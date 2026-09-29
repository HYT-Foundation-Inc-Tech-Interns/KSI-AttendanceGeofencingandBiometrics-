import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User } from '../../database/entities';
import { canonicalEmail } from '../../common/utils/password.util';
import { JwtPayload } from './strategies/jwt.strategy';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  async validateUser(email: string, password: string): Promise<any> {
    /*
     * Emails are stored canonicalised (lower-cased, trimmed) by
     * EmployeesService, but users.email is a case-sensitive text column. A
     * worker typing "Juan.Delacruz@..." on a phone keyboard would otherwise
     * fail against the stored "juan.delacruz@..." even though the credentials
     * are correct.
     */
    const user = await this.userRepository.findOne({
      where: { email: canonicalEmail(email), isActive: true },
    });

    if (!user) {
      return null;
    }

    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);

    if (!isPasswordValid) {
      return null;
    }

    // Update last login
    await this.userRepository.update(user.id, {
      lastLoginAt: new Date(),
    });

    const { passwordHash, ...result } = user;
    return result;
  }

  async login(user: any) {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      organizationId: user.organizationId,
    };

    const accessToken = this.jwtService.sign(payload);
    const refreshToken = this.jwtService.sign(payload, {
      secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
      expiresIn: this.configService.get<string>(
        'JWT_REFRESH_EXPIRES_IN',
        '7d',
      ),
    });

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      user: {
        id: user.id,
        email: user.email,
        full_name: user.fullName,
        role: user.role,
        organization_id: user.organizationId,
        employee_id: user.employeeId,
        /*
         * Drives the "set your own password" screen. The client needs it at
         * sign-in time so it can route there before showing anything else;
         * `PasswordChangeRequiredGuard` is what actually enforces it.
         */
        must_change_password: user.mustChangePassword === true,
      },
    };
  }

  async refreshToken(refreshToken: string) {
    try {
      const payload = this.jwtService.verify(refreshToken, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
      });

      const user = await this.userRepository.findOne({
        where: { id: payload.sub, isActive: true },
      });

      if (!user) {
        throw new UnauthorizedException('User not found or inactive');
      }

      return this.login(user);
    } catch (error) {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  async hashPassword(password: string): Promise<string> {
    const saltRounds = 10;
    return bcrypt.hash(password, saltRounds);
  }

  /**
   * Replace the signed-in user's own password.
   *
   * Also clears `mustChangePassword`, which is what releases
   * `PasswordChangeRequiredGuard` -- so this call is the only way out of the
   * temporary-password state.
   *
   * No new tokens are issued. The guard reads the flag from the database on
   * every request rather than from a token claim, so the caller's existing
   * access token starts working for everything else the moment this returns.
   */
  async changePassword(
    userId: string,
    currentPassword: string | undefined,
    newPassword: string,
  ): Promise<{ message: string; mustChangePassword: false }> {
    const user = await this.userRepository.findOne({ where: { id: userId } });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    /*
     * The current password is demanded only for a voluntary change.
     *
     * While the account is flagged, the caller reached this endpoint with a
     * session, and the only way to obtain one is to have signed in with the
     * temporary password -- so the session already proves what the field would
     * ask for. Enforcing it there would add nothing and cost a field worker a
     * retyped 12-character random string on a phone.
     *
     * The decision is made from the stored flag, never from the request, so
     * omitting the field cannot be used to skip the check on a normal account.
     */
    if (!user.mustChangePassword) {
      if (!currentPassword) {
        throw new BadRequestException(
          'Your current password is required to change it.',
        );
      }

      const currentIsCorrect = await bcrypt.compare(
        currentPassword,
        user.passwordHash,
      );

      if (!currentIsCorrect) {
        throw new UnauthorizedException(
          'That is not your current password. Check it and try again.',
        );
      }

      if (currentPassword === newPassword) {
        throw new BadRequestException(
          'The new password must be different from the current one.',
        );
      }
    }

    // Nothing changes if the temporary password is simply kept as the new one.
    if (await bcrypt.compare(newPassword, user.passwordHash)) {
      throw new BadRequestException(
        'The new password must be different from the one you signed in with.',
      );
    }

    user.passwordHash = await this.hashPassword(newPassword);
    user.mustChangePassword = false;
    await this.userRepository.save(user);

    return {
      message: 'Your password has been changed.',
      mustChangePassword: false,
    };
  }

  async validatePassword(
    plainPassword: string,
    hashedPassword: string,
  ): Promise<boolean> {
    return bcrypt.compare(plainPassword, hashedPassword);
  }
}
