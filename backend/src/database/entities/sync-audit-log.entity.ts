import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { AttendanceEvent } from './attendance-event.entity';

export enum AuditAction {
  RECEIVED = 'received',
  VERIFIED = 'verified',
  FLAGGED = 'flagged',
  REJECTED = 'rejected',
  MANUAL_OVERRIDE = 'manual_override',
  EXPORTED_TO_PAYROLL = 'exported_to_payroll',
  SYNC_RETRY = 'sync_retry',
}

@Entity('sync_audit_log')
@Index(['attendanceEventId'])
@Index(['at'])
export class SyncAuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'attendance_event_id', type: 'uuid', nullable: true })
  attendanceEventId: string;

  @Column({
    type: 'enum',
    enum: AuditAction,
    nullable: false,
  })
  action: AuditAction;

  @Column({ type: 'text', nullable: true })
  actor: string; // 'system' or user id

  @Column({ name: 'actor_role', type: 'text', nullable: true })
  actorRole: string;

  @Column({ type: 'text', nullable: true })
  notes: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any>;

  @CreateDateColumn({ name: 'at' })
  at: Date;

  // Relations
  @ManyToOne(() => AttendanceEvent, (event) => event.auditLogs, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'attendance_event_id' })
  attendanceEvent: AttendanceEvent;
}
