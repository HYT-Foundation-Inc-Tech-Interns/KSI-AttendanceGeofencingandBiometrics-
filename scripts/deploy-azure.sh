#!/usr/bin/env bash
#
# Deploy the Klassic attendance API to Azure Container Apps.
#
# Everything is built in the cloud by Azure Container Registry, so this needs
# no local Docker -- which matters, because this machine has none installed and
# the image has never been built end to end locally.
#
# Cost: $0. Azure grants every subscription 180,000 vCPU-seconds, 360,000
# GiB-seconds and 2,000,000 requests per calendar month, and a revision scaled
# to zero replicas incurs no resource charge. The script pins min-replicas to 0
# so the app is free while idle.
#
# Prerequisites:
#   - Azure CLI installed   (winget install Microsoft.AzureCLI)
#   - az login              (must be a subscription with credit -- see
#                            https://azure.microsoft.com/free/students)
#   - backend/.env present  (it supplies the secrets; it is gitignored)
#
# Usage:
#   bash scripts/deploy-azure.sh
#
# Override any of these by exporting them first:
#   RG, APP, LOCATION, POOLER_HOST, POOLER_PORT

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/backend/.env"

RG="${RG:-klassic-attendance-rg}"
APP="${APP:-klassic-attendance-api}"
ENVNAME="${ENVNAME:-klassic-attendance-api-env}"

# The image is built by .github/workflows/build-backend.yml and pushed to
# ghcr.io -- it is NOT built in Azure.
#
# Azure for Students blocks ACR Tasks ("TasksOperationsNotAllowed"), and ACR
# Tasks is the mechanism `az containerapp up --source` relies on to build in the
# cloud. This machine has no Docker either, so neither cloud nor local building
# is available. GitHub Actions covers both.
#
# The image name is FIXED, not derived from the repository. The repository is
# `KSI-AttendanceGeofencingandBiometrics-`, and lowercasing it yields a trailing
# hyphen -- Docker image components must match [a-z0-9]+([._-][a-z0-9]+)*, so
# ghcr.io rejects it with NAME_INVALID. The owner segment is lowercased from
# `HYT-Foundation-Inc-Tech-Interns`.
#
# ghcr.io packages are PRIVATE BY DEFAULT, even when they are pushed from a
# public repository, and even though the repository's contents are world
# readable. Container Apps then fails with:
#
#   BuildFailed: Authentication failed when pulling container image
#   'ghcr.io/...:latest'. Provide 'registryCredentials' (username and token)
#   or 'managedIdentityClientId' in your request to authenticate.
#
# There are exactly two ways out, and this script supports both:
#
#   1. Make the package public (no token needed):
#      https://github.com/orgs/HYT-Foundation-Inc-Tech-Interns/packages/container/klassic-attendance-api/settings
#      -> Danger Zone -> Change visibility -> Public
#
#   2. Keep it private and hand the app a token. Export GHCR_USER and
#      GHCR_TOKEN before running; GHCR_TOKEN needs only `read:packages`.
#
#      GHCR_USER=your-github-username GHCR_TOKEN=ghp_xxx bash scripts/deploy-azure.sh
#
# A `GITHUB_TOKEN` inside the workflow CANNOT flip package visibility: the
# PATCH returns an error body while curl still exits 0, so the step reports
# success and changes nothing. That is why the workflow's "Make the package
# public" step looks green but the package stays private.
IMAGE="${IMAGE:-ghcr.io/hyt-foundation-inc-tech-interns/klassic-attendance-api:latest}"
# Azure for Students attaches a `sys.regionrestriction` policy ("Allowed
# resource deployment regions") that limits deployments to a fixed list. On this
# subscription the allowed set is exactly:
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
IMAGE_TAG="klassic-api:$(date +%Y%m%d-%H%M%S)"

# Registry credentials, only if the package is private AND the user supplied a
# token. See the IMAGE comment above for the two supported options.
#
# `set -u` plus an empty array is a trap: "${ARR[@]}" is an unbound-variable
# error on bash < 4.4, so every expansion below is written in the guarded form.
declare -a REGISTRY_ARGS=()
if [ -n "${GHCR_TOKEN:-}" ]; then
  REGISTRY_ARGS=(
    --registry-server "ghcr.io"
    --registry-username "${GHCR_USER:-}"
    --registry-password "$GHCR_TOKEN"
  )
fi

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

# --- can we actually pull the image? -----------------------------------------

# Ask ghcr.io anonymously. 200 means the package is public and no credential is
# needed; 401 means it is private. Discovering this here costs one second, and
# discovering it at deploy time costs a failed revision and a confusing
# BuildFailed error that never mentions visibility.
IMAGE_REPO="${IMAGE%%:*}"
if [ "${#REGISTRY_ARGS[@]}" -eq 0 ]; then
  CODE="$(curl -sS -o /dev/null -w '%{http_code}' -m 15 \
    "https://ghcr.io/v2/${IMAGE_REPO#ghcr.io/}/tags/list" 2>/dev/null || echo 000)"
  case "$CODE" in
    200)
      ok "image is publicly pullable (no registry credential needed)"
      ;;
    401|403)
      die "The image at ${IMAGE_REPO} is PRIVATE, so Container Apps cannot pull it.

     Pick ONE of these two fixes:

     (1) Make the package public -- no token, 15 seconds:
         https://github.com/orgs/HYT-Foundation-Inc-Tech-Interns/packages/container/klassic-attendance-api/settings
         -> scroll to 'Danger Zone' -> 'Change visibility' -> 'Public'
         -> type the package name to confirm, then re-run this script.

     (2) Keep it private and supply a token with read:packages:
         GHCR_USER=<your-github-username> GHCR_TOKEN=ghp_xxx bash scripts/deploy-azure.sh

     Note: a repository-scoped GITHUB_TOKEN cannot change package visibility,
     which is why the workflow's make-public step cannot fix this for you."
      ;;
    000)
      printf '\033[33mwarn:\033[0m could not reach ghcr.io to check visibility; continuing\n'
      ;;
    *)
      printf '\033[33mwarn:\033[0m unexpected response %s from ghcr.io; continuing\n' "$CODE"
      ;;
  esac
else
  ok "using supplied registry credentials for ${IMAGE_REPO#ghcr.io/}"
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

# --- deploy ------------------------------------------------------------------

# Note the image is not built here. See the IMAGE comment at the top: ACR Tasks
# are blocked on this subscription, so the build happens in GitHub Actions and
# this script only points the container app at the result.
if az containerapp show -n "$APP" -g "$RG" >/dev/null 2>&1; then
  say "Updating the existing container app to $IMAGE"
  az containerapp update -n "$APP" -g "$RG" \
    --image "$IMAGE" \
    ${REGISTRY_ARGS[@]+"${REGISTRY_ARGS[@]}"} \
    --set-env-vars "${ENV_ARGS[@]}" \
    --only-show-errors -o none
else
  say "Creating the container app from $IMAGE"
  az containerapp create \
    -n "$APP" -g "$RG" \
    --environment "$ENVNAME" \
    --image "$IMAGE" \
    ${REGISTRY_ARGS[@]+"${REGISTRY_ARGS[@]}"} \
    --target-port "$PORT_TARGET" \
    --ingress external \
    --min-replicas 0 --max-replicas 3 \
    --env-vars "${ENV_ARGS[@]}" \
    --only-show-errors -o none
fi

ok "deployed"

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
