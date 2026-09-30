/*
 * API base URL.
 *
 * This previously derived the address from window.location.hostname in the
 * browser, and read NEXT_PUBLIC_API_URL only on the server branch. Since
 * `typeof window !== 'undefined'` is always true in a browser and these pages
 * are client-only, the env var was never consulted: a dashboard deployed to
 * any public host called `http://<its-own-host>:3000/v1`, where nothing
 * listens. Over HTTPS that request is also blocked as mixed content before
 * CORS is ever reached.
 *
 * NEXT_PUBLIC_API_URL is inlined at build time, so it is the single knob for
 * deployed builds. The hostname fallback is kept so local dev and LAN access
 * (e.g. http://192.168.1.104:3002 -> :3000) still work with no configuration.
 *
 * ---------------------------------------------------------------------------
 * Why a loopback URL is treated as "not configured" off loopback
 *
 * The build is done on a developer machine, where `http://localhost:3000/v1` is
 * correct. The same bundle is then opened on a phone, where `localhost` means
 * *the phone* -- nothing is listening there, so every request fails with a
 * connection error that looks like the backend being down.
 *
 * That case is decidable rather than a guess: if the page is not being served
 * from a loopback host, then a loopback API URL cannot be reachable by
 * definition. A non-loopback configured URL is always honoured, so a real
 * deployment is unaffected.
 *
 * ---------------------------------------------------------------------------
 * Why an https page calls its own origin
 *
 * The phone camera needs a secure context -- on plain http:// `navigator.
 * mediaDevices` is undefined, not merely denied -- so phone testing means
 * HTTPS, and in practice that means a tunnel. A Cloudflare quick tunnel maps
 * one hostname to one local port, so the app and the API have to share a port
 * (`_serve-out.mjs` proxies /v1 alongside the export).
 *
 * That is also the only arrangement that can work: an https page calling an
 * http:// endpoint is blocked as mixed content before CORS is consulted. So on
 * https the API is same-origin, and the tunnel hostname -- which changes every
 * time a quick tunnel restarts -- never has to be baked into a build.
 *
 * Plain http off loopback (a phone on the LAN, where the camera is blocked
 * anyway) keeps the original direct route to the backend's own :3000.
 */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

function isLoopbackUrl(url: string): boolean {
  try {
    return LOOPBACK_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

function resolveApiBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_API_URL;

  if (typeof window === 'undefined') {
    return configured || 'http://localhost:3000/v1';
  }

  // A configured non-loopback API host is a real deployment; always honour it.
  if (configured && !isLoopbackUrl(configured)) {
    return configured;
  }

  const { hostname, origin, protocol } = window.location;

  if (LOOPBACK_HOSTS.has(hostname)) {
    return configured || 'http://localhost:3000/v1';
  }

  return protocol === 'https:' ? `${origin}/v1` : `http://${hostname}:3000/v1`;
}

const API_BASE_URL = resolveApiBaseUrl();

interface ApiOptions extends RequestInit {
  token?: string;
}

/**
 * A refused check-in or check-out, as the notification bell sees it.
 *
 * This is deliberately not an attendance event. A refusal means the server
 * would not accept the punch -- outside the geofence, or a face that did not
 * match -- so filing it in the attendance table made one worker's four retries
 * read as four attendance records. The attempt is kept, with the reason and the
 * face that was standing there, and an administrator either dismisses it or
 * approves it into real attendance.
 */
export interface AttendanceNotification {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  siteId: string | null;
  siteName: string | null;
  eventType: 'check_in' | 'check_out';
  serverTimestamp: string;
  reasonCode:
    | 'outside_geofence'
    | 'face_mismatch'
    | 'no_face'
    | 'not_enrolled'
    | 'face_error';
  /** The sentence shown to the worker, and stored for the administrator. */
  reason: string;
  /** 1 - distance, or null when the refusal was not a face comparison. */
  matchScore: number | null;
  distanceMeters: number | null;
  captureImage: string | null;
  acknowledgedAt: string | null;
  approvedEventId: string | null;
  approvedAt: string | null;
}

/**
 * Build a query string, dropping empty values.
 *
 * `new URLSearchParams({ status: undefined })` serialises to the literal string
 * "undefined", which the backend's enum validation rejects — so omit them.
 */
function buildQuery(params?: Record<string, unknown>): string {
  const clean = Object.fromEntries(
    Object.entries(params ?? {}).filter(
      ([, value]) => value !== undefined && value !== null && value !== ''
    )
  ) as Record<string, string>;
  return new URLSearchParams(clean).toString();
}

/**
 * An error from the API that keeps the machine-readable parts.
 *
 * The server sends a stable `code` alongside the human message, and some
 * decisions depend on it rather than on the text. `PASSWORD_CHANGE_REQUIRED`
 * is the one that matters today: a 403 also means "wrong role", and those two
 * need different handling -- one is fixable on a screen, the other is not.
 *
 * Extends Error, so every existing `catch (err) { err.message }` keeps working.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string = API_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  private async request<T>(
    endpoint: string,
    options: ApiOptions = {}
  ): Promise<T> {
    const { token, ...fetchOptions } = options;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(fetchOptions.headers as Record<string, string> | undefined),
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    let response = await fetch(`${this.baseUrl}${endpoint}`, {
      ...fetchOptions,
      headers,
    });

    if (response.status === 401 && typeof window !== 'undefined') {
      const refreshToken = localStorage.getItem('refreshToken');
      if (refreshToken) {
        try {
          const refreshRes = await fetch(`${this.baseUrl}/auth/refresh`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refresh_token: refreshToken })
          });
          
          if (refreshRes.ok) {
            const data = await refreshRes.json();
            const newAccessToken = data.access_token || data.accessToken;
            const newRefreshToken = data.refresh_token || data.refreshToken;
            
            localStorage.setItem('accessToken', newAccessToken);
            localStorage.setItem('refreshToken', newRefreshToken);
            
            headers['Authorization'] = `Bearer ${newAccessToken}`;
            response = await fetch(`${this.baseUrl}${endpoint}`, {
              ...fetchOptions,
              headers,
            });
          } else {
            localStorage.removeItem('accessToken');
            localStorage.removeItem('refreshToken');
            localStorage.removeItem('user');
            window.location.href = '/';
          }
        } catch (e) {
          localStorage.removeItem('accessToken');
          localStorage.removeItem('refreshToken');
          localStorage.removeItem('user');
          window.location.href = '/';
        }
      }
    }

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: { message: response.statusText } }));
      const errorMessage = errorData?.error?.message || errorData?.message || 'An error occurred';
      const finalMessage = Array.isArray(errorMessage) ? errorMessage.join(', ') : errorMessage;
      throw new ApiError(finalMessage, response.status, errorData?.error?.code);
    }

    /*
     * Not every success carries a body.
     *
     * DELETE /employees/:id answers 204 No Content, and an unconditional
     * response.json() threw "Unexpected end of JSON input" -- *after* the
     * server had already deleted the row. The page then reported a failure
     * that had not happened and skipped its refresh, so the deleted employee
     * stayed on screen until a manual reload. Reading the text first also
     * covers a 200 with an empty body, which a proxy or a bare res.end() can
     * produce.
     */
    if (response.status === 204 || response.status === 205) {
      return undefined as T;
    }

    const body = await response.text();
    if (!body) {
      return undefined as T;
    }

    return JSON.parse(body) as T;
  }

  // Auth
  async login(email: string, password: string) {
    return this.request<{ accessToken: string; refreshToken: string; user: any }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  }

  /**
   * Set a new password for the signed-in account.
   *
   * `currentPassword` is omitted while the account is still on an
   * administrator-issued temporary password -- the server decides whether to
   * demand it from the stored flag, not from what is sent here.
   */
  async changePassword(
    token: string,
    newPassword: string,
    currentPassword?: string
  ): Promise<{ message: string; mustChangePassword: boolean }> {
    return this.request('/auth/change-password', {
      method: 'POST',
      token,
      body: JSON.stringify({
        newPassword,
        ...(currentPassword ? { currentPassword } : {}),
      }),
    });
  }

  /**
   * Wake a sleeping backend.
   *
   * The free hosting tier used for this deployment stops an idle container
   * after ~15 minutes and takes up to a minute to start it again. Firing an
   * unauthenticated `/health` request as the check-in page loads starts that
   * wake-up while the worker is still signing in and framing their face, so
   * the real submit usually does not pay the cold start.
   *
   * `/health` is marked @Public() on the server, so no token is needed.
   * Failures are swallowed: this is an optimisation, never a gate -- if it
   * never resolves, the submit path reports the real error.
   */
  async warmUp(): Promise<void> {
    try {
      await fetch(`${this.baseUrl}/health`, { method: 'GET', cache: 'no-store' });
    } catch {
      /* ignored on purpose */
    }
  }

  // Employees
  async getEmployees(token: string, params?: { page?: number; limit?: number; search?: string }) {
    // The API returns a bare array; some callers still handle a paginated
    // envelope, so the union keeps both branches type-safe.
    return this.request<any[] | { data: any[]; total: number; page: number; limit: number }>(
      `/employees?${buildQuery(params)}`,
      { token }
    );
  }

  async getEmployee(token: string, id: string) {
    return this.request<any>(`/employees/${id}`, { token });
  }

  /**
   * Create an employee record.
   *
   * No login is created and no email is sent. Provisioning the account is a
   * separate step — see issueEmployeeCredentials.
   */
  async createEmployee(token: string, data: any): Promise<any> {
    return this.request<any>('/employees', {
      method: 'POST',
      body: JSON.stringify(data),
      token,
    });
  }

  /**
   * Create or reset an employee's login, and email them the password.
   *
   * Provisions the account when the employee has none, so this is both the
   * normal first-time step and the recovery path for a lost password.
   * Administrators only — the server rejects anyone else.
   */
  async issueEmployeeCredentials(token: string, id: string) {
    return this.request<{
      email: string;
      role: string;
      temporaryPassword?: string;
      emailSent: boolean;
      emailError?: string;
      created: boolean;
    }>(`/employees/${id}/credentials`, {
      method: 'POST',
      token,
    });
  }

  async updateEmployee(token: string, id: string, data: any) {
    return this.request<any>(`/employees/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
      token,
    });
  }

  async deleteEmployee(token: string, id: string) {
    return this.request<void>(`/employees/${id}`, {
      method: 'DELETE',
      token,
    });
  }

  // Sites
  async getSites(token: string, params?: { page?: number; limit?: number }) {
    // The API returns a bare array; callers elsewhere still defensively handle a
    // paginated envelope, so the union keeps both branches type-safe.
    return this.request<any[] | { data: any[]; total: number; page: number; limit: number }>(
      `/sites?${buildQuery(params)}`,
      { token }
    );
  }

  async getSite(token: string, id: string) {
    return this.request<any>(`/sites/${id}`, { token });
  }

  async createSite(token: string, data: any) {
    return this.request<any>('/sites', {
      method: 'POST',
      body: JSON.stringify(data),
      token,
    });
  }

  async updateSite(token: string, id: string, data: any) {
    return this.request<any>(`/sites/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
      token,
    });
  }

  async deleteSite(token: string, id: string) {
    return this.request<void>(`/sites/${id}`, {
      method: 'DELETE',
      token,
    });
  }

  // Attendance
  async getAttendanceEvents(token: string, params?: {
    page?: number;
    limit?: number;
    search?: string;
    eventType?: string;
    startDate?: string;
    endDate?: string;
    status?: string;
  }) {
    return this.request<{ data: any[]; total: number; page: number; limit: number }>(
      `/attendance/events?${buildQuery(params)}`,
      { token }
    );
  }

  async getEmployeeAttendance(token: string, employeeId: string) {
    return this.request<any[]>(`/attendance/employee/${employeeId}`, { token });
  }

  /**
   * Server-authoritative geofence pre-check.
   *
   * `POST /attendance/check-in` also validates the geofence, but it does so
   * *after* the caller has captured and uploaded a face image. An employee
   * standing outside the fence should learn that before the upload, so the
   * check-in screen calls this first. The result is advisory: the server
   * re-validates on submit and is the only authority.
   */
  async validateGeofence(
    token: string,
    siteId: string,
    latitude: number,
    longitude: number
  ) {
    return this.request<{ withinGeofence: boolean; distance?: number }>(
      `/sites/${siteId}/validate-geofence`,
      {
        method: 'POST',
        body: JSON.stringify({ latitude, longitude }),
        token,
      }
    );
  }

  /**
   * Check in / check out.
   *
   * Supply `faceDescriptor` (the 128-d vector computed on the device) or
   * `faceImage`. The server rejects a request carrying neither, so the caller
   * always sends one of them -- it does not rely on
   * DEV_SKIP_BIOMETRIC_VERIFICATION, because that flag is read inside the
   * service, after the DTO has already been validated.
   *
   * `captureImage` is optional and is not used to decide anything: it is the
   * cropped face frame the administrator sees next to the punch. Leaving it out
   * costs a thumbnail, never the check-in.
   */
  async checkIn(
    token: string,
    data: {
      employeeId: string;
      siteId: string;
      latitude: number;
      longitude: number;
      faceImage?: string;
      faceDescriptor?: number[];
      captureImage?: string;
      deviceIdentifier?: string;
    }
  ) {
    return this.request<{
      id: string;
      eventType: string;
      timestamp: string;
      withinGeofence: boolean;
      biometricVerified: boolean;
      status: string;
      message: string;
    }>('/attendance/check-in', {
      method: 'POST',
      body: JSON.stringify(data),
      token,
    });
  }

  async checkOut(
    token: string,
    data: {
      employeeId: string;
      siteId: string;
      latitude: number;
      longitude: number;
      faceImage?: string;
      faceDescriptor?: number[];
      captureImage?: string;
      deviceIdentifier?: string;
    }
  ) {
    return this.request<{
      id: string;
      eventType: string;
      timestamp: string;
      withinGeofence: boolean;
      biometricVerified: boolean;
      status: string;
      message: string;
    }>('/attendance/check-out', {
      method: 'POST',
      body: JSON.stringify(data),
      token,
    });
  }

  /**
   * Enroll a face for an employee.
   *
   * Sends the descriptor rather than the photo, so the server stores a vector
   * it cannot reverse into an image. `captureImage` is the face frame kept for
   * the administrator to compare against -- a record, not a credential.
   */
  async enrollFace(
    token: string,
    data: {
      employeeId: string;
      faceDescriptor?: number[];
      faceImage?: string;
      captureImage?: string;
      deviceIdentifier?: string;
      deviceName?: string;
    }
  ) {
    return this.request<{
      success: boolean;
      enrollmentId: string;
      faceQuality?: number;
      message: string;
    }>('/biometric/enroll', {
      method: 'POST',
      body: JSON.stringify(data),
      token,
    });
  }

  /**
   * List an employee's device enrollments, so the UI can show if one exists.
   *
   * The response deliberately carries no `faceDescriptor`: the vector is the
   * credential, and handing it to a browser would let it be replayed as that
   * person's face. `hasDescriptor` is what callers actually need.
   *
   * `enrollmentImage` IS present -- the frame the employee enrolled with, as a
   * data URL. It is a picture of a face, not the credential.
   */
  async getFaceEnrollments(token: string, employeeId: string) {
    return this.request<
      Array<{
        id: string;
        employeeId: string;
        deviceIdentifier: string | null;
        deviceName: string | null;
        isRevoked: boolean;
        enrolledAt: string;
        faceEmbeddingRef: string;
        hasDescriptor: boolean;
        enrollmentImage: string | null;
      }>
    >(`/biometric/enrollments/${employeeId}`, { token });
  }

  /**
   * Every face enrollment in the organization, for the Employees page.
   *
   * Back-office only; the server refuses it for anyone below ADMIN/HR.
   */
  async listFaceEnrollments(token: string, includeRevoked = false) {
    return this.request<
      Array<{
        id: string;
        employeeId: string;
        employeeName?: string;
        employeeCode?: string;
        deviceIdentifier: string | null;
        deviceName: string | null;
        isRevoked: boolean;
        enrolledAt: string;
        faceEmbeddingRef: string;
        hasDescriptor: boolean;
        enrollmentImage: string | null;
      }>
    >(
      `/biometric/enrollments${includeRevoked ? '?includeRevoked=true' : ''}`,
      { token }
    );
  }

  /**
   * Failed check-ins, for the notification bell.
   *
   * These are punches the server refused. They are deliberately not attendance
   * rows -- a refusal is not a record of someone being at work -- so they live
   * here until an administrator either dismisses one or approves it into a
   * real attendance event.
   */
  async listNotifications(
    token: string,
    options: { includeAcknowledged?: boolean; limit?: number; page?: number } = {}
  ) {
    const params = new URLSearchParams();
    if (options.includeAcknowledged) params.set('includeAcknowledged', 'true');
    if (options.limit) params.set('limit', String(options.limit));
    if (options.page) params.set('page', String(options.page));
    const query = params.toString();

    return this.request<{
      unreadCount: number;
      total: number;
      page: number;
      limit: number;
      data: AttendanceNotification[];
    }>(`/notifications${query ? `?${query}` : ''}`, { token });
  }

  /** Dismiss one failed attempt without recording attendance. */
  async acknowledgeNotification(token: string, id: string) {
    return this.request<AttendanceNotification>(
      `/notifications/${id}/acknowledge`,
      { method: 'POST', token }
    );
  }

  /** Dismiss every open notification. */
  async acknowledgeAllNotifications(token: string) {
    return this.request<{ acknowledged: number }>('/notifications/acknowledge-all', {
      method: 'POST',
      token,
    });
  }

  /**
   * Accept a refused punch and turn it into a real attendance event.
   *
   * Used when the refusal was the system's fault -- a GPS fix that drifted, a
   * face that did not read in bad light -- and the person was genuinely there.
   */
  async approveNotification(token: string, id: string) {
    return this.request<AttendanceNotification & { attendanceEventId: string }>(
      `/notifications/${id}/approve`,
      { method: 'POST', token }
    );
  }

  /**
   * Report the biometric retention window and how many images are on file.
   *
   * ADMIN only: HR looks at the images, but changing when they are destroyed is
   * a data-protection decision.
   */
  async getBiometricRetention(token: string) {
    return this.request<{
      enabled: boolean;
      retentionDays: number | null;
      cutoff: string | null;
      imagesOnFile: {
        enrollments: number;
        attendanceEvents: number;
        refusedAttempts: number;
      };
    }>('/maintenance/biometric-retention', { token });
  }

  // Admin operations
  async approveAttendanceEvent(token: string, eventId: string, notes?: string) {
    return this.request<any>(`/admin/attendance/${eventId}/approve`, {
      method: 'POST',
      body: JSON.stringify({ notes }),
      token,
    });
  }

  async rejectAttendanceEvent(token: string, eventId: string, reason: string) {
    return this.request<any>(`/admin/attendance/${eventId}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
      token,
    });
  }

  async overrideAttendance(token: string, employeeId: string, data: any) {
    return this.request<any>(`/admin/attendance/override`, {
      method: 'POST',
      body: JSON.stringify({ employeeId, ...data }),
      token,
    });
  }

  // Dashboard
  async getDashboardStatistics() {
    const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
    if (!token) {
      throw new Error('No access token found');
    }
    return this.request<{
      totalEmployees: number;
      totalSites: number;
      checkedInToday: number;
      flaggedEvents: number;
    }>('/dashboard/statistics', { token });
  }

  async getRecentCheckIns() {
    const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
    if (!token) {
      throw new Error('No access token found');
    }
    return this.request<Array<{
      id: string;
      employeeName: string;
      siteName: string;
      checkInTime: string;
      verificationStatus: string;
    }>>('/dashboard/recent-checkins', { token });
  }

  async getFlaggedEvents() {
    const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
    if (!token) {
      throw new Error('No access token found');
    }
    return this.request<Array<{
      id: string;
      employeeName: string;
      reason: string;
      timestamp: string;
    }>>('/dashboard/flagged-events', { token });
  }
}

export const api = new ApiClient();
