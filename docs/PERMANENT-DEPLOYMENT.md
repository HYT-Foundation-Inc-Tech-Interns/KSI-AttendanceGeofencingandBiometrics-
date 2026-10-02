# Permanent deployment: Render + Cloudflare Pages

This replaces the Cloudflare **quick tunnel** the app has been running behind.

## Why the tunnel had to go

The app has been served from this laptop through `cloudflared tunnel --url`,
which is a *quick* tunnel. Two properties of a quick tunnel are the entire
cause of both reported symptoms:

| Symptom | Cause |
|---|---|
| The URL changes every time | A quick tunnel gets a **new random hostname on every start**. Nothing can pin it. |
| The app keeps going down | The origin is **this laptop**. When the laptop sleeps, or the node processes are killed, the tunnel stays registered and returns **530 / 502**. |

Measured directly, not inferred: over a few minutes the stack was brought up
four times, and each time both node servers *and* `cloudflared` were gone by the
next check. A 530 with
`dial tcp [::1]:3001: connectex: No connection was made because the target
machine actively refused it` in the tunnel log is the tunnel being healthy while
its origin is not.

**A named Cloudflare tunnel would not have fixed this.** It pins the hostname,
but the origin is still this laptop — so the URL stops changing while the
downtime stays exactly the same. It also needs a domain you own on Cloudflare;
a `trycloudflare.com` name cannot be made permanent.

The fix is to stop serving from a laptop.

## Target architecture

```
   Phone (worker)                      Admin (office)
        |                                     |
        | https                               | https
        v                                     v
  Cloudflare Pages  <app>.pages.dev  (static export of dashboard/)
        |
        | fetch, cross-origin
        v
  Render  klassic-attendance-api.onrender.com  (NestJS, Docker)
        |
        | postgres + PostGIS
        v
  Supabase  (managed Postgres)
```

Both front ends are the **same static export** — `/checkin` for workers and
`/dashboard` for admins. Only the backend is a long-running process.

`render.yaml` and `backend/Dockerfile` are already written for this and need no
changes. `next.config.ts` is already `output: "export"`.

---

## Part 1 — Push the code (required first: Render builds from GitHub)

The remote's history is **unrelated** to the local one — it holds a single
`First Commit` import — so a normal push is rejected.

A force-push would drop 6 entries that exist only on the remote:

- `dashboard` — recorded there as a **git submodule pointer** (`160000`), not
  real files. Locally it is a normal directory, so the force-push *improves*
  this.
- `mobile/metro.config.js` and `mobile/assets/{icon,splash,favicon,adaptive-icon}.png`
  — 5 real files that were never in local history.

`mobile/` is not referenced by `render.yaml` or the Dockerfile, so it does not
affect the deployment. The commands below restore those 5 files first, which
makes the push lose **nothing at all**.

```bash
# 1. keep the remote's only commit locally, so nothing is unrecoverable
git fetch origin main
git branch remote-first-commit origin/main

# 2. bring back the 5 mobile files that exist only on the remote
git checkout remote-first-commit -- mobile/metro.config.js mobile/assets/
git commit -m "Restore mobile assets that existed only in the remote's first commit"

# 3. check what is about to change (optional)
git log --oneline origin/main..HEAD | wc -l

# 4. push. --force-with-lease is used instead of --force: it refuses if someone
#    else has pushed since your fetch, which --force would silently overwrite.
git push --force-with-lease origin main
```

Then delete the safety branch once you are happy:

```bash
git branch -D remote-first-commit
```

---

## Part 2 — Render (the API)

1. Sign in at <https://render.com> and connect the GitHub account that owns
   `HYT-Foundation-Inc-Tech-Interns/KlassicSolutionsInc_AttendanceGeofencing`.
2. **New → Blueprint**, pick the repository. Render reads `render.yaml` and
   creates the service `klassic-attendance-api` (Docker, free plan, Singapore).
3. It prompts for the six values marked `sync: false`. Copy each from your local
   `backend/.env` — **do not commit them**:

   | Render env var | Where it comes from |
   |---|---|
   | `DATABASE_URL` | `backend/.env` (the Supabase connection string) |
   | `JWT_SECRET` | `backend/.env` — must be the **same** value, or every existing session is invalidated |
   | `JWT_REFRESH_SECRET` | `backend/.env` — same warning |
   | `HMAC_DEVICE_SIGNING_KEY` | `backend/.env` |
   | `ENCRYPTION_KEY` | `backend/.env` |
   | `CORS_ORIGINS` | the Pages URL from Part 3 — see the note below |

4. **CORS_ORIGINS ordering.** The dashboard is a different origin from the API,
   so the browser blocks every call until this matches. You cannot know the
   Pages URL before creating the project, so either:

   - create the Pages project first (Part 3), then come back and set
     `CORS_ORIGINS=https://<your-project>.pages.dev`, or
   - set it to a placeholder now and fix it in step 3 of Part 4.

   No trailing slash, comma-separated if you have more than one.

5. Deploy. When it finishes, confirm the API is alive:

   ```bash
   curl -s https://klassic-attendance-api.onrender.com/v1/health
   # {"status":"ok",...,"services":{"database":"up"}}
   ```

   The service URL is derived from `name: klassic-attendance-api` in
   `render.yaml`. If Render reports the name as taken it will suffix it —
   **read the actual URL off the dashboard** and use that everywhere below.

---

## Part 3 — Cloudflare Pages (the dashboard)

1. Cloudflare dashboard → **Workers & Pages → Create → Pages →
   Connect to Git**, and pick the same repository.
2. Build settings:

   | Setting | Value |
   |---|---|
   | Production branch | `main` |
   | Framework preset | `Next.js (Static HTML Export)` — or `None` |
   | **Root directory** | `dashboard` |
   | Build command | `npm ci && npm run build` |
   | Build output directory | `out` |

3. Environment variables (Production **and** Preview):

   | Variable | Value |
   |---|---|
   | `NEXT_PUBLIC_API_URL` | `https://klassic-attendance-api.onrender.com/v1` |
   | `NODE_VERSION` | `22` |

   `NEXT_PUBLIC_API_URL` is **inlined at build time** — changing it later
   requires a rebuild, not just a restart. This is the single knob that points
   the static app at the API; without it the app calls `/v1` on its own origin
   and every request 404s.

   `NODE_VERSION=22` matters: Next 16 needs Node ≥ 20, and Pages defaults lower.

   `dashboard/.env.local` is gitignored and is **not** in the repository, so it
   cannot override these.

4. Deploy and note the URL (`https://<project>.pages.dev`).

---

## Part 4 — Wire them together

1. **Render → `CORS_ORIGINS`** = `https://<project>.pages.dev` (no trailing
   slash). Save; Render redeploys. Without this every API call fails in the
   browser while `curl` from your terminal still works — the classic
   "it works locally" CORS symptom.

2. **Render → `APP_CHECKIN_URL`** = `https://<project>.pages.dev/checkin`.
   This is the link inside the employee credential email. It is **not** in
   `render.yaml`, so add it as a plain environment variable.

3. Open `https://<project>.pages.dev` and sign in. If the API is asleep the
   first request takes up to a minute (see caveats).

### Verification checklist

```bash
# API is up and can reach Supabase
curl -s https://klassic-attendance-api.onrender.com/v1/health

# CORS actually allows the dashboard origin (look for the ACAO header)
curl -s -D - -o /dev/null \
  -H "Origin: https://<project>.pages.dev" \
  https://klassic-attendance-api.onrender.com/v1/health | grep -i access-control

# the dashboard is being served
curl -s -o /dev/null -w '%{http_code}\n' https://<project>.pages.dev/dashboard
```

Then, in the browser: sign in, load `/dashboard`, and hover a stat tile — the
figures must match the popup contents. On a phone, open `/checkin`: the camera
prompt should appear (Pages is HTTPS, so `navigator.mediaDevices` exists).

---

## Caveats to know before relying on this

- **Render's free tier sleeps after ~15 minutes idle** and takes up to a minute
  to wake. `api.warmUp()` in `dashboard/src/lib/api.ts` pings `/v1/health` as the
  check-in page loads to start that wake-up early, but the first visitor after a
  quiet period still waits. Paid plans remove this.
- **Face verification is off on this deployment.**
  `DEV_SKIP_BIOMETRIC_VERIFICATION=true` in `render.yaml` is deliberate: no
  biometric backend is configured (AWS Rekognition is unset, InsightFace is
  commented out), and with it `false` **every** check-in is rejected with a 401.
  Consequence, stated plainly: check-in verifies **where** (PostGIS geofence) but
  not **who**. An employee's credentials alone are enough to check in from
  anywhere inside the fence. Turning it on needs a paid face-matching service.
- **`mobile/` is not deployed.** Field workers use the web `/checkin` page. The
  native app is kept only because it had an offline queue the web page does not.
- **Secrets live in two places** once this is done: your local `backend/.env`
  (gitignored) and the Render dashboard. Never commit them.
