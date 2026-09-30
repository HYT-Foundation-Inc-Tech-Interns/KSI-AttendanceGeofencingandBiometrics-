import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { BiometricRetentionService } from './biometric-retention.service';
import { MaintenanceController } from './maintenance.controller';
import {
  AttendanceAttempt,
  AttendanceEvent,
  DeviceEnrollment,
} from '../../database/entities';

/**
 * Scheduled housekeeping that no single feature module owns.
 *
 * The retention sweep reaches into biometrics, attendance and refused
 * attempts at once, so filing it under any one of them would make that module
 * depend on the other two for reasons unrelated to its own job.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([DeviceEnrollment, AttendanceEvent, AttendanceAttempt]),
    ConfigModule,
  ],
  controllers: [MaintenanceController],
  providers: [BiometricRetentionService],
  exports: [BiometricRetentionService],
})
export class MaintenanceModule {}
