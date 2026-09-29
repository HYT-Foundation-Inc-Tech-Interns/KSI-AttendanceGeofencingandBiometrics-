import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class ApproveAttendanceEventDto {
  @ApiPropertyOptional({ description: 'Optional note recorded in the audit log' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class RejectAttendanceEventDto {
  @ApiProperty({ description: 'Why the event is being rejected' })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason: string;
}
