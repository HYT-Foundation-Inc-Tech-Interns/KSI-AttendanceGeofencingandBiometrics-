import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { Site } from './site.entity';
import { Employee } from './employee.entity';
import { User } from './user.entity';

@Entity('organizations')
export class Organization {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text', nullable: false })
  name: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  // Relations
  @OneToMany(() => Site, (site) => site.organization)
  sites: Site[];

  @OneToMany(() => Employee, (employee) => employee.organization)
  employees: Employee[];

  @OneToMany(() => User, (user) => user.organization)
  users: User[];
}
