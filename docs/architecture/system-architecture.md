# Klassic Field Attendance System - Architecture

## System Architecture Diagram

```mermaid
graph TB
    subgraph "Mobile Layer - React Native"
        A[Employee Mobile App]
        A1[GPS Module]
        A2[Camera + ML Kit]
        A3[SQLite Local Queue]
        A4[HMAC Signing]
        
        A --> A1
        A --> A2
        A --> A3
        A --> A4
    end
    
    subgraph "Network Layer"
        N1[HTTPS/TLS]
        N2[Rate Limiter]
        N3[API Gateway]
    end
    
    subgraph "Backend Layer - NestJS"
        B[REST API]
        B1[Auth Module<br/>JWT]
        B2[Geofence Validator<br/>PostGIS]
        B3[Face Match Service]
        B4[Sync Controller<br/>Idempotent]
        B5[Payroll Reconciliation]
        
        B --> B1
        B --> B2
        B --> B3
        B --> B4
        B --> B5
    end
    
    subgraph "Data Layer - Supabase"
        C[(PostgreSQL + PostGIS)]
        C1[Row Level Security]
        C2[Encrypted Embeddings]
        C3[Append-Only Audit Log]
        
        C --> C1
        C --> C2
        C --> C3
    end
    
    subgraph "External Services"
        E1[AWS Rekognition<br/>Face Match API]
        E2[Klassic Payroll<br/>System]
        E3[Sentry<br/>Error Tracking]
    end
    
    subgraph "Admin/HR"
        H[HR Dashboard<br/>Enrollment & Overrides]
    end
    
    A -- "Check-in/Check-out<br/>Liveness + Embedding" --> N1
    A3 -- "Batch Offline Sync<br/>HMAC Signed" --> N1
    N1 --> N2
    N2 --> N3
    N3 --> B
    
    B2 -- "ST_Contains()<br/>ST_DWithin()" --> C
    B3 -- "CompareFaces()" --> E1
    B4 -- "Upsert by client_event_id" --> C
    B5 -- "Verified Records" --> E2
    
    B --> C
    B --> E3
    H --> B
    
    style A fill:#4CAF50,stroke:#2E7D32,color:#fff
    style B fill:#2196F3,stroke:#1565C0,color:#fff
    style C fill:#FF9800,stroke:#E65100,color:#fff
    style E1 fill:#9C27B0,stroke:#6A1B9A,color:#fff
    style E2 fill:#F44336,stroke:#C62828,color:#fff
    style H fill:#607D8B,stroke:#37474F,color:#fff
```

---

## Component Flow Diagrams

### 1. Check-In Flow (Online)

```mermaid
sequenceDiagram
    actor Employee
    participant App as Mobile App
    participant GPS
    participant Camera as Camera + ML Kit
    participant API as Backend API
    participant DB as Database
    participant FaceAPI as Face Match API
    
    Employee->>App: Tap "Check In"
    App->>GPS: Request Location
    GPS-->>App: GPS Coordinates
    
    App->>App: Pre-check Geofence<br/>(client-side UX only)
    
    alt Outside Geofence (client-side)
        App-->>Employee: ⚠️ Too far from site
    else Within Buffer
        App->>Camera: Prompt Liveness Challenge<br/>(blink/turn/smile)
        Camera-->>App: Capture Frames
        App->>Camera: Run On-Device Liveness
        Camera-->>App: livenessScore: 0.95
        
        alt Low Liveness Score
            App-->>Employee: ❌ Liveness failed, retry
        else Pass
            App->>App: Extract Face Embedding
            App->>API: POST /attendance/check-in<br/>{GPS, embedding, liveness}
            
            API->>DB: Validate Geofence<br/>(server-authoritative)
            DB-->>API: Within geofence: true
            
            API->>FaceAPI: CompareFaces(embedding, enrolled)
            FaceAPI-->>API: matchScore: 0.92
            
            alt Match & Geofence OK
                API->>DB: INSERT attendance_event<br/>status: verified
                API->>DB: INSERT sync_audit_log
                API-->>App: ✅ Check-in successful
                App-->>Employee: ✅ Checked in at 9:00 AM
            else Fail
                API->>DB: INSERT attendance_event<br/>status: flagged
                API-->>App: ⚠️ Verification issue
                App-->>Employee: ⚠️ Contact HR
            end
        end
    end
```

---

### 2. Offline Sync Flow

```mermaid
sequenceDiagram
    actor Employee
    participant App as Mobile App
    participant SQLite
    participant Network
    participant API as Backend API
    participant DB as Database
    
    Employee->>App: Check In (no network)
    App->>App: Detect Offline
    App->>SQLite: Save Event to Queue<br/>{clientEventId, payload, signature}
    SQLite-->>App: Queued
    App-->>Employee: ✅ Saved locally (will sync)
    
    Note over App,Network: ... Time passes, network returns ...
    
    App->>Network: Detect Online
    App->>SQLite: Get Pending Events
    SQLite-->>App: [event1, event2, event3]
    
    loop For Each Event
        App->>App: Sign Payload (HMAC)
        App->>API: POST /attendance/sync<br/>{events[], signature}
        
        API->>API: Verify HMAC Signature
        
        alt Valid Signature
            API->>DB: UPSERT by client_event_id
            
            alt New Event
                API->>DB: Process normally
                API-->>App: 200 OK - synced
                App->>SQLite: Mark "synced"
            else Duplicate clientEventId
                API-->>App: 409 Conflict - duplicate
                App->>SQLite: Mark "synced" (already exists)
            end
        else Invalid Signature
            API-->>App: 400 Bad Request
            App->>SQLite: Increment retry_count
            
            alt retry_count > MAX_RETRIES
                App->>SQLite: Mark "needs_manual_review"
                App-->>Employee: ⚠️ Some events need HR review
            end
        end
    end
```

---

### 3. Payroll Reconciliation Flow

```mermaid
flowchart TD
    Start([Scheduled Job<br/>Daily at 2 AM]) --> FetchEvents[Fetch Verified Events<br/>for Date Range]
    FetchEvents --> GroupByEmp[Group by Employee + Date]
    
    GroupByEmp --> PairEvents{Pair Check-In<br/>with Check-Out}
    
    PairEvents -->|Missing Check-Out| Flag1[Flag: missing_checkout<br/>→ HR Queue]
    PairEvents -->|Excessive Hours| Flag2[Flag: excessive_hours<br/>→ HR Queue]
    PairEvents -->|Flagged Event| Flag3[Flag: biometric_flagged<br/>→ HR Queue]
    PairEvents -->|Valid Pair| CalcHours[Calculate Worked Hours]
    
    CalcHours --> SumHours[Sum Daily Hours]
    SumHours --> ValidateRules{Passes All<br/>Business Rules?}
    
    ValidateRules -->|Yes| MarkExported[Mark status: exported]
    ValidateRules -->|No| Flag4[Flag for HR Approval]
    
    MarkExported --> ExportPayroll[Export to Payroll System<br/>POST /payroll/import]
    ExportPayroll --> AuditLog[Log to sync_audit_log<br/>action: exported_to_payroll]
    
    Flag1 --> HRQueue[(HR Exception Queue)]
    Flag2 --> HRQueue
    Flag3 --> HRQueue
    Flag4 --> HRQueue
    
    AuditLog --> End([End])
    HRQueue --> End
    
    style Start fill:#4CAF50,color:#fff
    style Flag1 fill:#FF9800,color:#fff
    style Flag2 fill:#FF9800,color:#fff
    style Flag3 fill:#FF9800,color:#fff
    style Flag4 fill:#FF9800,color:#fff
    style HRQueue fill:#F44336,color:#fff
    style MarkExported fill:#2196F3,color:#fff
    style End fill:#4CAF50,color:#fff
```

---

## Data Flow: Geofence Validation

### Circular Geofence (Haversine Formula)

```
┌─────────────────────────────────────────┐
│  Site: SM Manila Office                  │
│  Center: (14.5964, 120.9842)            │
│  Radius: 100 meters                      │
└─────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────┐
│  Employee Check-In Request              │
│  GPS: (14.5970, 120.9850)               │
└─────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────┐
│  Backend: Calculate Distance             │
│  Formula: Haversine                      │
│  Distance = 87.3 meters                  │
└─────────────────────────────────────────┘
                    │
                    ▼
         ┌──────────┴──────────┐
         │                     │
         ▼                     ▼
    ✅ PASS                ❌ REJECT
  87.3m ≤ 100m          > 100m
  Status: verified      Status: flagged
```

### Polygon Geofence (PostGIS)

```sql
-- Server-side query (authoritative)
SELECT ST_Contains(
  geofence_polygon,
  ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)
) AS is_within
FROM sites
WHERE id = :site_id;

-- Returns: true → verified, false → flagged
```

---

## Security Architecture

```mermaid
graph TB
    subgraph "Defense in Depth"
        L1[Layer 1: Network<br/>TLS 1.3, Rate Limiting]
        L2[Layer 2: Authentication<br/>JWT + Refresh Tokens]
        L3[Layer 3: Authorization<br/>RBAC + RLS]
        L4[Layer 4: Input Validation<br/>DTO Guards, Schema Validation]
        L5[Layer 5: Business Logic<br/>Server-side Geofence & Face Match]
        L6[Layer 6: Data<br/>Encryption at Rest, Audit Log]
        L7[Layer 7: Monitoring<br/>Sentry, Anomaly Detection]
    end
    
    L1 --> L2
    L2 --> L3
    L3 --> L4
    L4 --> L5
    L5 --> L6
    L6 --> L7
    
    style L1 fill:#F44336,color:#fff
    style L2 fill:#FF9800,color:#fff
    style L3 fill:#FFC107,color:#fff
    style L4 fill:#FFEB3B,color:#fff
    style L5 fill:#8BC34A,color:#fff
    style L6 fill:#4CAF50,color:#fff
    style L7 fill:#2196F3,color:#fff
```

---

## Database Schema (Entity Relationship)

```mermaid
erDiagram
    ORGANIZATIONS ||--o{ SITES : has
    ORGANIZATIONS ||--o{ EMPLOYEES : employs
    ORGANIZATIONS ||--o{ USERS : has
    ORGANIZATIONS ||--o{ PAYROLL_EXPORTS : generates
    
    SITES ||--o{ EMPLOYEES : "assigned to"
    SITES ||--o{ ATTENDANCE_EVENTS : "occurs at"
    
    EMPLOYEES ||--o{ DEVICE_ENROLLMENTS : enrolls
    EMPLOYEES ||--o{ ATTENDANCE_EVENTS : logs
    EMPLOYEES ||--o| USERS : "may have account"
    
    ATTENDANCE_EVENTS ||--o{ SYNC_AUDIT_LOG : tracked_by
    
    ORGANIZATIONS {
        uuid id PK
        text name
        timestamptz created_at
    }
    
    SITES {
        uuid id PK
        uuid organization_id FK
        text name
        geography geofence_center
        int geofence_radius_m
        geography geofence_polygon
        text timezone
        text status
    }
    
    EMPLOYEES {
        uuid id PK
        uuid organization_id FK
        uuid site_id FK
        text employee_code UK
        text full_name
        text status
    }
    
    DEVICE_ENROLLMENTS {
        uuid id PK
        uuid employee_id FK
        text device_id
        text face_embedding_ref
        uuid enrolled_by
        timestamptz enrolled_at
        timestamptz revoked_at
    }
    
    ATTENDANCE_EVENTS {
        uuid id PK
        uuid client_event_id UK
        uuid employee_id FK
        uuid site_id FK
        text event_type
        timestamptz device_timestamp
        timestamptz server_timestamp
        geography gps_point
        numeric liveness_score
        numeric match_score
        text status
        bool created_offline
    }
    
    SYNC_AUDIT_LOG {
        uuid id PK
        uuid attendance_event_id FK
        text action
        text actor
        jsonb metadata
        timestamptz at
    }
    
    PAYROLL_EXPORTS {
        uuid id PK
        uuid organization_id FK
        date export_date
        date date_range_start
        date date_range_end
        int total_records
        text status
    }
    
    USERS {
        uuid id PK
        uuid organization_id FK
        text email UK
        text full_name
        text role
        uuid employee_id FK
        text password_hash
    }
```

---

## Technology Stack Deep Dive

### Backend: NestJS

**Why NestJS?**
- ✅ **Type Safety**: TypeScript end-to-end
- ✅ **Opinionated Structure**: Modules, Guards, Pipes, Interceptors prevent accidental security gaps
- ✅ **Built-in Validation**: class-validator + class-transformer for DTO validation
- ✅ **Dependency Injection**: Testable, modular architecture
- ✅ **Enterprise-Ready**: Used by large organizations for mission-critical systems

**Alternatives Considered:**
- ❌ Express.js: Too unopinionated for a payroll-adjacent system (easy to skip validation)
- ❌ Django/Flask: Would work, but team expertise is stronger in Node.js
- ❌ Golang: Excellent performance, but slower dev speed for MVP

### Database: PostgreSQL + PostGIS (via Supabase)

**Why PostgreSQL?**
- ✅ **ACID Transactions**: Critical for attendance → payroll data integrity
- ✅ **Relational Model**: Natural fit for employees, sites, events, exports
- ✅ **PostGIS Extension**: Native geospatial queries (ST_Contains, ST_DWithin)
- ✅ **Row Level Security**: Built-in multi-tenancy (org isolation at DB level)

**Why Supabase?**
- ✅ **Managed Postgres**: Auto-backups, point-in-time recovery, scaling
- ✅ **Built-in Auth**: JWT generation, refresh tokens
- ✅ **RLS Policies**: Declarative security (can't be bypassed by application bugs)
- ✅ **Real-time Subscriptions**: Future feature (live attendance dashboard)

**Alternatives Considered:**
- ❌ MongoDB: Weaker transactions, no native geospatial SQL syntax, less suitable for payroll math
- ❌ Firebase: Vendor lock-in, harder to export data, less control
- ❌ MySQL: No PostGIS equivalent, weaker JSON support

### Mobile: React Native (Expo Bare Workflow)

**Why React Native?**
- ✅ **Cross-Platform**: iOS + Android from one codebase
- ✅ **Native Module Support**: Required for facial recognition SDKs
- ✅ **TypeScript**: Shared types with backend
- ✅ **Large Ecosystem**: Libraries for GPS, camera, biometrics, offline storage

**Why Bare Workflow (not Expo Go)?**
- ✅ Liveness detection SDKs require native modules
- ✅ Root/jailbreak detection requires native code
- ✅ Custom ML Kit integration

**Alternatives Considered:**
- ❌ Native (Swift/Kotlin): 2x development time, 2x maintenance cost
- ❌ Flutter: Less mature ecosystem for biometric/ML libraries
- ❌ PWA: No reliable offline mode, can't access native biometric APIs

---

## Deployment Architecture

### Production Environment

```
┌──────────────────────────────────────────────────────────────┐
│                      CLOUDFLARE / DNS                          │
│                  api.klassic.ph (TLS/CDN)                      │
└────────────────────────────┬─────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────┐
│              RENDER / RAILWAY / FLY.IO                         │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  Docker Container (NestJS API)                         │  │
│  │  - Auto-scaling (1-5 instances)                        │  │
│  │  - Health checks (/health)                             │  │
│  │  - Environment secrets from vault                      │  │
│  └────────────────────────────────────────────────────────┘  │
└────────────────────────────┬─────────────────────────────────┘
                             │
                ┌────────────┼────────────┐
                ▼            ▼            ▼
         ┌──────────┐  ┌──────────┐  ┌──────────┐
         │ Supabase │  │   AWS    │  │  Sentry  │
         │ Postgres │  │Rekognition│  │  Logs    │
         │ + PostGIS│  │Face Match │  │          │
         └──────────┘  └──────────┘  └──────────┘
                             │
                             ▼
                    ┌────────────────┐
                    │Klassic Payroll │
                    │     System     │
                    └────────────────┘
```

### CI/CD Pipeline (GitHub Actions)

```
┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐
│  Push to │ --> │   Lint   │ --> │   Test   │ --> │  Build   │
│   main   │     │ (ESLint) │     │  (Jest)  │     │ (Docker) │
└──────────┘     └──────────┘     └──────────┘     └──────────┘
                                                           │
                                                           ▼
                                                    ┌──────────┐
                                                    │  Deploy  │
                                                    │ Staging  │
                                                    └──────────┘
                                                           │
                                                           ▼
                                                    ┌──────────┐
                                                    │  Manual  │
                                                    │ Approval │
                                                    └──────────┘
                                                           │
                                                           ▼
                                                    ┌──────────┐
                                                    │  Deploy  │
                                                    │Production│
                                                    └──────────┘
```

---

## Scalability Considerations

### Current Architecture Capacity

| Component | Expected Load | Capacity | Bottleneck |
|-----------|---------------|----------|------------|
| **API Server** | ~1000 concurrent users, 10K req/day | 10K req/sec (single instance) | CPU (face matching) |
| **Database** | 100K attendance events/day | 10M rows (no issue) | Write throughput at ~50K/sec |
| **Face Match API** | ~2K face comparisons/day | AWS: virtually unlimited | Cost, not capacity |
| **Mobile App** | Offline-first, no direct scaling concern | N/A | Device storage (~10K events) |

### Scaling Strategy (if needed)

1. **Horizontal Scaling**: Add more API instances (stateless, load-balanced)
2. **Read Replicas**: If reporting queries slow down writes
3. **Queue-Based Face Matching**: Offload face comparisons to a job queue (BullMQ + Redis)
4. **CDN for Static Assets**: Mobile app updates via CDN
5. **Database Sharding**: By organization_id (only if > 10M events/month)

---

## Disaster Recovery

### Backup Strategy

- **Database**: Supabase auto-backup (daily) + point-in-time recovery (7 days)
- **Application Code**: Git (GitHub) + Docker images (container registry)
- **Secrets**: Vault backups (encrypted)

### Recovery Time Objectives (RTO/RPO)

| Scenario | RTO (Recovery Time) | RPO (Data Loss) |
|----------|---------------------|-----------------|
| API server crash | < 5 minutes (auto-restart) | 0 (stateless) |
| Database corruption | < 1 hour (restore from backup) | < 24 hours (daily backup) |
| Complete infrastructure loss | < 4 hours (redeploy from scratch) | < 24 hours |

### Rollback Plan

```bash
# If production deployment breaks:

# 1. Revert to previous Docker image
docker pull klassic-attendance-api:v1.2.3-stable
docker stop klassic-attendance-api-current
docker run klassic-attendance-api:v1.2.3-stable

# 2. Revert database migration (if schema changed)
npm run migration:revert

# 3. Notify team + incident report
```

---

## Performance Benchmarks (Target)

| Endpoint | Target Response Time | Notes |
|----------|---------------------|-------|
| `POST /auth/login` | < 500ms | Includes password hashing (bcrypt) |
| `POST /attendance/check-in` | < 1s | Includes geofence calc + face match API call |
| `POST /attendance/sync` (10 events) | < 2s | Batch upsert |
| `GET /attendance/history` | < 300ms | Paginated query |
| `GET /payroll/export` | < 5s | For 1 month of data (~10K events) |

---

## Next Steps

See [README.md](../../README.md) for implementation roadmap (Phases 1-10).

---

**Document Version**: 1.0  
**Last Updated**: September 11, 2026  
**Author**: Klassic Engineering Team
