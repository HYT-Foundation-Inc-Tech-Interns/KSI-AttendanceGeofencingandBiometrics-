-- Klassic Field Attendance System - Database Schema
-- PostgreSQL + PostGIS (Supabase)
-- Run this script in order; PostGIS extension must be enabled first.

-- Enable PostGIS extension for geospatial operations
CREATE EXTENSION IF NOT EXISTS postgis;

-- =============================================================================
-- ORGANIZATIONS
-- =============================================================================
CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_organizations_name ON organizations(name);

-- =============================================================================
-- SITES (with geofencing)
-- =============================================================================
CREATE TABLE sites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  address TEXT,
  -- Circular geofence (simple sites)
  geofence_center GEOGRAPHY(Point, 4326),
  geofence_radius_m INT,
  -- Polygon geofence (irregular campus boundaries)
  geofence_polygon GEOGRAPHY(Polygon, 4326),
  timezone TEXT NOT NULL DEFAULT 'Asia/Manila',
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'suspended')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT geofence_required CHECK (
    (geofence_center IS NOT NULL AND geofence_radius_m IS NOT NULL) OR
    geofence_polygon IS NOT NULL
  )
);

CREATE INDEX idx_sites_org ON sites(organization_id);
CREATE INDEX idx_sites_geofence_center ON sites USING GIST(geofence_center);
CREATE INDEX idx_sites_geofence_polygon ON sites USING GIST(geofence_polygon);

-- =============================================================================
-- EMPLOYEES
-- =============================================================================
CREATE TABLE employees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  site_id UUID REFERENCES sites(id) ON DELETE SET NULL,
  employee_code TEXT UNIQUE NOT NULL,
  full_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'offboarded')),
  hired_at DATE,
  offboarded_at DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_employees_org ON employees(organization_id);
CREATE INDEX idx_employees_site ON employees(site_id);
CREATE INDEX idx_employees_code ON employees(employee_code);
CREATE INDEX idx_employees_status ON employees(status);

-- =============================================================================
-- DEVICE ENROLLMENTS (biometric registration)
-- =============================================================================
CREATE TABLE device_enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  -- Device identification used to scope an enrollment to a specific handset
  device_identifier TEXT,
  device_name TEXT,
  -- Reference to encrypted face embedding (NOT the raw photo)
  face_embedding_ref TEXT NOT NULL,
  -- Working copy of the embedding; encrypted at rest in production
  face_embedding_data TEXT,
  is_revoked BOOLEAN NOT NULL DEFAULT FALSE,
  -- Enrollment supervision
  enrolled_by UUID, -- HR/supervisor user id
  enrolled_at TIMESTAMPTZ DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  revoked_by UUID,
  revoke_reason TEXT,
  -- Device info
  device_model TEXT,
  device_os TEXT,
  app_version TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_device_enrollments_employee ON device_enrollments(employee_id);
CREATE INDEX idx_device_enrollments_device ON device_enrollments(device_id);
CREATE INDEX idx_device_enrollments_active ON device_enrollments(employee_id) WHERE revoked_at IS NULL;

-- =============================================================================
-- ATTENDANCE EVENTS
-- =============================================================================
CREATE TABLE attendance_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Idempotency key from device (prevents duplicate submissions)
  client_event_id UUID UNIQUE NOT NULL,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('check_in', 'check_out')),
  
  -- Timestamps
  device_timestamp TIMESTAMPTZ NOT NULL,
  server_timestamp TIMESTAMPTZ DEFAULT NOW(),
  
  -- Geolocation
  gps_point GEOGRAPHY(Point, 4326) NOT NULL,
  gps_accuracy_meters NUMERIC,
  is_mock_location BOOLEAN DEFAULT FALSE,
  
  -- Biometric verification scores
  liveness_score NUMERIC CHECK (liveness_score >= 0 AND liveness_score <= 1),
  match_score NUMERIC CHECK (match_score >= 0 AND match_score <= 1),
  
  -- Status workflow
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'flagged', 'rejected', 'exported')),
  flag_reason TEXT,
  
  -- Offline handling
  created_offline BOOLEAN DEFAULT FALSE,
  sync_attempt_count INT DEFAULT 0,
  
  -- Metadata
  device_id TEXT,
  app_version TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_attendance_employee ON attendance_events(employee_id);
CREATE INDEX idx_attendance_site ON attendance_events(site_id);
CREATE INDEX idx_attendance_server_timestamp ON attendance_events(server_timestamp);
CREATE INDEX idx_attendance_status ON attendance_events(status);
CREATE INDEX idx_attendance_employee_date ON attendance_events(employee_id, DATE(server_timestamp AT TIME ZONE 'Asia/Manila'));
CREATE INDEX idx_attendance_gps ON attendance_events USING GIST(gps_point);

-- =============================================================================
-- SYNC AUDIT LOG (immutable append-only log)
-- =============================================================================
CREATE TABLE sync_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attendance_event_id UUID REFERENCES attendance_events(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('received', 'verified', 'flagged', 'rejected', 'manual_override', 'exported_to_payroll', 'sync_retry')),
  actor TEXT, -- 'system' or user id for manual actions
  actor_role TEXT,
  notes TEXT,
  metadata JSONB,
  at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sync_audit_event ON sync_audit_log(attendance_event_id);
CREATE INDEX idx_sync_audit_at ON sync_audit_log(at);
CREATE INDEX idx_sync_audit_action ON sync_audit_log(action);

-- =============================================================================
-- PAYROLL EXPORTS (tracking what's been sent to the payroll system)
-- =============================================================================
CREATE TABLE payroll_exports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  export_date DATE NOT NULL,
  date_range_start DATE NOT NULL,
  date_range_end DATE NOT NULL,
  total_records INT NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed')),
  export_file_url TEXT,
  error_message TEXT,
  exported_by UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_payroll_exports_org ON payroll_exports(organization_id);
CREATE INDEX idx_payroll_exports_date ON payroll_exports(export_date);

-- =============================================================================
-- USERS (HR, Supervisors, Admins)
-- =============================================================================
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email TEXT UNIQUE NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'hr', 'supervisor', 'employee')),
  employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
  password_hash TEXT NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  -- TRUE while the account is still on an administrator-issued temporary
  -- password. Cleared when the owner sets their own. Enforced by
  -- PasswordChangeRequiredGuard, not merely shown by the client.
  must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_users_org ON users(organization_id);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_employee ON users(employee_id);

-- =============================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- =============================================================================

-- Enable RLS on all tables
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_exports ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- Organizations: users can only see their own org
CREATE POLICY org_isolation ON organizations
  FOR ALL
  USING (id = current_setting('app.current_organization_id')::UUID);

-- Sites: scoped by organization
CREATE POLICY site_org_isolation ON sites
  FOR ALL
  USING (organization_id = current_setting('app.current_organization_id')::UUID);

-- Employees: scoped by organization
CREATE POLICY employee_org_isolation ON employees
  FOR ALL
  USING (organization_id = current_setting('app.current_organization_id')::UUID);

-- Device enrollments: scoped by employee's organization
CREATE POLICY enrollment_org_isolation ON device_enrollments
  FOR ALL
  USING (
    employee_id IN (
      SELECT id FROM employees 
      WHERE organization_id = current_setting('app.current_organization_id')::UUID
    )
  );

-- Attendance events: scoped by employee's organization
CREATE POLICY attendance_org_isolation ON attendance_events
  FOR ALL
  USING (
    employee_id IN (
      SELECT id FROM employees 
      WHERE organization_id = current_setting('app.current_organization_id')::UUID
    )
  );

-- Sync audit log: scoped by related attendance event's organization
CREATE POLICY audit_org_isolation ON sync_audit_log
  FOR ALL
  USING (
    attendance_event_id IN (
      SELECT ae.id FROM attendance_events ae
      JOIN employees e ON ae.employee_id = e.id
      WHERE e.organization_id = current_setting('app.current_organization_id')::UUID
    )
  );

-- Payroll exports: scoped by organization
CREATE POLICY payroll_org_isolation ON payroll_exports
  FOR ALL
  USING (organization_id = current_setting('app.current_organization_id')::UUID);

-- Users: scoped by organization
CREATE POLICY user_org_isolation ON users
  FOR ALL
  USING (organization_id = current_setting('app.current_organization_id')::UUID);

-- =============================================================================
-- FUNCTIONS & TRIGGERS
-- =============================================================================

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_organizations_updated_at BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_sites_updated_at BEFORE UPDATE ON sites
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_employees_updated_at BEFORE UPDATE ON employees
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_attendance_events_updated_at BEFORE UPDATE ON attendance_events
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- GEOFENCE VALIDATION FUNCTIONS
-- =============================================================================

-- Check if a point is within a site's geofence (circular)
-- NOTE: both arguments to ST_DWithin must be `geography`. Casting to `geometry`
-- makes geofence_radius_m be compared against degrees (1 degree ~ 111 km), so a
-- 100 m radius would accept points thousands of km away.
CREATE OR REPLACE FUNCTION is_within_circular_geofence(
  p_site_id UUID,
  p_lat NUMERIC,
  p_lng NUMERIC
)
RETURNS BOOLEAN AS $$
DECLARE
  v_within BOOLEAN;
BEGIN
  SELECT ST_DWithin(
    geofence_center,
    ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography,
    geofence_radius_m
  )
  INTO v_within
  FROM sites
  WHERE id = p_site_id AND geofence_center IS NOT NULL;

  RETURN COALESCE(v_within, FALSE);
END;
$$ LANGUAGE plpgsql STABLE;

-- Check if a point is within a site's geofence (polygon)
CREATE OR REPLACE FUNCTION is_within_polygon_geofence(
  p_site_id UUID,
  p_lat NUMERIC,
  p_lng NUMERIC
)
RETURNS BOOLEAN AS $$
DECLARE
  v_within BOOLEAN;
BEGIN
  SELECT ST_Contains(
    geofence_polygon::geometry,
    ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geometry
  )
  INTO v_within
  FROM sites
  WHERE id = p_site_id AND geofence_polygon IS NOT NULL;
  
  RETURN COALESCE(v_within, FALSE);
END;
$$ LANGUAGE plpgsql STABLE;

-- Universal geofence check (tries both circular and polygon)
CREATE OR REPLACE FUNCTION is_within_geofence(
  p_site_id UUID,
  p_lat NUMERIC,
  p_lng NUMERIC
)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN is_within_circular_geofence(p_site_id, p_lat, p_lng) OR
         is_within_polygon_geofence(p_site_id, p_lat, p_lng);
END;
$$ LANGUAGE plpgsql STABLE;

-- =============================================================================
-- SAMPLE DATA (for development/testing)
-- =============================================================================

-- Insert sample organization
INSERT INTO organizations (id, name) VALUES 
  ('11111111-1111-1111-1111-111111111111', 'Klassic Inc.')
ON CONFLICT DO NOTHING;

-- Insert sample site (SM Manila - circular geofence)
INSERT INTO sites (id, organization_id, name, address, geofence_center, geofence_radius_m, timezone) VALUES 
  ('22222222-2222-2222-2222-222222222222',
   '11111111-1111-1111-1111-111111111111',
   'SM Manila Office',
   'SM City Manila, Manila',
   ST_SetSRID(ST_MakePoint(120.9842, 14.5964), 4326)::geography,
   100,
   'Asia/Manila')
ON CONFLICT DO NOTHING;

-- Insert sample employee
INSERT INTO employees (id, organization_id, site_id, employee_code, full_name, email, status) VALUES 
  ('33333333-3333-3333-3333-333333333333',
   '11111111-1111-1111-1111-111111111111',
   '22222222-2222-2222-2222-222222222222',
   'EMP001',
   'Juan Dela Cruz',
   'juan.delacruz@klassic.ph',
   'active')
ON CONFLICT DO NOTHING;

-- Insert sample admin user (password: 'password123' - CHANGE IN PRODUCTION!)
INSERT INTO users (id, organization_id, email, full_name, role, password_hash) VALUES 
  ('44444444-4444-4444-4444-444444444444',
   '11111111-1111-1111-1111-111111111111',
   'admin@klassic.ph',
   'Admin User',
   'admin',
   '$2b$10$rKvVEhNSKDm0JKBJqe0t0.JrYh5CZ1pBwqYm0YqhGQPXZN0gH0q9i')
ON CONFLICT DO NOTHING;
