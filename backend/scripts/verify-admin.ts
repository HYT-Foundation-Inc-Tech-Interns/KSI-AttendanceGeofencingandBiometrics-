import { DataSource } from 'typeorm';
import { config } from 'dotenv';
import { join } from 'path';

config({ path: join(__dirname, '..', '.env') });

async function verifyAdmin() {
  const dataSource = new DataSource({
    type: 'postgres',
    url: process.env.DATABASE_URL,
    entities: [],
    synchronize: false,
  });

  try {
    await dataSource.initialize();
    console.log('✅ Connected to database\n');

    const users = await dataSource.query(`
      SELECT 
        u.id,
        u.email,
        u.full_name,
        u.role,
        u.is_active,
        o.name as organization_name
      FROM users u
      LEFT JOIN organizations o ON u.organization_id = o.id
      WHERE u.email = 'admin@klassic.ph'
    `);

    if (users.length === 0) {
      console.log('❌ No user found with email: admin@klassic.ph');
      console.log('\n🔧 Run this to create admin user:');
      console.log('   cd backend');
      console.log('   npx ts-node scripts/create-admin.ts');
    } else {
      console.log('✅ Admin user found!\n');
      console.log('📧 Email:', users[0].email);
      console.log('👤 Name:', users[0].full_name);
      console.log('🏢 Organization:', users[0].organization_name);
      console.log('🔐 Role:', users[0].role);
      console.log('✓ Active:', users[0].is_active);
      console.log('\n🔑 Login credentials:');
      console.log('   Email: admin@klassic.ph');
      console.log('   Password: admin123');
      console.log('\n🌐 Dashboard: http://localhost:3001');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await dataSource.destroy();
  }
}

verifyAdmin();
