import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import {
  User,
  Organization,
  Site,
  Employee,
  DeviceEnrollment,
  AttendanceEvent,
  AttendanceAttempt,
  SyncAuditLog,
} from '../database/entities';

export const getDatabaseConfig = (
  configService: ConfigService,
): TypeOrmModuleOptions => {
  return {
    type: 'postgres',
    url: configService.get<string>('DATABASE_URL'),
    entities: [
      User,
      Organization,
      Site,
      Employee,
      DeviceEnrollment,
      AttendanceEvent,
      AttendanceAttempt,
      SyncAuditLog,
    ],
    migrations: [__dirname + '/../database/migrations/**/*{.ts,.js}'],
    synchronize: false, // NEVER use synchronize in production
    logging: configService.get<string>('NODE_ENV') === 'development',
    ssl:
      configService.get<string>('NODE_ENV') === 'production'
        ? { rejectUnauthorized: false }
        : false,
    extra: {
      // Connection pool settings
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    },
  };
};
