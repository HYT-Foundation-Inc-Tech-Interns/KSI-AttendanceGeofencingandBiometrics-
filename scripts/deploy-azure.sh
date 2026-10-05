#!/usr/bin/env bash
#
# Deploy the Klassic attendance API to Azure Container Apps.
#
# The image is built by .github/workflows/build-backend.yml and pushed to
# Azure Container Registry. This script does not build anything: it points the
# container app at the image and wires up the credentials.
#
# Cost: the app itself is $0. Azure grants every subscription 180,000
# vCPU-seconds, 360,000 GiB-seconds and 2,000,000 requests per calendar month,
# and a revision scaled to zero replicas incurs no resource charge. The script
# pins min-replicas to 0 so the app is free while idle.
#
# The registry is the one recurring cost: ACR Basic is about $5/month. It
# already existed on this subscription -- an earlier `az containerapp up` had
# created it -- so this deployment adds nothing to it.
#
# Prerequisites:
#   - Azure CLI installed   (winget install Microsoft.AzureCLI)
#   - az login              (a subscription with credit -- see
#                            https://azure.microsoft.com/free/students)
#   - backend/.env present  (it supplies the secrets; it is gitignored)
#   - the image already pushed to ACR by the GitHub Actions workflow
#
# Usage:
#   bash scripts/deploy-azure.sh
#
# Override any of these by exporting them first:
#   RG, APP, ENVNAME, ACR_NAME, LOCATION, POOLER_HOST, POOLER_PORT

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/backend/.env"

RG="${RG:-klassic-attendance-rg}"
APP="${APP:-klassic-attendance-api}"
ENVNAME="${ENVNAME:-klassic-attendance-api-env}"

# --- the registry ------------------------------------------------------------
#
# Azure Container Registry, NOT ghcr.io.
#
# ghcr.io was the first choice, and it does not work here: ghcr creates
# packages PRIVATE even when they are pushed from a public repository, so
# Container Apps cannot pull the image and the revision dies with
#
#   BuildFailed: Authentication failed when pulling container image ...
#     Provide 'registryCredentials' (username and token) ...
#
# which reads like a credentials problem but is a visibility one. A workflow
# cannot fix it either: changing an org package's visibility needs admin rights
# that a repository-scoped GITHUB_TOKEN does not have, and the API call reports
# success while changing nothing because curl exits 0 on an HTTP error.
#
# ACR has none of those problems, and the registry already existed.
ACR_NAME="${ACR_NAME:-ca023b128445acr}"
REGISTRY_SERVER="${ACR_NAME}.azurecr.io"
IMAGE="${IMAGE:-${REGISTRY_SERVER}/klassic-attendance-api:latest}"

# The identity the app uses to pull. `system` means its own system-assigned
# managed identity, so no registry password is stored anywhere. The matching
# AcrPull grant is applied below.
REGISTRY_IDENTITY="${REGISTRY_IDENTITY:-system}"

# Built-in role definition. A fixed GUID published by Microsoft.
ACR_PULL_ROLE_ID="7f951dda-4ed3-4680-a7ca-43fe172d538d"

# A FIXED guid for the AcrPull assignment, rather than a random one per run.
# A role assignment is identified by its GUID and PUT is an upsert, so reusing
# the same GUID makes re-running this script idempotent instead of accumulating
# duplicate assignments.
ACR_PULL_ASSIGNMENT_GUID="b7c1f0a2-9d34-4e58-9a61-2f8c3d5e7a90"

# Azure for Students attaches a `sys.regionrestriction` policy ("Allowed
# resource deployment regions") that limits deployments to a fixed list. On
# this subscription the allowed set is exactly:
#
#   indiasouthcentral, koreacentral, eastasia, malaysiawest, australiaeast
#
# southeastasia is NOT on it. The failure is a RequestDisallowedByAzure error
# naming the auto-generated Log Analytics workspace, which does not obviously
# point at a region problem -- check the policy, not the resource:
#
#   az policy assignment list -o json | grep -A12 listOfAllowedLocations
#
# koreacentral (Seoul) is chosen deliberately rather than eastasia (Hong Kong).
# The Supabase pooler is aws-0-ap-northeast-2, which IS Seoul, so the API runs
# in the same region as the database. That removes a ~35-40 ms round trip from
# every query, and a single request makes several. Hong Kong is marginally
# closer to Philippine users, but the database hop compounds and the user hop
# does not.
LOCATION="${LOCATION:-koreacentral}"

# The Supabase pooler. The direct host (db.<ref>.supabase.co) is IPv6-only and
# Azure Container Apps is IPv4-only, so the direct host cannot be reached from
# here at all -- it fails as a generic connection timeout, not a DNS error.
# This endpoint was confirmed by an actual connection test.
POOLER_HOST="${POOLER_HOST:-aws-0-ap-northeast-2.pooler.supabase.com}"
# 5432 is session mode and is the safe choice for an ORM. 6543 is transaction
# mode: more connection-efficient, but it breaks anything relying on session
# state (advisory locks, prepared statements, SET).
POOLER_PORT="${POOLER_PORT:-5432}"

PORT_TARGET=3000

die() { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }
say() { printf '\033[36m==>\033[0m %s\n' "$*"; }
ok()  { printf '\033[32m ok:\033[0m %s\n' "$*"; }

# --- prerequisites -----------------------------------------------------------

# winget updates PATH for NEW shells only, so a CLI installed moments ago is
# invisible to an already-running session. Check the standard install location
# before concluding it is missing.
if ! command -v az >/dev/null 2>&1; then
  for d in "/c/Program Files/Microsoft SDKs/Azure/CLI2/wbin" \
           "/c/Program Files (x86)/Microsoft SDKs/Azure/CLI2/wbin"; do
    if [ -x "$d/az" ] || [ -f "$d/az.cmd" ]; then
      PATH="$PATH:$d"
      export PATH
      break
    fi
  done
fi

command -v az >/dev/null 2>&1 || die \
  "Azure CLI not found. Install it with:  winget install Microsoft.AzureCLI
     then open a NEW terminal -- an install does not reach a running shell."

[ -f "$ENV_FILE" ] || die \
  "backend/.env not found. It supplies the secrets and is gitignored."

az account show >/dev/null 2>&1 || die \
  "Not signed in to Azure. Run:  az login"

SUBSCRIPTION="$(az account show --query name -o tsv)"
SUBSCRIPTION_ID="$(az account show --query id -o tsv)"
say "Subscription: $SUBSCRIPTION"

# --- read secrets out of backend/.env ----------------------------------------

# Pulls a single key, tolerating CRLF (this is a Windows checkout), surrounding
# quotes, and trailing whitespace.
get_env() {
  sed -n "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*//p" "$ENV_FILE" \
    | head -n1 \
    | sed -e 's/\r$//' -e 's/[[:space:]]*$//' \
          -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/"
}

require_env() {
  local v
  v="$(get_env "$1")"
  [ -n "$v" ] || die "backend/.env has no value for $1"
  printf '%s' "$v"
}

# --- rewrite DATABASE_URL onto the pooler ------------------------------------

DIRECT_URL="$(require_env DATABASE_URL)"
[ -n "$DIRECT_URL" ] || die "DATABASE_URL is empty"

# postgresql://<user>:<pass>@<host>:<port>/<db>
# Split on the LAST '@' so a password containing '@' does not break the parse.
CREDS="${DIRECT_URL%%@*}"          # postgresql://user:pass
HOSTPART="${DIRECT_URL##*@}"       # host:port/db
USERINFO="${CREDS#*://}"           # user:pass
DBUSER="${USERINFO%%:*}"           # user
PASSWORD="${USERINFO#*:}"          # pass
HOSTPORT="${HOSTPART%%/*}"         # host:port
DBPATH="${HOSTPART#*/}"            # db
PROJECT_REF="${HOSTPORT%%.*}"      # the host is db.<ref>.supabase.co

if [ "$PROJECT_REF" = "db" ]; then
  PROJECT_REF="${HOSTPORT#db.}"
  PROJECT_REF="${PROJECT_REF%%.*}"
fi

[ -n "$PROJECT_REF" ] || die "Could not derive the project ref from DATABASE_URL"

# The pooler requires the username to carry the project ref.
POOLER_USER="postgres.${PROJECT_REF}"
POOLER_URL="postgresql://${POOLER_USER}:${PASSWORD}@${POOLER_HOST}:${POOLER_PORT}/${DBPATH}"

say "Database: rewrote the direct host to the pooler"
printf '     from  %s\n' "postgresql://<user>:***@db.${PROJECT_REF}.supabase.co"
printf '     to    %s\n' "postgresql://${POOLER_USER}:***@${POOLER_HOST}:${POOLER_PORT}/${DBPATH}"

# --- assemble the environment ------------------------------------------------

# Fixed values, matching render.yaml so the two stay in step.
declare -a FIXED=(
  "NODE_ENV=production"
  "API_PREFIX=v1"
  "LOG_LEVEL=log"
  "PORT=${PORT_TARGET}"
  "JWT_EXPIRES_IN=15m"
  "JWT_REFRESH_EXPIRES_IN=7d"
  "DEV_SKIP_GEOFENCE_VALIDATION=false"
  "DEV_SKIP_BIOMETRIC_VERIFICATION=false"
  "FACE_MATCH_THRESHOLD=0.85"
  "LIVENESS_THRESHOLD=0.7"
  "MAX_GEOFENCE_DISTANCE_M=1000"
  "MAX_TIMESTAMP_DRIFT_SEC=300"
  "MAX_SHIFT_HOURS=16"
  "RATE_LIMIT=100"
  "BIOMETRIC_RETENTION_DAYS=365"
  "AUDIT_LOG_RETENTION_DAYS=2555"
  "ENABLE_OFFLINE_SYNC=true"
  "ENABLE_MOCK_LOCATION_DETECTION=true"
  "ENABLE_ROOT_JAILBREAK_DETECTION=true"
  "ENABLE_PAYROLL_AUTO_EXPORT=false"
)

# Secrets, pulled from backend/.env.
declare -a SECRET_KEYS=(
  JWT_SECRET
  JWT_REFRESH_SECRET
  HMAC_DEVICE_SIGNING_KEY
  ENCRYPTION_KEY
  SMTP_HOST
  SMTP_PORT
  SMTP_SECURE
  SMTP_USER
  SMTP_PASS
  SMTP_FROM
  APP_CHECKIN_URL
  CORS_ORIGINS
)

declare -a ENV_ARGS=("DATABASE_URL=${POOLER_URL}")
for kv in "${FIXED[@]}"; do ENV_ARGS+=("$kv"); done
for k in "${SECRET_KEYS[@]}"; do
  v="$(get_env "$k")"
  if [ -n "$v" ]; then
    ENV_ARGS+=("${k}=${v}")
  else
    printf '\033[33mwarn:\033[0m %s is unset in backend/.env -- skipping\n' "$k"
  fi
done

say "Environment: ${#ENV_ARGS[@]} variables prepared"

# --- is the image actually there? --------------------------------------------

# Checked here because discovering it at deploy time costs a failed revision
# and an error that never mentions the real cause.
say "Checking that the image exists in $ACR_NAME"
if az acr repository show-tags -n "$ACR_NAME" --repository klassic-attendance-api \
     -o tsv >/dev/null 2>&1; then
  TAGS="$(az acr repository show-tags -n "$ACR_NAME" --repository klassic-attendance-api -o tsv 2>/dev/null | tr '\n' ' ')"
  ok "found tags: ${TAGS}"
else
  die "No 'klassic-attendance-api' repository in $ACR_NAME yet.

     The image is built by GitHub Actions, not by this script. Trigger it with:
       gh workflow run build-backend.yml
     or push a change under backend/ to main. Watch it at:
       https://github.com/HYT-Foundation-Inc-Tech-Interns/KSI-AttendanceGeofencingandBiometrics-/actions"
fi

# --- resource group ----------------------------------------------------------

if az group show -n "$RG" >/dev/null 2>&1; then
  ok "resource group $RG already exists"
else
  say "Creating resource group $RG in $LOCATION"
  az group create -n "$RG" -l "$LOCATION" -o none
  ok "resource group created"
fi

# --- resource providers ------------------------------------------------------

# A fresh subscription has these namespaces unregistered, and `az containerapp
# up` only registers some of them -- it fails on Microsoft.ContainerRegistry
# with "MissingSubscriptionRegistration" *after* creating the environment, so
# the error arrives late and looks like a different problem.
#
# Registration is per-subscription and one-time; it takes a minute or two each.
# `--wait` matters: without it the very next command races the registration and
# fails with the same error it was meant to prevent.
say "Registering resource providers (one-time per subscription)"
for ns in Microsoft.ContainerRegistry Microsoft.App Microsoft.OperationalInsights Microsoft.Storage; do
  STATE="$(az provider show -n "$ns" --query registrationState -o tsv 2>/dev/null || echo NotRegistered)"
  if [ "$STATE" = "Registered" ]; then
    printf '     %-34s already registered\n' "$ns"
  else
    printf '     %-34s registering (was %s)...\n' "$ns" "$STATE"
    az provider register -n "$ns" --wait --only-show-errors >/dev/null 2>&1 \
      || die "Failed to register $ns. Try:  az provider register -n $ns --wait"
    ok "  $ns registered"
  fi
done

# --- environment -------------------------------------------------------------

if az containerapp env show -n "$ENVNAME" -g "$RG" >/dev/null 2>&1; then
  ok "Container Apps environment $ENVNAME already exists"
else
  say "Creating the Container Apps environment (first run only, a few minutes)"
  az containerapp env create \
    -n "$ENVNAME" -g "$RG" --location "$LOCATION" \
    --only-show-errors -o none
  ok "environment created"
fi

# --- create or update the app ------------------------------------------------

# Note the image is not built here. See the IMAGE comment at the top.
#
# The registry is deliberately NOT configured in this block.
# `az containerapp update` has no --registry-* flags at all -- only `create`
# does -- so configuring it inline would work on the first run and fail on
# every later one with "unrecognized arguments". `az containerapp registry set`
# is used below instead, which works for both paths.
if az containerapp show -n "$APP" -g "$RG" >/dev/null 2>&1; then
  say "Updating the existing container app to $IMAGE"
  az containerapp update -n "$APP" -g "$RG" \
    --image "$IMAGE" \
    --set-env-vars "${ENV_ARGS[@]}" \
    --only-show-errors -o none
else
  say "Creating the container app from $IMAGE"
  az containerapp create \
    -n "$APP" -g "$RG" \
    --environment "$ENVNAME" \
    --image "$IMAGE" \
    --target-port "$PORT_TARGET" \
    --ingress external \
    --min-replicas 0 --max-replicas 3 \
    --env-vars "${ENV_ARGS[@]}" \
    --only-show-errors -o none
fi

ok "container app is pointed at the image"

# --- let the app pull from the registry --------------------------------------

# The app pulls with its own system-assigned managed identity, so no registry
# password is stored anywhere.
say "Assigning a system-assigned managed identity to the app"
PRINCIPAL_ID="$(az containerapp identity assign -n "$APP" -g "$RG" \
  --system-assigned --query principalId -o tsv 2>/dev/null || true)"

if [ -z "$PRINCIPAL_ID" ]; then
  # Already assigned on a previous run.
  PRINCIPAL_ID="$(az containerapp identity show -n "$APP" -g "$RG" \
    --query principalId -o tsv 2>/dev/null || true)"
fi
[ -n "$PRINCIPAL_ID" ] || die "Could not determine the app's managed identity"
ok "identity: $PRINCIPAL_ID"

say "Pointing the app at $REGISTRY_SERVER using that identity"
az containerapp registry set -n "$APP" -g "$RG" \
  --server "$REGISTRY_SERVER" --identity "$REGISTRY_IDENTITY" \
  --only-show-errors -o none

# AcrPull for that identity.
#
# IMPORTANT: this uses `az rest`, not `az role assignment`. On this
# subscription every `az role assignment` verb fails with
#
#   MissingSubscription: The request did not have a subscription or a valid
#   tenant level resource provider.
#
# even though `az role definition list` works and the ARM REST API is fine. The
# CLI verbs are the broken part, so the assignment goes through `az rest`.
ACR_ID="/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/${RG}/providers/Microsoft.ContainerRegistry/registries/${ACR_NAME}"
ASSIGNMENT_URL="https://management.azure.com${ACR_ID}/providers/Microsoft.Authorization/roleAssignments/${ACR_PULL_ASSIGNMENT_GUID}?api-version=2022-04-01"
ROLE_BODY="{\"properties\":{\"roleDefinitionId\":\"/subscriptions/${SUBSCRIPTION_ID}/providers/Microsoft.Authorization/roleDefinitions/${ACR_PULL_ROLE_ID}\",\"principalId\":\"${PRINCIPAL_ID}\",\"principalType\":\"ServicePrincipal\"}}"

say "Granting AcrPull to $PRINCIPAL_ID"
# PUT is an upsert, so this is safe to re-run.
az rest --method put --url "$ASSIGNMENT_URL" \
  --headers "Content-Type=application/json" \
  --body "$ROLE_BODY" --only-show-errors -o none \
  || die "Could not grant AcrPull. See the note above about az rest vs az role assignment."
ok "AcrPull granted"

# A role assignment takes a moment to propagate, and the revision may already
# have failed its pull by the time the grant lands. Restarting makes it retry
# with the grant in place.
say "Restarting so the pull retries with the new identity"
REV="$(az containerapp revision list -n "$APP" -g "$RG" --query '[0].name' -o tsv 2>/dev/null || true)"
if [ -n "$REV" ]; then
  az containerapp revision restart -n "$APP" -g "$RG" --revision "$REV" \
    --only-show-errors -o none 2>/dev/null || true
fi

# --- scale to zero, and make it actually free while idle ---------------------

say "Pinning min-replicas=0 so idle time costs nothing"
az containerapp update \
  -n "$APP" -g "$RG" \
  --min-replicas 0 --max-replicas 3 \
  -o none

FQDN="$(az containerapp show -n "$APP" -g "$RG" \
  --query 'properties.configuration.ingress.fqdn' -o tsv)"
BASE="https://${FQDN}"

say "URL: ${BASE}"

# --- verify ------------------------------------------------------------------

say "Waiting for /v1/health to report the database is up"
for i in $(seq 1 30); do
  BODY="$(curl -fsS -m 10 "${BASE}/v1/health" 2>/dev/null || true)"
  case "$BODY" in
    *'"database":"up"'*)
      ok "healthy: ${BODY}"
      printf '\n\033[32mDeployed.\033[0m %s\n\n' "$BASE"
      printf 'Next:\n'
      printf '  1. Point the dashboard at %s/v1\n' "$BASE"
      printf '  2. Set CORS_ORIGINS to the dashboard origin\n'
      printf '  3. Set APP_CHECKIN_URL to <dashboard>/checkin\n\n'
      exit 0
      ;;
  esac
  sleep 10
done

die "Timed out waiting for the app to become healthy.
     Inspect the logs with:
       az containerapp logs show -n $APP -g $RG --follow
     A 500 on /v1/health usually means the database is unreachable, which means
     DATABASE_URL is wrong -- not that the deploy failed."
