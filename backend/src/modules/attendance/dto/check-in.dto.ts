import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsUUID, IsNumber, IsString, IsOptional, Min, Max } from 'class-validator';

export class CheckInDto {
  @ApiProperty({
    description: 'Employee UUID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsNotEmpty()
  @IsUUID()
  employeeId: string;

  @ApiProperty({
    description: 'Site UUID where check-in is happening',
    example: '660e8400-e29b-41d4-a716-446655440001',
  })
  @IsNotEmpty()
  @IsUUID()
  siteId: string;

  @ApiProperty({
    description: 'Latitude of employee location',
    example: 14.5995,
  })
  @IsNotEmpty()
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude: number;

  @ApiProperty({
    description: 'Longitude of employee location',
    example: 120.9842,
  })
  @IsNotEmpty()
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude: number;

  @ApiProperty({
    description: 'Base64-encoded face image for verification (JPEG/PNG)',
    example: 'data:image/jpeg;base64,/9j/4AAQSkZJRg...',
  })
  @IsNotEmpty()
  @IsString()
  faceImage: string;

  @ApiProperty({
    description: 'Device identifier (optional)',
    required: false,
  })
  @IsOptional()
  @IsString()
  deviceIdentifier?: string;
}

export class CheckOutDto {
  @ApiProperty({
    description: 'Employee UUID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsNotEmpty()
  @IsUUID()
  employeeId: string;

  @ApiProperty({
    description: 'Site UUID where check-out is happening',
    example: '660e8400-e29b-41d4-a716-446655440001',
  })
  @IsNotEmpty()
  @IsUUID()
  siteId: string;

  @ApiProperty({
    description: 'Latitude of employee location',
    example: 14.5995,
  })
  @IsNotEmpty()
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude: number;

  @ApiProperty({
    description: 'Longitude of employee location',
    example: 120.9842,
  })
  @IsNotEmpty()
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude: number;

  @ApiProperty({
    description: 'Base64-encoded face image for verification (JPEG/PNG)',
    example: 'data:image/jpeg;base64,/9j/4AAQSkZJRg...',
  })
  @IsNotEmpty()
  @IsString()
  faceImage: string;

  @ApiProperty({
    description: 'Device identifier (optional)',
    required: false,
  })
  @IsOptional()
  @IsString()
  deviceIdentifier?: string;
}

export class AttendanceEventResponseDto {
  @ApiProperty({ description: 'Event UUID' })
  id: string;

  @ApiProperty({ description: 'Event type: check_in or check_out' })
  eventType: string;

  @ApiProperty({ description: 'Timestamp of the event' })
  timestamp: Date;

  @ApiProperty({ description: 'Geofence validation passed' })
  withinGeofence: boolean;

  @ApiProperty({ description: 'Biometric verification passed' })
  biometricVerified: boolean;

  @ApiProperty({ description: 'Attendance status' })
  status: string;

  @ApiProperty({ description: 'Message or validation result' })
  message: string;
}
