import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import {
  AttendanceAttempt,
  AttendanceEvent,
  AttendanceStatus,
  Site,
  toGeoJsonPoint,
} from '../../database/entities';

/**
 * The admin's inbox for refused check-ins and check-outs.
 *
 * Before this existed, a refusal was written into `attendance_events` as a
 * FLAGGED row and appeared in the attendance list beside real attendance. One
 * worker retrying a bad capture produced four rows that read as four attendance
 * records. A refusal is not attendance; it is something the admin needs to be
 * *told about*, so it lives in `attendance_attempts` and arrives here.
 *
 * An admin can still accept one -- a refusal in bad light is the system's
 * fault, not the worker's -- which writes a real attendance event and links
 * back, so the override is traceable rather than invisible.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectRepository(AttendanceAttempt)
    private attemptRepository: Repository<AttendanceAttempt>,
    @InjectRepository(AttendanceEvent)
    private attendanceRepository: Repository<AttendanceEvent>,
    @InjectRepository(Site)
    private siteRepository: Repository<Site>,
  ) {}

  /**
   * List refusals for the organisation, newest first.
   *
   * `unreadCount` is counted separately from the page so the bell badge is
   * right even when the list is paginated.
   */
  async list(
    organizationId: string,
    options: { includeAcknowledged?: boolean; limit?: number; page?: number } = {},
  ) {
    const { includeAcknowledged = false, limit = 50, page = 1 } = options;

    const base = this.attemptRepository
      .createQueryBuilder('attempt')
      .leftJoinAndSelect('attempt.employee', 'employee')
      .leftJoinAndSelect('attempt.site', 'site')
      .where('employee.organizationId = :organizationId', { organizationId });

    const unread = await base
      .clone()
      .andWhere('attempt.acknowledgedAt IS NULL')
      .getCount();

    if (!includeAcknowledged) {
      base.andWhere('attempt.acknowledgedAt IS NULL');
    }

    const [rows, total] = await base
      .orderBy('attempt.serverTimestamp', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return {
      unreadCount: unread,
      total,
      page,
      limit,
      data: rows.map((row) => this.toItem(row)),
    };
  }

  /** Clear one refusal from the bell without recording attendance for it. */
  async acknowledge(id: string, organizationId: string, actorId: string) {
    const attempt = await this.getForOrganization(id, organizationId);

    if (attempt.acknowledgedAt) {
      return this.toItem(attempt);
    }

    attempt.acknowledgedAt = new Date();
    attempt.acknowledgedBy = actorId;
    await this.attemptRepository.save(attempt);

    return this.toItem(attempt);
  }

  /** Clear every open refusal at once. */
  async acknowledgeAll(organizationId: string, actorId: string) {
    const result = await this.attemptRepository
      .createQueryBuilder()
      .update(AttendanceAttempt)
      .set({ acknowledgedAt: new Date(), acknowledgedBy: actorId })
      .where(
        'acknowledged_at IS NULL AND employee_id IN (SELECT id FROM employees WHERE organization_id = :organizationId)',
        { organizationId },
      )
      .execute();

    return { acknowledged: result.affected ?? 0 };
  }

  /**
   * Accept a refusal, turning it into real attendance.
   *
   * The event is written as VERIFIED because a human decided it was legitimate
   * -- the same meaning `verified` already carries for an event an admin
   * approved. The refusal keeps `approvedEventId`, so the override is recorded
   * on both sides rather than the refusal simply disappearing.
   */
  async approve(id: string, organizationId: string, actorId: string) {
    const attempt = await this.getForOrganization(id, organizationId);

    if (attempt.approvedEventId) {
      throw new BadRequestException(
        'This attempt has already been approved and recorded as attendance.',
      );
    }

    /*
     * `gps_point` is NOT NULL on attendance_events. Every refusal normally
     * carries coordinates, but a record written without them cannot become an
     * event without inventing a location -- which would put a false position in
     * the attendance record. Fall back to the site's own centre, which is at
     * least true, and only then give up.
     */
    let latitude = attempt.latitude === null ? null : Number(attempt.latitude);
    let longitude = attempt.longitude === null ? null : Number(attempt.longitude);

    if (latitude === null || longitude === null) {
      if (!attempt.siteId) {
        throw new BadRequestException(
          'This attempt has no location recorded and no site to fall back on, so it cannot be recorded as attendance.',
        );
      }

      const centre = await this.siteRepository
        .createQueryBuilder('site')
        .select('ST_Y(site.geofenceCenter::geometry)', 'lat')
        .addSelect('ST_X(site.geofenceCenter::geometry)', 'lng')
        .where('site.id = :id', { id: attempt.siteId })
        .getRawOne<{ lat: string; lng: string }>();

      if (!centre) {
        throw new BadRequestException('The site for this attempt no longer exists.');
      }

      latitude = Number(centre.lat);
      longitude = Number(centre.lng);
    }

    const event = this.attendanceRepository.create({
      clientEventId: uuidv4(),
      employeeId: attempt.employeeId,
      siteId: attempt.siteId as string,
      eventType: attempt.eventType,
      deviceTimestamp: attempt.deviceTimestamp ?? attempt.serverTimestamp,
      gpsPoint: toGeoJsonPoint(longitude, latitude),
      status: AttendanceStatus.VERIFIED,
      deviceId: attempt.deviceId ?? undefined,
      matchScore: attempt.matchScore,
      captureImage: attempt.captureImage,
      flagReason: `Manually recorded from a refused ${attempt.eventType} (${attempt.reason})`,
    });

    const saved = await this.attendanceRepository.save(event);

    attempt.approvedEventId = saved.id;
    attempt.approvedBy = actorId;
    attempt.approvedAt = new Date();
    // Approving settles it; leaving it unread would keep nagging the admin.
    attempt.acknowledgedAt = attempt.acknowledgedAt ?? new Date();
    attempt.acknowledgedBy = attempt.acknowledgedBy ?? actorId;
    await this.attemptRepository.save(attempt);

    this.logger.log(
      `Refused ${attempt.eventType} for employee ${attempt.employeeId} approved as attendance event ${saved.id}`,
    );

    return { ...this.toItem(attempt), attendanceEventId: saved.id };
  }

  /**
   * Attempts have no organization of their own, so scope through the employee
   * that owns them -- the same rule attendance events use.
   */
  private async getForOrganization(
    id: string,
    organizationId: string,
  ): Promise<AttendanceAttempt> {
    const attempt = await this.attemptRepository
      .createQueryBuilder('attempt')
      .leftJoinAndSelect('attempt.employee', 'employee')
      .leftJoinAndSelect('attempt.site', 'site')
      .where('attempt.id = :id', { id })
      .andWhere('employee.organizationId = :organizationId', { organizationId })
      .getOne();

    if (!attempt) {
      throw new NotFoundException(`Notification ${id} not found`);
    }

    return attempt;
  }

  private toItem(attempt: AttendanceAttempt) {
    return {
      id: attempt.id,
      employeeId: attempt.employeeId,
      employeeName: attempt.employee?.fullName ?? 'Unknown',
      employeeCode: attempt.employee?.employeeCode ?? '',
      siteId: attempt.siteId,
      siteName: attempt.site?.name ?? null,
      eventType: attempt.eventType,
      serverTimestamp: attempt.serverTimestamp,
      reasonCode: attempt.reasonCode,
      reason: attempt.reason,
      matchScore:
        attempt.matchScore === null || attempt.matchScore === undefined
          ? null
          : Number(attempt.matchScore),
      distanceMeters:
        attempt.distanceMeters === null || attempt.distanceMeters === undefined
          ? null
          : Number(attempt.distanceMeters),
      captureImage: attempt.captureImage ?? null,
      acknowledgedAt: attempt.acknowledgedAt,
      approvedEventId: attempt.approvedEventId,
      approvedAt: attempt.approvedAt,
    };
  }
}
