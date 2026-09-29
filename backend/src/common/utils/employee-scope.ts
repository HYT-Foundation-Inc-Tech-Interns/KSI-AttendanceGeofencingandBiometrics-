import { ForbiddenException } from '@nestjs/common';
import { UserRole } from '../../database/entities';

/**
 * The authenticated caller, as populated by JwtStrategy.
 *
 * `employeeId` is null for accounts that are not tied to an employee record,
 * which is the normal case for administrators.
 */
export interface ActingUser {
  id: string;
  role: string;
  employeeId?: string | null;
}

/**
 * Roles allowed to record attendance or manage biometrics on behalf of
 * another employee.
 *
 * Deliberately just ADMIN and HR. SUPERVISOR is left out until there is a
 * real notion of which employees a supervisor covers -- granting "any
 * supervisor, any employee" would be a guess, and the safe default is that
 * everyone else may only act for themselves.
 */
const ROLES_MAY_ACT_FOR_OTHERS: ReadonlySet<string> = new Set([
  UserRole.ADMIN,
  UserRole.HR,
]);

export function mayActForOthers(user: ActingUser): boolean {
  return ROLES_MAY_ACT_FOR_OTHERS.has(user.role);
}

/**
 * Refuse when a caller tries to act on an employee record that is not theirs.
 *
 * Without this, any authenticated employee could post a check-in for any
 * colleague -- the DTO carries the employee id and nothing compared it to the
 * token. That was survivable while biometrics were skipped, but once face
 * matching is enforced it becomes the difference between "someone else
 * punched in for me" and "only I can punch in as me".
 *
 * Throws 403 rather than 404: the caller is authenticated and the record may
 * well exist, they simply are not allowed to touch it.
 */
export function assertMayActForEmployee(
  user: ActingUser,
  targetEmployeeId: string
): void {
  if (mayActForOthers(user)) return;

  if (!user.employeeId || user.employeeId !== targetEmployeeId) {
    throw new ForbiddenException(
      'You can only record attendance and manage biometrics for yourself.'
    );
  }
}

/**
 * Refuse when a caller asks for another employee's data.
 *
 * Same rule as above; used by read paths such as listing enrollments.
 */
export function assertMayReadEmployee(
  user: ActingUser,
  targetEmployeeId: string
): void {
  assertMayActForEmployee(user, targetEmployeeId);
}
