import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  AttendanceEvent,
  AttendanceStatus,
  AuditAction,
  SyncAuditLog,
} from '../../database/entities';

@Injectable()
export class AdminService {
  constructor(
    @InjectRepository(AttendanceEvent)
    private attendanceRepository: Repository<AttendanceEvent>,
    @InjectRepository(SyncAuditLog)
    private auditLogRepository: Repository<SyncAuditLog>,
  ) {}

  async approveEvent(
    eventId: string,
    organizationId: string,
    actor: { id: string; role: string },
    notes?: string,
  ) {
    const event = await this.getEventForOrganization(eventId, organizationId);

    event.status = AttendanceStatus.VERIFIED;
    const saved = await this.attendanceRepository.save(event);

    await this.writeAudit(saved.id, AuditAction.VERIFIED, actor, notes);

    return this.toResponse(saved);
  }

  async rejectEvent(
    eventId: string,
    organizationId: string,
    actor: { id: string; role: string },
    reason: string,
  ) {
    const event = await this.getEventForOrganization(eventId, organizationId);

    event.status = AttendanceStatus.REJECTED;
    const saved = await this.attendanceRepository.save(event);

    await this.writeAudit(saved.id, AuditAction.REJECTED, actor, reason);

    return this.toResponse(saved);
  }

  /**
   * Attendance events have no organization of their own, so scope through the
   * employee that owns them.
   */
  private async getEventForOrganization(
    eventId: string,
    organizationId: string,
  ): Promise<AttendanceEvent> {
    const event = await this.attendanceRepository
      .createQueryBuilder('event')
      .leftJoin('event.employee', 'employee')
      .leftJoinAndSelect('event.site', 'site')
      .where('event.id = :eventId', { eventId })
      .andWhere('employee.organizationId = :organizationId', { organizationId })
      .getOne();

    if (!event) {
      throw new NotFoundException(`Attendance event with ID ${eventId} not found`);
    }

    return event;
  }

  private async writeAudit(
    attendanceEventId: string,
    action: AuditAction,
    actor: { id: string; role: string },
    notes?: string,
  ) {
    await this.auditLogRepository.save(
      this.auditLogRepository.create({
        attendanceEventId,
        action,
        actor: actor.id,
        actorRole: actor.role,
        notes: notes,
      }),
    );
  }

  private toResponse(event: AttendanceEvent) {
    return {
      id: event.id,
      employeeId: event.employeeId,
      siteId: event.siteId,
      eventType: event.eventType,
      status: event.status,
      flagReason: event.flagReason ?? null,
      serverTimestamp: event.serverTimestamp,
    };
  }
}
