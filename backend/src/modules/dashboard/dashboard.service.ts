import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { Employee, EmployeeStatus } from '../../database/entities/employee.entity';
import { Site } from '../../database/entities/site.entity';
import { AttendanceEvent } from '../../database/entities/attendance-event.entity';

@Injectable()
export class DashboardService {
  constructor(
    @InjectRepository(Employee)
    private employeeRepository: Repository<Employee>,
    @InjectRepository(Site)
    private siteRepository: Repository<Site>,
    @InjectRepository(AttendanceEvent)
    private attendanceRepository: Repository<AttendanceEvent>,
  ) {}

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
        this.attendanceRepository
          .createQueryBuilder('attendance')
          .leftJoin('attendance.employee', 'employee')
          .where('employee.organizationId = :organizationId', { organizationId })
          .andWhere('attendance.serverTimestamp >= :today', { today })
          .andWhere('attendance.serverTimestamp < :tomorrow', { tomorrow })
          .andWhere('attendance.status = :status', { status: 'flagged' })
          .getCount(),
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

  async getFlaggedEvents(organizationId: string) {
    const flaggedEvents = await this.attendanceRepository
      .createQueryBuilder('attendance')
      .leftJoinAndSelect('attendance.employee', 'employee')
      .where('employee.organizationId = :organizationId', { organizationId })
      .andWhere('attendance.status = :status', { status: 'flagged' })
      .orderBy('attendance.serverTimestamp', 'DESC')
      .take(5)
      .getMany();

    return flaggedEvents.map((event) => ({
      id: event.id,
      employeeName: event.employee?.fullName || 'Unknown',
      reason: event.flagReason || 'Unknown reason',
      timestamp: event.serverTimestamp,
    }));
  }
}
