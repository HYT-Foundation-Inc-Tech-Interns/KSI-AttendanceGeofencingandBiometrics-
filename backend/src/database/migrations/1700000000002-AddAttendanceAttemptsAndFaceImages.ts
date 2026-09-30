import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Separate refused attempts from real attendance, and keep the face that was
 * actually seen.
 *
 * NOTE: this project has no migrations table and `synchronize` is off, so
 * TypeORM migrations have never been executed here. This file records the
 * change; the same statements were applied to the live database directly, and
 * every one is idempotent so re-running is safe. `database/schema.sql` was
 * updated alongside it and remains the source of truth for a fresh database.
 *
 * Why `attendance_attempts` exists: a refused check-in was written into
 * `attendance_events` with status FLAGGED. That put a failed attempt in the
 * same list as real attendance -- one worker retrying a bad capture produced
 * four rows that read as four attendance records. A refusal is not attendance;
 * it is something the admin needs to be told about, so it gets its own table
 * and surfaces through the notification bell.
 *
 * Why the image columns exist: "face verification failed" tells an admin
 * nothing they can act on, and neither does a match score on its own. Storing
 * the frame the camera actually saw makes the record auditable. All three
 * columns are cleared after BIOMETRIC_RETENTION_DAYS; the 128-d descriptor is
 * kept, because that is what verification uses and it is not a photograph.
 */
export class AddAttendanceAttemptsAndFaceImages1700000000002
  implements MigrationInterface
{
  name = 'AddAttendanceAttemptsAndFaceImages1700000000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    /*
     * `event_type` is TEXT + CHECK, not a Postgres enum: that is what
     * database/schema.sql builds and therefore what the live table has, even
     * though the TypeORM entity declares `type: 'enum'`. The entity's hint only
     * affects DDL generation, and `synchronize` is off.
     */
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "attendance_attempts" (
         "id" uuid NOT NULL DEFAULT gen_random_uuid(),
         "employee_id" uuid NOT NULL,
         "site_id" uuid,
         "event_type" text NOT NULL CHECK ("event_type" IN ('check_in', 'check_out')),
         "device_timestamp" timestamptz,
         "server_timestamp" timestamptz NOT NULL DEFAULT now(),
         "reason_code" text NOT NULL,
         "reason" text NOT NULL,
         "match_score" numeric CHECK ("match_score" IS NULL OR ("match_score" >= 0 AND "match_score" <= 1)),
         "distance_meters" numeric,
         "latitude" numeric,
         "longitude" numeric,
         "capture_image" text,
         "device_id" text,
         "acknowledged_at" timestamptz,
         "acknowledged_by" uuid,
         "approved_event_id" uuid,
         "approved_by" uuid,
         "approved_at" timestamptz,
         "created_at" timestamptz NOT NULL DEFAULT now(),
         CONSTRAINT "PK_attendance_attempts" PRIMARY KEY ("id"),
         CONSTRAINT "FK_attendance_attempts_employee"
           FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE,
         CONSTRAINT "FK_attendance_attempts_site"
           FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE
       )`,
    );

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_attendance_attempts_employee_time"
         ON "attendance_attempts" ("employee_id", "server_timestamp")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_attendance_attempts_acknowledged"
         ON "attendance_attempts" ("acknowledged_at")`,
    );

    await queryRunner.query(
      `ALTER TABLE "attendance_events" ADD COLUMN IF NOT EXISTS "capture_image" TEXT`,
    );
    await queryRunner.query(
      `ALTER TABLE "device_enrollments" ADD COLUMN IF NOT EXISTS "enrollment_image" TEXT`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "device_enrollments" DROP COLUMN IF EXISTS "enrollment_image"`,
    );
    await queryRunner.query(
      `ALTER TABLE "attendance_events" DROP COLUMN IF EXISTS "capture_image"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "attendance_attempts"`);
  }
}
