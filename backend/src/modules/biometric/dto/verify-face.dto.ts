import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsUUID, IsOptional } from 'class-validator';

export class VerifyFaceDto {
  @ApiProperty({
    description: 'Employee UUID to verify against',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsNotEmpty()
  @IsUUID()
  employeeId: string;

  @ApiProperty({
    description: 'Base64-encoded face image for verification (JPEG/PNG)',
    example: 'data:image/jpeg;base64,/9j/4AAQSkZJRg...',
  })
  @IsNotEmpty()
  @IsString()
  faceImage: string;

  @ApiProperty({
    description: 'Device identifier (optional for device-specific verification)',
    required: false,
  })
  @IsOptional()
  @IsString()
  deviceIdentifier?: string;
}

export class VerifyFaceResponseDto {
  @ApiProperty({ description: 'Whether verification passed' })
  verified: boolean;

  @ApiProperty({ description: 'Match confidence score (0-1)' })
  confidence: number;

  @ApiProperty({ description: 'Threshold used for matching', required: false })
  threshold?: number;

  @ApiProperty({
    description: 'Liveness check passed (if liveness enabled)',
    required: false,
  })
  livenessCheck?: boolean;

  @ApiProperty({ description: 'Message or reason for verification result' })
  message: string;
}
