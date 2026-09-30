import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Employee } from './employee.entity';
import { Site } from './site.entity';
import { EventType } from './attendance-event.entity';

/**
 * Why a check-in or check-out was refused.
 *
 * Kept as a small closed set rather than free text so the notification list can
 * group and filter without parsing sentences, while `reason` still carries the
 * full human-readable message the server produced.
 */
export enum AttemptReason {
  OUTSIDE_GEOFENCE = 'outside_geofence',
  FACE_MISMATCH = 'face_mismatch',
  NO_FACE = 'no_face',
  NOT_ENROLLED = 'not_enrolled',
  FACE_ERROR = 'face_error',
}

/**
 * A refused check-in or check-out.
 *
 * These used to be written into `attendance_events` with status FLAGGED, which
 * meant every failed attempt appeared in the attendance list next to real
 * attendance. One worker retrying a bad capture produced four rows that looked
 * like four attendance records, and the admin had to read a sentence in the
 * status column to tell them apart.
 *
 * A refusal is not attendance. It is an operational event that the admin needs
 * to *know about*, which is a different thing with a different lifetime -- so
 * it lives in its own table and surfaces through the notification bell. An
 * admin can still approve one, which writes a real attendance event and links
 * back here.
 */
@Entity('attendance_attempts')
@Index(['employeeId', 'serverTimestamp'])
@Index(['acknowledgedAt'])
export class AttendanceAttempt {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'employee_id', type: 'uuid', nullable: false })
  employeeId: string;

  @Column({ name: 'site_id', type: 'uuid', nullable: true })
  siteId: string | null;

  @Column({
    name: 'event_type',
    type: 'enum',
    enum: EventType,
    nullable: false,
  })
  eventType: EventType;

  @Column({ name: 'device_timestamp', type: 'timestamptz', nullable: true })
  deviceTimestamp: Date | null;

  @CreateDateColumn({ name: 'server_timestamp' })
  serverTimestamp: Date;

  @Column({ name: 'reason_code', type: 'text', nullable: false })
  reasonCode: AttemptReason;

  /** The message the employee was shown, verbatim. */
  @Column({ name: 'reason', type: 'text', nullable: false })
  reason: string;

  /** Match confidence (1 - distance) when the refusal was a face mismatch. */
  @Column({ name: 'match_score', type: 'numeric', nullable: true })
  matchScore: number | null;

  /** Metres from the site when the refusal was a geofence violation. */
  @Column({ name: 'distance_meters', type: 'numeric', nullable: true })
  distanceMeters: number | null;

  @Column({ name: 'latitude', type: 'numeric', nullable: true })
  latitude: number | null;

  @Column({ name: 'longitude', type: 'numeric', nullable: true })
  longitude: number | null;

  /**
   * The face the camera actually saw, as a small JPEG data URL.
   *
   * This is the whole point of the record: "face verification failed" is not
   * actionable, but a picture of who was standing there is. Cleared by the
   * retention sweep after BIOMETRIC_RETENTION_DAYS; the row itself is kept.
   */
  @Column({ name: 'capture_image', type: 'text', nullable: true })
  captureImage: string | null;

  @Column({ name: 'device_id', type: 'text', nullable: true })
  deviceId: string | null;

  /** When an admin cleared it from the notification list. */
  @Column({ name: 'acknowledged_at', type: 'timestamptz', nullable: true })
  acknowledgedAt: Date | null;

  @Column({ name: 'acknowledged_by', type: 'uuid', nullable: true })
  acknowledgedBy: string | null;

  /** Set when an admin accepted the attempt, turning it into real attendance. */
  @Column({ name: 'approved_event_id', type: 'uuid', nullable: true })
  approvedEventId: string | null;

  @Column({ name: 'approved_by', type: 'uuid', nullable: true })
  approvedBy: string | null;

  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true })
  approvedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @ManyToOne(() => Employee, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'employee_id' })
  employee: Employee;

  @ManyToOne(() => Site, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'site_id' })
  site: Site | null;
}
