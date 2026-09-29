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

  /**
   * Required, not optional.
   *
   * The email is the identifier the employee will sign in with once an
   * administrator issues their credentials, so an employee without one could
   * never be given an account. It is validated as a real address at creation
   * time rather than at credential time, while the form is still open.
   */
  @ApiProperty({ example: 'maria.santos@klassic.ph' })
  @IsEmail()
  @IsNotEmpty()
  email: string;

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

/**
 * The login account that was created or reset by an administrator.
 *
 * `temporaryPassword` is present only in the response to the credentials call.
 * It is never stored in plaintext, never returned by any read endpoint, and
 * cannot be retrieved again — the admin is expected to pass it on, and a lost
 * password is handled by issuing a new one, not by looking it up.
 */
export class EmployeeAccountDto {
  @ApiProperty({ description: 'Login email the employee signs in with' })
  email: string;

  @ApiProperty({ description: 'Role granted to the account' })
  role: string;

  @ApiPropertyOptional({
    description:
      'One-time temporary password. Shown once, in this response only.',
  })
  temporaryPassword?: string;

  @ApiProperty({
    description:
      'Whether the credentials were emailed. False when SMTP is not configured.',
  })
  emailSent: boolean;

  @ApiPropertyOptional({
    description: 'Why the email was not sent, when emailSent is false',
  })
  emailError?: string;

  @ApiProperty({
    description:
      'True when this call provisioned the login, false when it reset an existing one.',
  })
  created: boolean;
}
