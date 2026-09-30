import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Employee } from './employee.entity';

@Entity('device_enrollments')
export class DeviceEnrollment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'employee_id', type: 'uuid', nullable: false })
  employeeId: string;

  @Column({ name: 'device_id', type: 'text', nullable: false })
  deviceId: string;

  @Column({ name: 'device_identifier', type: 'text', nullable: true })
  deviceIdentifier: string; // Unique device identifier

  @Column({ name: 'device_name', type: 'text', nullable: true })
  deviceName: string; // Friendly device name

  @Column({ name: 'face_embedding_ref', type: 'text', nullable: false })
  faceEmbeddingRef: string; // Where the embedding lives, e.g. 'inline:face_descriptor'

  /*
   * The 128-d face-api descriptor, computed on the phone.
   *
   * Only the vector is stored -- never the captured photo. The descriptor is
   * not reversible into an image, which is why this column can hold it
   * directly instead of pointing at an encrypted blob the way
   * `face_embedding_ref` was originally designed to.
   */
  @Column({ name: 'face_descriptor', type: 'jsonb', nullable: true })
  faceDescriptor: number[] | null;

  @Column({ name: 'face_embedding_data', type: 'text', nullable: true })
  faceEmbeddingData: string | null; // Legacy image path only; null when a descriptor is stored

  /**
   * The face as it looked when this enrolment was made, as a small JPEG data
   * URL.
   *
   * Deliberately separate from `faceEmbeddingData`: that column is the *input*
   * to the legacy image-matching path, whereas this is a record for the admin
   * to look at. Verification never reads it, so clearing it after
   * BIOMETRIC_RETENTION_DAYS cannot break anyone's check-in.
   */
  @Column({ name: 'enrollment_image', type: 'text', nullable: true })
  enrollmentImage: string | null;

  @Column({ name: 'is_revoked', type: 'boolean', default: false })
  isRevoked: boolean;

  @Column({ name: 'enrolled_by', type: 'uuid', nullable: true })
  enrolledBy: string;

  @CreateDateColumn({ name: 'enrolled_at' })
  enrolledAt: Date;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt: Date | null;

  @Column({ name: 'revoked_by', type: 'uuid', nullable: true })
  revokedBy: string | null;

  @Column({ name: 'revoke_reason', type: 'text', nullable: true })
  revokeReason: string | null;

  @Column({ name: 'device_model', type: 'text', nullable: true })
  deviceModel: string;

  @Column({ name: 'device_os', type: 'text', nullable: true })
  deviceOs: string;

  @Column({ name: 'app_version', type: 'text', nullable: true })
  appVersion: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  // Relations
  @ManyToOne(() => Employee, (employee) => employee.deviceEnrollments, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'employee_id' })
  employee: Employee;
}
