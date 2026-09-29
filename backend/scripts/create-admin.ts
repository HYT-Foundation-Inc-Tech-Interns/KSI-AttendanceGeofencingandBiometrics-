import { DataSource } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { config } from 'dotenv';
import { join } from 'path';

// Load environment variables
config({ path: join(__dirname, '..', '.env') });

async function createAdminUser() {
  console.log('🔧 Connecting to database...');
  
  const dataSource = new DataSource({
    type: 'postgres',
    url: process.env.DATABASE_URL,
    entities: [],
    synchronize: false,
  });

  try {
    await dataSource.initialize();
    console.log('✅ Connected to database');

    // 1. Create organization if doesn't exist
    console.log('\n📊 Creating organization...');
    const orgResult = await dataSource.query(`
      INSERT INTO organizations (id, name, created_at)
      VALUES (
        'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
        'Klassic Solutions',
        NOW()
      )
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name
      RETURNING id, name;
    `);
    console.log('✅ Organization:', orgResult[0]);

    // 2. Hash password
    console.log('\n🔐 Hashing password...');
    const password = 'admin123';
    const passwordHash = await bcrypt.hash(password, 10);
    console.log('✅ Password hashed');

    // 3. Create admin user
    console.log('\n👤 Creating admin user...');
    const userResult = await dataSource.query(`
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
        'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a12',
        'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
        'admin@klassic.ph',
        'Admin User',
        'admin',
        $1,
        true,
        NOW(),
        NOW()
      )
      ON CONFLICT (email) 
      DO UPDATE SET 
        password_hash = EXCLUDED.password_hash,
        updated_at = NOW()
      RETURNING id, email, full_name, role;
    `, [passwordHash]);

    console.log('✅ Admin user created/updated:', userResult[0]);

    // 4. Verify
    console.log('\n🔍 Verifying user...');
    const verifyResult = await dataSource.query(`
      SELECT 
        u.id,
        u.email,
        u.full_name,
        u.role,
        o.name as organization_name,
        u.is_active
      FROM users u
      JOIN organizations o ON u.organization_id = o.id
      WHERE u.email = 'admin@klassic.ph'
    `);

    console.log('\n✅ User verified:', verifyResult[0]);

    console.log('\n🎉 Success! You can now login with:');
    console.log('   Email:    admin@klassic.ph');
    console.log('   Password: admin123');
    console.log('\n🌐 Dashboard: http://localhost:3001');

  } catch (error) {
    console.error('❌ Error:', error.message);
    throw error;
  } finally {
    await dataSource.destroy();
    console.log('\n👋 Disconnected from database');
  }
}

// Run the script
createAdminUser()
  .then(() => {
    console.log('\n✅ Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Script failed:', error);
    process.exit(1);
  });
