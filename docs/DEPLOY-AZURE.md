# Deploying for free: Azure Container Apps + Cloudflare Pages

This supersedes `DEPLOY-FREE-TIER.md` and `PERMANENT-DEPLOYMENT.md`, both of
which are built on **Render**. Render requires a credit card even on its free
plan, confirmed firsthand on final submit — so that path is closed. Hugging Face
now requires PRO for Docker Spaces, Koyeb removed free compute, and Zeabur
removed its free tier.

**Target cost: $0/month. No credit card anywhere.**

---

## What you need

Two accounts, both free, neither requiring a card:

| # | What | Where | Why |
|---|---|---|---|
| 1 | **Azure for Students** | <https://azure.microsoft.com/free/students> | Hosts the backend. $100 credit, renewable yearly, and 65+ always-free services. Requires a **school email** or GitHub Student Pack verification. |
| 2 | **Cloudflare** account | <https://dash.cloudflare.com/sign-up> | Hosts the dashboard on Pages. Unlimited bandwidth, and commercial use is permitted. |

Already done, no action needed:

- **GitHub repository** — pushed, at `HYT-Foundation-Inc-Tech-Interns/KSI-AttendanceGeofencingandBiometrics-`
- **Supabase** — the database is live and reachable
- **`backend/Dockerfile`** — already correct, builds in the cloud
- **`render.yaml`** — not used by Azure, but keep it as the canonical list of environment variables

---

## Architecture

```
   Phone (worker)                    Admin (office)
        |                                   |
        | https                             | https
        v                                   v
   Cloudflare Pages  <project>.pages.dev   (static export of dashboard/)
   /checkin  (worker)      /dashboard  (admin)
        |
        | fetch, cross-origin, Bearer token
        v
   Azure Container Apps   <app>.<region>.azurecontainerapps.io   (NestJS, Docker)
        |                  min-replicas 0 -> free while idle
        |
        | postgres + PostGIS  (pooler, port 5432)
        v
   Supabase   aws-0-ap-northeast-2.pooler.supabase.com
```

---

## Step 1 — Azure for Students

1. Go to <https://azure.microsoft.com/free/students> and click **Start free**.
2. Sign in with the account you want to use, then verify student status with a
   **school email address**. If you have the GitHub Student Developer Pack, that
   is an accepted alternative.
3. No payment method is requested. If a card form appears, you have landed on
   the standard "Azure free account" page rather than the students page — go
   back and use the students URL.

Confirm it worked:

```bash
az account show --query '{name:name, state:state}' -o table
```

`state` must be `Enabled`.

---

## Step 2 — Deploy the backend

The script `scripts/deploy-azure.sh` does the whole thing: it derives the
Supabase pooler URL, reads the secrets out of `backend/.env`, builds the image
in the cloud, deploys, pins `min-replicas 0`, and polls `/v1/health` until the
database reports up.

```bash
# one-time
winget install Microsoft.AzureCLI
az login

# deploy
cd "C:/Users/arnel api/Documents/Klassic_ Field_ Attendance_System"
bash scripts/deploy-azure.sh
```

It prints the public URL when the app is healthy. Expect a few minutes on the
first run, most of it the cloud image build.

### Why the script rewrites `DATABASE_URL`

**This is the single most important thing in this document.** `backend/.env`
points at `db.fwmjwjgeajwpnmxeqbyv.supabase.co`, which resolves to **IPv6
only** — it has no `A` record at all. It works on this development machine
because the machine has IPv6. Azure Container Apps is **IPv4-only**, so the
direct host is unreachable from there, and the failure surfaces as a generic
connection timeout rather than a DNS error — which sends you looking in the
wrong place entirely.

The script rewrites it to the pooler, which does have IPv4:

```
postgresql://postgres.fwmjwjgeajwpnmxeqbyv:<password>@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres
```

Two details that are easy to get wrong:

- The **username must carry the project ref** (`postgres.<ref>`). A bare
  `postgres` fails with `tenant/user postgres not found`.
- Port **5432 is session mode**, which is the safe choice for an ORM. Port 6543
  is transaction mode — more connection-efficient, but it breaks anything
  relying on session state. Both were verified working; the script uses 5432.

---

## Step 3 — Deploy the dashboard to Cloudflare Pages

1. Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git**,
   and pick the repository.
2. Build settings:

   | Setting | Value |
   |---|---|
   | Production branch | `main` |
   | Framework preset | `None` |
   | **Root directory** | `dashboard` |
   | Build command | `npm run build` |
   | Build output directory | `out` |

3. Environment variables (set for **Production** and **Preview**):

   | Variable | Value |
   |---|---|
   | `NEXT_PUBLIC_API_URL` | `https://<your-app>.<region>.azurecontainerapps.io/v1` |
   | `NODE_VERSION` | `22` |

   > **`NEXT_PUBLIC_API_URL` is inlined at build time.** Changing it later needs
   > a **rebuild**, not a restart — redeploying the same commit with the old
   > value baked in silently keeps calling the old URL.

   > **`NODE_VERSION=22` is required.** `next@16.3.5` declares
   > `engines.node >= 20.9.0`, and Pages defaults lower.

4. Deploy, and note the URL: `https://<project>.pages.dev`.

---

## Step 4 — Wire them together

Both of these are backend environment variables. Set them and Azure restarts
the revision automatically:

```bash
RG=klassic-attendance-rg
APP=klassic-attendance-api
PAGES=https://<project>.pages.dev

az containerapp update -n "$APP" -g "$RG" \
  --set-env-vars "CORS_ORIGINS=$PAGES" "APP_CHECKIN_URL=$PAGES/checkin"
```

- **`CORS_ORIGINS`** — comma-separated, **no trailing slash**. Without this the
  browser blocks every API call while `curl` from a terminal still works, which
  is the classic "it works locally" CORS symptom.
- **`APP_CHECKIN_URL`** — the link inside the employee credential email.

---

## Step 5 — Verify

```bash
BASE=https://<your-app>.<region>.azurecontainerapps.io

# 1. the API is up AND can reach Supabase
curl -s "$BASE/v1/health"
# expect: {"status":"ok",...,"services":{"database":"up"}}

# 2. CORS actually allows the dashboard origin
curl -s -D - -o /dev/null -H "Origin: https://<project>.pages.dev" \
  "$BASE/v1/health" | grep -i access-control

# 3. the dashboard is being served
curl -s -o /dev/null -w '%{http_code}\n' https://<project>.pages.dev/dashboard

# 4. a real login through the public URL
curl -s -X POST "$BASE/v1/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"email":"<a-real-account>","password":"<its-password>"}'
```

Then on a phone, open `https://<project>.pages.dev/checkin`, grant **location**
and **camera**, and check in.

> **HTTPS is mandatory.** `navigator.geolocation` and `navigator.mediaDevices`
> are `undefined` outside a secure context. On plain `http://192.168.x.x` the
> camera silently does not exist. Only `https://` and `localhost` count.

---

## Caveats, stated plainly

1. **Scale-to-zero means a cold start.** With `min-replicas 0` the first request
   after a quiet period waits a few seconds while the container starts.
   `api.warmUp()` in `dashboard/src/lib/api.ts` pings `/v1/health` as the
   check-in page loads to start that early. Setting `min-replicas 1` removes the
   cold start but bills ~$34/month continuously — it is the one setting that
   turns this from free into not-free.

2. **Face verification runs in-process.** `BiometricService` falls back to
   `DescriptorMatchService`, so check-in verifies **who** as well as **where**
   with no external service. `DEV_SKIP_BIOMETRIC_VERIFICATION` must stay
   `false`; setting it `true` silently disables face matching and reduces
   check-in to geofence-only.

3. **Supabase free projects pause after 7 days without a database request.**
   Data is not lost; the project needs a manual resume from the dashboard, and
   there are no backups on the free plan. A scheduled keep-alive ping prevents
   it. **Pro ($25/month) removes the pause** and is the right upgrade once real
   staff depend on this.

4. **The free tier has no SLA.** Fine for a pilot; not something to put payroll
   data behind without a paid plan.

5. **`dashboard/vercel.json` still rewrites `/v1/*` to a dead tunnel.** It is
   ignored by Cloudflare Pages, but if you deploy to Vercel instead it must be
   repointed at the Azure URL or deleted. Note Vercel's Hobby tier forbids
   commercial use — Cloudflare Pages does not.

6. **`connectionTimeoutMillis` is 2000 ms** in
   `backend/src/config/database.config.ts`. Measured against the pooler the
   connect alone took **989 ms** — half the budget before any query. From Azure
   it will be faster, but a cold TLS handshake can exceed 2 s. **Raise it to
   10000.** This is the most likely cause of the intermittent
   `Connection terminated due to connection timeout` errors on login.

---

## What was verified

- The pooler endpoint was found by **actual connection**, not by guessing the
  region: `aws-0-ap-northeast-2.pooler.supabase.com` (Seoul, not Singapore).
  Both ports 5432 and 6543 authenticate and return real rows.
- The deploy script's URL rewrite was tested against the real `backend/.env`:
  it derives the project ref `fwmjwjgeajwpnmxeqbyv` correctly and all twelve
  secrets resolve.
- `scripts/deploy-azure.sh` passes `bash -n`.
- The local stack is up: `/v1/health` reports `"database":"up"`.
- **Not** verified: the Docker image build itself. This machine has no Docker,
  which is precisely why the script builds in Azure Container Registry instead
  of locally.
