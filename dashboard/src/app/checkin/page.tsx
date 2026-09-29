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
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { ApiError, api } from '@/lib/api';
import {
  SessionUser,
  clearSession,
  displayName,
  employeeIdOf,
  homeForRole,
  isEmployeeRole,
  markPasswordChanged,
  mustChangePassword,
  readSession,
} from '@/lib/auth';
import {
  AlertCircle,
  Camera,
  CheckCircle2,
  KeyRound,
  Loader2,
  LogOut,
  MapPin,
  RefreshCw,
} from 'lucide-react';

interface SiteOption {
  id: string;
  name: string;
  geofenceRadiusM?: number | null;
}

/**
 * `booting` is the session check, `set_password` the temporary-password gate.
 *
 * There is deliberately no `login` stage: this page has no sign-in form of its
 * own. Signing in happens once, at "/", which routes here by role.
 */
type Stage = 'booting' | 'set_password' | 'ready' | 'done';

/** `GET /sites` and `GET /employees` return a bare array, but the API client
 *  types them as a union with a paginated envelope. Normalise once, here. */
function asArray<T>(value: T[] | { data: T[] } | undefined | null): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : (value.data ?? []);
}

/**
 * The server refused because the account is still on a temporary password.
 *
 * This can happen mid-session: an administrator resetting a password sets the
 * flag again, and the next request fails even though the page was already
 * showing the check-in screen. Detecting the specific code keeps that from
 * surfacing as a confusing "forbidden" error on a working account.
 */
function isPasswordChangeRequired(err: unknown): boolean {
  return err instanceof ApiError && err.code === 'PASSWORD_CHANGE_REQUIRED';
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
  const router = useRouter();
  const [stage, setStage] = useState<Stage>('booting');
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<SessionUser | null>(null);

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
   * Setting a password.
   *
   * `forced` is true when the account is still on the administrator-issued
   * temporary password, in which case there is no way past this screen and no
   * current password is asked for -- holding a session already proves it was
   * known. A voluntary change asks for the current password.
   */
  const [forced, setForced] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState('');

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
    const session = readSession();

    // Nothing stored: this page is not a front door. The single sign-in page
    // at "/" is, and it routes back here for an employee account.
    if (!session) {
      router.replace('/');
      return;
    }

    /*
     * A valid session, but not an employee one. Send them to their own screen
     * rather than signing them out -- they are signed in, just not here. An
     * administrator has no employee record, so there is nothing to check in.
     */
    if (!isEmployeeRole(session.user.role)) {
      router.replace(homeForRole(session.user.role));
      return;
    }

    setToken(session.token);
    setUser(session.user);

    /*
     * Still on the administrator-issued temporary password. The server refuses
     * every other endpoint in this state, so there is nothing useful to show
     * before this is dealt with -- go straight to the screen that resolves it.
     */
    if (mustChangePassword(session.user)) {
      setForced(true);
      setStage('set_password');
      return;
    }

    setStage('ready');
  }, [router]);

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
        if (isPasswordChangeRequired(err)) {
          setForced(true);
          setStage('set_password');
          return;
        }
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

  const handleSignOut = () => {
    stopCamera();
    clearSession();
    setToken(null);
    setUser(null);
    setResult(null);
    setError('');
    // Back to the single sign-in page; this page cannot sign anyone in.
    router.replace('/');
  };

  /** Open the change-password screen for a voluntary change. */
  const openVoluntaryPasswordChange = () => {
    setForced(false);
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setPasswordError('');
    setStage('set_password');
  };

  const handleSetPassword = async () => {
    if (!token) return;
    setPasswordError('');

    // Checked here as well as on the server so the obvious mistakes get an
    // instant answer instead of a round trip.
    if (newPassword !== confirmPassword) {
      setPasswordError('The two new passwords do not match.');
      return;
    }
    if (newPassword.length < 8) {
      setPasswordError('Your new password must be at least 8 characters.');
      return;
    }
    if (!forced && !currentPassword) {
      setPasswordError('Enter your current password.');
      return;
    }

    setSavingPassword(true);
    try {
      await api.changePassword(
        token,
        newPassword,
        forced ? undefined : currentPassword
      );

      setUser(markPasswordChanged(user ?? {}));
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setForced(false);
      setStage('ready');
    } catch (err) {
      setPasswordError(
        (err as Error).message || 'Could not change your password.'
      );
    } finally {
      setSavingPassword(false);
    }
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
      if (isPasswordChangeRequired(err)) {
        setForced(true);
        setStage('set_password');
        return;
      }
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

        {/*
          No sign-in form here. This page shows a spinner while it checks the
          session, then either the check-in screen or a redirect to "/".
        */}

        {/* ---- Booting ---- */}
        {stage === 'booting' && (
          <Card className="border-silver-200 shadow-sm">
            <CardContent className="py-10 flex items-center justify-center text-muted">
              <Loader2 className="animate-spin h-5 w-5" />
            </CardContent>
          </Card>
        )}

        {/* ---- Set your own password ---- */}
        {stage === 'set_password' && (
          <Card className="border-silver-200 shadow-sm">
            <CardContent className="pt-5 space-y-4">
              <div className="flex items-start gap-3">
                <div className="h-9 w-9 rounded-full bg-brand-50 flex items-center justify-center shrink-0">
                  <KeyRound className="h-4 w-4 text-brand-600" />
                </div>
                <div>
                  <p className="font-medium text-ink">Choose your own password</p>
                  <p className="text-xs text-muted mt-1">
                    {forced
                      ? 'Your administrator sent you a temporary password. Set your own to continue — the temporary one will stop working.'
                      : 'Enter your current password, then choose a new one.'}
                  </p>
                </div>
              </div>

              {passwordError && (
                <div
                  role="alert"
                  className="flex items-start gap-2 p-3 text-sm text-critical-600 bg-critical-50 border border-critical-200 rounded-lg"
                >
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>{passwordError}</span>
                </div>
              )}

              {/*
                Only asked for on a voluntary change. While the account is on a
                temporary password the session already proves it was known, and
                demanding it again would mean retyping a random 12-character
                string from an email on a phone keypad.
              */}
              {!forced && (
                <div className="space-y-1.5">
                  <label htmlFor="current-password" className="text-sm font-medium text-ink">
                    Current password
                  </label>
                  <Input
                    id="current-password"
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    disabled={savingPassword}
                    autoComplete="current-password"
                    placeholder="••••••••"
                  />
                </div>
              )}

              <div className="space-y-1.5">
                <label htmlFor="new-password" className="text-sm font-medium text-ink">
                  New password
                </label>
                <Input
                  id="new-password"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  disabled={savingPassword}
                  autoComplete="new-password"
                  placeholder="••••••••"
                />
                <p className="text-xs text-muted">At least 8 characters.</p>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="confirm-password" className="text-sm font-medium text-ink">
                  Confirm new password
                </label>
                <Input
                  id="confirm-password"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={savingPassword}
                  autoComplete="new-password"
                  placeholder="••••••••"
                />
              </div>

              <Button
                className="w-full"
                size="lg"
                onClick={handleSetPassword}
                disabled={savingPassword || !newPassword || !confirmPassword}
              >
                {savingPassword ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="animate-spin h-4 w-4" />
                    Saving…
                  </span>
                ) : (
                  'Save password'
                )}
              </Button>

              {!forced ? (
                <Button
                  variant="ghost"
                  className="w-full"
                  onClick={() => setStage('ready')}
                  disabled={savingPassword}
                >
                  Cancel
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  className="w-full"
                  onClick={handleSignOut}
                  disabled={savingPassword}
                >
                  <span className="flex items-center gap-2">
                    <LogOut className="h-4 w-4" />
                    Sign out
                  </span>
                </Button>
              )}
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
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={openVoluntaryPasswordChange}
                      title="Change password"
                    >
                      <KeyRound className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleSignOut}
                      title="Sign out"
                    >
                      <LogOut className="h-4 w-4" />
                    </Button>
                  </div>
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
