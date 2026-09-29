import { DataSource } from 'typeorm';
import { config } from 'dotenv';
import * as bcrypt from 'bcrypt';
import {
  Organization,
  Site,
  Employee,
  User,
  UserRole,
  EmployeeStatus,
  SiteStatus,
} from '../entities';

config(); // Load .env file

const AppDataSource = new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  entities: [__dirname + '/../entities/**/*.entity{.ts,.js}'],
  synchronize: false,
});

async function seed() {
  try {
    await AppDataSource.initialize();
    console.log('📦 Database connected for seeding...');

    const organizationRepo = AppDataSource.getRepository(Organization);
    const siteRepo = AppDataSource.getRepository(Site);
    const employeeRepo = AppDataSource.getRepository(Employee);
    const userRepo = AppDataSource.getRepository(User);

    // Create Organization
    console.log('🏢 Creating organization...');
    let organization = await organizationRepo.findOne({
      where: { name: 'Klassic Inc.' },
    });

    if (!organization) {
      organization = organizationRepo.create({
        name: 'Klassic Inc.',
      });
      await organizationRepo.save(organization);
      console.log('  ✓ Organization created');
    } else {
      console.log('  ℹ Organization already exists');
    }

    // Create Site (SM Manila)
    console.log('📍 Creating site...');
    let site = await siteRepo.findOne({
      where: { name: 'SM Manila Office' },
    });

    if (!site) {
      site = siteRepo.create({
        organizationId: organization.id,
        name: 'SM Manila Office',
        address: 'SM City Manila, Manila',
        // PostGIS geography column: TypeORM writes this as ST_GeomFromGeoJSON,
        // so it must be a GeoJSON object (not WKT) or PostGIS rejects it with
        // "unknown GeoJSON type".
        // GeoJSON coordinates are [longitude, latitude] — longitude first!
        geofenceCenter: {
          type: 'Point',
          coordinates: [120.9842, 14.5964],
        },
        geofenceRadiusM: 100,
        timezone: 'Asia/Manila',
        status: SiteStatus.ACTIVE,
      });
      await siteRepo.save(site);
      console.log('  ✓ Site created');
    } else {
      console.log('  ℹ Site already exists');
    }

    // Create Employee
    console.log('👤 Creating employee...');
    let employee = await employeeRepo.findOne({
      where: { employeeCode: 'EMP001' },
    });

    if (!employee) {
      employee = employeeRepo.create({
        organizationId: organization.id,
        siteId: site.id,
        employeeCode: 'EMP001',
        fullName: 'Juan Dela Cruz',
        email: 'juan.delacruz@klassic.ph',
        phone: '+639171234567',
        status: EmployeeStatus.ACTIVE,
        hiredAt: new Date('2024-01-01'),
      });
      await employeeRepo.save(employee);
      console.log('  ✓ Employee created');
    } else {
      console.log('  ℹ Employee already exists');
    }

    // Create Admin User
    console.log('🔐 Creating admin user...');
    let adminUser = await userRepo.findOne({
      where: { email: 'admin@klassic.ph' },
    });

    if (!adminUser) {
      const passwordHash = await bcrypt.hash('admin123', 10);
      adminUser = userRepo.create({
        organizationId: organization.id,
        email: 'admin@klassic.ph',
        fullName: 'Admin User',
        role: UserRole.ADMIN,
        passwordHash,
        isActive: true,
      });
      await userRepo.save(adminUser);
      console.log('  ✓ Admin user created');
      console.log('  📧 Email: admin@klassic.ph');
      console.log('  🔑 Password: admin123');
      console.log('  ⚠️  CHANGE THIS PASSWORD IN PRODUCTION!');
    } else {
      console.log('  ℹ Admin user already exists');
    }

    // Create Employee User (linked to employee)
    console.log('👤 Creating employee user...');
    let employeeUser = await userRepo.findOne({
      where: { email: 'juan.delacruz@klassic.ph' },
    });

    if (!employeeUser) {
      const passwordHash = await bcrypt.hash('employee123', 10);
      employeeUser = userRepo.create({
        organizationId: organization.id,
        employeeId: employee.id,
        email: 'juan.delacruz@klassic.ph',
        fullName: 'Juan Dela Cruz',
        role: UserRole.EMPLOYEE,
        passwordHash,
        isActive: true,
      });
      await userRepo.save(employeeUser);
      console.log('  ✓ Employee user created');
      console.log('  📧 Email: juan.delacruz@klassic.ph');
      console.log('  🔑 Password: employee123');
    } else {
      console.log('  ℹ Employee user already exists');
    }

    console.log('');
    console.log('✅ Seeding complete!');
    console.log('');
    console.log('📝 Test Credentials:');
    console.log('   Admin    - admin@klassic.ph / admin123');
    console.log('   Employee - juan.delacruz@klassic.ph / employee123');
    console.log('');

    await AppDataSource.destroy();
  } catch (error) {
    console.error('❌ Seeding failed:', error);
    process.exit(1);
  }
}

seed();
