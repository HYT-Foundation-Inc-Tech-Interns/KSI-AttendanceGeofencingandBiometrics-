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
 *  2. Face capture happens on the device. `@vladmandic/face-api` turns the
 *     camera frame into a 128-d descriptor locally and only that vector is
 *     sent -- see `@/lib/face`. The server makes the match decision; a client
 *     that could decide for itself could simply claim a match. If the models
 *     fail to load, the page falls back to sending a JPEG frame so a phone
 *     with a bad connection is not locked out entirely.
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
// `MapPin` is already the lucide icon in this file, so the map's pin type
// arrives aliased.
import GeoMap, {
  type MapFence,
  type MapPin as GeoMapPin,
} from '@/components/geo-map';
import { ApiError, api } from '@/lib/api';
import {
  FaceCaptureResult,
  FaceReading,
  areFaceModelsReady,
  captureFaceDescriptor,
  detectFaces,
  loadFaceModels,
} from '@/lib/face';
import { getDeviceId } from '@/lib/device';
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

/** Short calendar date, for naming the day a past punch happened on. */
function formatDay(iso: string | Date | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

/**
 * The Asia/Manila calendar date of an instant, as `YYYY-MM-DD`.
 *
 * The server allows one check-in and one check-out per Asia/Manila day, and
 * Manila is a fixed UTC+8 with no daylight saving, so this is a constant shift
 * -- the same one the server's rule uses. The screen has to count the day the
 * same way the server does, or it will offer a button the server refuses.
 */
function manilaDateKey(iso: string | Date): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return new Date(d.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
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

/**
 * A short human label for this handset, stored with the enrollment so an
 * administrator looking at the record can tell which device a face belongs
 * to. Only coarse platform and browser names are derived -- nothing that
 * identifies the person or the exact device.
 */
function describeDevice(): string {
  if (typeof navigator === 'undefined') return 'Unknown Device';

  const ua = navigator.userAgent;
  const platform = /iPhone|iPad|iPod/.test(ua)
    ? 'iOS'
    : /Android/.test(ua)
      ? 'Android'
      : /Windows/.test(ua)
        ? 'Windows'
        : /Mac OS X/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : 'Unknown';

  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\//.test(ua)
      ? 'Opera'
      : /Chrome\//.test(ua)
        ? 'Chrome'
        : /Safari\//.test(ua)
          ? 'Safari'
          : /Firefox\//.test(ua)
            ? 'Firefox'
            : 'browser';

  return `${platform} ${browser}`;
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

  /*
   * Today's punches, counted in the site's local day.
   *
   * The server allows one check-in and one check-out per Asia/Manila day. The
   * screen used to read only the most recent event of any age, so someone who
   * had already timed in and out today was still shown a "Check In" button --
   * which the server then refused, and someone who forgot to time out
   * yesterday was shown "Check Out". Both are the button lying about what is
   * possible, so the screen now counts the same day the server enforces.
   */
  const [todayPunches, setTodayPunches] = useState<{
    checkInAt: string | null;
    checkOutAt: string | null;
  }>({ checkInAt: null, checkOutAt: null });
  const [loadingContext, setLoadingContext] = useState(false);

  /*
   * Location preview.
   *
   * The submit path reads the position again and the server validates it
   * again -- nothing here is trusted. This exists so a worker standing outside
   * the fence finds out while they can still walk closer, instead of after
   * they have posed for a photo. The verdict comes from the same
   * `validateGeofence` endpoint the submit consults, so the map cannot promise
   * something the punch will then refuse.
   */
  const [geofence, setGeofence] = useState<{
    site_id: string;
    site_name: string;
    geofence_center?: { latitude: number; longitude: number };
    geofence_radius_m?: number | null;
    geofence_polygon?: { type: 'Polygon'; coordinates: number[][][] } | null;
  } | null>(null);
  const [myPosition, setMyPosition] = useState<{
    latitude: number;
    longitude: number;
    accuracy: number;
  } | null>(null);
  const [geofenceCheck, setGeofenceCheck] = useState<{
    /* Carries its own site, so switching sites cannot leave a stale verdict
       on screen while the new one is still being fetched. */
    siteId: string;
    withinGeofence: boolean;
    distance?: number;
    /* How far the fence was widened by the fix's own reported accuracy. Shown
       so a worker can tell a real "move closer" from a weak GPS signal. */
    allowanceMeters?: number;
  } | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState('');

  // Capture
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState('');

  /*
   * Face recognition state.
   *
   * `faceModelState` tracks the 6.8 MB of model weights; check-in cannot be
   * face-verified until they are loaded, so the UI says so instead of letting
   * the user press a button that will fail.
   *
   * `faceStatus` is the live "are you framed" reading, refreshed on a short
   * interval. It runs the same gates the capture does, so it can say why a
   * frame is unusable while there is still time to move -- rather than only
   * after the button is pressed. The capture remains authoritative.
   */
  const [faceModelState, setFaceModelState] = useState<
    'idle' | 'loading' | 'ready' | 'error'
  >('idle');
  const [faceModelError, setFaceModelError] = useState('');
  const [faceStatus, setFaceStatus] = useState<FaceReading | null>(null);

  /*
   * The model load must start exactly once, and must survive the effect
   * re-running.
   *
   * This is subtle enough to be worth spelling out, because getting it wrong is
   * silent. The effect below sets `faceModelState` synchronously, and if that
   * state is also in its own dependency array, React re-runs the effect, runs
   * the previous invocation's cleanup, and marks the in-flight load cancelled.
   * When the weights then finish downloading, the resolved promise discards its
   * own result -- so the UI sits on "Preparing face recognition..." forever
   * while the 6.8 MB has in fact arrived. `faceLoadStartedRef` makes the load
   * once-only, and `mountedRef` is the only cancellation actually wanted:
   * leaving the page.
   */
  const faceLoadStartedRef = useRef(false);
  const mountedRef = useRef(true);

  /*
   * Whether this employee already has a face on file. `null` means "not
   * checked yet", which is distinct from "no enrollment" -- showing the
   * register-your-face prompt before the answer is known would flash it at
   * everyone on every load.
   */
  const [hasEnrollment, setHasEnrollment] = useState<boolean | null>(null);
  const [enrolling, setEnrolling] = useState(false);
  const [enrollMessage, setEnrollMessage] = useState('');

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
  /*
   * What is still possible today, mirroring the server's rule exactly: one
   * check-in, then one check-out, then nothing more until tomorrow.
   */
  const nextAction: 'check_in' | 'check_out' | 'done' = todayPunches.checkOutAt
    ? 'done'
    : todayPunches.checkInAt
      ? 'check_out'
      : 'check_in';

  const selectedSite = useMemo(
    () => sites.find((s) => s.id === siteId) ?? null,
    [sites, siteId]
  );

  /*
   * Plain-language framing advice for the overlay.
   *
   * Phrased as instructions rather than status codes: "Move closer" is
   * actionable, "score 0.42" is not. The wording comes from the capture gates
   * themselves, so the overlay cannot promise a capture that would then fail.
   */
  const framing = useMemo(() => {
    if (faceModelState === 'idle' || faceModelState === 'loading') {
      return { tone: 'muted' as const, text: 'Preparing face recognition…' };
    }
    if (faceModelState === 'error') {
      return {
        tone: 'warn' as const,
        text: 'Face recognition unavailable — check-in will still be attempted',
      };
    }
    if (!faceStatus) {
      return { tone: 'muted' as const, text: 'Looking for your face…' };
    }
    if (faceStatus.problem) {
      return { tone: 'warn' as const, text: faceStatus.problem };
    }
    return { tone: 'ok' as const, text: 'Face detected' };
  }, [faceModelState, faceStatus]);

  /*
   * Check-in needs a face on file before the server can verify one. While the
   * models are still loading (or failed to load) this is not enforced, so a
   * phone that cannot download them is not locked out of checking in.
   */
  const needsEnrollment = faceModelState === 'ready' && hasEnrollment === false;

  /*
   * While the models are still downloading, submitting would silently fall
   * back to sending an image -- which the server cannot match against a
   * descriptor enrollment, producing a confusing rejection. Better to wait.
   * An *error* state is different: the fallback is then the only option, so
   * the button stays available.
   */
  const faceBlocking =
    faceModelState === 'idle' || faceModelState === 'loading' || needsEnrollment;

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
        // the latest event, whatever day it fell on.
        const events = asArray<{
          eventType?: string;
          serverTimestamp?: string;
          status?: string;
        }>(attendance as never);
        setLastEventType(events[0]?.eventType ?? null);
        setLastEventAt(events[0]?.serverTimestamp ?? null);

        /*
         * Today only, and ignoring anything voided or flagged -- exactly the
         * rows the server counts toward the day. A punch an administrator
         * voided must stop counting here too, or the screen would keep
         * refusing an action the server would now allow.
         */
        const today = manilaDateKey(new Date());
        const todays = events.filter(
          (e) =>
            !!e.serverTimestamp &&
            manilaDateKey(e.serverTimestamp) === today &&
            e.status !== 'rejected' &&
            e.status !== 'flagged'
        );

        setTodayPunches({
          checkInAt:
            todays.find((e) => e.eventType === 'check_in')?.serverTimestamp ??
            null,
          checkOutAt:
            todays.find((e) => e.eventType === 'check_out')?.serverTimestamp ??
            null,
        });
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

  /*
   * Load the face models as soon as the camera is up.
   *
   * Started here rather than on submit so the 6.8 MB download overlaps with
   * the worker picking a site and framing their face, instead of being a
   * dead wait at the end.
   */
  useEffect(() => {
    if (stage !== 'ready' || !secure || !siteId) return;
    if (faceLoadStartedRef.current) return;
    faceLoadStartedRef.current = true;

    setFaceModelState('loading');

    loadFaceModels()
      .then(() => {
        if (!mountedRef.current) return;
        setFaceModelState('ready');
        setFaceModelError('');
      })
      .catch((err: Error) => {
        if (!mountedRef.current) return;
        setFaceModelState('error');
        setFaceModelError(err?.message || 'Face recognition could not be loaded.');
      });
    /*
     * Deliberately no `faceModelState` dependency and no cleanup: this load is
     * not tied to any value in the array, and cancelling it on a dependency
     * change is exactly the bug described above.
     */
  }, [stage, secure, siteId]);

  /*
   * Track unmount. Re-asserting `true` on mount keeps this correct under
   * React's development-mode double-invocation, where the effect is mounted,
   * torn down, and mounted again.
   */
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /*
   * Does this employee already have a face enrolled?
   *
   * Only asked once the models are ready, because the answer only matters for
   * the face-verified path.
   */
  useEffect(() => {
    if (stage !== 'ready' || !token || !employeeId) return;
    if (faceModelState !== 'ready') return;
    if (hasEnrollment !== null) return;

    let cancelled = false;

    api
      .getFaceEnrollments(token, employeeId)
      .then((enrollments) => {
        if (cancelled) return;
        const active = (enrollments ?? []).filter(
          (enrollment) => !enrollment.isRevoked && enrollment.hasDescriptor
        );
        setHasEnrollment(active.length > 0);
      })
      .catch(() => {
        if (cancelled) return;
        /*
         * Treat an unreadable answer as "already enrolled" rather than
         * blocking the worker behind a registration screen that may be
         * pointless. The server still refuses a check-in it cannot verify.
         */
        setHasEnrollment(true);
      });

    return () => {
      cancelled = true;
    };
  }, [stage, token, employeeId, faceModelState, hasEnrollment]);

  /*
   * Live framing feedback.
   *
   * Runs about once a second while the camera is up. Without it the worker
   * gets no signal until they press the button and are told the capture was
   * unusable, which is a poor loop on a phone.
   */
  useEffect(() => {
    if (stage !== 'ready' || !secure || !siteId) return;
    if (faceModelState !== 'ready' || cameraError) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      const video = videoRef.current;
      if (video && video.videoWidth && !cancelled) {
        // `detectFaces` reports its own failures as a `problem` string rather
        // than throwing, so a bad poll just becomes advice in the overlay.
        const reading = await detectFaces(video);
        if (!cancelled) setFaceStatus(reading);
      }
      if (!cancelled) timer = setTimeout(poll, 900);
    };

    timer = setTimeout(poll, 600);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [stage, secure, siteId, faceModelState, cameraError]);

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

  /**
   * How good a fix must be before we stop waiting for a better one, in metres.
   */
  const GOOD_FIX_ACCURACY_M = 25;

  /**
   * How long to keep watching for a better fix before settling for the best so
   * far. Long enough for a cold GPS lock outdoors, short enough that a worker
   * is not left staring at a spinner.
   */
  const BEST_FIX_WAIT_MS = 10000;

  /**
   * Read the best position available, rather than the first one offered.
   *
   * `getCurrentPosition` resolves with whatever the handset has at that moment.
   * On a cold start that is routinely a Wi-Fi or cell-tower fix a hundred
   * metres out, with `accuracy` admitting as much -- and treating that as an
   * exact point is what told people standing inside the building that they were
   * not there. So this keeps watching until the fix is good enough or the wait
   * runs out, and always resolves with the most accurate fix it saw rather than
   * the most recent.
   */
  const readPosition = () =>
    new Promise<GeolocationPosition>((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('This browser does not support location access.'));
        return;
      }

      let best: GeolocationPosition | null = null;
      let lastError: unknown = null;
      let watchId = 0;
      let timer: ReturnType<typeof setTimeout> | null = null;
      let settled = false;

      const finish = () => {
        if (settled) return;
        settled = true;
        navigator.geolocation.clearWatch(watchId);
        if (timer) clearTimeout(timer);

        if (best) resolve(best);
        else reject(lastError ?? new Error('Could not determine your location.'));
      };

      watchId = navigator.geolocation.watchPosition(
        (position) => {
          if (!best || position.coords.accuracy < best.coords.accuracy) {
            best = position;
          }
          if (position.coords.accuracy <= GOOD_FIX_ACCURACY_M) finish();
        },
        (error) => {
          lastError = error;
          // A denial will never improve by waiting for it.
          if (error.code === 1) finish();
        },
        { enableHighAccuracy: true, timeout: BEST_FIX_WAIT_MS, maximumAge: 0 },
      );

      timer = setTimeout(finish, BEST_FIX_WAIT_MS);
    });

  /**
   * Read the position and ask the server where it falls, for display only.
   *
   * `validateGeofence` throws for a site with no geofence configured. That is
   * not an error worth showing -- it means there is no boundary to draw -- so
   * the verdict is cleared and the map falls back to showing the position on
   * its own.
   */
  const refreshLocation = useCallback(async () => {
    if (!token || !siteId) return;

    setLocating(true);
    setLocationError('');

    try {
      const position = await readPosition();
      const { latitude, longitude, accuracy } = position.coords;
      setMyPosition({ latitude, longitude, accuracy });

      try {
        const check = await api.validateGeofence(
          token,
          siteId,
          latitude,
          longitude,
          accuracy,
        );
        setGeofenceCheck({
          siteId,
          withinGeofence: check.withinGeofence,
          distance: check.distance,
          allowanceMeters: check.allowanceMeters,
        });
      } catch {
        setGeofenceCheck(null);
      }
    } catch (err) {
      setLocationError(describeGeoError(err));
    } finally {
      setLocating(false);
    }
    // `readPosition` closes over browser APIs only, not over props or state, so
    // it is not a reactive dependency of this callback.
  }, [token, siteId]);

  /** The selected site's fence, to draw. Never used to decide anything. */
  useEffect(() => {
    if (!token || !siteId) return;

    let cancelled = false;

    (async () => {
      try {
        const data = await api.getSiteGeofence(token, siteId);
        if (!cancelled) setGeofence(data);
      } catch {
        if (!cancelled) setGeofence(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token, siteId]);

  /*
   * Ask for the position as soon as the screen is usable.
   *
   * The punch needs the location regardless, so prompting here is the same
   * conversation held earlier -- and earlier is the only moment it can still
   * change the worker's mind about walking closer.
   *
   * Deferred by a tick because `refreshLocation` sets the "locating" flag
   * before its first await; calling it straight from the effect body would be
   * a synchronous setState during an effect, which cascades a render for
   * nothing.
   */
  useEffect(() => {
    if (stage !== 'ready' || !secure || !siteId || !token) return;

    const timer = setTimeout(() => void refreshLocation(), 0);
    return () => clearTimeout(timer);
  }, [stage, secure, siteId, token, refreshLocation]);

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

  /**
   * Grab the face for a request.
   *
   * Prefers the descriptor. Falls back to a JPEG frame only when the models
   * could not be loaded, so a phone that cannot download them is not locked
   * out entirely -- the server then decides what it can do with an image
   * (nothing, if the employee is enrolled by descriptor, which is the honest
   * answer rather than a silent pass).
   */
  const captureFace = async (): Promise<{
    faceDescriptor?: number[];
    faceImage?: string;
    captureImage?: string;
  }> => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) {
      throw new Error(
        'Could not capture a photo. Make sure the camera preview is showing, then try again.'
      );
    }

    if (areFaceModelsReady()) {
      const result: FaceCaptureResult = await captureFaceDescriptor(video);
      if (result.ok) {
        /*
         * `captureImage` is the cropped face frame filed with the record. It is
         * best-effort and may be null; the descriptor is what decides the
         * outcome, so a missing thumbnail never blocks a punch.
         */
        return {
          faceDescriptor: result.descriptor,
          captureImage: result.captureImage ?? undefined,
        };
      }
      throw new Error(result.message);
    }

    const faceImage = captureFaceImage();
    if (!faceImage) {
      throw new Error(
        'Could not capture a photo. Make sure the camera preview is showing, then try again.'
      );
    }
    return { faceImage };
  };

  const handleEnroll = async () => {
    if (!token || !employeeId) return;
    setEnrolling(true);
    setError('');
    setEnrollMessage('');

    try {
      const face = await captureFace();

      if (!face.faceDescriptor) {
        throw new Error(
          'Face recognition is still loading. Give it a moment and try again.'
        );
      }

      await api.enrollFace(token, {
        employeeId,
        faceDescriptor: face.faceDescriptor,
        captureImage: face.captureImage,
        deviceIdentifier: getDeviceId(),
        deviceName: describeDevice(),
      });

      setHasEnrollment(true);
      setEnrollMessage('Face saved. You can check in now.');
    } catch (err) {
      if (isPasswordChangeRequired(err)) {
        setForced(true);
        setStage('set_password');
        return;
      }
      setError((err as Error).message || 'Could not save your face. Please try again.');
    } finally {
      setEnrolling(false);
    }
  };

  const handleSubmit = async () => {
    if (!token || !employeeId || !siteId) return;
    // Nothing is possible once the day's pair is used up; the button is
    // replaced by the done panel, and this is the backstop.
    if (nextAction === 'done') return;
    setSubmitting(true);
    setError('');

    try {
      const position = await readPosition();
      const { latitude, longitude, accuracy } = position.coords;

      // Advisory geofence pre-check: block only on an explicit "outside"
      // verdict. A thrown error (e.g. a site with no geofence configured) is
      // not a rejection, so it falls through to the server.
      try {
        const check = await api.validateGeofence(
          token,
          siteId,
          latitude,
          longitude,
          accuracy,
        );
        if (check && check.withinGeofence === false) {
          const allowance = check.allowanceMeters ?? 0;
          throw new Error(
            `You are about ${Math.round(check.distance ?? 0)} m from ${
              selectedSite?.name ?? 'the site'
            }` +
              (allowance > 0
                ? ` (already allowing for GPS accuracy of about ${Math.round(allowance)} m)`
                : '') +
              '. Move closer and try again.'
          );
        }
      } catch (preCheckErr) {
        if ((preCheckErr as Error).message?.startsWith('You are about')) {
          throw preCheckErr;
        }
        // Otherwise ignore: the pre-check is advisory, the server is authority.
      }

      const face = await captureFace();

      const payload = {
        employeeId,
        siteId,
        latitude,
        longitude,
        // Sent so the server can widen the fence by the fix's own uncertainty
        // and record how much of the verdict was GPS noise.
        accuracyMeters: accuracy,
        ...face,
        deviceIdentifier: getDeviceId(),
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

  /*
   * Both the fence and the verdict are tied to the site they were fetched
   * for. Without that check, switching sites would leave the previous
   * boundary on screen and a stale "you are inside" next to it -- which is
   * exactly the reassurance that would send someone away from the fence.
   */
  const check = geofenceCheck && geofenceCheck.siteId === siteId ? geofenceCheck : null;

  const mapFences: MapFence[] = [];
  if (geofence && geofence.site_id === siteId) {
    const ring = geofence.geofence_polygon?.coordinates?.[0];
    if (ring && ring.length >= 3) {
      mapFences.push({
        id: geofence.site_id,
        name: geofence.site_name,
        latitude: geofence.geofence_center?.latitude ?? 0,
        longitude: geofence.geofence_center?.longitude ?? 0,
        polygon: ring,
      });
    } else if (geofence.geofence_center) {
      mapFences.push({
        id: geofence.site_id,
        name: geofence.site_name,
        latitude: geofence.geofence_center.latitude,
        longitude: geofence.geofence_center.longitude,
        radiusM: geofence.geofence_radius_m ?? null,
      });
    }
  }

  const mapPins: GeoMapPin[] = myPosition
    ? [
        {
          id: 'me',
          latitude: myPosition.latitude,
          longitude: myPosition.longitude,
          label: 'You are here',
          // Falls back to the neutral "self" pin until the server has judged
          // this position, so an unverified point is never drawn as "inside".
          tone: !check ? 'self' : check.withinGeofence ? 'inside' : 'outside',
          detail:
            check && typeof check.distance === 'number'
              ? `${Math.round(check.distance)} m from the site centre`
              : undefined,
        },
      ]
    : [];

  const locationVerdict =
    !myPosition || !check ? null : check.withinGeofence ? (
      <div className="flex items-start gap-2 p-3 text-sm text-brand-700 bg-brand-50 border border-brand-200 rounded-lg">
        <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
        <span>
          You are inside {selectedSite?.name ?? 'the site'}
          {typeof check.distance === 'number'
            ? `, about ${Math.round(check.distance)} m from the centre`
            : ''}
          .
        </span>
      </div>
    ) : (
      <div className="flex items-start gap-2 p-3 text-sm text-critical-600 bg-critical-50 border border-critical-200 rounded-lg">
        <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
        <span>
          You are about {Math.round(check.distance ?? 0)} m from{' '}
          {selectedSite?.name ?? 'the site'} — outside its boundary. Move closer
          before checking in.
        </span>
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

                {todayPunches.checkInAt || todayPunches.checkOutAt ? (
                  <div className="flex items-center gap-2 text-sm text-muted">
                    <CheckCircle2 className="h-4 w-4 text-brand-600" />
                    <span>
                      Today:{' '}
                      {todayPunches.checkInAt
                        ? `timed in at ${formatClock(todayPunches.checkInAt)}`
                        : 'not timed in yet'}
                      {todayPunches.checkOutAt
                        ? `, timed out at ${formatClock(todayPunches.checkOutAt)}`
                        : ''}
                    </span>
                  </div>
                ) : lastEventType ? (
                  <div className="flex items-center gap-2 text-sm text-muted">
                    <CheckCircle2 className="h-4 w-4 text-brand-600" />
                    <span>
                      Last {lastEventType === 'check_in' ? 'check-in' : 'check-out'}{' '}
                      {formatDay(lastEventAt || undefined)} at{' '}
                      {formatClock(lastEventAt || undefined)}
                    </span>
                  </div>
                ) : null}

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

            {/*
              Where the worker is, relative to the site they are punching at.
              Drawn above the camera on purpose: someone standing outside the
              fence should learn that before they pose for a photo, not after
              the upload is refused.
            */}
            {siteId && (
              <Card className="border-silver-200 shadow-sm">
                <CardContent className="pt-5 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium text-ink">Your location</p>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={refreshLocation}
                      disabled={locating}
                      title="Update my location"
                    >
                      {locating ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <RefreshCw className="h-4 w-4" />
                      )}
                      <span className="ml-1.5 text-xs">Update</span>
                    </Button>
                  </div>

                  {locationVerdict}

                  {locationError ? (
                    <div className="flex items-start gap-2 p-3 text-sm text-warning-700 bg-warning-50 border border-warning-200 rounded-lg">
                      <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                      <span>{locationError}</span>
                    </div>
                  ) : (
                    <GeoMap
                      fences={mapFences}
                      pins={mapPins}
                      height={220}
                      emptyMessage="Finding your position…"
                    />
                  )}

                  {myPosition && (
                    <p className="text-xs text-muted">
                      Accurate to about {Math.round(myPosition.accuracy)} m.
                      {selectedSite?.name
                        ? ` Measured against ${selectedSite.name}.`
                        : ''}
                    </p>
                  )}
                </CardContent>
              </Card>
            )}

            <Card className="border-silver-200 shadow-sm overflow-hidden">
              <CardContent className="p-0">
                <div className="relative bg-silver-900 aspect-[4/3]">
                  {/*
                    The preview is mirrored; the picture that gets filed is not.

                    Field testers reported the view felt inverted, and they were
                    describing the raw camera feed: raise your left hand and it
                    appears on the right of the screen. Every selfie camera they
                    have ever used shows a mirror, so the honest image is the one
                    that reads as backwards.

                    So the preview is flipped to behave like a mirror, which is
                    the only thing a CSS transform can reach. `drawImage` in
                    `@/lib/face` reads the raw video frame, which no transform
                    touches, so the stored face -- and the descriptor computed
                    from it -- stays in the true orientation. That split is the
                    point: easy to line yourself up, honest in the record.

                    It costs nothing in security. A mirrored face is still the
                    same face, and enrolment and check-in both come off this same
                    un-mirrored path, so they always agree with each other.

                    Nothing here is directional -- the guide is a centred oval
                    and the advice is only ever "Move closer" or "Face detected"
                    -- so flipping the view cannot invert an instruction.
                  */}
                  <video
                    ref={videoRef}
                    playsInline
                    muted
                    autoPlay
                    className="w-full h-full object-cover"
                    style={{ transform: 'scaleX(-1)' }}
                  />

                  {/*
                    Framing guide. The oval is where the detector expects the
                    face; the pill underneath reports what it actually sees.
                  */}
                  {!cameraError && (
                    <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                      <div
                        className={`w-[46%] h-[68%] rounded-[50%] border-2 transition-colors duration-200 ${
                          framing.tone === 'ok'
                            ? 'border-brand-400'
                            : framing.tone === 'warn'
                              ? 'border-amber-300'
                              : 'border-white/40'
                        }`}
                      />
                    </div>
                  )}

                  {cameraError && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
                      <Camera className="h-7 w-7 text-silver-400" />
                      <p className="text-sm text-silver-300">{cameraError}</p>
                    </div>
                  )}

                  {!cameraError && (
                    <div className="absolute inset-x-0 bottom-0 p-2">
                      <div
                        className={`mx-auto w-fit max-w-full flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium backdrop-blur-sm ${
                          framing.tone === 'ok'
                            ? 'bg-brand-600/85 text-white'
                            : framing.tone === 'warn'
                              ? 'bg-amber-500/90 text-white'
                              : 'bg-black/55 text-white/90'
                        }`}
                      >
                        {faceModelState === 'loading' || faceModelState === 'idle' ? (
                          <Loader2 className="h-3 w-3 animate-spin shrink-0" />
                        ) : framing.tone === 'ok' ? (
                          <CheckCircle2 className="h-3 w-3 shrink-0" />
                        ) : (
                          <AlertCircle className="h-3 w-3 shrink-0" />
                        )}
                        <span className="truncate">{framing.text}</span>
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/*
              Enrollment gate. Without a face on file there is nothing for the
              server to match against, so the worker is asked to register one
              before the check-in button becomes available.
            */}
            {needsEnrollment && (
              <Card className="border-amber-300 bg-amber-50/60 shadow-sm">
                <CardContent className="pt-5 space-y-3">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-amber-600" />
                    <div>
                      <p className="text-sm font-medium text-ink">
                        Set up your face before checking in
                      </p>
                      <p className="text-xs text-muted mt-1">
                        Your face is stored as a mathematical vector, not a photo. It
                        takes a few seconds and only needs doing once.
                      </p>
                    </div>
                  </div>
                  <Button
                    className="w-full"
                    onClick={handleEnroll}
                    disabled={enrolling || submitting || framing.tone !== 'ok'}
                  >
                    {enrolling ? (
                      <span className="flex items-center gap-2">
                        <Loader2 className="animate-spin h-4 w-4" />
                        Saving your face…
                      </span>
                    ) : (
                      <span className="flex items-center gap-2">
                        <Camera className="h-4 w-4" />
                        Save my face
                      </span>
                    )}
                  </Button>
                  {framing.tone !== 'ok' && (
                    <p className="text-xs text-center text-amber-700">
                      Wait until the preview says “Face detected”, then press the button.
                    </p>
                  )}
                </CardContent>
              </Card>
            )}

            {enrollMessage && (
              <div
                role="status"
                className="flex items-start gap-2 p-3 text-sm text-brand-700 bg-brand-50 border border-brand-200 rounded-lg"
              >
                <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{enrollMessage}</span>
              </div>
            )}

            {error && (
              <div
                role="alert"
                className="flex items-start gap-2 p-3 text-sm text-critical-600 bg-critical-50 border border-critical-200 rounded-lg"
              >
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {nextAction === 'done' ? (
              /*
               * Both punches for the day are used. The server will refuse a
               * third, so the button is replaced instead of offered and then
               * rejected -- which is exactly what used to happen, and read as
               * the system being broken rather than the day being over.
               */
              <div className="rounded-lg border border-brand-200 bg-brand-50 p-4 text-center">
                <div className="flex justify-center mb-2">
                  <CheckCircle2 className="h-6 w-6 text-brand-600" />
                </div>
                <p className="text-sm font-medium text-ink">You are done for today</p>
                <p className="text-xs text-muted mt-1">
                  Timed in at {formatClock(todayPunches.checkInAt || undefined)} and
                  timed out at {formatClock(todayPunches.checkOutAt || undefined)}.
                  You can time in again tomorrow.
                </p>
              </div>
            ) : (
              <>
                <Button
                  className="w-full"
                  size="lg"
                  onClick={handleSubmit}
                  disabled={submitting || loadingContext || !siteId || !secure || faceBlocking}
                >
                  {submitting ? (
                    <span className="flex items-center gap-2">
                      <Loader2 className="animate-spin h-4 w-4" />
                      Verifying…
                    </span>
                  ) : faceBlocking ? (
                    <span className="flex items-center gap-2">
                      {faceModelState === 'idle' || faceModelState === 'loading' ? (
                        <>
                          <Loader2 className="animate-spin h-4 w-4" />
                          Preparing face recognition…
                        </>
                      ) : (
                        <>
                          <AlertCircle className="h-4 w-4" />
                          Save your face first
                        </>
                      )}
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
                  Your location and a face reading are sent to verify this event. The
                  photo itself never leaves your phone.
                </p>
              </>
            )}
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
