import { IsString, IsNotEmpty, IsOptional, IsEmail, IsEnum, IsUUID, IsDateString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { EmployeeStatus } from '../../../database/entities';

export class CreateEmployeeDto {
  @ApiProperty({ example: 'EMP002' })
  @IsString()
  @IsNotEmpty()
  employeeCode: string;

  @ApiProperty({ example: 'Maria Santos' })
  @IsString()
  @IsNotEmpty()
  fullName: string;

  @ApiPropertyOptional({ example: 'maria.santos@klassic.ph' })
  @IsEmail()
  @IsOptional()
  email?: string;

  @ApiPropertyOptional({ example: '+639171234567' })
  @IsString()
  @IsOptional()
  phone?: string;

  @ApiPropertyOptional({ description: 'Site ID to assign employee' })
  @IsUUID()
  @IsOptional()
  siteId?: string;

  @ApiPropertyOptional({ enum: EmployeeStatus, default: EmployeeStatus.ACTIVE })
  @IsEnum(EmployeeStatus)
  @IsOptional()
  status?: EmployeeStatus;

  @ApiPropertyOptional({ example: '2024-01-01' })
  @IsDateString()
  @IsOptional()
  hiredAt?: string;
}

export class UpdateEmployeeDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  fullName?: string;

  @ApiPropertyOptional()
  @IsEmail()
  @IsOptional()
  email?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  phone?: string;

  @ApiPropertyOptional()
  @IsUUID()
  @IsOptional()
  siteId?: string;

  @ApiPropertyOptional({ enum: EmployeeStatus })
  @IsEnum(EmployeeStatus)
  @IsOptional()
  status?: EmployeeStatus;

  @ApiPropertyOptional()
  @IsDateString()
  @IsOptional()
  hiredAt?: string;

  @ApiPropertyOptional()
  @IsDateString()
  @IsOptional()
  offboardedAt?: string;
}

export class GetEmployeeResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  organization_id: string;

  @ApiPropertyOptional()
  site_id?: string;

  @ApiProperty()
  employee_code: string;

  @ApiProperty()
  full_name: string;

  @ApiPropertyOptional()
  email?: string;

  @ApiPropertyOptional()
  phone?: string;

  @ApiProperty({ enum: EmployeeStatus })
  status: EmployeeStatus;

  @ApiPropertyOptional()
  hired_at?: string;

  @ApiPropertyOptional()
  offboarded_at?: string;

  @ApiProperty()
  created_at: string;

  @ApiProperty()
  updated_at: string;
}
