# Klassic Field Attendance System — Cost Plan

All figures in USD, verified October 2026 against each provider's own pricing
page (not third-party blogs — several of those turned out to be wrong).
PHP conversions are approximate at ~₱58/USD; check the current rate.

---

## 1. Headline: the current stack costs $0/month

| Layer | Service | Cost | Card needed? |
|---|---|---|---|
| Backend (NestJS API) | **Azure Container Apps** (Azure for Students) | **$0** | **No** |
| Dashboard (Next.js) | **Cloudflare Pages** or Vercel Hobby | **$0** | No |
| Database | **Supabase** (Postgres + PostGIS) | **$0** | No |
| Map tiles | **OpenStreetMap** | **$0** | No |
| Face verification | **In-process descriptor matching** | **$0** | No |
| Email (credentials) | **Brevo** free tier | **$0** | No |
| **Total** | | **$0 / month** | |

This is a complete, working deployment. Nothing below is required.

---

## 2. What you get inside the free tiers

### Azure for Students — backend hosting

- **$100 credit**, valid 12 months, **renewable yearly while you're a student**
- **No credit card required** (Microsoft states this explicitly)
- **65+ always-free services**

Azure Container Apps free grants, **per subscription, per calendar month**:

| Resource | Free grant | Worth |
|---|---|---|
| vCPU | 180,000 vCPU-seconds | 50 vCPU-hours |
| Memory | 360,000 GiB-seconds | 100 GiB-hours |
| HTTP requests | 2,000,000 | — |

**The important setting: minimum replicas = 0.** Microsoft's billing docs:
*"When a revision is scaled to zero replicas, no resource consumption charges
are incurred."* Idle costs nothing; it wakes on the first request.

For a demo or low-traffic pilot, you will likely **never touch the $100 credit**.

**If you did run 24/7** at 0.5 vCPU / 1 GiB, after the free grants:

| | Monthly |
|---|---|
| vCPU overage (1,134,000 s × $0.000024) | ~$27 |
| Memory overage (2,268,000 s × $0.000003) | ~$7 |
| **Total** | **~$34/month** |

So the $100 credit alone would cover roughly **3 months of continuous 24/7
operation** — and with `min replicas = 0` you'd spend a fraction of that.

### Supabase — database

Free tier: Postgres with **PostGIS** (needed for geofencing), auth, storage.
No cost, no card. Your project is in `ap-northeast-2` (Seoul).

### Email — Brevo

| Provider | Free tier | Renews? |
|---|---|---|
| **Brevo** | **9,000/month (300/day)** | ✅ monthly |
| Resend | 3,000/month | ✅ monthly |
| MailerSend | 500/month | ✅ monthly |
| Postmark / SendGrid / Mailgun | 100 emails | ❌ **one-time trial only** |

Brevo is the pick: largest allowance and it renews. **Important** — this also
sidesteps the SMTP port blocking that broke Gmail on Render's free tier, since
Brevo offers an HTTP API on port 443.

---

## 3. Optional add-ons and their real prices

### Maps — only if you outgrow OpenStreetMap

You currently use OSM tiles, which are free but whose usage policy discourages
heavy or commercial traffic. Google Maps pricing below is from Google's official
price list. **Note: the old $200/month credit was removed on 1 March 2025** and
replaced by per-SKU free caps.

| SKU | Free per month | Then per 1,000 |
|---|---|---|
| Map Tiles API (2D) | **100,000** | $0.60 |
| Dynamic Maps (JS API) | 10,000 | $7.00 |
| Static Maps | 10,000 | $2.00 |
| **Geocoding** | 10,000 | **$5.00** |
| Geolocation | 10,000 | $5.00 |
| Places Autocomplete | 10,000 | $2.83 |
| Places Details (Essentials) | 10,000 | $5.00 |
| Directions / Routes | 10,000 | $5.00 |

**Map Tiles API is the standout** — 100,000 free loads per month, then only
$0.60 per 1,000. If you want to leave OSM without meaningful cost, that's the
one to use.

### Face recognition — only if you want a real face API

Today you use in-process descriptor matching, which is **free and already
working**. AWS Rekognition is the optional upgrade:

| Item | Price |
|---|---|
| `CompareFaces` (Group 1) | **$1.00 per 1,000 images** (first 1M) |
| Free tier | **1,000 images/month**, first 12 months |
| New AWS customers | up to **$200** in free-tier credits |

### SMS — ⚠️ not viable, do not build on this

Twilio's rate for outbound SMS **to the Philippines is $0.241 per message**.

| Scenario | Messages/month | Monthly cost |
|---|---|---|
| 50 employees × 2 check-ins × 22 days | 2,200 | **$530** |
| 100 employees × 2 check-ins × 22 days | 4,400 | **$1,060** |

That is more than the entire rest of the system by two orders of magnitude.
**Use in-app notifications or push instead.** Firebase Cloud Messaging is free
and unlimited. Supabase Realtime is free on the tier you already have.

---

## 4. Worked scenario: 50 employees, one month

| Item | Usage | Cost |
|---|---|---|
| Azure backend | scale-to-zero, ~60 hrs active | **$0** (within free grant) |
| Supabase | within free tier | **$0** |
| Dashboard hosting | within free tier | **$0** |
| Face verification | 2,200 checks, in-process | **$0** |
| Email | ~50 credential emails | **$0** (Brevo) |
| Geocoding | 2,200 lookups | **$0** (under 10,000) |
| Map loads | ~2,000 | **$0** (under 10,000) |
| SMS notifications | 2,200 | ~~$530~~ — **omit** |
| **Total** | | **$0** |

### Same scenario, using every paid API

| Item | Usage | Cost |
|---|---|---|
| Face verification (Rekognition) | 2,200 − 1,000 free | **$1.20** |
| Geocoding (Google) | 2,200 | **$0** |
| Maps (Google Dynamic Maps) | 2,000 | **$0** |
| Everything else | | **$0** |
| **Total** | | **≈ $1.20 / month** |

Even with paid APIs throughout, the real cost is about **a dollar a month** —
because the free caps are generous relative to a 50-person pilot. The only
genuinely expensive component is SMS.

---

## 5. When costs would actually appear

| Trigger | Cost |
|---|---|
| Exceed 180,000 vCPU-s or 360,000 GiB-s/month | ~$0.000024 / vCPU-s, $0.000003 / GiB-s |
| Run `min replicas = 1` (always on) | ~$34/month |
| Exceed 10,000 Google geocoding calls | $5 per 1,000 |
| Exceed 1,000 Rekognition face checks | $1 per 1,000 |
| Exceed 9,000 emails/month | Brevo paid from ~$5.36/month |
| Graduate and lose student status | Azure credit stops renewing |
| Want SMS | $0.241 per message — reconsider the feature |

---

## 6. Non-cost caveats worth knowing

- **Vercel Hobby forbids commercial use.** Your own `next.config.ts` notes this.
  **Cloudflare Pages does not** — which is why Pages is the better dashboard
  host for a Foundation project, and it has unlimited bandwidth.
- **Render requires a credit card even for its free tier** — verified firsthand.
  Hugging Face Spaces now requires PRO for Docker. Koyeb is closed. Zeabur
  removed free compute. None of these are options.
- **The database host is IPv6-only.** `db.<ref>.supabase.co` has no IPv4 record,
  so any IPv4-only host cannot connect. Use the pooler instead —
  verified working: **`aws-0-ap-northeast-2.pooler.supabase.com`** (port 6543
  for transaction mode, 5432 for session mode), with the username as
  `postgres.<project-ref>`.
- **Free tiers carry no SLA.** Fine for a pilot or demo; not for production
  payroll data without a paid plan.

---

## 7. Bottom line

| Question | Answer |
|---|---|
| Cost of the current design as specified? | **$0/month** |
| Cost with real-time APIs added? | **≈$1–2/month** at pilot scale |
| The one thing that would blow the budget? | **SMS at $0.241/message in PH** |
| Card required anywhere? | **No** — Azure for Students covers the backend |
| When does this stop working? | When student status ends, or past the free caps |
