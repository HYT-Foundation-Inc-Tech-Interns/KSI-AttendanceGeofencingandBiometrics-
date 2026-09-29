# Deploying on free tiers only

Target cost: **$0/month**. This documents the exact path from this repository to
a working phone check-in, and every place the free tiers impose a constraint.

---

## What changed, and why

The native Expo app is **no longer part of the deployed system**. Field workers
now check in through a web page at `/checkin` in the dashboard app.

| | Expo app (before) | Web `/checkin` (now) |
|---|---|---|
| Distribution | App Store / Play Store / EAS build | A URL |
| Cost | $99/yr Apple account for iOS | $0 |
| Camera + GPS | Native modules | `navigator.mediaDevices` / `navigator.geolocation` |
| Updates | Rebuild and redistribute | Redeploy |
| Offline | Offline queue + sync | Not implemented |

The backend contract is unchanged — the same `POST /v1/attendance/check-in`
and `/check-out` with the same payload. Nothing in `backend/` was modified to
support this.

The `mobile/` directory is still in the repository. It is not deployed, and
nothing in the deployed path imports it.

**One capability was lost:** the native app had an offline queue
(`MAX_OFFLINE_QUEUE_SIZE`, retry/backoff, `POST /v1/sync`). The web page needs
connectivity to check in. For a site with no signal, that is a real regression
and the reason to keep the mobile app alive if offline check-in matters.

---

## Architecture

```
   Phone (worker)                    Admin (office)
        |                                   |
        | https                             | https
        v                                   v
  Cloudflare Pages  ──────────┐      Cloudflare Pages
  /checkin  (static)          │      /dashboard (static)
        │                     │            │
        │ fetch               │            │ fetch
        v                     v            v
   Render  ──── klassic-attendance-api ────  (Node/NestJS, Docker)
        │
        │ postgres + PostGIS
        v
   Supabase  (managed Postgres)
```

Both front ends are **static files**. That matters: Cloudflare Pages serves
static assets with **unlimited bandwidth and no per-request limit**, so the app
never touches the Workers free-tier ceiling (100k requests/day, 10 ms CPU).

Only the backend is a long-running process, and that is the one piece the free
tiers have largely stopped offering.

---

## Free-tier constraints that shape this

| Service | Constraint | Mitigation |
|---|---|---|
| **Render** free | Container stops after **15 min idle**, ~1 min cold start. Docs say "not for production." | `api.warmUp()` pings `/v1/health` when `/checkin` loads — the server wakes while the worker signs in and frames their face. |
| **Cloudflare Pages** free | 500 builds/month, 20,000 files, 25 MiB/file | Static export is well within all three. Commercial use **is** permitted (Vercel Hobby forbids it). |
| **Supabase** free | Project **pauses after 7 days** of low activity. **No backup retention.** | Data is not deleted; resume takes 30 s–3 min. Take a manual `pg_dump` before any risky change. |

Ruled out, checked in 2026: **Fly.io** (trial only, card required),
**Koyeb** (free compute removed), **Railway** (no free tier), **Vercel Hobby**
(commercial use prohibited).

---

## Before you start

- The repository must be on GitHub. Render and Cloudflare Pages both deploy
  from a Git remote, and there is currently **no remote configured**.
- Have `backend/.env` open — you will copy values out of it, but **never commit
  it**. It is already in `.gitignore`.

---

## Step 1 — Create the GitHub repository

The local repository already exists with one commit. Create an empty repo on
GitHub (**do not** let it add a README or .gitignore), then:

```bash
cd "C:/Users/arnel api/Documents/Klassic_ Field_ Attendance_System"
git remote add origin https://github.com/<your-username>/<repo-name>.git
git branch -M main
git push -u origin main
```

Verify nothing sensitive was pushed — this must print nothing:

```bash
git ls-files | grep -E "\.env$|\.env\.local"
```

---

## Step 2 — Deploy the backend to Render

1. Sign up at **render.com** (GitHub sign-in, no card required for free plan).
2. **New → Blueprint**, pick the repository. Render reads `render.yaml`.
3. Render prompts for the variables marked `sync: false`. Fill from `backend/.env`:
   - `DATABASE_URL` — the Supabase connection string
   - `JWT_SECRET`, `JWT_REFRESH_SECRET` — **must match the current values** or
     every existing session is invalidated
   - `HMAC_DEVICE_SIGNING_KEY`, `ENCRYPTION_KEY`
   - `CORS_ORIGINS` — leave as a placeholder for now, fixed in Step 4
4. Deploy. Watch the log for:

   ```
   🚀 Application is running on: http://localhost:<port>/v1
   ```

5. Note the service URL, e.g. `https://klassic-attendance-api.onrender.com`.

**Verify** — this must return `{"status":"ok",...}` with `database: "up"`:

```bash
curl https://<your-service>.onrender.com/v1/health
```

If it returns `"degraded"`, Supabase is unreachable and the problem is
`DATABASE_URL`, not the deploy.

---

## Step 3 — Deploy the dashboard to Cloudflare Pages

1. Sign up at **dash.cloudflare.com** (free plan, no card).
2. **Workers & Pages → Create → Pages → Connect to Git**, pick the repository.
3. Build settings — these exact values matter:

   | Setting | Value |
   |---|---|
   | Framework preset | None |
   | **Root directory** | `dashboard` |
   | **Build command** | `npm run build` |
   | **Build output directory** | `out` |

4. Environment variables (**Settings → Environment variables**):

   | Name | Value |
   |---|---|
   | `NEXT_PUBLIC_API_URL` | `https://<your-service>.onrender.com/v1` |
   | `NODE_VERSION` | `22` |

   > **`NEXT_PUBLIC_API_URL` is inlined at build time.** Changing it later
   > requires a **rebuild**, not just a restart — a redeploy of the same commit
   > with the old value baked in will silently keep calling the old URL.

   > **`NODE_VERSION=22` is required.** `next@16.3.5` declares
   > `engines.node >= 20.9.0`. If Pages picks an older default the build fails
   > during install.

5. Deploy. Note the URL, e.g. `https://<project>.pages.dev`.

---

## Step 4 — Point CORS at the dashboard

The browser blocks cross-origin API calls, and `credentials: true` means a
wildcard `*` is not a legal substitute. In Render → Environment, set:

```
CORS_ORIGINS=https://<project>.pages.dev
```

Comma-separated, **no trailing slash**, no quotes.

`src/main.ts` previously hardcoded localhost origins and read `CORS_ORIGINS`
from nowhere — the variable existed in `.env` but was ignored. It is now wired
up. Localhost and `192.168.x.x:300x` stay allowed for development and cannot
match a public HTTPS origin.

Redeploy the backend after saving.

**Verify** — this must print `access-control-allow-origin`:

```bash
curl -s -D - -o /dev/null -X OPTIONS \
  -H "Origin: https://<project>.pages.dev" \
  -H "Access-Control-Request-Method: POST" \
  https://<your-service>.onrender.com/v1/auth/login | grep -i access-control
```

---

## Step 5 — Test on a phone

Open `https://<project>.pages.dev/checkin` on the phone and sign in with an
**employee** account (one linked to an employee record — an admin account
cannot check in and says so).

The browser will ask for **location** and **camera** permission. Grant both.
Then stand inside the site's geofence and press **Check In**.

> **HTTPS is mandatory.** `navigator.geolocation` and `navigator.mediaDevices`
> are `undefined` outside a secure context. On plain `http://192.168.x.x` the
> camera silently does not exist. The page detects `window.isSecureContext`
> and shows an explicit banner instead of failing obscurely. Only `https://`
> and `localhost` count as secure.

If the button reports **"You are about N m from the site"**, that is the
geofence working — it is enforced server-side in PostGIS and the message tells
you the real distance.

---

## Known limitations, stated plainly

1. **Face verification does not run.** The server logs
   `No face matching service available. Biometric verification disabled.`
   at startup, because neither AWS Rekognition (billed per image) nor
   InsightFace (needs a host) is configured. `DEV_SKIP_BIOMETRIC_VERIFICATION`
   is therefore `true`.

   **Check-in verifies WHERE but not WHO.** An employee's credentials alone are
   enough to check in from anywhere inside the fence. Turning the flag off
   without configuring a face service rejects **every** check-in with a 401 —
   verified, not assumed.

2. **First check-in of the day is slow.** Up to ~1 minute if the Render
   container slept. `api.warmUp()` hides most of it.

3. **No offline mode.** The web page needs connectivity; the native app had an
   offline queue.

4. **Supabase free pauses after 7 days idle.** Data survives; the project needs
   a manual resume and there are no backups.

5. **The Docker image build is unverified locally** — Docker is not installed on
   the development machine. The `npm ci` install and dependency resolution were
   verified against the lockfile, and the `bcrypt` native module does publish a
   `linux-x64-musl` prebuild so the Alpine base works, but the image itself has
   never been built end to end here.

---

## What was verified, and how

Against the running backend and the live Supabase database:

- Employee login returns `employee_id` and role `employee`.
- An `employee`-role token can list sites and read its own employee record.
- Geofence pre-check returns `withinGeofence: true, distance: 0` at the fence
  centre, and `false, distance: 6727` far outside it.
- **Check-in: 201, `status: "verified"`.** Check-out: 201, `status: "verified"`.
- Outside the fence: 401 with `"You are 6727m from the site"`, and a
  `flagged` event is written — the audit trail works.
- `npx tsc --noEmit` clean; `next build` emits all 9 routes as static,
  including `/checkin`.

Test rows were deleted afterwards; the database was left as it was found.
