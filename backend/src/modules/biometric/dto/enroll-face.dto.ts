import { ApiProperty } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsString,
  IsUUID,
  IsOptional,
  IsArray,
  IsNumber,
  ArrayMinSize,
  ArrayMaxSize,
  MaxLength,
} from 'class-validator';
import { FACE_DESCRIPTOR_LENGTH } from '../services/descriptor-match.service';

export class EnrollFaceDto {
  @ApiProperty({
    description: 'Employee UUID to enroll',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsNotEmpty()
  @IsUUID()
  employeeId: string;

  @ApiProperty({
    description:
      'Base64-encoded face image (JPEG/PNG). Optional; prefer faceDescriptor, which avoids uploading the photo at all.',
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
