import { ApiProperty } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsUUID,
  IsNumber,
  IsString,
  IsOptional,
  IsArray,
  ArrayMinSize,
  ArrayMaxSize,
  Min,
  Max,
  MaxLength,
} from 'class-validator';
import { FACE_DESCRIPTOR_LENGTH } from '../../biometric/services/descriptor-match.service';

/**
 * Ceiling on a stored face image.
 *
 * The phone sends a small face crop (~20 kB of base64), so this is roughly ten
 * times what a real client needs -- generous enough that a slightly larger
 * capture is never rejected, bounded enough that the column cannot be filled
 * with arbitrary data. The body limit in main.ts is 10 MB, so without this a
 * single request could write megabytes into every row.
 */
export const MAX_CAPTURE_IMAGE_LENGTH = 400_000;

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

  /*
   * The handset's own uncertainty for the fix above, in metres.
   *
   * Optional, so an older client keeps working. It exists because the geofence
   * used to be a raw point-in-circle test: a cold-start fix triangulated from
   * Wi-Fi can land 100 m away and be refused as "you are not there" even though
   * the phone itself reported +/-100 m. The server widens the fence by this
   * (bounded) rather than trusting the point as exact, and stores it so an
   * administrator can see how much of the verdict was GPS noise.
   */
  @ApiProperty({
    description:
      'GPS accuracy in metres, as reported by the device. Widens the geofence by up to 50 m.',
    example: 18,
    required: false,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  accuracyMeters?: number;

  @ApiProperty({
    description:
      'Base64-encoded face image for verification (JPEG/PNG). Optional; prefer faceDescriptor.',
    example: 'data:image/jpeg;base64,/9j/4AAQSkZJRg...',
    required: false,
  })
  @IsOptional()
  @IsString()
  faceImage?: string;

  @ApiProperty({
    description: `The ${FACE_DESCRIPTOR_LENGTH}-d face descriptor computed on the device. One of faceDescriptor or faceImage is required.`,
    required: false,
    type: [Number],
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(FACE_DESCRIPTOR_LENGTH)
  @ArrayMaxSize(FACE_DESCRIPTOR_LENGTH)
  @IsNumber({}, { each: true })
  faceDescriptor?: number[];

  @ApiProperty({
    description: 'Device identifier (optional)',
    required: false,
  })
  @IsOptional()
  @IsString()
  deviceIdentifier?: string;

  @ApiProperty({
    description:
      'The face the camera saw, as a small base64 data URL, kept so an admin ' +
      'can confirm who actually punched. Not used for verification -- the ' +
      'descriptor is. Optional.',
    example: 'data:image/jpeg;base64,/9j/4AAQSkZJRg...',
    required: false,
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_CAPTURE_IMAGE_LENGTH)
  captureImage?: string;
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

  /*
   * The handset's own uncertainty for the fix above, in metres.
   *
   * Optional, so an older client keeps working. It exists because the geofence
   * used to be a raw point-in-circle test: a cold-start fix triangulated from
   * Wi-Fi can land 100 m away and be refused as "you are not there" even though
   * the phone itself reported +/-100 m. The server widens the fence by this
   * (bounded) rather than trusting the point as exact, and stores it so an
   * administrator can see how much of the verdict was GPS noise.
   */
  @ApiProperty({
    description:
      'GPS accuracy in metres, as reported by the device. Widens the geofence by up to 50 m.',
    example: 18,
    required: false,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  accuracyMeters?: number;

  @ApiProperty({
    description:
      'Base64-encoded face image for verification (JPEG/PNG). Optional; prefer faceDescriptor.',
    example: 'data:image/jpeg;base64,/9j/4AAQSkZJRg...',
    required: false,
  })
  @IsOptional()
  @IsString()
  faceImage?: string;

  @ApiProperty({
    description: `The ${FACE_DESCRIPTOR_LENGTH}-d face descriptor computed on the device. One of faceDescriptor or faceImage is required.`,
    required: false,
    type: [Number],
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(FACE_DESCRIPTOR_LENGTH)
  @ArrayMaxSize(FACE_DESCRIPTOR_LENGTH)
  @IsNumber({}, { each: true })
  faceDescriptor?: number[];

  @ApiProperty({
    description: 'Device identifier (optional)',
    required: false,
  })
  @IsOptional()
  @IsString()
  deviceIdentifier?: string;

  @ApiProperty({
    description:
      'The face the camera saw, as a small base64 data URL, kept so an admin ' +
      'can confirm who actually punched. Not used for verification -- the ' +
      'descriptor is. Optional.',
    example: 'data:image/jpeg;base64,/9j/4AAQSkZJRg...',
    required: false,
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_CAPTURE_IMAGE_LENGTH)
  captureImage?: string;
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
