import { IsString, IsNotEmpty, IsOptional, IsNumber, IsArray, IsEnum, Min, ValidateIf } from 'class-validator';
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
