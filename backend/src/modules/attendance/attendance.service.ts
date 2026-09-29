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
  EventType,
  AttendanceStatus,
  Employee,
  toGeoJsonPoint,
} from '../../database/entities';
import { BiometricService } from '../biometric/biometric.service';
import { SitesService } from '../sites/sites.service';
import {
  ActingUser,
  assertMayActForEmployee,
} from '../../common/utils/employee-scope';
import { CheckInDto, CheckOutDto, AttendanceEventResponseDto } from './dto/check-in.dto';
import { ListAttendanceEventsQueryDto } from './dto/list-attendance-events.dto';

@Injectable()
export class AttendanceService {
  private readonly logger = new Logger(AttendanceService.name);

  constructor(
    @InjectRepository(AttendanceEvent)
    private attendanceRepository: Repository<AttendanceEvent>,
    @InjectRepository(Employee)
    private employeeRepository: Repository<Employee>,
    private biometricService: BiometricService,
    private sitesService: SitesService,
    private configService: ConfigService,
  ) {}

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
     * Check if already checked in (no matching check-out).
     *
     * A FLAGGED event is one that was *denied* -- outside the geofence, or a
     * failed face match -- so it does not represent a successful check-in and
     * must not block a retry. Counting it did exactly that: one bad face
     * capture locked the employee out with "already checked in. Please check
     * out first", which they could not do because they had never got in.
     */
    const lastEvent = await this.attendanceRepository.findOne({
      where: { employeeId: checkInDto.employeeId },
      order: { serverTimestamp: 'DESC' },
    });

    if (
      lastEvent &&
      lastEvent.eventType === EventType.CHECK_IN &&
      lastEvent.status !== AttendanceStatus.FLAGGED
    ) {
      throw new BadRequestException(
        'Employee already checked in. Please check out first.',
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
        },
      );

      withinGeofence = geofenceResult.withinGeofence;
      distanceFromSite = geofenceResult.distance;

      if (!withinGeofence) {
        // Create flagged event
        const event = this.attendanceRepository.create({
          clientEventId: uuidv4(),
          employeeId: checkInDto.employeeId,
          siteId: checkInDto.siteId,
          eventType: EventType.CHECK_IN,
          deviceTimestamp: new Date(),
          gpsPoint: toGeoJsonPoint(checkInDto.longitude, checkInDto.latitude),
          status: AttendanceStatus.FLAGGED,
          flagReason: `Outside geofence (${distanceFromSite}m from site)`,
          deviceId: checkInDto.deviceIdentifier,
        });

        await this.attendanceRepository.save(event);

        throw new UnauthorizedException(
          `Check-in denied: You are ${distanceFromSite}m from the site. Please move closer.`,
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
        // Create flagged event
        const event = this.attendanceRepository.create({
          clientEventId: uuidv4(),
          employeeId: checkInDto.employeeId,
          siteId: checkInDto.siteId,
          eventType: EventType.CHECK_IN,
          deviceTimestamp: new Date(),
          gpsPoint: toGeoJsonPoint(checkInDto.longitude, checkInDto.latitude),
          status: AttendanceStatus.FLAGGED,
          flagReason: `Biometric verification failed: ${error.message}`,
          deviceId: checkInDto.deviceIdentifier,
        });

        await this.attendanceRepository.save(event);

        throw new UnauthorizedException(`Check-in denied: ${error.message}`);
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
      status: AttendanceStatus.VERIFIED,
      deviceId: checkInDto.deviceIdentifier,
      matchScore,
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
     * Check if employee is checked in.
     *
     * A FLAGGED check-in was denied, so there is nothing to check out of --
     * treating it as an active check-in would let a denied attempt be paired
     * with a real check-out and produce a nonsense event sequence.
     */
    const lastEvent = await this.attendanceRepository.findOne({
      where: { employeeId: checkOutDto.employeeId },
      order: { serverTimestamp: 'DESC' },
    });

    if (
      !lastEvent ||
      lastEvent.eventType === EventType.CHECK_OUT ||
      lastEvent.status === AttendanceStatus.FLAGGED
    ) {
      throw new BadRequestException(
        'No active check-in found. Please check in first.',
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
        },
      );

      withinGeofence = geofenceResult.withinGeofence;
      distanceFromSite = geofenceResult.distance;

      if (!withinGeofence) {
        // Create flagged event
        const event = this.attendanceRepository.create({
          clientEventId: uuidv4(),
          employeeId: checkOutDto.employeeId,
          siteId: checkOutDto.siteId,
          eventType: EventType.CHECK_OUT,
          deviceTimestamp: new Date(),
          gpsPoint: toGeoJsonPoint(checkOutDto.longitude, checkOutDto.latitude),
          status: AttendanceStatus.FLAGGED,
          flagReason: `Outside geofence (${distanceFromSite}m from site)`,
          deviceId: checkOutDto.deviceIdentifier,
        });

        await this.attendanceRepository.save(event);

        throw new UnauthorizedException(
          `Check-out denied: You are ${distanceFromSite}m from the site. Please move closer.`,
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
        // Create flagged event
        const event = this.attendanceRepository.create({
          clientEventId: uuidv4(),
          employeeId: checkOutDto.employeeId,
          siteId: checkOutDto.siteId,
          eventType: EventType.CHECK_OUT,
          deviceTimestamp: new Date(),
          gpsPoint: toGeoJsonPoint(checkOutDto.longitude, checkOutDto.latitude),
          status: AttendanceStatus.FLAGGED,
          flagReason: `Biometric verification failed: ${error.message}`,
          deviceId: checkOutDto.deviceIdentifier,
        });

        await this.attendanceRepository.save(event);

        throw new UnauthorizedException(`Check-out denied: ${error.message}`);
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
      status: AttendanceStatus.VERIFIED,
      deviceId: checkOutDto.deviceIdentifier,
      matchScore,
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
   */
  private toListItem(event: AttendanceEvent) {
    const [longitude, latitude] = event.gpsPoint?.coordinates ?? [null, null];

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
      flagReason: event.flagReason ?? null,
      isMockLocation: event.isMockLocation,
      createdOffline: event.createdOffline,
    };
  }
}
