import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { PASSWORD_CHANGE_EXEMPT_KEY } from '../decorators/password-change-exempt.decorator';

/**
 * Refuse every request from an account still on a temporary password.
 *
 * An administrator issues a temporary password by email, and the owner is
 * expected to replace it with one of their own. Asking the client to show a
 * "set your password" screen is not enforcement -- anyone can skip a screen.
 * This guard makes it real: until `users.must_change_password` is cleared, the
 * only route that answers is the one that clears it.
 *
 * There is no extra database read here. `JwtStrategy.validate()` already loads
 * the user on every authenticated request and is the natural place to read the
 * flag, so this costs nothing beyond the check itself. That also means the
 * restriction applies to sessions opened *before* the flag was set, not just
 * to future logins.
 *
 * Ordering matters: this must run after `JwtAuthGuard`, which populates
 * `request.user`. Registered in that order in `app.module.ts`.
 */
@Injectable()
export class PasswordChangeRequiredGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const exempt = this.reflector.getAllAndOverride<boolean>(
      PASSWORD_CHANGE_EXEMPT_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (exempt) {
      return true;
    }

    // Public routes never have a user to check.
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const user = context.switchToHttp().getRequest()?.user;

    // No user means this route is not authenticated, or the JWT guard already
    // rejected it. Nothing to add in either case.
    if (!user) {
      return true;
    }

    if (user.mustChangePassword) {
      /*
       * The `code` is what the client keys off. The status alone is not enough:
       * a 403 also means "wrong role", and the two need different handling --
       * one is fixable in a screen, the other is not.
       */
      throw new ForbiddenException({
        code: 'PASSWORD_CHANGE_REQUIRED',
        message:
          'This account is still using an administrator-issued temporary password. Set your own password to continue.',
      });
    }

    return true;
  }
}
