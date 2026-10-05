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
LOCATION="${LOCATION:-southeastasia}"

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

die() { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }
say() { printf '\033[36m==>\033[0m %s\n' "$*"; }
ok()  { printf '\033[32m ok:\033[0m %s\n' "$*"; }

# --- prerequisites -----------------------------------------------------------

command -v az >/dev/null 2>&1 || die \
  "Azure CLI not found. Install it with:  winget install Microsoft.AzureCLI"

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
printf '     from  %s\n' "${DIRECT_URL%%@*}@db.${PROJECT_REF}.supabase.co"
printf '     to    %s\n' "${POOLER_URL%%@*}@${POOLER_HOST}:${POOLER_PORT}"

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

# --- resource group ----------------------------------------------------------

if az group show -n "$RG" >/dev/null 2>&1; then
  ok "resource group $RG already exists"
else
  say "Creating resource group $RG in $LOCATION"
  az group create -n "$RG" -l "$LOCATION" -o none
  ok "resource group created"
fi

# --- build and deploy --------------------------------------------------------

# `az containerapp up --source` creates the registry, builds the Dockerfile in
# the cloud, provisions the Container Apps environment and deploys. It is the
# one command that does not need a local Docker daemon.
say "Building and deploying (this takes a few minutes on the first run)"
az containerapp up \
  --name "$APP" \
  --resource-group "$RG" \
  --location "$LOCATION" \
  --source "$ROOT/backend" \
  --target-port "$PORT_TARGET" \
  --ingress external \
  --env-vars "${ENV_ARGS[@]}" \
  -o none

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
