# Klassic Field Attendance System - Backend API

NestJS + TypeScript + PostgreSQL + PostGIS backend for the GPS-geofenced biometric attendance system.

## 🚀 Quick Start

### Prerequisites
- Node.js >= 18.x
- PostgreSQL with PostGIS extension (or Supabase account)
- npm or yarn

### Installation

```bash
# Install dependencies
npm install

# Copy environment variables
cp .env.example .env

# Edit .env with your configuration
# IMPORTANT: Set DATABASE_URL and JWT secrets!
```

### Database Setup

#### Option A: Supabase (Recommended for Development)
1. Create a project at [supabase.com](https://supabase.com)
2. Copy connection string to `.env`
3. Run schema from project root:
```bash
psql "your-supabase-connection-string" < ../database/schema.sql
```

#### Option B: Local PostgreSQL + Docker
```bash
# Start PostgreSQL + PostGIS
docker run --name klassic-db \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=klassic_attendance \
  -p 5432:5432 \
  -d postgis/postgis:15-3.3

# Run schema
psql -h localhost -U postgres -d klassic_attendance < ../database/schema.sql
```

### Seed Database

```bash
# Populate with sample data (admin user, test employee, site)
npm run seed
```

**Test Credentials:**
- Admin: `admin@klassic.ph` / `password123`
- Employee: `juan.delacruz@klassic.ph` / `employee123`

⚠️ **Change these passwords in production!**

### Development

```bash
# Start development server (with hot reload)
npm run start:dev

# API runs on http://localhost:3000/v1
# Swagger docs at http://localhost:3000/api-docs
```

### Production Build

```bash
# Build
npm run build

# Run production server
npm run start:prod
```

## 📁 Project Structure

```
backend/
├── src/
│   ├── config/              # Configuration files (database, JWT, throttler)
│   ├── common/              # Shared resources
│   │   ├── decorators/      # Custom decorators (@CurrentUser, @Public, @Roles)
│   │   ├── guards/          # Auth guards (JWT, Roles)
│   │   ├── filters/         # Exception filters
│   │   └── pipes/           # Validation pipes
│   ├── database/
│   │   ├── entities/        # TypeORM entities (User, Employee, Site, etc.)
│   │   ├── migrations/      # Database migrations
│   │   └── seeds/           # Seed scripts
│   ├── modules/
│   │   ├── auth/            # ✅ Authentication (JWT + refresh tokens)
│   │   ├── health/          # ✅ Health check endpoint
│   │   ├── organizations/   # TODO: Phase 1
│   │   ├── sites/           # TODO: Phase 3
│   │   ├── employees/       # TODO: Phase 1
│   │   ├── attendance/      # TODO: Phase 3-4
│   │   ├── sync/            # TODO: Phase 5
│   │   ├── payroll/         # TODO: Phase 6
│   │   └── admin/           # TODO: Phase 6
│   ├── app.module.ts        # Root module
│   └── main.ts              # Bootstrap file
├── test/                    # E2E tests
├── Dockerfile               # Docker build configuration
└── package.json
```

## 🔐 Authentication

### Login
```bash
curl -X POST http://localhost:3000/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@klassic.ph","password":"password123"}'
```

Response:
```json
{
  "access_token": "eyJhbGc...",
  "refresh_token": "eyJhbGc...",
  "user": {
    "id": "...",
    "email": "admin@klassic.ph",
    "full_name": "Admin User",
    "role": "admin",
    "organization_id": "..."
  }
}
```

### Protected Endpoints

Include the access token in the `Authorization` header:

```bash
curl http://localhost:3000/v1/some-protected-endpoint \
  -H "Authorization: Bearer eyJhbGc..."
```

### Refresh Token

```bash
curl -X POST http://localhost:3000/v1/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{"refresh_token":"eyJhbGc..."}'
```

## 🧪 Testing

```bash
# Unit tests
npm test

# E2E tests
npm run test:e2e

# Test coverage
npm run test:cov
```

## 📊 Database Entities

- **Organization**: Multi-tenant organizations
- **Site**: Physical locations with geofences (circular or polygon)
- **Employee**: Field employees assigned to sites
- **User**: Login accounts (Admin, HR, Supervisor, Employee)
- **DeviceEnrollment**: Biometric enrollment records
- **AttendanceEvent**: Check-in/check-out events
- **SyncAuditLog**: Immutable audit trail

## 🔒 Security Features

✅ **Implemented (Phase 1):**
- JWT access tokens (15min expiry)
- Refresh tokens (7 day expiry)
- Bcrypt password hashing
- Rate limiting (configurable per endpoint)
- Global exception handling
- DTO validation with class-validator
- Helmet security headers
- CORS configuration
- Row Level Security (RLS) in database

🔜 **TODO (Phase 7):**
- HMAC signature verification for offline sync
- Face embedding encryption
- Mock location detection
- Root/jailbreak detection
- Penetration testing

## 📝 API Documentation

Interactive Swagger documentation available at:
```
http://localhost:3000/api-docs
```

Or refer to the OpenAPI spec:
```
../docs/api/openapi.yaml
```

## 🐳 Docker Deployment

### Build Image
```bash
docker build -t klassic-attendance-api .
```

### Run Container
```bash
docker run -p 3000:3000 \
  --env-file .env \
  klassic-attendance-api
```

### Docker Compose (Full Stack)
```bash
# TODO: Create docker-compose.yml in Phase 9
```

## 📈 Performance

- Connection pooling enabled (max 20 connections)
- Query optimization with TypeORM indexes
- PostGIS spatial indexes for geofence queries
- Compression middleware enabled

## 🛠️ Development Commands

```bash
# Start with watch mode
npm run start:dev

# Start with debug mode
npm run start:debug

# Format code
npm run format

# Lint code
npm run lint

# Generate migration
npm run migration:generate -- src/database/migrations/MigrationName

# Run migrations
npm run migration:run

# Revert migration
npm run migration:revert
```

## 🌍 Environment Variables

See `.env.example` for all available configuration options.

**Critical variables:**
- `DATABASE_URL` - PostgreSQL connection string
- `JWT_SECRET` - Access token secret (min 32 chars)
- `JWT_REFRESH_SECRET` - Refresh token secret
- `NODE_ENV` - `development` | `production`

## 📞 Troubleshooting

### Database connection fails
- Check `DATABASE_URL` in `.env`
- Verify PostgreSQL is running
- Test connection: `psql "your-connection-string"`

### PostGIS functions not found
- Ensure PostGIS extension is enabled:
```sql
CREATE EXTENSION IF NOT EXISTS postgis;
```

### JWT errors
- Verify `JWT_SECRET` and `JWT_REFRESH_SECRET` are set
- Check token hasn't expired

### Port already in use
- Change `PORT` in `.env` or kill process:
```bash
# Windows
netstat -ano | findstr :3000
taskkill /PID <PID> /F
```

## 🚧 Phase 1 Status

✅ **Completed:**
- [x] NestJS project initialization
- [x] TypeORM + PostgreSQL setup
- [x] Database entities (7 core models)
- [x] Auth module (JWT + refresh tokens)
- [x] Health check endpoint
- [x] Rate limiting
- [x] Global validation and error handling
- [x] Swagger API documentation
- [x] Docker configuration
- [x] Seed script

🔜 **Next (Phase 2-3):**
- [ ] Organizations CRUD
- [ ] Sites CRUD with geofence management
- [ ] Employees CRUD
- [ ] Geofence validation endpoint

---

**Built with ❤️ by the Klassic Engineering Team**
