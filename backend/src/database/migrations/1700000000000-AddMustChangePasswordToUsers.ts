import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Add `users.must_change_password`.
 *
 * NOTE: this project has no migrations table and `synchronize` is off, so
 * TypeORM migrations have never been executed here. This file records the
 * change; the column was applied to the live database with the equivalent
 * statement, which is idempotent and safe to re-run:
 *
 *   ALTER TABLE public.users
 *     ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;
 *
 * `database/schema.sql` was updated alongside it and remains the source of
 * truth for a database built from scratch.
 */
export class AddMustChangePasswordToUsers1700000000000
  implements MigrationInterface
{
  name = 'AddMustChangePasswordToUsers1700000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "must_change_password" BOOLEAN NOT NULL DEFAULT FALSE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "must_change_password"`,
    );
  }
}
