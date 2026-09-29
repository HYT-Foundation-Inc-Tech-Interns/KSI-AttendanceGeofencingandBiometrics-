import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Organization } from './organization.entity';
import { Employee } from './employee.entity';
import { Exclude } from 'class-transformer';

export enum UserRole {
  ADMIN = 'admin',
  HR = 'hr',
  SUPERVISOR = 'supervisor',
  EMPLOYEE = 'employee',
}

@Entity('users')
@Index(['email'], { unique: true })
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid', nullable: false })
  organizationId: string;

  @Column({ type: 'text', unique: true, nullable: false })
  email: string;

  @Column({ name: 'full_name', type: 'text', nullable: false })
  fullName: string;

  @Column({
    type: 'enum',
    enum: UserRole,
    nullable: false,
  })
  role: UserRole;

  @Column({ name: 'employee_id', type: 'uuid', nullable: true })
  employeeId: string;

  @Column({ name: 'password_hash', type: 'text', nullable: false })
  @Exclude() // Never serialize password hash in responses
  passwordHash: string;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  /**
   * True while the account is still on an administrator-issued temporary
   * password.
   *
   * Set when credentials are issued, cleared when the owner sets their own
   * password. Enforced by `PasswordChangeRequiredGuard`, which refuses every
   * endpoint except the one that changes it -- so this is a real restriction,
   * not just a prompt the client is trusted to show.
   */
  @Column({ name: 'must_change_password', type: 'boolean', default: false })
  mustChangePassword: boolean;

  @Column({ name: 'last_login_at', type: 'timestamptz', nullable: true })
  lastLoginAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  // Relations
  @ManyToOne(() => Organization, (org) => org.users, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  @OneToOne(() => Employee, (employee) => employee.user, {
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'employee_id' })
  employee: Employee;
}
