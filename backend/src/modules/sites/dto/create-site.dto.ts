import { IsString, IsNotEmpty, IsOptional, IsNumber, IsArray, IsEnum, Min, Matches, ValidateIf } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum SiteStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  SUSPENDED = 'suspended',
}

export class CreateSiteDto {
  @ApiProperty({ example: 'SM Manila Office' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({ example: 'SM City Manila, Manila' })
  @IsString()
  @IsOptional()
  address?: string;

  @ApiPropertyOptional({ example: 14.5964, description: 'Latitude for circular geofence center' })
  @IsNumber()
  @IsOptional()
  @ValidateIf((o) => o.geofenceRadiusM !== undefined)
  geofenceCenterLat?: number;

  @ApiPropertyOptional({ example: 120.9842, description: 'Longitude for circular geofence center' })
  @IsNumber()
  @IsOptional()
  @ValidateIf((o) => o.geofenceRadiusM !== undefined)
  geofenceCenterLng?: number;

  @ApiPropertyOptional({ example: 100, description: 'Radius in meters for circular geofence' })
  @IsNumber()
  @IsOptional()
  @Min(10)
  @ValidateIf((o) => o.geofenceCenterLat !== undefined)
  geofenceRadiusM?: number;

  @ApiPropertyOptional({ 
    example: [[120.984, 14.596], [120.985, 14.596], [120.985, 14.597], [120.984, 14.597], [120.984, 14.596]],
    description: 'Polygon coordinates for irregular geofence (array of [lng, lat] pairs)'
  })
  @IsArray()
  @IsOptional()
  geofencePolygon?: number[][];

  @ApiPropertyOptional({ example: 'Asia/Manila' })
  @IsString()
  @IsOptional()
  timezone?: string;

  /*
   * When the working day starts at this site, as `HH:mm` in `timezone`.
   *
   * Optional, and an empty string is treated as "no shift start" rather than
   * rejected, because that is what an HTML time input submits when it is
   * cleared. A site without one has no lateness measured -- which is honest,
   * where defaulting to midnight would mark every punch late.
   */
  @ApiPropertyOptional({
    example: '08:00',
    description:
      'Shift start as HH:mm in the site timezone. Omit or send an empty string to measure no lateness.',
  })
  @IsString()
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'shiftStartTime must look like HH:mm, e.g. 08:00',
  })
  shiftStartTime?: string;

  @ApiPropertyOptional({ enum: SiteStatus, default: SiteStatus.ACTIVE })
  @IsEnum(SiteStatus)
  @IsOptional()
  status?: SiteStatus;
}

export class UpdateSiteDto extends CreateSiteDto {}

export class GeofenceValidationDto {
  @ApiProperty({ example: 14.5964 })
  @IsNumber()
  @IsNotEmpty()
  latitude: number;

  @ApiProperty({ example: 120.9842 })
  @IsNumber()
  @IsNotEmpty()
  longitude: number;

  /*
   * How uncertain the handset says this fix is, in metres (the `accuracy` of
   * a GeolocationPosition). Optional, and omitted by callers that have no fix
   * metadata.
   *
   * This is what stops a cold-start GPS fix from being read as a fact. The
   * first fix after opening a page is routinely triangulated from Wi-Fi and
   * cell towers and lands 50-150 m away with `accuracy` admitting as much, so
   * a raw point-in-circle test refuses a worker who is standing inside the
   * building. When this is supplied the fence is widened by it (bounded -- see
   * ACCURACY_ALLOWANCE_CAP_M), which is the honest reading of a point that
   * could be anywhere inside its own error circle.
   */
  @ApiPropertyOptional({
    example: 18,
    description:
      'GPS accuracy in metres. Widens the fence by up to 50 m so a weak fix is not read as being elsewhere.',
  })
  @IsNumber()
  @IsOptional()
  @Min(0)
  accuracyMeters?: number;
}

export class GetSiteResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  organization_id: string;

  @ApiProperty()
  name: string;

  @ApiPropertyOptional()
  address?: string;

  @ApiPropertyOptional()
  geofence_center?: { latitude: number; longitude: number };

  @ApiPropertyOptional()
  geofence_radius_m?: number;

  @ApiPropertyOptional()
  geofence_polygon?: { type: string; coordinates: number[][][] };

  @ApiProperty()
  timezone: string;

  @ApiProperty()
  status: string;

  @ApiProperty()
  created_at: string;
}
