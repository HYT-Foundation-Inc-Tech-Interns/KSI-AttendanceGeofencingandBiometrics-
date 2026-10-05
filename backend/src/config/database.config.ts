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
      // Connection pool settings.
      //
      // connectionTimeoutMillis was 2000, which is aggressive for a remote
      // Postgres and was the most likely cause of the intermittent
      // "Connection terminated due to connection timeout" errors on
      // POST /v1/auth/login.
      //
      // Measured, not assumed: connecting to the Supabase pooler took 989 ms
      // on its own -- half of the old 2000 ms budget spent before a single
      // query ran. A cold TCP connect plus TLS handshake against a remote
      // pooler can exceed 2 s outright, and when it does the failure is a
      // generic timeout that looks like the database is down rather than like
      // a budget that was set too tight.
      //
      // 10000 is the conventional value for a managed remote database. It only
      // bounds how long to wait for a connection to be ESTABLISHED; it does
      // not affect query timeouts, so raising it cannot mask a slow query.
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    },
  };
};
