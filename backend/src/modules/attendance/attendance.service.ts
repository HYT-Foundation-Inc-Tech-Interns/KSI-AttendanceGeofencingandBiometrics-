import {
  Injectable,
  NotFoundException,
  BadRequestException,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { v4 as uuidv4 } from 'uuid';
import {
  AttendanceEvent,
  AttendanceAttempt,
  AttemptReason,
  EventType,
  AttendanceStatus,
  Employee,
  toGeoJsonPoint,
} from '../../database/entities';
import { BiometricService } from '../biometric/biometric.service';
import { matchScoreOf, reasonCodeOf } from '../biometric/face-verification.error';
import { SitesService } from '../sites/sites.service';
import {
  manilaDayWindow,
  manilaMinutesOfDay,
  parseShiftStartMinutes,
  toHhMm,
} from '../../common/utils/manila-time';
import {
  ActingUser,
  assertMayActForEmployee,
} from '../../common/utils/employee-scope';
import { CheckInDto, CheckOutDto, AttendanceEventResponseDto } from './dto/check-in.dto';
import { ListAttendanceEventsQueryDto } from './dto/list-attendance-events.dto';

/** What a refusal needs to be filed under. */
interface RefusalContext {
  employeeId: string;
  siteId: string;
  eventType: EventType;
  deviceIdentifier?: string;
  latitude: number;
  longitude: number;
  captureImage?: string;
}

/**
 * A parenthetical naming the GPS uncertainty, or nothing when the fix was good.
 *
 * Only worth saying when the allowance actually changed the verdict's margin:
 * a worker refused while their phone admitted +/-40 m needs to know the number
 * is the problem, not their position, otherwise they walk around the block
 * trying to satisfy a fence that the fix cannot resolve.
 */
function describeGpsUncertainty(allowanceMeters: number): string {
  if (allowanceMeters <= 0) return '';
  return ` (allowing for GPS accuracy of about ${Math.round(allowanceMeters)}m)`;
}

/**
 * Manila has been a fixed UTC+8 offset with no daylight saving since 1978, so
 * the shift is a constant. The day-window and time-of-day maths now live in
 * `common/utils/manila-time` so the dashboard cannot compute a different day.
 */
@Injectable()
export class AttendanceService {
  private readonly logger = new Logger(AttendanceService.name);

  constructor(
    @InjectRepository(AttendanceEvent)
    private attendanceRepository: Repository<AttendanceEvent>,
    @InjectRepository(AttendanceAttempt)
    private attemptRepository: Repository<AttendanceAttempt>,
    @InjectRepository(Employee)
    private employeeRepository: Repository<Employee>,
    private biometricService: BiometricService,
    private sitesService: SitesService,
    private configService: ConfigService,
  ) {}

  /**
   * File a refused check-in or check-out.
   *
   * This used to write an `attendance_events` row with status FLAGGED, which
   * put a refusal in the same list as real attendance: one worker retrying a
   * bad capture produced four rows that read as four attendance records, and
   * the admin had to read a sentence in the status column to tell them apart.
   *
   * A refusal is not attendance. It goes in its own table and reaches the admin
   * through the notification bell, where it can be approved into attendance if
   * the refusal turns out to have been the system's fault rather than the
   * worker's.
   *
   * Filing must never mask the refusal itself, so a failure to write the record
   * is logged and swallowed -- the caller still throws the denial.
   */
  private async recordRefusal(
    context: RefusalContext,
    reasonCode: AttemptReason,
    reason: string,
    extras: { matchScore?: number | null; distanceMeters?: number | null } = {},
  ): Promise<void> {
    try {
      await this.attemptRepository.save(
        this.attemptRepository.create({
          employeeId: context.employeeId,
          siteId: context.siteId,
          eventType: context.eventType,
          deviceTimestamp: new Date(),
          reasonCode,
          reason,
          matchScore: extras.matchScore ?? null,
          distanceMeters: extras.distanceMeters ?? null,
          latitude: context.latitude,
          longitude: context.longitude,
          captureImage: context.captureImage ?? null,
          deviceId: context.deviceIdentifier ?? null,
        }),
      );
    } catch (error) {
      this.logger.error(
        `Could not record refused ${context.eventType} for employee ${context.employeeId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Everything this employee punched on one Manila day, oldest first.
   *
   * FLAGGED and REJECTED are both excluded, because neither is a punch that
   * happened. FLAGGED is a refusal written by the pre-attempts-table code, and
   * counting one as a punch is what used to lock a worker out with "already
   * checked in" after a bad face capture. REJECTED is a punch an administrator
   * has voided -- most often an accidental one -- and if that still counted
   * toward the day, voiding it would not actually free the worker to punch
   * again, which is the whole point of voiding it.
   */
  private async punchesOnManilaDay(
    employeeId: string,
    at: Date,
  ): Promise<AttendanceEvent[]> {
    const { start, end } = manilaDayWindow(at);

    return this.attendanceRepository
      .createQueryBuilder('event')
      .where('event.employeeId = :employeeId', { employeeId })
      .andWhere('event.serverTimestamp >= :start', { start })
      .andWhere('event.serverTimestamp < :end', { end })
      .andWhere('event.status NOT IN (:...ignored)', {
        ignored: [AttendanceStatus.FLAGGED, AttendanceStatus.REJECTED],
      })
      .orderBy('event.serverTimestamp', 'ASC')
      .getMany();
  }

  /**
   * Check-in: Validate geofence + biometric, create attendance event
   */
  async checkIn(
    organizationId: string,
    checkInDto: CheckInDto,
    actor: ActingUser,
  ): Promise<AttendanceEventResponseDto> {
    /*
     * The DTO names the employee, so without this check any authenticated
     * worker could punch in on a colleague's behalf just by changing the id.
     */
    assertMayActForEmployee(actor, checkInDto.employeeId);

    // Verify employee
    const employee = await this.employeeRepository.findOne({
      where: { id: checkInDto.employeeId, organizationId },
    });

    if (!employee) {
      throw new NotFoundException('Employee not found');
    }

    /*
     * One check-in per Manila day.
     *
     * This used to compare only the single most recent event, which meant a
     * worker who timed in and back out could time in again and again on the
     * same day -- each pair looked like a fresh "last event was a check-out".
     * It was also not date-scoped at all, so a check-in yesterday with a
     * forgotten check-out blocked today.
     *
     * Now the whole day is loaded and any existing check-in refuses the punch.
     * The counter resets on its own at the next Manila midnight, so there is
     * nothing to clear.
     */
    const todaysPunches = await this.punchesOnManilaDay(
      checkInDto.employeeId,
      new Date(),
    );

    const alreadyIn = todaysPunches.find((e) => e.eventType === EventType.CHECK_IN);

    if (alreadyIn) {
      throw new BadRequestException(
        'You have already timed in today. You can time in again tomorrow.',
      );
    }

    // Step 1: Validate geofence
    const skipGeofence = this.configService.get<string>(
      'DEV_SKIP_GEOFENCE_VALIDATION',
      'false',
    ) === 'true';

    let withinGeofence = true;
    let distanceFromSite: number | undefined;

    if (!skipGeofence) {
      const geofenceResult = await this.sitesService.validateGeofence(
        checkInDto.siteId,
        organizationId,
        {
          latitude: checkInDto.latitude,
          longitude: checkInDto.longitude,
          accuracyMeters: checkInDto.accuracyMeters,
        },
      );

      withinGeofence = geofenceResult.withinGeofence;
      distanceFromSite = geofenceResult.distance;

      if (!withinGeofence) {
        await this.recordRefusal(
          {
            employeeId: checkInDto.employeeId,
            siteId: checkInDto.siteId,
            eventType: EventType.CHECK_IN,
            deviceIdentifier: checkInDto.deviceIdentifier,
            latitude: checkInDto.latitude,
            longitude: checkInDto.longitude,
            captureImage: checkInDto.captureImage,
          },
          AttemptReason.OUTSIDE_GEOFENCE,
          `Outside geofence (${distanceFromSite}m from site)`,
          { distanceMeters: distanceFromSite ?? null },
        );

        throw new UnauthorizedException(
          `Check-in denied: You are ${distanceFromSite}m from the site${describeGpsUncertainty(
            geofenceResult.allowanceMeters,
          )}. Please move closer.`,
        );
      }
    }

    // Step 2: Validate biometric
    const skipBiometric = this.configService.get<string>(
      'DEV_SKIP_BIOMETRIC_VERIFICATION',
      'false',
    ) === 'true';

    let biometricVerified = true;
    let matchScore: number | null = null;

    if (!skipBiometric) {
      try {
        const verifyResult = await this.biometricService.verifyFace(organizationId, {
          employeeId: checkInDto.employeeId,
          faceImage: checkInDto.faceImage,
          faceDescriptor: checkInDto.faceDescriptor,
          deviceIdentifier: checkInDto.deviceIdentifier,
        }, actor);

        biometricVerified = verifyResult.verified;
        // Recorded so a later dispute can be settled from the stored score
        // rather than from the fact that the request once returned 200.
        matchScore = verifyResult.confidence ?? null;
      } catch (error) {
        await this.recordRefusal(
          {
            employeeId: checkInDto.employeeId,
            siteId: checkInDto.siteId,
            eventType: EventType.CHECK_IN,
            deviceIdentifier: checkInDto.deviceIdentifier,
            latitude: checkInDto.latitude,
            longitude: checkInDto.longitude,
            captureImage: checkInDto.captureImage,
          },
          reasonCodeOf(error),
          error instanceof Error ? error.message : String(error),
          { matchScore: matchScoreOf(error) },
        );

        throw new UnauthorizedException(
          `Check-in denied: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    // Step 3: Create approved attendance event
    const event = this.attendanceRepository.create({
      clientEventId: uuidv4(),
      employeeId: checkInDto.employeeId,
      siteId: checkInDto.siteId,
      eventType: EventType.CHECK_IN,
      deviceTimestamp: new Date(),
      gpsPoint: toGeoJsonPoint(checkInDto.longitude, checkInDto.latitude),
      // Was never populated, so no stored punch could be audited for how much
      // of its geofence verdict was GPS noise.
      gpsAccuracyMeters: checkInDto.accuracyMeters ?? null,
      status: AttendanceStatus.VERIFIED,
      deviceId: checkInDto.deviceIdentifier,
      matchScore,
      captureImage: checkInDto.captureImage ?? null,
    });

    await this.attendanceRepository.save(event);

    this.logger.log(
      `Employee ${checkInDto.employeeId} checked in at site ${checkInDto.siteId}`,
    );

    return {
      id: event.id,
      eventType: event.eventType,
      timestamp: event.serverTimestamp,
      withinGeofence,
      biometricVerified,
      status: event.status,
      message: 'Check-in successful',
    };
  }

  /**
   * Check-out: Validate geofence + biometric, create attendance event
   */
  async checkOut(
    organizationId: string,
    checkOutDto: CheckOutDto,
    actor: ActingUser,
  ): Promise<AttendanceEventResponseDto> {
    // Same rule as check-in: only your own record, unless you are admin or HR.
    assertMayActForEmployee(actor, checkOutDto.employeeId);

    // Verify employee
    const employee = await this.employeeRepository.findOne({
      where: { id: checkOutDto.employeeId, organizationId },
    });

    if (!employee) {
      throw new NotFoundException('Employee not found');
    }

    /*
     * One check-out per Manila day, and only after a check-in on that same day.
     *
     * The old rule read only the most recent event, so a check-in from a
     * previous day with a forgotten check-out would let today's check-out
     * through, and a check-out yesterday blocked today entirely.
     */
    const todaysPunches = await this.punchesOnManilaDay(
      checkOutDto.employeeId,
      new Date(),
    );

    if (!todaysPunches.some((e) => e.eventType === EventType.CHECK_IN)) {
      throw new BadRequestException(
        'No check-in found for today. Please time in first.',
      );
    }

    if (todaysPunches.some((e) => e.eventType === EventType.CHECK_OUT)) {
      throw new BadRequestException(
        'You have already timed out today. You can time out again tomorrow.',
      );
    }

    // Step 1: Validate geofence
    const skipGeofence = this.configService.get<string>(
      'DEV_SKIP_GEOFENCE_VALIDATION',
      'false',
    ) === 'true';

    let withinGeofence = true;
    let distanceFromSite: number | undefined;

    if (!skipGeofence) {
      const geofenceResult = await this.sitesService.validateGeofence(
        checkOutDto.siteId,
        organizationId,
        {
          latitude: checkOutDto.latitude,
          longitude: checkOutDto.longitude,
          accuracyMeters: checkOutDto.accuracyMeters,
        },
      );

      withinGeofence = geofenceResult.withinGeofence;
      distanceFromSite = geofenceResult.distance;

      if (!withinGeofence) {
        await this.recordRefusal(
          {
            employeeId: checkOutDto.employeeId,
            siteId: checkOutDto.siteId,
            eventType: EventType.CHECK_OUT,
            deviceIdentifier: checkOutDto.deviceIdentifier,
            latitude: checkOutDto.latitude,
            longitude: checkOutDto.longitude,
            captureImage: checkOutDto.captureImage,
          },
          AttemptReason.OUTSIDE_GEOFENCE,
          `Outside geofence (${distanceFromSite}m from site)`,
          { distanceMeters: distanceFromSite ?? null },
        );

        throw new UnauthorizedException(
          `Check-out denied: You are ${distanceFromSite}m from the site${describeGpsUncertainty(
            geofenceResult.allowanceMeters,
          )}. Please move closer.`,
        );
      }
    }

    // Step 2: Validate biometric
    const skipBiometric = this.configService.get<string>(
      'DEV_SKIP_BIOMETRIC_VERIFICATION',
      'false',
    ) === 'true';

    let biometricVerified = true;
    let matchScore: number | null = null;

    if (!skipBiometric) {
      try {
        const verifyResult = await this.biometricService.verifyFace(organizationId, {
          employeeId: checkOutDto.employeeId,
          faceImage: checkOutDto.faceImage,
          faceDescriptor: checkOutDto.faceDescriptor,
          deviceIdentifier: checkOutDto.deviceIdentifier,
        }, actor);

        biometricVerified = verifyResult.verified;
        matchScore = verifyResult.confidence ?? null;
      } catch (error) {
        await this.recordRefusal(
          {
            employeeId: checkOutDto.employeeId,
            siteId: checkOutDto.siteId,
            eventType: EventType.CHECK_OUT,
            deviceIdentifier: checkOutDto.deviceIdentifier,
            latitude: checkOutDto.latitude,
            longitude: checkOutDto.longitude,
            captureImage: checkOutDto.captureImage,
          },
          reasonCodeOf(error),
          error instanceof Error ? error.message : String(error),
          { matchScore: matchScoreOf(error) },
        );

        throw new UnauthorizedException(
          `Check-out denied: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    // Step 3: Create approved attendance event
    const event = this.attendanceRepository.create({
      clientEventId: uuidv4(),
      employeeId: checkOutDto.employeeId,
      siteId: checkOutDto.siteId,
      eventType: EventType.CHECK_OUT,
      deviceTimestamp: new Date(),
      gpsPoint: toGeoJsonPoint(checkOutDto.longitude, checkOutDto.latitude),
      gpsAccuracyMeters: checkOutDto.accuracyMeters ?? null,
      status: AttendanceStatus.VERIFIED,
      deviceId: checkOutDto.deviceIdentifier,
      matchScore,
      captureImage: checkOutDto.captureImage ?? null,
    });

    await this.attendanceRepository.save(event);

    this.logger.log(
      `Employee ${checkOutDto.employeeId} checked out from site ${checkOutDto.siteId}`,
    );

    return {
      id: event.id,
      eventType: event.eventType,
      timestamp: event.serverTimestamp,
      withinGeofence,
      biometricVerified,
      status: event.status,
      message: 'Check-out successful',
    };
  }

  /**
   * Get attendance history for an employee
   */
  async getEmployeeAttendance(
    organizationId: string,
    employeeId: string,
    startDate?: Date,
    endDate?: Date,
  ): Promise<AttendanceEvent[]> {
    const employee = await this.employeeRepository.findOne({
      where: { id: employeeId, organizationId },
    });

    if (!employee) {
      throw new NotFoundException('Employee not found');
    }

    const query = this.attendanceRepository
      .createQueryBuilder('event')
      .where('event.employeeId = :employeeId', { employeeId })
      .orderBy('event.serverTimestamp', 'DESC');

    if (startDate) {
      query.andWhere('event.serverTimestamp >= :startDate', { startDate });
    }

    if (endDate) {
      query.andWhere('event.serverTimestamp <= :endDate', { endDate });
    }

    return query.getMany();
  }

  /**
   * List attendance events for the whole organization (dashboard view).
   *
   * Events carry no organization of their own — they are scoped through the
   * employee that owns them.
   */
  async findAllEvents(
    organizationId: string,
    filters: ListAttendanceEventsQueryDto,
  ) {
    const { page, limit, search, status, eventType, startDate, endDate } = filters;

    const query = this.attendanceRepository
      .createQueryBuilder('event')
      .leftJoinAndSelect('event.employee', 'employee')
      .leftJoinAndSelect('event.site', 'site')
      .where('employee.organizationId = :organizationId', { organizationId });

    if (search) {
      query.andWhere(
        '(employee.fullName ILIKE :search OR employee.employeeCode ILIKE :search OR site.name ILIKE :search)',
        { search: `%${search}%` },
      );
    }

    if (status) {
      query.andWhere('event.status = :status', { status });
    }

    if (eventType) {
      query.andWhere('event.eventType = :eventType', { eventType });
    }

    if (startDate) {
      query.andWhere('event.serverTimestamp >= :startDate', {
        startDate: new Date(startDate),
      });
    }

    if (endDate) {
      query.andWhere('event.serverTimestamp <= :endDate', {
        endDate: new Date(endDate),
      });
    }

    const [events, total] = await query
      .orderBy('event.serverTimestamp', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return {
      data: events.map((event) => this.toListItem(event)),
      total,
      page,
      limit,
    };
  }

  /**
   * Flatten an event into the shape the dashboard consumes. `gpsPoint` arrives
   * as a GeoJSON object because PostGIS geography columns are read through
   * `ST_AsGeoJSON`, so lat/lng are read from coordinates (which are [lng, lat]).
   *
   * `captureImage` is returned inline rather than behind a URL. The dashboard
   * authenticates with a Bearer token in localStorage, which an `<img src>`
   * cannot send, so a separate image endpoint would need either a token in the
   * query string or a blob fetch per row. Inline is one request instead of
   * fifty. It is affordable because the phone sends a small face crop (~10-20
   * kB), not a full camera frame.
   *
   * Lateness is derived here rather than stored, so that changing a site's
   * shift start re-reads history instead of silently leaving old punches
   * measured against a clock that no longer applies.
   */
  private toListItem(event: AttendanceEvent) {
    const [longitude, latitude] = event.gpsPoint?.coordinates ?? [null, null];

    const shiftStartMinutes = parseShiftStartMinutes(event.site?.shiftStartTime);
    const isCheckIn = event.eventType === EventType.CHECK_IN;
    const lateMinutes =
      shiftStartMinutes === null || !isCheckIn
        ? null
        : Math.max(0, manilaMinutesOfDay(event.serverTimestamp) - shiftStartMinutes);

    return {
      id: event.id,
      employeeId: event.employeeId,
      employeeName: event.employee?.fullName ?? 'Unknown',
      employeeCode: event.employee?.employeeCode ?? '',
      siteId: event.siteId,
      siteName: event.site?.name ?? 'Unknown Site',
      eventType: event.eventType,
      deviceTimestamp: event.deviceTimestamp,
      serverTimestamp: event.serverTimestamp,
      status: event.status,
      latitude,
      longitude,
      gpsAccuracyMeters:
        event.gpsAccuracyMeters === null || event.gpsAccuracyMeters === undefined
          ? null
          : Number(event.gpsAccuracyMeters),
      livenessScore:
        event.livenessScore === null || event.livenessScore === undefined
          ? null
          : Number(event.livenessScore),
      matchScore:
        event.matchScore === null || event.matchScore === undefined
          ? null
          : Number(event.matchScore),
      captureImage: event.captureImage ?? null,
      flagReason: event.flagReason ?? null,
      isMockLocation: event.isMockLocation,
      createdOffline: event.createdOffline,
      // Shift start this punch is measured against, or null when the site has
      // none configured. `lateMinutes` is null for the same reason, and also
      // for check-outs, where "late" has no meaning.
      shiftStartTime: toHhMm(event.site?.shiftStartTime),
      lateMinutes,
      isLate: lateMinutes !== null && lateMinutes > 0,
    };
  }
}
