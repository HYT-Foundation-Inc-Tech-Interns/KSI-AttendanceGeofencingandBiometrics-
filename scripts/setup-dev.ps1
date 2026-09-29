# Klassic Field Attendance System - Development Environment Setup Script
# Run this script to initialize your local development environment

Write-Host "=====================================================================" -ForegroundColor Cyan
Write-Host "   Klassic Field Attendance System - Development Setup" -ForegroundColor Cyan
Write-Host "=====================================================================" -ForegroundColor Cyan
Write-Host ""

# Check prerequisites
Write-Host "[1/8] Checking prerequisites..." -ForegroundColor Yellow

# Check Node.js
try {
    $nodeVersion = node --version
    Write-Host "  ✓ Node.js: $nodeVersion" -ForegroundColor Green
} catch {
    Write-Host "  ✗ Node.js not found. Please install Node.js >= 18.x" -ForegroundColor Red
    Write-Host "    Download: https://nodejs.org" -ForegroundColor Yellow
    exit 1
}

# Check npm
try {
    $npmVersion = npm --version
    Write-Host "  ✓ npm: v$npmVersion" -ForegroundColor Green
} catch {
    Write-Host "  ✗ npm not found" -ForegroundColor Red
    exit 1
}

# Check Docker (optional)
try {
    $dockerVersion = docker --version
    Write-Host "  ✓ Docker: $dockerVersion" -ForegroundColor Green
    $hasDocker = $true
} catch {
    Write-Host "  ⚠ Docker not found (optional, but recommended for local Postgres)" -ForegroundColor Yellow
    $hasDocker = $false
}

Write-Host ""

# Create environment files
Write-Host "[2/8] Creating environment files..." -ForegroundColor Yellow

if (-not (Test-Path "backend\.env")) {
    Copy-Item "backend\.env.example" "backend\.env"
    Write-Host "  ✓ Created backend\.env from template" -ForegroundColor Green
    Write-Host "    ⚠ IMPORTANT: Edit backend\.env and set your secrets!" -ForegroundColor Yellow
} else {
    Write-Host "  ℹ backend\.env already exists, skipping" -ForegroundColor Cyan
}

if (-not (Test-Path "mobile\.env")) {
    Copy-Item "mobile\.env.example" "mobile\.env"
    Write-Host "  ✓ Created mobile\.env from template" -ForegroundColor Green
} else {
    Write-Host "  ℹ mobile\.env already exists, skipping" -ForegroundColor Cyan
}

Write-Host ""

# Install backend dependencies
Write-Host "[3/8] Installing backend dependencies..." -ForegroundColor Yellow
Set-Location backend
npm install
if ($LASTEXITCODE -eq 0) {
    Write-Host "  ✓ Backend dependencies installed" -ForegroundColor Green
} else {
    Write-Host "  ✗ Backend installation failed" -ForegroundColor Red
    Set-Location ..
    exit 1
}
Set-Location ..

Write-Host ""

# Install mobile dependencies
Write-Host "[4/8] Installing mobile dependencies..." -ForegroundColor Yellow
Set-Location mobile
npm install
if ($LASTEXITCODE -eq 0) {
    Write-Host "  ✓ Mobile dependencies installed" -ForegroundColor Green
} else {
    Write-Host "  ✗ Mobile installation failed" -ForegroundColor Red
    Set-Location ..
    exit 1
}
Set-Location ..

Write-Host ""

# Offer to start PostgreSQL via Docker
if ($hasDocker) {
    Write-Host "[5/8] Database Setup" -ForegroundColor Yellow
    Write-Host "  Do you want to start a local PostgreSQL + PostGIS database via Docker?" -ForegroundColor Cyan
    Write-Host "  (If you're using Supabase or an existing Postgres instance, select 'N')" -ForegroundColor Cyan
    $startDb = Read-Host "  Start local database? (Y/N)"
    
    if ($startDb -eq "Y" -or $startDb -eq "y") {
        Write-Host "  Starting PostgreSQL + PostGIS container..." -ForegroundColor Yellow
        
        docker run --name klassic-db `
            -e POSTGRES_PASSWORD=postgres `
            -e POSTGRES_DB=klassic_attendance `
            -p 5432:5432 `
            -d postgis/postgis:15-3.3
        
        if ($LASTEXITCODE -eq 0) {
            Write-Host "  ✓ Database container started" -ForegroundColor Green
            Write-Host "    Connection: postgresql://postgres:postgres@localhost:5432/klassic_attendance" -ForegroundColor Cyan
            
            # Wait for database to be ready
            Write-Host "  Waiting for database to be ready..." -ForegroundColor Yellow
            Start-Sleep -Seconds 5
            
            # Run schema
            Write-Host "  Running database schema..." -ForegroundColor Yellow
            $env:PGPASSWORD = "postgres"
            psql -h localhost -U postgres -d klassic_attendance -f database/schema.sql 2>&1 | Out-Null
            
            if ($LASTEXITCODE -eq 0) {
                Write-Host "  ✓ Database schema applied" -ForegroundColor Green
            } else {
                Write-Host "  ⚠ Schema application failed. You may need to run it manually:" -ForegroundColor Yellow
                Write-Host "    psql -h localhost -U postgres -d klassic_attendance < database/schema.sql" -ForegroundColor Cyan
            }
        } else {
            Write-Host "  ✗ Failed to start database container" -ForegroundColor Red
        }
    } else {
        Write-Host "  ℹ Skipping local database setup" -ForegroundColor Cyan
        Write-Host "    Remember to:" -ForegroundColor Yellow
        Write-Host "      1. Set DATABASE_URL in backend\.env" -ForegroundColor Yellow
        Write-Host "      2. Run database/schema.sql on your database" -ForegroundColor Yellow
    }
} else {
    Write-Host "[5/8] Database Setup" -ForegroundColor Yellow
    Write-Host "  ⚠ Docker not available. Manual database setup required:" -ForegroundColor Yellow
    Write-Host "    Option A: Create a Supabase project at https://supabase.com" -ForegroundColor Cyan
    Write-Host "    Option B: Install PostgreSQL + PostGIS manually" -ForegroundColor Cyan
    Write-Host "    Then: Run database/schema.sql on your database" -ForegroundColor Cyan
}

Write-Host ""

# Generate secrets (JWT)
Write-Host "[6/8] Security Configuration" -ForegroundColor Yellow
Write-Host "  ⚠ CRITICAL: Update these secrets in backend\.env:" -ForegroundColor Yellow

# Generate random base64 secrets
$jwtSecret = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes((New-Guid).ToString() + (New-Guid).ToString()))
$refreshSecret = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes((New-Guid).ToString() + (New-Guid).ToString()))
$hmacSecret = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes((New-Guid).ToString() + (New-Guid).ToString()))

Write-Host "    JWT_SECRET=$jwtSecret" -ForegroundColor Cyan
Write-Host "    JWT_REFRESH_SECRET=$refreshSecret" -ForegroundColor Cyan
Write-Host "    HMAC_DEVICE_SIGNING_KEY=$hmacSecret" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Copy these to backend\.env (replace the placeholder values)" -ForegroundColor Yellow

Write-Host ""

# Compliance checklist reminder
Write-Host "[7/8] Compliance Checklist" -ForegroundColor Yellow
Write-Host "  ⚠ Before deploying to production, complete:" -ForegroundColor Yellow
Write-Host "    [ ] docs/compliance/dpa-compliance-checklist.md" -ForegroundColor Cyan
Write-Host "    [ ] Designate a Data Protection Officer (DPO)" -ForegroundColor Cyan
Write-Host "    [ ] Customize docs/compliance/privacy-notice-employee-template.md" -ForegroundColor Cyan
Write-Host "    [ ] Obtain employee consent forms" -ForegroundColor Cyan
Write-Host "    [ ] Sign Data Processing Agreements with vendors" -ForegroundColor Cyan

Write-Host ""

# Summary
Write-Host "[8/8] Setup Complete!" -ForegroundColor Green
Write-Host ""
Write-Host "=====================================================================" -ForegroundColor Cyan
Write-Host "   Next Steps:" -ForegroundColor Cyan
Write-Host "=====================================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "1. Edit backend\.env with your configuration (especially secrets!)" -ForegroundColor White
Write-Host ""
Write-Host "2. Start the backend:" -ForegroundColor White
Write-Host "   cd backend" -ForegroundColor Cyan
Write-Host "   npm run start:dev" -ForegroundColor Cyan
Write-Host ""
Write-Host "3. Start the mobile app (in a new terminal):" -ForegroundColor White
Write-Host "   cd mobile" -ForegroundColor Cyan
Write-Host "   expo start" -ForegroundColor Cyan
Write-Host ""
Write-Host "4. Access API documentation:" -ForegroundColor White
Write-Host "   http://localhost:3000/health" -ForegroundColor Cyan
Write-Host ""
Write-Host "5. Review the architecture:" -ForegroundColor White
Write-Host "   docs/architecture/system-architecture.md" -ForegroundColor Cyan
Write-Host ""
Write-Host "=====================================================================" -ForegroundColor Cyan
Write-Host "   Development Resources:" -ForegroundColor Cyan
Write-Host "=====================================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  • README.md - Project overview & build phases" -ForegroundColor White
Write-Host "  • docs/api/openapi.yaml - API specification" -ForegroundColor White
Write-Host "  • database/schema.sql - Database schema" -ForegroundColor White
Write-Host "  • database/types.ts - TypeScript type definitions" -ForegroundColor White
Write-Host ""
Write-Host "Need help? Contact: devops@klassic.ph" -ForegroundColor Yellow
Write-Host ""
