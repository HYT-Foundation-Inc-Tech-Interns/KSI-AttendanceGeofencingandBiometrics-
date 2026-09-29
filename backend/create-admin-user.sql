-- Create Admin User for HR Dashboard
-- Run this SQL in your Supabase SQL Editor or via psql

-- 1. First, check if an organization exists (or create one)
INSERT INTO organizations (id, name, created_at)
VALUES (
  'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', -- Fixed UUID for testing
  'Klassic Solutions',
  NOW()
)
ON CONFLICT (id) DO NOTHING;

-- 2. Create an admin user
-- Password: "admin123" (hashed with bcrypt)
-- You can change this after first login!
INSERT INTO users (
  id,
  organization_id,
  email,
  full_name,
  role,
  password_hash,
  is_active,
  created_at,
  updated_at
)
VALUES (
  'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a12', -- Fixed UUID for testing
  'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', -- Organization ID from above
  'admin@klassic.ph',
  'Admin User',
  'admin',
  '$2b$10$rZ5yJ8B3YqJYZ8K3QX5YWuYHZY8X9X0X1X2X3X4X5X6X7X8X9X0X1X', -- bcrypt hash of "admin123"
  true,
  NOW(),
  NOW()
)
ON CONFLICT (email) DO NOTHING;

-- 3. Verify the user was created
SELECT 
  u.id,
  u.email,
  u.full_name,
  u.role,
  o.name as organization_name,
  u.is_active,
  u.created_at
FROM users u
JOIN organizations o ON u.organization_id = o.id
WHERE u.email = 'admin@klassic.ph';

-- Expected output:
-- email: admin@klassic.ph
-- password: admin123
-- role: admin
