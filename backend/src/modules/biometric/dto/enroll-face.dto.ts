import { ApiProperty } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsString,
  IsUUID,
  IsOptional,
  IsBase64,
  MaxLength,
} from 'class-validator';

export class EnrollFaceDto {
  @ApiProperty({
    description: 'Employee UUID to enroll',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsNotEmpty()
  @IsUUID()
  employeeId: string;

  @ApiProperty({
    description: 'Base64-encoded face image (JPEG/PNG)',
    example: 'data:image/jpeg;base64,/9j/4AAQSkZJRg...',
  })
  @IsNotEmpty()
  @IsString()
  faceImage: string; // Base64 or data URL

  @ApiProperty({
    description: 'Device unique identifier',
    example: 'device-abc-123',
    required: false,
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  deviceIdentifier?: string;

  @ApiProperty({
    description: 'Device name/model',
    example: 'iPhone 14 Pro',
    required: false,
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  deviceName?: string;
}

export class EnrollFaceResponseDto {
  @ApiProperty({ description: 'Enrollment success status' })
  success: boolean;

  @ApiProperty({ description: 'Device enrollment UUID' })
  enrollmentId: string;

  @ApiProperty({ description: 'Face quality score (0-1)', required: false })
  faceQuality?: number;

  @ApiProperty({ description: 'Message or error description' })
  message: string;
}
