import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Index,
} from 'typeorm';
import { Employee } from './employee.entity';
import { Site } from './site.entity';
import { SyncAuditLog } from './sync-audit-log.entity';
import { GeoJsonPoint } from './geo-json.types';

export enum EventType {
  CHECK_IN = 'check_in',
  CHECK_OUT = 'check_out',
}

export enum AttendanceStatus {
  PENDING = 'pending',
  VERIFIED = 'verified',
  FLAGGED = 'flagged',
  REJECTED = 'rejected',
  EXPORTED = 'exported',
}

@Entity('attendance_events')
@Index(['employeeId', 'serverTimestamp'])
@Index(['siteId'])
@Index(['status'])
export class AttendanceEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'client_event_id', type: 'uuid', unique: true, nullable: false })
  clientEventId: string; // Idempotency key from device

  @Column({ name: 'employee_id', type: 'uuid', nullable: false })
  employeeId: string;

  @Column({ name: 'site_id', type: 'uuid', nullable: false })
  siteId: string;

  @Column({
    name: 'event_type',
    type: 'enum',
    enum: EventType,
    nullable: false,
  })
  eventType: EventType;

  @Column({ name: 'device_timestamp', type: 'timestamptz', nullable: false })
  deviceTimestamp: Date;

  @CreateDateColumn({ name: 'server_timestamp' })
  serverTimestamp: Date;

  // GPS location
  @Column({
    name: 'gps_point',
    type: 'geography',
    spatialFeatureType: 'Point',
    srid: 4326,
    nullable: false,
  })
  gpsPoint: GeoJsonPoint;

  /*
   * Nullable in the database and in the type. It was typed `number` while the
   * column allowed NULL, which was invisible only because nothing ever wrote
   * to it -- every row had NULL, and the one mapper that read it had to defend
   * against `null` anyway.
   */
  @Column({ name: 'gps_accuracy_meters', type: 'numeric', nullable: true })
  gpsAccuracyMeters: number | null;

  @Column({ name: 'is_mock_location', type: 'boolean', default: false })
  isMockLocation: boolean;

  // Biometric scores
  @Column({ name: 'liveness_score', type: 'numeric', nullable: true })
  livenessScore: number;

  @Column({ name: 'match_score', type: 'numeric', nullable: true })
  matchScore: number | null;

  /**
   * The face the camera saw at this punch, as a small JPEG data URL.
   *
   * Stored so an admin can confirm that the person who checked in is the
   * person on the roster -- a match score alone cannot be argued with or
   * audited. Cleared by the retention sweep after BIOMETRIC_RETENTION_DAYS;
   * the descriptor that verification actually used is kept indefinitely, so
   * check-in keeps working once the photo is gone.
   */
  @Column({ name: 'capture_image', type: 'text', nullable: true })
  captureImage: string | null;

  @Column({
    type: 'enum',
    enum: AttendanceStatus,
    default: AttendanceStatus.PENDING,
  })
  status: AttendanceStatus;

  @Column({ name: 'flag_reason', type: 'text', nullable: true })
  flagReason: string;

  @Column({ name: 'created_offline', type: 'boolean', default: false })
  createdOffline: boolean;

  @Column({ name: 'sync_attempt_count', type: 'int', default: 0 })
  syncAttemptCount: number;

  @Column({ name: 'device_id', type: 'text', nullable: true })
  deviceId: string;

  @Column({ name: 'app_version', type: 'text', nullable: true })
  appVersion: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  // Relations
  @ManyToOne(() => Employee, (employee) => employee.attendanceEvents, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'employee_id' })
  employee: Employee;

  @ManyToOne(() => Site, (site) => site.attendanceEvents, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'site_id' })
  site: Site;

  @OneToMany(() => SyncAuditLog, (log) => log.attendanceEvent)
  auditLogs: SyncAuditLog[];
}
