/*
 * Session storage and the two front doors.
 *
 * This system has exactly two kinds of account and two places to use them:
 *
 *   back office  admin, hr  ->  /            (sign in)  ->  /dashboard/*
 *   field        employee   ->  /checkin     (sign in)  ->  stays on /checkin
 *
 * Nothing in the API stops an employee token from reaching back-office
 * endpoints that are not individually role-guarded, so the separation has to
 * be enforced on the client as well as on the server.
 *
 * It was not, and the two doors disagreed: /checkin refused administrator
 * logins, while /dashboard accepted employee ones and rendered the whole
 * back office to them. Every session read and write now goes through this
 * module so the two surfaces cannot drift apart again.
 */

export const SESSION_KEYS = {
  accessToken: 'accessToken',
  refreshToken: 'refreshToken',
  user: 'user',
} as const;

/**
 * The /auth/login response stores the user in snake_case. Records written by
 * older builds may hold camelCase, and a stale entry must not break the page,
 * so both spellings are read everywhere.
 */
export interface SessionUser {
  id?: string;
  email?: string;
  full_name?: string;
  fullName?: string;
  role?: string;
  employee_id?: string | null;
  employeeId?: string | null;
}

/** Roles that belong in the back office. Mirrors `UserRole` on the server. */
const BACK_OFFICE_ROLES = ['admin', 'hr'];

export function isBackOfficeRole(role: string | null | undefined): boolean {
  return !!role && BACK_OFFICE_ROLES.includes(role.toLowerCase());
}

export function isEmployeeRole(role: string | null | undefined): boolean {
  return !!role && role.toLowerCase() === 'employee';
}

/**
 * Where an account belongs, so signing in at the single login page can land
 * each role on its own surface.
 *
 * An unrecognised role returns '/', not '/checkin'. Returning the check-in
 * page for "not back office" would be a redirect loop: /checkin sees a
 * non-employee role, asks for its home, and gets /checkin back. The sign-in
 * page is the only safe landing because it is the one page that never
 * redirects on the basis of a role.
 */
export function homeForRole(role: string | null | undefined): string {
  if (isBackOfficeRole(role)) return '/dashboard';
  if (isEmployeeRole(role)) return '/checkin';
  return '/';
}

export function displayName(user: SessionUser | null): string {
  return user?.full_name || user?.fullName || user?.email || 'User';
}

export function employeeIdOf(user: SessionUser | null): string | null {
  return user?.employee_id || user?.employeeId || null;
}

/** The token pair plus user from a login response, across both spellings. */
export function extractSession(response: unknown): {
  accessToken: string;
  refreshToken: string;
  user: SessionUser;
} {
  const r = response as Record<string, any>;
  return {
    accessToken: r?.access_token || r?.accessToken || '',
    refreshToken: r?.refresh_token || r?.refreshToken || '',
    user: (r?.user ?? {}) as SessionUser,
  };
}

export function saveSession(
  accessToken: string,
  refreshToken: string,
  user: SessionUser
): void {
  localStorage.setItem(SESSION_KEYS.accessToken, accessToken);
  localStorage.setItem(SESSION_KEYS.refreshToken, refreshToken);
  localStorage.setItem(SESSION_KEYS.user, JSON.stringify(user));
}

export function clearSession(): void {
  localStorage.removeItem(SESSION_KEYS.accessToken);
  localStorage.removeItem(SESSION_KEYS.refreshToken);
  localStorage.removeItem(SESSION_KEYS.user);
}

/**
 * Read the stored session. Returns null when there is nothing usable, and
 * clears a corrupt entry rather than leaving the page wedged on every load.
 */
export function readSession(): { token: string; user: SessionUser } | null {
  const token = localStorage.getItem(SESSION_KEYS.accessToken);
  const raw = localStorage.getItem(SESSION_KEYS.user);

  if (!token || !raw) return null;

  try {
    return { token, user: JSON.parse(raw) as SessionUser };
  } catch {
    clearSession();
    return null;
  }
}
