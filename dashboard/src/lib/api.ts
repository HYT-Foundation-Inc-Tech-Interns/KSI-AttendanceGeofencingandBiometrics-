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
 */
const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ||
  (typeof window !== 'undefined'
    ? `http://${window.location.hostname}:3000/v1`
    : 'http://localhost:3000/v1');

interface ApiOptions extends RequestInit {
  token?: string;
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
      throw new Error(finalMessage);
    }

    return response.json();
  }

  // Auth
  async login(email: string, password: string) {
    return this.request<{ accessToken: string; refreshToken: string; user: any }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
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

  async createEmployee(token: string, data: any) {
    return this.request<any>('/employees', {
      method: 'POST',
      body: JSON.stringify(data),
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
   * `faceImage` must be a non-empty string even when the server runs with
   * DEV_SKIP_BIOMETRIC_VERIFICATION=true -- the DTO rejects an empty value
   * before the service ever consults that flag. The caller therefore always
   * captures a real frame rather than relying on the skip.
   */
  async checkIn(
    token: string,
    data: {
      employeeId: string;
      siteId: string;
      latitude: number;
      longitude: number;
      faceImage: string;
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
      faceImage: string;
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
