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
  faceEmbeddingRef: string; // Reference to encrypted embedding, NOT raw photo

  @Column({ name: 'face_embedding_data', type: 'text', nullable: true })
  faceEmbeddingData: string; // Temporary storage for base64 (encrypted in production)

  @Column({ name: 'is_revoked', type: 'boolean', default: false })
  isRevoked: boolean;

  @Column({ name: 'enrolled_by', type: 'uuid', nullable: true })
  enrolledBy: string;

  @CreateDateColumn({ name: 'enrolled_at' })
  enrolledAt: Date;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt: Date;

  @Column({ name: 'revoked_by', type: 'uuid', nullable: true })
  revokedBy: string;

  @Column({ name: 'revoke_reason', type: 'text', nullable: true })
  revokeReason: string;

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
