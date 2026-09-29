import {
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * A signed-in user replacing their own password.
 *
 * `currentPassword` is required only for a voluntary change. While the account
 * is still on an administrator-issued temporary password it is optional, and
 * `AuthService.changePassword` decides which case applies from the stored flag
 * rather than trusting anything the client sends.
 *
 * The reasoning: to reach this endpoint while flagged, the caller must already
 * hold a session, and the only way to get one is to have signed in with the
 * temporary password. So the session *is* proof of knowing it, and asking for
 * it again would add no security while forcing a field worker to retype a
 * random 12-character string from an email on a phone keypad.
 */
export class ChangePasswordDto {
  @ApiPropertyOptional({
    description:
      'Required when changing a password voluntarily. May be omitted while the account is on a temporary password.',
  })
  @IsString()
  @IsOptional()
  currentPassword?: string;

  /**
   * 72 is not arbitrary: bcrypt ignores everything past 72 bytes, so a longer
   * password would be silently truncated. Rejecting it is honest; accepting it
   * would let someone believe a 100-character passphrase was in force when
   * only its first 72 bytes were.
   */
  @ApiProperty({ description: 'The new password', minLength: 8, maxLength: 72 })
  @IsString()
  @IsNotEmpty()
  @MinLength(8, { message: 'The new password must be at least 8 characters.' })
  @MaxLength(72, {
    message: 'The new password must be at most 72 characters.',
  })
  newPassword: string;
}
