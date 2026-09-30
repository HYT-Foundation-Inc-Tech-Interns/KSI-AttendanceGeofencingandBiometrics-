import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  AttendanceAttempt,
  AttendanceEvent,
  DeviceEnrollment,
} from '../../database/entities';

/**
 * What one sweep did. Returned rather than only logged so the admin endpoint
 * (and any test) can assert on it.
 */
export interface RetentionSweepResult {
  retentionDays: number;
  cutoff: Date;
  clearedEnrollmentImages: number;
  clearedEventImages: number;
  clearedAttemptImages: number;
}

/**
 * Cap per table per run.
 *
 * Retention is a promise about the long run, not about one night, so there is
 * no reason for a single sweep to rewrite millions of rows and hold locks
 * while attendance is being recorded. Anything left over is cleared by the
 * next run -- the cron is daily and the backlog only shrinks.
 */
const MAX_ROWS_PER_TABLE = 5_000;

/**
 * Deletes the face photographs once they are older than the retention window.
 *
 * Three things this deliberately does NOT do:
 *
 * 1. It does not delete rows. The attendance record -- who, when, where, what
 *    score -- is the audit trail and stays. Only the picture goes. A check-in
 *    that happened is still a check-in after the photo expires.
 *
 * 2. It does not touch `face_descriptor`. The 128-d vector is what makes
 *    verification work, it is not reversible into an image, and clearing it
 *    would silently lock every employee out of check-in on day 31. Retention
 *    is about the photographs.
 *
 * 3. It does not delete `face_embedding_data` either, even though that column
 *    holds an image. That one is the *input* to the legacy AWS/InsightFace
 *    matching path -- clearing it would change verification behaviour, which
 *    is a decision for whoever runs that path, not a nightly job.
 *
 * Age is measured from `server_timestamp`, not `device_timestamp`. The latter
 * arrives from the phone and a phone can claim to be from last year, which
 * would let a device hold a photograph past its expiry by lying about the
 * date. The server clock cannot be moved by the client.
 */
@Injectable()
export class BiometricRetentionService {
  private readonly logger = new Logger(BiometricRetentionService.name);

  constructor(
    @InjectRepository(DeviceEnrollment)
    private readonly enrollmentRepository: Repository<DeviceEnrollment>,
    @InjectRepository(AttendanceEvent)
    private readonly eventRepository: Repository<AttendanceEvent>,
    @InjectRepository(AttendanceAttempt)
    private readonly attemptRepository: Repository<AttendanceAttempt>,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Read the window. Returns null when the sweep should not run at all.
   *
   * A non-positive or unparseable value disables the sweep instead of being
   * treated as "expire immediately". `BIOMETRIC_RETENTION_DAYS=0` is far more
   * likely to be a mistake or a placeholder than a considered decision to
   * destroy every photograph on the next cron tick, and the safe reading of
   * an ambiguous instruction is to do nothing.
   */
  private resolveRetentionDays(): number | null {
    const raw = this.configService.get<string>('BIOMETRIC_RETENTION_DAYS', '30');
    const parsed = Number.parseInt(raw, 10);

    if (!Number.isFinite(parsed) || parsed <= 0) {
      this.logger.warn(
        `BIOMETRIC_RETENTION_DAYS="${raw}" is not a positive number of days; skipping the sweep.`,
      );
      return null;
    }

    return parsed;
  }

  /**
   * What the sweep would do right now, without doing it.
   */
  async describe(now: Date = new Date()): Promise<{
    enabled: boolean;
    retentionDays: number | null;
    cutoff: Date | null;
    imagesOnFile: {
      enrollments: number;
      attendanceEvents: number;
      refusedAttempts: number;
    };
  }> {
    const retentionDays = this.resolveRetentionDays();

    const [enrollments, attendanceEvents, refusedAttempts] = await Promise.all([
      this.enrollmentRepository
        .createQueryBuilder('e')
        .where('e.enrollment_image IS NOT NULL')
        .getCount(),
      this.eventRepository
        .createQueryBuilder('e')
        .where('e.capture_image IS NOT NULL')
        .getCount(),
      this.attemptRepository
        .createQueryBuilder('a')
        .where('a.capture_image IS NOT NULL')
        .getCount(),
    ]);

    return {
      enabled: retentionDays !== null,
      retentionDays,
      cutoff:
        retentionDays === null
          ? null
          : new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000),
      imagesOnFile: { enrollments, attendanceEvents, refusedAttempts },
    };
  }

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async handleDailySweep(): Promise<void> {
    try {
      const result = await this.sweep();
      if (!result) return;

      const total =
        result.clearedEnrollmentImages +
        result.clearedEventImages +
        result.clearedAttemptImages;

      if (total === 0) {
        this.logger.log(
          `Biometric retention sweep: nothing older than ${result.retentionDays} days.`,
        );
        return;
      }

      this.logger.log(
        `Biometric retention sweep cleared ${total} image(s) older than ` +
          `${result.retentionDays} days (enrollments ${result.clearedEnrollmentImages}, ` +
          `events ${result.clearedEventImages}, attempts ${result.clearedAttemptImages}).`,
      );
    } catch (error) {
      /*
       * Swallowed on purpose. This runs unattended at 03:00; a thrown error
       * would surface as an unhandled rejection with no one watching, and the
       * next run retries anyway.
       */
      this.logger.error(
        'Biometric retention sweep failed',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /**
   * Run one sweep now. Returns null when retention is disabled.
   */
  async sweep(now: Date = new Date()): Promise<RetentionSweepResult | null> {
    const retentionDays = this.resolveRetentionDays();
    if (retentionDays === null) return null;

    const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);

    const result: RetentionSweepResult = {
      retentionDays,
      cutoff,
      clearedEnrollmentImages: 0,
      clearedEventImages: 0,
      clearedAttemptImages: 0,
    };

    /*
     * Each table is swept independently: a failure on one (say, a lock
     * timeout on attendance_events) must not stop the other two from being
     * cleared. Retention is a per-table promise.
     */
    result.clearedEnrollmentImages = await this.clearTable(
      'enrollment images',
      () =>
        this.enrollmentRepository
          .createQueryBuilder()
          .update(DeviceEnrollment)
          .set({ enrollmentImage: null })
          .where('enrollment_image IS NOT NULL')
          .andWhere('enrolled_at < :cutoff', { cutoff })
          .andWhere(
            'id IN ' + this.limitedSubquery('device_enrollments', 'enrolled_at'),
            { cutoff },
          )
          .execute()
          .then((r) => r.affected ?? 0),
    );

    result.clearedEventImages = await this.clearTable(
      'attendance event images',
      () =>
        this.eventRepository
          .createQueryBuilder()
          .update(AttendanceEvent)
          .set({ captureImage: null })
          .where('capture_image IS NOT NULL')
          .andWhere('server_timestamp < :cutoff', { cutoff })
          .andWhere(
            'id IN ' + this.limitedSubquery('attendance_events', 'server_timestamp'),
            { cutoff },
          )
          .execute()
          .then((r) => r.affected ?? 0),
    );

    result.clearedAttemptImages = await this.clearTable(
      'refused attempt images',
      () =>
        this.attemptRepository
          .createQueryBuilder()
          .update(AttendanceAttempt)
          .set({ captureImage: null })
          .where('capture_image IS NOT NULL')
          .andWhere('server_timestamp < :cutoff', { cutoff })
          .andWhere(
            'id IN ' + this.limitedSubquery('attendance_attempts', 'server_timestamp'),
            { cutoff },
          )
          .execute()
          .then((r) => r.affected ?? 0),
    );

    return result;
  }

  /**
   * A subquery selecting at most MAX_ROWS_PER_TABLE expiring ids.
   *
   * The cutoff is left as a `:cutoff` placeholder rather than interpolated:
   * the caller binds it through the same parameter object as the surrounding
   * WHERE. The table and column names are literals passed by this class, never
   * by a request.
   *
   * The UPDATE carries the same predicate as the subquery, so the limit is
   * only a throttle, never a filter that leaves a row permanently unexpired --
   * the next run picks up whatever this one skipped.
   */
  private limitedSubquery(table: string, timestampColumn: string): string {
    return `(SELECT id FROM ${table} WHERE ${timestampColumn} < :cutoff LIMIT ${MAX_ROWS_PER_TABLE})`;
  }

  private async clearTable(
    label: string,
    run: () => Promise<number>,
  ): Promise<number> {
    try {
      return await run();
    } catch (error) {
      this.logger.error(
        `Failed to clear expired ${label}`,
        error instanceof Error ? error.stack : String(error),
      );
      return 0;
    }
  }
}
