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
}
