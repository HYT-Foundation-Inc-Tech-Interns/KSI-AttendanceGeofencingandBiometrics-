import { SetMetadata } from '@nestjs/common';

export const PASSWORD_CHANGE_EXEMPT_KEY = 'passwordChangeExempt';

/**
 * Mark a route as usable while the account is still on an
 * administrator-issued temporary password.
 *
 * `PasswordChangeRequiredGuard` refuses everything for such an account, so
 * this decorator is the way out. Apply it only to routes that either let the
 * owner set a new password or carry no account data of their own -- adding it
 * to an ordinary data route would reopen the hole the guard closes.
 */
export const PasswordChangeExempt = () =>
  SetMetadata(PASSWORD_CHANGE_EXEMPT_KEY, true);
