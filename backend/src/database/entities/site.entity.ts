import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';
import { Organization } from './organization.entity';
import { Employee } from './employee.entity';
import { AttendanceEvent } from './attendance-event.entity';
import { GeoJsonPoint, GeoJsonPolygon } from './geo-json.types';

export enum SiteStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  SUSPENDED = 'suspended',
}

@Entity('sites')
export class Site {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid', nullable: false })
  organizationId: string;

  @Column({ type: 'text', nullable: false })
  name: string;

  @Column({ type: 'text', nullable: true })
  address: string;

  // Circular geofence
  @Column({
    name: 'geofence_center',
    type: 'geography',
    spatialFeatureType: 'Point',
    srid: 4326,
    nullable: true,
  })
  geofenceCenter: GeoJsonPoint | null;

  @Column({ name: 'geofence_radius_m', type: 'int', nullable: true })
  geofenceRadiusM: number | null;

  // Polygon geofence
  @Column({
    name: 'geofence_polygon',
    type: 'geography',
    spatialFeatureType: 'Polygon',
    srid: 4326,
    nullable: true,
  })
  geofencePolygon: GeoJsonPolygon | null;

  @Column({ type: 'text', default: 'Asia/Manila', nullable: false })
  timezone: string;

  @Column({
    type: 'enum',
    enum: SiteStatus,
    default: SiteStatus.ACTIVE,
  })
  status: SiteStatus;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  // Relations
  @ManyToOne(() => Organization, (org) => org.sites, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  @OneToMany(() => Employee, (employee) => employee.site)
  employees: Employee[];

  @OneToMany(() => AttendanceEvent, (event) => event.site)
  attendanceEvents: AttendanceEvent[];
}
