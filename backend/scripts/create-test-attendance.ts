import { DataSource } from 'typeorm';
import { config } from 'dotenv';
import { AttendanceEvent, AttendanceEventType, AttendanceEventStatus } from '../src/database/entities';

config();

const AppDataSource = new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  entities: [__dirname + '/../src/database/entities/**/*.entity{.ts,.js}'],
  synchronize: false,
});

async function createTestAttendance() {
  try {
    await AppDataSource.initialize();
    console.log('📦 Creating test attendance events...\n');

    const attendanceRepo = AppDataSource.getRepository(AttendanceEvent);

    const employeeId = '33333333-3333-3333-3333-333333333333';
    const siteId = '22222222-2222-2222-2222-222222222222';

    // Check-in event (verified, approved)
    const checkIn = attendanceRepo.create({
      employeeId,
      siteId,
      eventType: AttendanceEventType.CHECK_IN,
      timestamp: new Date('2026-09-15T01:00:00Z'), // 9:00 AM Manila
      location: `SRID=4326;POINT(120.9842 14.5964)`, // SM Manila coordinates
      deviceId: 'test-device-001',
      biometricVerified: true,
      geofenceVerified: true,
      status: AttendanceEventStatus.APPROVED,
      metadata: {
        deviceInfo: { platform: 'ios', model: 'iPhone 14' },
        faceMatchScore: 0.95,
        livenessScore: 0.98,
        gpsAccuracyM: 10,
      },
    });

    // Check-out event (verified, pending)
    const checkOut = attendanceRepo.create({
      employeeId,
      siteId,
      eventType: AttendanceEventType.CHECK_OUT,
      timestamp: new Date('2026-09-15T09:00:00Z'), // 5:00 PM Manila
      location: `SRID=4326;POINT(120.9842 14.5964)`,
      deviceId: 'test-device-001',
      biometricVerified: true,
      geofenceVerified: true,
      status: AttendanceEventStatus.PENDING,
      metadata: {
        deviceInfo: { platform: 'ios', model: 'iPhone 14' },
        faceMatchScore: 0.92,
        livenessScore: 0.97,
        gpsAccuracyM: 15,
      },
    });

    // Flagged check-in (outside geofence)
    const flaggedCheckIn = attendanceRepo.create({
      employeeId,
      siteId,
      eventType: AttendanceEventType.CHECK_IN,
      timestamp: new Date('2026-09-14T01:30:00Z'),
      location: `SRID=4326;POINT(121.0500 14.6000)`, // Different location
      deviceId: 'test-device-001',
      biometricVerified: true,
      geofenceVerified: false,
      status: AttendanceEventStatus.FLAGGED,
      flagReason: 'Outside geofence: 5.2km from site center',
      metadata: {
        deviceInfo: { platform: 'ios', model: 'iPhone 14' },
        faceMatchScore: 0.93,
        livenessScore: 0.96,
        gpsAccuracyM: 20,
        distanceFromSiteM: 5200,
      },
    });

    // Flagged check-in (face match failed)
    const failedBiometric = attendanceRepo.create({
      employeeId,
      siteId,
      eventType: AttendanceEventType.CHECK_IN,
      timestamp: new Date('2026-09-13T01:00:00Z'),
      location: `SRID=4326;POINT(120.9842 14.5964)`,
      deviceId: 'test-device-001',
      biometricVerified: false,
      geofenceVerified: true,
      status: AttendanceEventStatus.FLAGGED,
      flagReason: 'Face match score below threshold: 0.45',
      metadata: {
        deviceInfo: { platform: 'ios', model: 'iPhone 14' },
        faceMatchScore: 0.45,
        livenessScore: 0.89,
        gpsAccuracyM: 12,
      },
    });

    await attendanceRepo.save([checkIn, checkOut, flaggedCheckIn, failedBiometric]);

    console.log('✅ Created 4 test attendance events:');
    console.log('   • Check-in (Approved)');
    console.log('   • Check-out (Pending)');
    console.log('   • Flagged: Outside geofence');
    console.log('   • Flagged: Face match failed');
    console.log('\n🔗 View in dashboard: http://172.16.0.2:3002/dashboard/attendance\n');

    await AppDataSource.destroy();
  } catch (error) {
    console.error('❌ Failed:', error);
    process.exit(1);
  }
}

createTestAttendance();
