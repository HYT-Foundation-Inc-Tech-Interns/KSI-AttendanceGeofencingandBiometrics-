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

# --- registry credentials ----------------------------------------------------
#
# Username/password, NOT a managed identity.
#
# The obvious approach is a system-assigned managed identity plus an AcrPull
# grant. It is not available here. This Container Apps environment is an
# *express* environment, which rejects managed identity outright:
#
#   ExpressEnvironmentFeatureNotSupported: 'System-assigned managed identity' is
#   not supported for container app ... on express environments.
#
# Worse, once an identity IS attached, every later update fails with that same
# error, so the app becomes un-updatable until the identity is removed. It is
# removed here if present, and never assigned again.
#
# The ACR admin account is used instead. The credentials are read from Azure at
# deploy time and written into the app's configuration; they are never placed in
# the repository and nothing about them is committed.
say "Reading the $ACR_NAME admin credentials"
ACR_USER="$(az acr credential show -n "$ACR_NAME" --query username -o tsv 2>/dev/null || true)"
ACR_PASS="$(az acr credential show -n "$ACR_NAME" --query 'passwords[0].value' -o tsv 2>/dev/null || true)"

if [ -z "$ACR_USER" ] || [ -z "$ACR_PASS" ]; then
  say "Admin account is disabled; enabling it"
  az acr update -n "$ACR_NAME" --admin-enabled true --only-show-errors -o none
  ACR_USER="$(az acr credential show -n "$ACR_NAME" --query username -o tsv)"
  ACR_PASS="$(az acr credential show -n "$ACR_NAME" --query 'passwords[0].value' -o tsv)"
fi
[ -n "$ACR_USER" ] && [ -n "$ACR_PASS" ] || die \
  "Could not read the ACR admin credentials for $ACR_NAME"
ok "registry user: $ACR_USER"

# --- create or update --------------------------------------------------------

if az containerapp show -n "$APP" -g "$RG" >/dev/null 2>&1; then
  APP_EXISTS=1
else
  APP_EXISTS=0
fi

# An express environment does not support revision suffixes, so a stuck revision
# cannot simply be replaced -- and the app has already been left un-pullable
# once. FORCE_RECREATE=1 deletes it so the next create supplies credentials
# from the very first revision, which is the only ordering an express
# environment reliably accepts.
if [ "$APP_EXISTS" -eq 1 ] && [ "${FORCE_RECREATE:-0}" = "1" ]; then
  say "Deleting the existing container app (FORCE_RECREATE=1)"
  az containerapp delete -n "$APP" -g "$RG" --yes --only-show-errors -o none
  APP_EXISTS=0
  ok "deleted"
fi

if [ "$APP_EXISTS" -eq 0 ]; then
  say "Creating the container app with registry credentials from the start"
  az containerapp create \
    -n "$APP" -g "$RG" \
    --environment "$ENVNAME" \
    --image "$IMAGE" \
    --registry-server "$REGISTRY_SERVER" \
    --registry-username "$ACR_USER" \
    --registry-password "$ACR_PASS" \
    --target-port "$PORT_TARGET" \
    --ingress external \
    --min-replicas 0 --max-replicas 3 \
    --env-vars "${ENV_ARGS[@]}" \
    --only-show-errors -o none
  ok "created"
else
  # An identity left over from an earlier attempt makes every update fail on an
  # express environment, so clear it first.
  if [ -n "$(az containerapp show -n "$APP" -g "$RG" --query 'identity.principalId' -o tsv 2>/dev/null || true)" ]; then
    say "Removing the managed identity (not supported on express environments)"
    az containerapp identity remove -n "$APP" -g "$RG" --system-assigned \
      --only-show-errors -o none 2>/dev/null || true
  fi

  say "Binding the registry"
  az containerapp registry set -n "$APP" -g "$RG" \
    --server "$REGISTRY_SERVER" \
    --username "$ACR_USER" --password "$ACR_PASS" \
    --only-show-errors -o none

  say "Applying the image $IMAGE"
  APPLIED=0
  for attempt in 1 2 3 4 5 6; do
    if az containerapp update -n "$APP" -g "$RG" \
         --image "$IMAGE" \
         --set-env-vars "${ENV_ARGS[@]}" \
         --only-show-errors -o none 2>/dev/null; then
      ok "image applied (attempt $attempt)"
      APPLIED=1
      break
    fi
    printf '\033[33mwarn://033[0m attempt %s failed; retrying in 20s\n' "$attempt"
    sleep 20
  done

  [ "$APPLIED" -eq 1 ] || die "Could not apply the image after 6 attempts.

     Check the registry binding:
       az containerapp registry list -n $APP -g $RG
     and that the tag really exists:
       az acr repository show-tags -n $ACR_NAME --repository klassic-attendance-api
     If the app is wedged, recreate it:
       FORCE_RECREATE=1 bash scripts/deploy-azure.sh"
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
