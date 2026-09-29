import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  OneToOne,
  JoinColumn,
} from 'typeorm';
import { Organization } from './organization.entity';
import { Site } from './site.entity';
import { DeviceEnrollment } from './device-enrollment.entity';
import { AttendanceEvent } from './attendance-event.entity';
import { User } from './user.entity';

export enum EmployeeStatus {
  ACTIVE = 'active',
  SUSPENDED = 'suspended',
  OFFBOARDED = 'offboarded',
}

@Entity('employees')
export class Employee {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid', nullable: false })
  organizationId: string;

  @Column({ name: 'site_id', type: 'uuid', nullable: true })
  siteId: string;

  @Column({ name: 'employee_code', type: 'text', unique: true, nullable: false })
  employeeCode: string;

  @Column({ name: 'full_name', type: 'text', nullable: false })
  fullName: string;

  @Column({ type: 'text', nullable: true })
  email: string;

  @Column({ type: 'text', nullable: true })
  phone: string;

  @Column({
    type: 'enum',
    enum: EmployeeStatus,
    default: EmployeeStatus.ACTIVE,
  })
  status: EmployeeStatus;

  @Column({ name: 'hired_at', type: 'date', nullable: true })
  hiredAt: Date;

  @Column({ name: 'offboarded_at', type: 'date', nullable: true })
  offboardedAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  // Relations
  @ManyToOne(() => Organization, (org) => org.employees, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  @ManyToOne(() => Site, (site) => site.employees, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'site_id' })
  site: Site;

  @OneToMany(() => DeviceEnrollment, (enrollment) => enrollment.employee)
  deviceEnrollments: DeviceEnrollment[];

  @OneToMany(() => AttendanceEvent, (event) => event.employee)
  attendanceEvents: AttendanceEvent[];

  @OneToOne(() => User, (user) => user.employee)
  user: User;
}
