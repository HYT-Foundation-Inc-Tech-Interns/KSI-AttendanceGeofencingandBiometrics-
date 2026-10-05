---
title: Klassic Attendance API
sdk: docker
app_port: 7860
pinned: false
---

# Klassic Field Attendance API

NestJS backend for the Klassic Field Attendance System: GPS-geofenced check-in
with face verification. The dashboard is hosted separately on Vercel and proxies
`/v1/*` to this Space, so the browser only ever talks to one origin.

## This repo holds no application source

That is deliberate. The `Dockerfile` clones the GitHub repository at build time,
so the backend keeps a **single source of truth** and a rebuild picks up the
latest `main` instead of drifting from a stale copy:

```
https://github.com/HYT-Foundation-Inc-Tech-Interns/KSI-AttendanceGeofencingandBiometrics-
```

To pick up new backend commits: **Settings -> Factory rebuild**.

## Configuration

Everything comes from **Space secrets and variables** (Settings -> Variables and
secrets). Nothing is committed, and the app's own `.env` is gitignored so the
clone does not contain one.

`PORT` is pinned to `7860` in the Dockerfile, which is the port Hugging Face
routes to. Do not override it.

## Known limitations of the free tier

- Free `cpu-basic` hardware **sleeps after 48 hours without traffic**, and that
  is not configurable. Open the Space before a demo to wake it; the first
  request after a sleep is slow.
- The filesystem is ephemeral, but the app writes nothing to disk, so nothing is
  lost on restart.
- Spaces are **public by default**.
- Outbound SMTP on ports 25/465/587 is not guaranteed, so the
  "create employee -> email credentials" feature may not send. Everything else
  works.
