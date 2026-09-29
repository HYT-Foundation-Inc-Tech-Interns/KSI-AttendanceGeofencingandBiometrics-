import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Add `device_enrollments.face_descriptor`.
 *
 * NOTE: this project has no migrations table and `synchronize` is off, so
 * TypeORM migrations have never been executed here. This file records the
 * change; the column was applied to the live database with the equivalent
 * statement, which is idempotent and safe to re-run:
 *
 *   ALTER TABLE public.device_enrollments
 *     ADD COLUMN IF NOT EXISTS face_descriptor JSONB;
 *
 * `database/schema.sql` was updated alongside it and remains the source of
 * truth for a database built from scratch.
 *
 * Why the column exists: enrollment previously had nowhere to put the face
 * vector. `face_embedding_data` was being handed the raw base64 photo, and
 * the NOT NULL `face_embedding_ref` was never written at all -- which is what
 * made POST /biometric/enroll fail with a 500 on every call. The descriptor
 * now has a typed column, so the raw photo no longer needs to be retained.
 */
export class AddFaceDescriptorToDeviceEnrollments1700000000001
  implements MigrationInterface
{
  name = 'AddFaceDescriptorToDeviceEnrollments1700000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "device_enrollments" ADD COLUMN IF NOT EXISTS "face_descriptor" JSONB`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "device_enrollments" DROP COLUMN IF EXISTS "face_descriptor"`,
    );
  }
}
