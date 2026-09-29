'use client';

/*
 * Worker check-in, in the browser.
 *
 * This is the web replacement for the native Expo app. It runs the same
 * backend flow the mobile client used -- GPS geofence validation plus a face
 * frame -- without an app store, a build pipeline, or an Apple developer
 * account, and it is served over HTTPS so the browser will grant camera and
 * location access.
 *
 * Three browser constraints shape the design, and all three are surfaced to the
 * user rather than failing silently:
 *
 *  1. `navigator.geolocation` and `navigator.mediaDevices` require a *secure
 *     context* (HTTPS, or localhost). Over plain http:// on a LAN IP -- e.g.
 *     http://192.168.1.104:3002 -- `mediaDevices` is not merely denied, it is
 *     undefined. `window.isSecureContext` detects this up front and explains it,
 *     because the raw symptom ("Cannot read properties of undefined") is useless.
 *
 *  2. `CheckInDto.faceImage` is `@IsNotEmpty()`. The server currently runs with
 *     DEV_SKIP_BIOMETRIC_VERIFICATION=true, but that flag is read *inside* the
 *     service, after the DTO has already been validated -- so an empty image is
 *     rejected with a 400 regardless. A real frame is always captured.
 *
 *  3. The geofence is enforced server-side with DEV_SKIP_GEOFENCE_VALIDATION=false.
 *     The pre-check below is advisory only: it exists so a worker standing
 *     outside the fence is told before uploading a photo, never to replace the
 *     server's decision. If the pre-check itself errors it is ignored and the
 *     submit proceeds.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { api } from '@/lib/api';
import {
  AlertCircle,
  Camera,
  CheckCircle2,
  Loader2,
  LogOut,
  MapPin,
  RefreshCw,
} from 'lucide-react';

/** The /auth/login response stores the user in snake_case; older records in
 *  localStorage may hold camelCase. Both are read so a stale entry still works. */
interface StoredUser {
  id?: string;
  email?: string;
  full_name?: string;
  fullName?: string;
  role?: string;
  employee_id?: string | null;
  employeeId?: string | null;
}

interface SiteOption {
  id: string;
  name: string;
  geofenceRadiusM?: number | null;
}

type Stage = 'booting' | 'login' | 'ready' | 'done';

/** `GET /sites` and `GET /employees` return a bare array, but the API client
 *  types them as a union with a paginated envelope. Normalise once, here. */
function asArray<T>(value: T[] | { data: T[] } | undefined | null): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : (value.data ?? []);
}

function displayName(user: StoredUser | null): string {
  return user?.full_name || user?.fullName || user?.email || 'Employee';
}

function employeeIdOf(user: StoredUser | null): string | null {
  return user?.employee_id || user?.employeeId || null;
}

function formatClock(iso: string | Date | undefined): string {
  if (!iso) return '--:--';
  const d = new Date(iso);
  return isNaN(d.getTime())
    ? '--:--'
    : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** Turn a GeolocationPositionError into something a field worker can act on. */
function describeGeoError(err: unknown): string {
  const code = (err as GeolocationPositionError | undefined)?.code;
  if (code === 1) {
    return 'Location permission was denied. Allow location access for this site in your browser settings, then reload.';
  }
  if (code === 2) {
    return 'Your location is unavailable right now. Step outside or near a window and try again.';
  }
  if (code === 3) {
    return 'Timed out while getting your location. Try again.';
  }
  return (err as Error)?.message || 'Could not determine your location.';
}

export default function CheckInPage() {
  const [stage, setStage] = useState<Stage>('booting');
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<StoredUser | null>(null);

  // Login form
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);

  // Context
  const [sites, setSites] = useState<SiteOption[]>([]);
  const [siteId, setSiteId] = useState('');
  const [lastEventType, setLastEventType] = useState<string | null>(null);
  const [lastEventAt, setLastEventAt] = useState<string | null>(null);
  const [loadingContext, setLoadingContext] = useState(false);

  // Capture
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState('');

  // Submit
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{
    message: string;
    eventType: string;
    timestamp: string;
  } | null>(null);

  /*
   * Secure-context flag, resolved *after* mount rather than during render.
   *
   * `window.isSecureContext` cannot be read while server-rendering, and
   * localhost IS a secure context. Computing this inline during render made the
   * server emit the "not on a secure connection" banner and then the browser
   * remove it on hydration -- a hydration mismatch, confirmed by the banner
   * appearing in the server-rendered HTML of a localhost request.
   *
   * Starting from `true` (no banner) keeps the first client render identical to
   * the server's; the real value is applied immediately afterwards.
   */
  const [secure, setSecure] = useState(true);
  const employeeId = employeeIdOf(user);
  const nextAction: 'check_in' | 'check_out' =
    lastEventType === 'check_in' ? 'check_out' : 'check_in';

  const selectedSite = useMemo(
    () => sites.find((s) => s.id === siteId) ?? null,
    [sites, siteId]
  );

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  // ---- Session restore -----------------------------------------------------

  useEffect(() => {
    const storedToken = localStorage.getItem('accessToken');
    const storedUser = localStorage.getItem('user');

    if (!storedToken || !storedUser) {
      setStage('login');
      return;
    }

    try {
      const parsed = JSON.parse(storedUser) as StoredUser;
      setToken(storedToken);
      setUser(parsed);
      setStage('ready');
    } catch {
      // A corrupt entry would otherwise wedge the page on every load.
      localStorage.removeItem('accessToken');
      localStorage.removeItem('user');
      setStage('login');
    }
  }, []);

  // Start waking the backend immediately. On a free tier that stops idle
  // containers this runs while the worker signs in and frames their face, so
  // the submit itself rarely waits for a cold start. See api.warmUp().
  useEffect(() => {
    void api.warmUp();
    setSecure(window.isSecureContext);
  }, []);

  // Always release the camera when leaving the page, or the recording indicator
  // stays lit and the device keeps the lens busy for the next app.
  useEffect(() => stopCamera, [stopCamera]);

  const loadContext = useCallback(
    async (authToken: string, empId: string) => {
      setLoadingContext(true);
      setError('');
      try {
        const [siteList, employee, attendance] = await Promise.all([
          api.getSites(authToken),
          api.getEmployee(authToken, empId).catch(() => null),
          api.getEmployeeAttendance(authToken, empId).catch(() => []),
        ]);

        const available = asArray<SiteOption>(siteList);
        setSites(available);

        // Prefer the site the employee is assigned to; fall back to the only
        // site if there is exactly one, otherwise leave the choice to them.
        const assigned = (employee as { siteId?: string } | null)?.siteId;
        if (assigned && available.some((s) => s.id === assigned)) {
          setSiteId(assigned);
        } else if (available.length === 1) {
          setSiteId(available[0].id);
        } else {
          setSiteId('');
        }

        // The history endpoint orders by serverTimestamp DESC, so index 0 is
        // the latest event and decides whether this is a check-in or check-out.
        const events = asArray<{
          eventType?: string;
          serverTimestamp?: string;
        }>(attendance as never);
        setLastEventType(events[0]?.eventType ?? null);
        setLastEventAt(events[0]?.serverTimestamp ?? null);
      } catch (err) {
        setError((err as Error).message || 'Could not load your attendance details.');
      } finally {
        setLoadingContext(false);
      }
    },
    []
  );

  useEffect(() => {
    if (stage !== 'ready' || !token || !employeeId) return;
    void loadContext(token, employeeId);
  }, [stage, token, employeeId, loadContext]);

  // ---- Camera --------------------------------------------------------------

  useEffect(() => {
    if (stage !== 'ready' || !secure || !siteId) return;
    let cancelled = false;

    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError(
          'This browser will not expose a camera here. Camera access needs an https:// address.'
        );
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }
        setCameraError('');
      } catch (err) {
        const name = (err as Error)?.name;
        setCameraError(
          name === 'NotAllowedError'
            ? 'Camera permission was denied. Allow the camera for this site, then reload.'
            : name === 'NotFoundError'
              ? 'No camera was found on this device.'
              : 'Could not start the camera.'
        );
      }
    })();

    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [stage, secure, siteId, stopCamera]);

  /** Downscale to 640px wide so the base64 body stays small on a phone uplink. */
  const captureFaceImage = (): string | null => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return null;

    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 640 / video.videoWidth);
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);

    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.72);
  };

  const readPosition = () =>
    new Promise<GeolocationPosition>((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('This browser does not support location access.'));
        return;
      }
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
      });
    });

  // ---- Actions -------------------------------------------------------------

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoggingIn(true);
    setError('');
    try {
      const response = await api.login(email, password);
      const accessToken = (response as any).access_token || response.accessToken;
      const refreshToken = (response as any).refresh_token || response.refreshToken;

      localStorage.setItem('accessToken', accessToken);
      localStorage.setItem('refreshToken', refreshToken);
      localStorage.setItem('user', JSON.stringify(response.user));

      const nextUser = response.user as StoredUser;
      if (!employeeIdOf(nextUser)) {
        // An admin/HR account has no employee record, so there is nothing to
        // check in. Say so plainly instead of failing later on a missing id.
        setError(
          'This account is not linked to an employee record, so it cannot check in. Sign in with your employee account.'
        );
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
        localStorage.removeItem('user');
        return;
      }

      setToken(accessToken);
      setUser(nextUser);
      setStage('ready');
    } catch (err) {
      setError((err as Error).message || 'Sign in failed.');
    } finally {
      setLoggingIn(false);
    }
  };

  const handleSignOut = () => {
    stopCamera();
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('user');
    setToken(null);
    setUser(null);
    setResult(null);
    setError('');
    setStage('login');
  };

  const handleSubmit = async () => {
    if (!token || !employeeId || !siteId) return;
    setSubmitting(true);
    setError('');

    try {
      const position = await readPosition();
      const { latitude, longitude, accuracy } = position.coords;

      // Advisory geofence pre-check: block only on an explicit "outside"
      // verdict. A thrown error (e.g. a site with no geofence configured) is
      // not a rejection, so it falls through to the server.
      try {
        const check = await api.validateGeofence(token, siteId, latitude, longitude);
        if (check && check.withinGeofence === false) {
          throw new Error(
            `You are about ${Math.round(check.distance ?? 0)} m from ${
              selectedSite?.name ?? 'the site'
            }. Move closer and try again.`
          );
        }
      } catch (preCheckErr) {
        if ((preCheckErr as Error).message?.startsWith('You are about')) {
          throw preCheckErr;
        }
        // Otherwise ignore: the pre-check is advisory, the server is authority.
      }

      const faceImage = captureFaceImage();
      if (!faceImage) {
        throw new Error(
          'Could not capture a photo. Make sure the camera preview is showing, then try again.'
        );
      }

      const payload = {
        employeeId,
        siteId,
        latitude,
        longitude,
        faceImage,
        deviceIdentifier: 'web-checkin',
      };

      const response =
        nextAction === 'check_in'
          ? await api.checkIn(token, payload)
          : await api.checkOut(token, payload);

      stopCamera();
      setResult({
        message: response.message,
        eventType: response.eventType,
        timestamp: String(response.timestamp),
      });
      setStage('done');
    } catch (err) {
      // A GeolocationPositionError has a numeric `code`; API errors do not.
      const message =
        typeof (err as GeolocationPositionError)?.code === 'number'
          ? describeGeoError(err)
          : (err as Error).message || 'Something went wrong. Please try again.';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  // ---- Render --------------------------------------------------------------

  const header = (
    <div className="flex flex-col items-center gap-3 mb-6">
      <div className="h-12 w-[10.5rem] bg-white rounded-lg border border-silver-200 flex items-center justify-center px-3 py-2">
        <img
          src="/klassiclogo.png"
          alt="Klassic Solutions"
          className="w-full h-full object-contain"
        />
      </div>
      <p className="text-sm text-muted">Field Attendance</p>
    </div>
  );

  return (
    <div className="min-h-screen bg-page flex flex-col items-center p-4 py-8">
      <div className="w-full max-w-md">
        {header}

        {!secure && (
          <div
            role="alert"
            className="mb-4 flex items-start gap-2 p-3 text-sm text-warning-700 bg-warning-50 border border-warning-200 rounded-lg"
          >
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>
              This page is not on a secure connection, so the browser will block
              the camera and location. Open it over <strong>https://</strong>
              {' '}(or on <code>localhost</code>) to check in.
            </span>
          </div>
        )}

        {/* ---- Login ---- */}
        {stage === 'login' && (
          <Card className="border-silver-200 shadow-sm">
            <CardHeader className="space-y-1">
              <CardTitle className="text-xl text-center">Check in</CardTitle>
              <CardDescription className="text-center">
                Sign in with your employee account
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleLogin} className="space-y-4">
                {error && (
                  <div
                    role="alert"
                    className="flex items-start gap-2 p-3 text-sm text-critical-600 bg-critical-50 border border-critical-200 rounded-lg"
                  >
                    <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                    <span>{error}</span>
                  </div>
                )}
                <div className="space-y-1.5">
                  <label htmlFor="email" className="text-sm font-medium text-ink">
                    Email
                  </label>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    disabled={loggingIn}
                    autoComplete="username"
                    placeholder="juan.delacruz@klassic.ph"
                  />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="password" className="text-sm font-medium text-ink">
                    Password
                  </label>
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    disabled={loggingIn}
                    autoComplete="current-password"
                    placeholder="••••••••"
                  />
                </div>
                <Button type="submit" className="w-full" disabled={loggingIn}>
                  {loggingIn ? (
                    <span className="flex items-center gap-2">
                      <Loader2 className="animate-spin h-4 w-4" />
                      Signing in...
                    </span>
                  ) : (
                    'Sign In'
                  )}
                </Button>
              </form>
            </CardContent>
          </Card>
        )}

        {/* ---- Booting ---- */}
        {stage === 'booting' && (
          <Card className="border-silver-200 shadow-sm">
            <CardContent className="py-10 flex items-center justify-center text-muted">
              <Loader2 className="animate-spin h-5 w-5" />
            </CardContent>
          </Card>
        )}

        {/* ---- Ready ---- */}
        {stage === 'ready' && (
          <div className="space-y-4">
            <Card className="border-silver-200 shadow-sm">
              <CardContent className="pt-5 space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-ink">{displayName(user)}</p>
                    <p className="text-xs text-muted">{user?.email}</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleSignOut}
                    title="Sign out"
                  >
                    <LogOut className="h-4 w-4" />
                  </Button>
                </div>

                {lastEventType && (
                  <div className="flex items-center gap-2 text-sm text-muted">
                    <CheckCircle2 className="h-4 w-4 text-brand-600" />
                    <span>
                      Last {lastEventType === 'check_in' ? 'check-in' : 'check-out'} at{' '}
                      {formatClock(lastEventAt || undefined)}
                    </span>
                  </div>
                )}

                <div className="space-y-1.5">
                  <label htmlFor="site" className="text-sm font-medium text-ink">
                    Site
                  </label>
                  {sites.length > 1 ? (
                    <Select
                      id="site"
                      value={siteId}
                      onChange={(e) => setSiteId(e.target.value)}
                      disabled={loadingContext || submitting}
                    >
                      <option value="">Select a site…</option>
                      {sites.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <div className="flex items-center gap-2 h-10 px-3 rounded-lg border border-silver-200 bg-silver-50 text-sm text-ink">
                      <MapPin className="h-4 w-4 text-brand-600 shrink-0" />
                      <span>
                        {loadingContext
                          ? 'Loading…'
                          : selectedSite?.name || 'No site assigned to your account'}
                      </span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card className="border-silver-200 shadow-sm overflow-hidden">
              <CardContent className="p-0">
                <div className="relative bg-silver-900 aspect-[4/3]">
                  <video
                    ref={videoRef}
                    playsInline
                    muted
                    autoPlay
                    className="w-full h-full object-cover"
                  />
                  {cameraError && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
                      <Camera className="h-7 w-7 text-silver-400" />
                      <p className="text-sm text-silver-300">{cameraError}</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {error && (
              <div
                role="alert"
                className="flex items-start gap-2 p-3 text-sm text-critical-600 bg-critical-50 border border-critical-200 rounded-lg"
              >
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <Button
              className="w-full"
              size="lg"
              onClick={handleSubmit}
              disabled={submitting || loadingContext || !siteId || !secure}
            >
              {submitting ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="animate-spin h-4 w-4" />
                  Verifying…
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  {nextAction === 'check_in' ? (
                    <MapPin className="h-4 w-4" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4" />
                  )}
                  {nextAction === 'check_in' ? 'Check In' : 'Check Out'}
                </span>
              )}
            </Button>

            <p className="text-xs text-center text-muted">
              Your location and a photo are sent to verify this event.
            </p>
          </div>
        )}

        {/* ---- Done ---- */}
        {stage === 'done' && result && (
          <Card className="border-silver-200 shadow-sm">
            <CardContent className="pt-6 space-y-4 text-center">
              <div className="flex justify-center">
                <div className="h-14 w-14 rounded-full bg-brand-50 flex items-center justify-center">
                  <CheckCircle2 className="h-7 w-7 text-brand-600" />
                </div>
              </div>
              <div>
                <p className="text-lg font-semibold text-ink">
                  {result.eventType === 'check_in' ? 'Checked in' : 'Checked out'}
                </p>
                <p className="text-sm text-muted mt-1">
                  {formatClock(result.timestamp)} ·{' '}
                  {selectedSite?.name ?? 'your site'}
                </p>
              </div>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => {
                  setResult(null);
                  setError('');
                  setStage('ready');
                }}
              >
                <span className="flex items-center gap-2">
                  <RefreshCw className="h-4 w-4" />
                  Done
                </span>
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
