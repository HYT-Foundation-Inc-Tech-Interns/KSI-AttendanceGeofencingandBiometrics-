import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Record when a site's working day is supposed to start, so a late arrival can
 * be named as late.
 *
 * NOTE: as with the earlier migrations here, this project has no migrations
 * table and `synchronize` is off, so TypeORM has never run these. This file
 * records the change; the same statement was applied to the live database
 * directly and is idempotent, and `database/schema.sql` was updated alongside
 * it and remains the source of truth for a fresh database.
 *
 * Why a column on `sites` rather than on `employees`: the shift belongs to the
 * place of work, not to the person. Everyone punching at Paltok starts at the
 * same time, and a per-employee column would mean setting it eight times and
 * keeping eight copies of one fact in step.
 *
 * Why `TIME` and not a timestamp: it is a daily recurring moment. A timestamp
 * would invite it to be read as a specific date, and the lateness comparison
 * has to be made against the day the punch actually happened on.
 *
 * Nullable on purpose. A site without a shift start has no lateness measured,
 * which is a different statement from "on time" -- and back-filling a guess
 * would silently mark every existing punch early or late.
 */
export class AddShiftStartToSites1700000000003 implements MigrationInterface {
  name = 'AddShiftStartToSites1700000000003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "sites" ADD COLUMN IF NOT EXISTS "shift_start_time" TIME`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "sites" DROP COLUMN IF EXISTS "shift_start_time"`,
    );
  }
}
