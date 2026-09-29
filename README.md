# Klassic Field Attendance System

**GPS-Geofenced & Biometric Mobile Timekeeping Platform**

> A production-grade attendance management system for field employees deployed across multiple sites in the Philippines, featuring real-time GPS geofencing, facial recognition with liveness detection, offline-first architecture, and Philippine Data Privacy Act (RA 10173) compliance.

---

## 🎯 System Overview

### What It Does

- **Geofenced Check-In/Out**: Employees can only clock in/out within predefined site boundaries (circular or polygon geofences)
- **Facial Recognition**: Liveness-detection-backed facial verification prevents photo/video spoofing
- **Offline-First**: Fully functional without network connectivity; syncs when reconnected
- **Multi-Tenant**: Supports multiple organizations, sites, and thousands of field employees
- **Payroll Integration**: Exports reconciled attendance records to Klassic's existing payroll system
- **DPA Compliant**: Built with Philippine Data Privacy Act requirements in mind

### Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| **Mobile** | React Native (Expo bare workflow) + TypeScript | Cross-platform (iOS/Android), native module support for biometrics |
| **Backend** | Node.js + NestJS + TypeScript | Type-safe, opinionated structure, built-in validation |
| **Database** | Supabase (PostgreSQL + PostGIS) | ACID transactions, native geospatial queries, RLS, managed auth |
| **Offline Storage** | SQLite (WatermelonDB) | Local queue for attendance events |
| **Face Matching** | AWS Rekognition / Self-hosted (InsightFace) | Cloud API for speed; self-hosted for data residency |
| **Liveness** | On-device ML Kit Face Detection | Works offline, keeps biometric processing local |
| **Infrastructure** | Docker + Render/Railway/Fly.io | Standard deployment, easy rollback |

---

## 📁 Project Structure

```
Klassic_Field_Attendance_System/
├── backend/                 # NestJS API server
│   ├── src/
│   │   ├── auth/           # Authentication module (JWT)
│   │   ├── employees/      # Employee management
│   │   ├── sites/          # Site & geofence management
│   │   ├── attendance/     # Check-in/out endpoints
│   │   ├── sync/           # Offline sync logic
│   │   ├── payroll/        # Reconciliation & export
│   │   ├── admin/          # Override & exception handling
│   │   └── common/         # Shared utilities, guards, pipes
│   ├── test/
│   ├── Dockerfile
│   └── package.json
│
├── mobile/                  # React Native app (Expo)
│   ├── src/
│   │   ├── screens/        # UI screens (login, check-in, history)
│   │   ├── components/     # Reusable components
│   │   ├── services/       # API client, biometric, GPS
│   │   ├── store/          # State management (Zustand/Redux)
│   │   ├── database/       # Local SQLite schema
│   │   └── navigation/     # React Navigation setup
│   ├── app.json
│   └── package.json
│
├── database/
│   ├── schema.sql          # PostgreSQL + PostGIS schema
│   ├── migrations/         # DB migration scripts
│   └── types.ts            # Shared TypeScript types
│
├── docs/
│   ├── api/
│   │   └── openapi.yaml    # OpenAPI 3.0 specification
│   ├── compliance/
│   │   ├── dpa-compliance-checklist.md
│   │   ├── privacy-notice-employee.md (TODO)
│   │   └── data-retention-policy.md (TODO)
│   └── architecture/
│       └── system-design.md (TODO)
│
├── .github/
│   └── workflows/
│       └── ci-cd.yml        # GitHub Actions pipeline (TODO)
│
└── README.md                # You are here
```

---

## 🚀 Quick Start

### Prerequisites

- **Node.js**: >= 18.x
- **npm** or **yarn**
- **PostgreSQL** with PostGIS extension (or Supabase account)
- **Docker** (optional, for local Postgres)
- **Expo CLI**: `npm install -g expo-cli`
- **Android Studio** / **Xcode** (for mobile development)

### 1. Clone & Install

```bash
git clone <repository-url>
cd Klassic_Field_Attendance_System

# Install backend dependencies
cd backend
npm install

# Install mobile dependencies
cd ../mobile
npm install
```

### 2. Database Setup

#### Option A: Supabase (Recommended for Development)

1. Create a free Supabase project at [supabase.com](https://supabase.com)
2. Copy your connection string and API keys
3. Run the schema:

```bash
psql "postgresql://postgres:[YOUR-PASSWORD]@db.[YOUR-PROJECT-REF].supabase.co:5432/postgres" < database/schema.sql
```

#### Option B: Local PostgreSQL + Docker

```bash
# Start Postgres with PostGIS
docker run --name klassic-db \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=klassic_attendance \
  -p 5432:5432 \
  -d postgis/postgis:15-3.3

# Run schema
psql -h localhost -U postgres -d klassic_attendance < database/schema.sql
```

### 3. Environment Variables

#### Backend (`backend/.env`)

```env
# Database
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/klassic_attendance

# JWT Secrets (CHANGE IN PRODUCTION!)
JWT_SECRET=your-secret-key-min-32-characters
JWT_REFRESH_SECRET=your-refresh-secret-key-min-32-characters
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

# Face Matching API (if using AWS Rekognition)
AWS_REGION=ap-southeast-1
AWS_ACCESS_KEY_ID=your-aws-key
AWS_SECRET_ACCESS_KEY=your-aws-secret
FACE_MATCH_THRESHOLD=0.85

# HMAC for offline sync verification
HMAC_DEVICE_SIGNING_KEY=your-hmac-secret-key

# Payroll Webhook
PAYROLL_WEBHOOK_SECRET=shared-secret-with-payroll-system

# Error Tracking
SENTRY_DSN=https://your-sentry-dsn

# App Config
PORT=3000
NODE_ENV=development
```

#### Mobile (`mobile/.env`)

```env
API_BASE_URL=http://localhost:3000/v1
```

### 4. Run Backend

```bash
cd backend
npm run start:dev

# Backend will run on http://localhost:3000
# API docs at http://localhost:3000/api-docs (TODO: Swagger integration)
```

### 5. Run Mobile App

```bash
cd mobile
expo start

# Press 'a' for Android emulator
# Press 'i' for iOS simulator
# Scan QR code for physical device (Expo Go won't work due to native modules)
```

---

## 🏗️ Build Phases

The system is built in 10 phases, following a contract-first methodology:

| Phase | Description | Status |
|-------|-------------|--------|
| **Phase 0** | ✅ Contract & Compliance Foundation | 🟢 **In Progress** |
| **Phase 1** | Backend Core - NestJS Setup | 🔵 Pending |
| **Phase 2** | Mobile App Skeleton | 🔵 Pending |
| **Phase 3** | Geofencing Implementation | 🔵 Pending |
| **Phase 4** | Biometric Enrollment & Face Matching | 🔵 Pending |
| **Phase 5** | Offline Mode & Sync | 🔵 Pending |
| **Phase 6** | Payroll Integration | 🔵 Pending |
| **Phase 7** | Security & Compliance Hardening | 🔵 Pending |
| **Phase 8** | QA & Testing Suite | 🔵 Pending |
| **Phase 9** | Deployment & DevOps Pipeline | 🔵 Pending |
| **Phase 10** | Documentation & Rollout Plan | 🔵 Pending |

See the [Phase 0 Completion Status](#phase-0-completion-status) section below for current progress.

---

## 🔐 Security Highlights

- **TLS Everywhere**: No plaintext HTTP in production
- **JWT Access + Refresh Tokens**: Short-lived access tokens (15min), rotating refresh tokens
- **Row Level Security (RLS)**: Database-enforced multi-tenancy (no org can see another's data)
- **Rate Limiting**: Auth (5/min), Attendance (100/min), Sync (20/min)
- **DTO Validation**: All inputs validated before touching business logic
- **HMAC-Signed Offline Payloads**: Tamper-proof sync queue
- **Encrypted Embeddings**: Face embeddings encrypted at rest (column-level encryption)
- **Append-Only Audit Log**: All check-ins, overrides, and exports immutably logged
- **Secrets in Vault**: Never in repo or app bundle

---

## 📊 Key Algorithms

### Geofence Validation (Server-Authoritative)

**Why server-side?** Never trust client-reported "I'm inside" boolean.

```typescript
// Circular geofence (Haversine formula)
function isWithinCircularGeofence(
  userLat: number, userLng: number,
  siteLat: number, siteLng: number,
  radiusMeters: number
): boolean {
  const R = 6371000; // Earth radius in meters
  const dLat = toRadians(siteLat - userLat);
  const dLng = toRadians(siteLng - userLng);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRadians(userLat)) * Math.cos(toRadians(siteLat)) *
            Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c;
  return distance <= radiusMeters;
}

// Polygon geofence (PostGIS)
SELECT ST_Contains(geofence_polygon, ST_SetSRID(ST_MakePoint(:lng, :lat), 4326))
FROM sites WHERE id = :site_id;
```

### Liveness Detection + Face Match

1. **On-device liveness**: Random micro-action (blink/turn/smile)
2. Capture 2-3 frames during action
3. Run on-device liveness model → `livenessScore` (0-1)
4. If `livenessScore < threshold`: reject, prompt retry
5. Extract face embedding vector from best frame
6. **Online**: Send embedding to backend, compare vs enrolled embedding
7. **Offline**: Compare locally (against encrypted cached embedding), mark for server re-verification

### Payroll Reconciliation

```typescript
for (const employee of employees) {
  for (const day of dateRange) {
    const events = getEventsForEmployeeOnDay(employee.id, day);
    const pairs = pairCheckInsAndCheckOuts(events); // chronologically
    
    let totalHours = 0;
    const exceptions = [];
    
    for (const pair of pairs) {
      if (!pair.checkOut) {
        exceptions.push({ type: 'missing_checkout', event: pair.checkIn });
        continue;
      }
      
      const hours = (pair.checkOut.timestamp - pair.checkIn.timestamp) / 3600000;
      
      if (hours > MAX_SHIFT_HOURS) {
        exceptions.push({ type: 'excessive_hours', hours, pair });
        continue;
      }
      
      if (pair.checkIn.status === 'flagged' || pair.checkOut.status === 'flagged') {
        exceptions.push({ type: 'flagged_event', pair });
        continue;
      }
      
      totalHours += hours;
    }
    
    if (exceptions.length > 0) {
      sendToHRApprovalQueue({ employee, day, totalHours, exceptions });
    } else {
      exportToPayroll({ employee, day, totalHours });
    }
  }
}
```

---

## 🧪 Testing Strategy

| Test Type | Coverage Target | Tools |
|-----------|----------------|-------|
| **Unit Tests** | Algorithms (geofence, reconciliation, idempotency) | Jest, ts-jest |
| **Integration Tests** | API endpoints against real Postgres+PostGIS | Supertest, Jest |
| **E2E Tests** | Full check-in flow (online + offline scenarios) | Detox (mobile), Playwright (backend) |
| **Security Tests** | OWASP Mobile/API Top 10 | OWASP ZAP, manual penetration test |
| **Device Lab** | Real Android/iOS devices (not just emulators) | Physical device farm |

Run tests:

```bash
# Backend unit + integration tests
cd backend
npm test

# Backend E2E tests
npm run test:e2e

# Mobile tests (TODO: Phase 8)
cd mobile
npm test
```

---

## 🚢 Deployment

### Backend (Docker + Render/Railway/Fly.io)

```bash
# Build Docker image
cd backend
docker build -t klassic-attendance-api .

# Run locally
docker run -p 3000:3000 --env-file .env klassic-attendance-api

# Deploy to Render (example)
# 1. Connect GitHub repo to Render
# 2. Set environment variables in Render dashboard
# 3. Render auto-deploys on push to main branch
```

### Mobile (Expo EAS Build)

```bash
cd mobile

# Build for Android
eas build --platform android --profile production

# Build for iOS (requires Apple Developer account)
eas build --platform ios --profile production

# Over-the-air updates (JS-only changes)
eas update --branch production
```

---

## 📈 Monitoring & Observability

- **Health Check**: `GET /health` (uptime monitoring)
- **Error Tracking**: Sentry (backend + mobile)
- **Structured Logging**: Winston/Pino (backend), console.log sanitized (mobile)
- **Uptime Monitoring**: BetterUptime, Pingdom, or UptimeRobot
- **Metrics**: Consider Prometheus + Grafana for production

---

## 🛡️ Compliance (Philippine Data Privacy Act)

> ⚠️ **CRITICAL**: Review `docs/compliance/dpa-compliance-checklist.md` before production.

**Key Requirements:**
- ✅ Written employee consent
- ✅ Privacy notice
- ✅ Designated Data Protection Officer (DPO)
- ✅ Data retention policy
- ✅ Cross-border transfer agreements (if using cloud APIs)
- ✅ Incident response plan
- ✅ Non-biometric fallback option

**Status**: 🟡 In Progress (Phase 0 & 7)

---

## 🐛 Known Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| GPS spoofing | High | High | Server-side re-validation, mock-location detection, anomaly checks |
| Photo/video replay | Medium | High | Mandatory liveness challenge (blink/turn/smile) |
| Poor rural connectivity | High | Medium | True offline-first design, compressed payloads |
| Device fragmentation | High | Medium | Real device-lab QA (not emulator-only) |
| Payroll data disputes | Low | High | Immutable audit log, HR exception queue |
| Cross-border data transfer | Medium | High | DPA with vendors, consider self-hosted face matching |

See `docs/compliance/risk-register.md` (TODO: Phase 7) for full risk assessment.

---

## 📖 API Documentation

- **OpenAPI Spec**: [docs/api/openapi.yaml](docs/api/openapi.yaml)
- **Interactive Docs**: `http://localhost:3000/api-docs` (TODO: Swagger integration in Phase 1)

---

## 🤝 Contributing

This is an internal Klassic project. For contribution guidelines, see `CONTRIBUTING.md` (TODO).

---

## 📄 License

Proprietary - Klassic Inc. All rights reserved.

---

## 📞 Support

- **Technical Issues**: DevOps Team <devops@klassic.ph>
- **Compliance Questions**: Data Protection Officer <dpo@klassic.ph>
- **API Support**: API Team <api@klassic.ph>

---

## Phase 0 Completion Status

✅ **Completed:**
- [x] Project structure created
- [x] Database schema (PostgreSQL + PostGIS) with RLS policies
- [x] TypeScript type definitions (shared types)
- [x] OpenAPI 3.0 API specification (complete contract)
- [x] Philippine DPA compliance checklist
- [x] README with architecture overview

🔵 **Remaining (to complete Phase 0):**
- [ ] Privacy notice template (`docs/compliance/privacy-notice-employee.md`)
- [ ] Employee consent form template (`docs/compliance/consent-form-template.docx`)
- [ ] Data retention policy (`docs/compliance/data-retention-policy.md`)
- [ ] System architecture diagram (Mermaid/draw.io)

---

**Built with ❤️ by the Klassic Engineering Team**  
**Version**: 1.0.0-alpha  
**Last Updated**: September 11, 2026
