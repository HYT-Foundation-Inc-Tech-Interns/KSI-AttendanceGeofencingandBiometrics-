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

  /*
   * When the working day is supposed to start, as `HH:mm` in the site's own
   * timezone. Nullable: a site that has not been given one simply has no
   * lateness measured, which is different from being on time.
   *
   * Read as `time`, not as a timestamp. It is a daily recurring moment, and
   * storing it as a timestamp would invite it to be read as a specific date.
   *
   * The transformer trims Postgres' `HH:mm:ss` down to `HH:mm` on every read.
   * An `<input type="time">` rejects the seconds form and renders blank, so a
   * saved shift start would look unsaved the moment the form was reopened --
   * and because this is the entity, every endpoint that returns a site is
   * covered, not just the ones that remember to format it.
   */
  @Column({
    name: 'shift_start_time',
    type: 'time',
    nullable: true,
    transformer: {
      to: (value: string | null) => value,
      from: (value: string | null) => (value ? String(value).slice(0, 5) : null),
    },
  })
  shiftStartTime: string | null;

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
