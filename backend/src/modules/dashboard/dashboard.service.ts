import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { Employee, EmployeeStatus } from '../../database/entities/employee.entity';
import { Site } from '../../database/entities/site.entity';
import { AttendanceEvent } from '../../database/entities/attendance-event.entity';
import { AttendanceAttempt } from '../../database/entities/attendance-attempt.entity';

@Injectable()
export class DashboardService {
  constructor(
    @InjectRepository(Employee)
    private employeeRepository: Repository<Employee>,
    @InjectRepository(Site)
    private siteRepository: Repository<Site>,
    @InjectRepository(AttendanceEvent)
    private attendanceRepository: Repository<AttendanceEvent>,
    @InjectRepository(AttendanceAttempt)
    private attemptRepository: Repository<AttendanceAttempt>,
  ) {}

  /**
   * Counts open refusals, not legacy FLAGGED attendance events.
   *
   * Refusals stopped being written as attendance when they moved to their own
   * table, so counting `status = 'flagged'` would now read zero forever while
   * the notification bell showed a growing pile. "Open" means not yet dismissed
   * and not yet approved -- an approved one has become attendance and no longer
   * needs the admin's attention.
   */
  private countOpenRefusals(organizationId: string): Promise<number> {
    return this.attemptRepository
      .createQueryBuilder('attempt')
      .leftJoin('attempt.employee', 'employee')
      .where('employee.organizationId = :organizationId', { organizationId })
      .andWhere('attempt.acknowledgedAt IS NULL')
      .getCount();
  }

  async getStatistics(organizationId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const [totalEmployees, totalSites, checkedInToday, flaggedEvents] =
      await Promise.all([
        this.employeeRepository.count({ 
          where: { 
            organizationId,
            status: EmployeeStatus.ACTIVE
          } 
        }),
        this.siteRepository.count({ 
          where: { 
            organizationId
          } 
        }),
        this.attendanceRepository
          .createQueryBuilder('attendance')
          .leftJoin('attendance.employee', 'employee')
          .where('employee.organizationId = :organizationId', { organizationId })
          .andWhere('attendance.eventType = :type', { type: 'check_in' })
          .andWhere('attendance.serverTimestamp >= :today', { today })
          .andWhere('attendance.serverTimestamp < :tomorrow', { tomorrow })
          .select('COUNT(DISTINCT attendance.employeeId)', 'count')
          .getRawOne()
          .then(result => parseInt(result.count) || 0),
        this.countOpenRefusals(organizationId),
      ]);

    return {
      totalEmployees,
      totalSites,
      checkedInToday,
      flaggedEvents,
    };
  }

  async getRecentCheckIns(organizationId: string) {
    const checkIns = await this.attendanceRepository
      .createQueryBuilder('attendance')
      .leftJoinAndSelect('attendance.employee', 'employee')
      .leftJoinAndSelect('attendance.site', 'site')
      .where('employee.organizationId = :organizationId', { organizationId })
      .andWhere('attendance.eventType = :type', { type: 'check_in' })
      .orderBy('attendance.serverTimestamp', 'DESC')
      .take(5)
      .getMany();

    return checkIns.map((checkIn) => ({
      id: checkIn.id,
      employeeName: checkIn.employee?.fullName || 'Unknown',
      siteName: checkIn.site?.name || 'Unknown Site',
      checkInTime: checkIn.serverTimestamp,
      verificationStatus: checkIn.status === 'flagged' ? 'flagged' : 'verified',
    }));
  }

  /**
   * The most recent open refusals, for the dashboard's flagged panel.
   *
   * Reads `attendance_attempts` rather than `status = 'flagged'` events: a
   * refusal has not been an attendance event since the notification split, so
   * the old query would have shown an empty panel while the bell showed a full
   * inbox.
   */
  async getFlaggedEvents(organizationId: string) {
    const attempts = await this.attemptRepository
      .createQueryBuilder('attempt')
      .leftJoinAndSelect('attempt.employee', 'employee')
      .where('employee.organizationId = :organizationId', { organizationId })
      .andWhere('attempt.acknowledgedAt IS NULL')
      .orderBy('attempt.serverTimestamp', 'DESC')
      .take(5)
      .getMany();

    return attempts.map((attempt) => ({
      id: attempt.id,
      employeeName: attempt.employee?.fullName || 'Unknown',
      reason: attempt.reason || 'Unknown reason',
      timestamp: attempt.serverTimestamp,
      captureImage: attempt.captureImage ?? null,
    }));
  }

  /**
   * Where every active employee was last seen, and whether that was inside
   * their site's geofence.
   *
   * The honest limit of this data: nothing here is continuous tracking. A row
   * is the employee's position at their most recent punch, not where they are
   * now, so the timestamp travels with every point and the UI has to show it.
   * Rendering a week-old fix as "current location" would be a claim an admin
   * could act on and be wrong about.
   *
   * That is also why the view is scoped to the current Asia/Manila day. This is
   * a live view of today's field, so it starts empty each morning: a pin means
   * "punched here today", and anyone who has not punched yet today is simply
   * absent rather than shown at a stale position. Attendance history is
   * untouched by this -- only what the live map draws.
   *
   * The inside/outside verdict is computed in PostGIS rather than in the
   * browser for the same reason check-in is validated on the server: a client
   * that draws its own boundary can disagree with the server that enforces it.
   */
  async getMapOverview(organizationId: string) {
    const sites = await this.siteRepository.find({
      where: { organizationId },
      order: { name: 'ASC' },
    });

    /*
     * LATERAL rather than DISTINCT ON: it picks the single most recent event
     * per employee without forcing the outer ORDER BY to lead with employee
     * id, which keeps the list ordered by name.
     *
     * Both sides of ST_DWithin and ST_Distance are geography, so the radius
     * and the result are metres. Comparing raw SRID 4326 coordinates would
     * measure degrees, where a 100 m fence is about 0.0009 and every point on
     * earth reads as "inside".
     */
    /*
     * The face on each pin is the enrolment biometric where one exists -- the
     * image the employee themselves saved as the basis of their access, which
     * never expires. It falls back to the most recent punch capture, which
     * keeps a face on anyone enrolled before images were being stored, at the
     * cost of that pin going faceless once biometric retention (30 days)
     * removes the capture.
     *
     * `face_source` reports which one was used rather than letting the UI
     * imply every pin is an enrolment, because those two images mean
     * different things: one is a claim, the other is evidence.
     */
    const rows: Array<{
      employee_id: string;
      full_name: string;
      employee_code: string | null;
      site_id: string | null;
      site_name: string | null;
      latitude: number | null;
      longitude: number | null;
      last_seen_at: Date | null;
      event_type: string | null;
      accuracy_m: string | null;
      is_mock_location: boolean | null;
      face_image: string | null;
      face_source: string | null;
      within_geofence: boolean | null;
      distance_m: string | null;
    }> = await this.employeeRepository.query(
      `
      SELECT
        e.id                          AS employee_id,
        e.full_name                   AS full_name,
        e.employee_code               AS employee_code,
        e.site_id                     AS site_id,
        s.name                        AS site_name,
        ST_Y(last_seen.gps_point::geometry) AS latitude,
        ST_X(last_seen.gps_point::geometry) AS longitude,
        last_seen.server_timestamp    AS last_seen_at,
        last_seen.event_type          AS event_type,
        last_seen.gps_accuracy_meters AS accuracy_m,
        last_seen.is_mock_location    AS is_mock_location,
        COALESCE(enrol.face_image, last_seen.capture_image) AS face_image,
        CASE
          WHEN enrol.face_image IS NOT NULL THEN 'enrolment'
          WHEN last_seen.capture_image IS NOT NULL THEN 'capture'
          ELSE NULL
        END                           AS face_source,
        CASE
          WHEN s.geofence_center IS NOT NULL AND s.geofence_radius_m IS NOT NULL
            THEN ST_DWithin(s.geofence_center, last_seen.gps_point, s.geofence_radius_m)
          WHEN s.geofence_polygon IS NOT NULL
            THEN ST_Contains(s.geofence_polygon::geometry, last_seen.gps_point::geometry)
          ELSE NULL
        END AS within_geofence,
        CASE
          WHEN s.geofence_center IS NOT NULL
            THEN ST_Distance(s.geofence_center, last_seen.gps_point)
          ELSE NULL
        END AS distance_m
      FROM employees e
      LEFT JOIN sites s ON s.id = e.site_id
      LEFT JOIN LATERAL (
        SELECT ae.gps_point, ae.server_timestamp, ae.event_type,
               ae.gps_accuracy_meters, ae.is_mock_location, ae.capture_image
        FROM attendance_events ae
        WHERE ae.employee_id = e.id
          AND ae.status NOT IN ('flagged', 'rejected')
          AND date(ae.server_timestamp AT TIME ZONE 'Asia/Manila')
              = date(now() AT TIME ZONE 'Asia/Manila')
        ORDER BY ae.server_timestamp DESC
        LIMIT 1
      ) last_seen ON TRUE
      LEFT JOIN LATERAL (
        SELECT de.enrollment_image AS face_image
        FROM device_enrollments de
        WHERE de.employee_id = e.id
          AND de.is_revoked = false
          AND de.enrollment_image IS NOT NULL
        ORDER BY de.enrolled_at DESC
        LIMIT 1
      ) enrol ON TRUE
      WHERE e.organization_id = $1
        AND e.status = 'active'
      ORDER BY e.full_name ASC
      `,
      [organizationId],
    );

    return {
      generatedAt: new Date().toISOString(),
      sites: sites.map((site) => {
        const [longitude, latitude] = site.geofenceCenter?.coordinates ?? [
          null,
          null,
        ];
        return {
          id: site.id,
          name: site.name,
          address: site.address,
          latitude,
          longitude,
          radiusM: site.geofenceRadiusM ?? null,
          polygon: site.geofencePolygon?.coordinates?.[0] ?? null,
        };
      }),
      employees: rows.map((row) => {
        const latitude = row.latitude === null ? null : Number(row.latitude);
        const longitude = row.longitude === null ? null : Number(row.longitude);

        /*
         * `unknown` rather than a guess, for three genuinely undecidable
         * cases: no fix yet, no assigned site, or a site with no geofence.
         * Defaulting any of them to "inside" would clear someone who was
         * never checked.
         */
        const status: 'inside' | 'outside' | 'unknown' =
          latitude === null ||
          longitude === null ||
          row.within_geofence === null ||
          row.within_geofence === undefined
            ? 'unknown'
            : row.within_geofence
              ? 'inside'
              : 'outside';

        return {
          id: row.employee_id,
          fullName: row.full_name,
          employeeCode: row.employee_code,
          siteId: row.site_id,
          siteName: row.site_name,
          latitude,
          longitude,
          lastSeenAt: row.last_seen_at,
          eventType: row.event_type,
          accuracyM: row.accuracy_m === null ? null : Number(row.accuracy_m),
          isMockLocation: row.is_mock_location ?? false,
          status,
          distanceM:
            row.distance_m === null ? null : Math.round(Number(row.distance_m)),
          faceImage: row.face_image ?? null,
          faceSource:
            row.face_source === 'enrolment' || row.face_source === 'capture'
              ? row.face_source
              : null,
        };
      }),
    };
  }
}
