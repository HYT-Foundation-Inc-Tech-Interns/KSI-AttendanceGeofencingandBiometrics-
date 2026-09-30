'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  Bell,
  Check,
  Loader2,
  MapPinOff,
  ScanFace,
  ShieldAlert,
  UserX,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import FaceThumb from '@/components/face-thumb';
import { api, AttendanceNotification } from '@/lib/api';
import { readSession } from '@/lib/auth';

/**
 * How often the badge refreshes.
 *
 * The badge poll asks for a single item -- it needs `unreadCount`, not the
 * list -- because every notification carries a base64 face image and shipping
 * fifty of those once a minute to render a number would be absurd.
 */
const BADGE_POLL_MS = 60_000;

/** How many refusals the open panel shows at once. */
const PANEL_PAGE_SIZE = 50;

/**
 * Plain-language labels for the server's reason codes.
 *
 * The stored `reason` sentence is shown underneath as well; this is the
 * scannable version, because an administrator triaging a list reads the
 * category first and the detail only for the ones they care about.
 */
const REASON_LABELS: Record<AttendanceNotification['reasonCode'], string> = {
  outside_geofence: 'Outside the site',
  face_mismatch: 'Face did not match',
  no_face: 'No face in the picture',
  not_enrolled: 'No face on file',
  face_error: 'Face check failed',
};

function ReasonIcon({ code }: { code: AttendanceNotification['reasonCode'] }) {
  const className = 'w-4 h-4';
  switch (code) {
    case 'outside_geofence':
      return <MapPinOff className={className} />;
    case 'face_mismatch':
      return <ScanFace className={className} />;
    case 'no_face':
      return <UserX className={className} />;
    case 'not_enrolled':
      return <ShieldAlert className={className} />;
    default:
      return <AlertTriangle className={className} />;
  }
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';

  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 60) return 'just now';

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;

  const days = Math.round(hours / 24);
  if (days < 7) return `${days} d ago`;

  return new Date(iso).toLocaleDateString();
}

/**
 * The notification bell.
 *
 * Refused check-ins used to be written into the attendance table as FLAGGED
 * rows, which meant one worker retrying a bad capture produced four rows that
 * read as four attendance records. A refusal is not attendance -- it is
 * something an administrator needs to be *told about* -- so it arrives here
 * instead, carrying the face that was captured and the reason it was refused.
 *
 * Approving one is the override: a refusal in bad light or with a drifted GPS
 * fix is the system's fault, not the worker's, so the admin can turn it into
 * real attendance. That writes a proper event, which then appears in the
 * attendance table like any other.
 */
export default function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [items, setItems] = useState<AttendanceNotification[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [busyAll, setBusyAll] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const containerRef = useRef<HTMLDivElement | null>(null);

  const tokenOf = useCallback(() => readSession()?.token ?? null, []);

  /** Badge only: one item, so the poll stays cheap. */
  const refreshCount = useCallback(async () => {
    const token = tokenOf();
    if (!token) return;
    try {
      const result = await api.listNotifications(token, { limit: 1 });
      setUnreadCount(result.unreadCount);
    } catch {
      // A failed poll is not worth telling anyone about; the next one retries.
    }
  }, [tokenOf]);

  const loadList = useCallback(async () => {
    const token = tokenOf();
    if (!token) return;

    setIsLoading(true);
    setError('');
    try {
      const result = await api.listNotifications(token, { limit: PANEL_PAGE_SIZE });
      setItems(result.data);
      setUnreadCount(result.unreadCount);
    } catch (err) {
      setError((err as Error).message || 'Could not load notifications.');
    } finally {
      setIsLoading(false);
    }
  }, [tokenOf]);

  /*
   * The first poll is deferred to a macrotask rather than fired inline.
   *
   * Two reasons: it lets the bell paint before the request is scheduled, so the
   * page does not wait on a network round trip to render; and it keeps every
   * setState in this component inside a timer or event callback, which is the
   * pattern React's own effect guidance asks for.
   */
  useEffect(() => {
    const kickoff = setTimeout(refreshCount, 0);
    const timer = setInterval(refreshCount, BADGE_POLL_MS);
    return () => {
      clearTimeout(kickoff);
      clearInterval(timer);
    };
  }, [refreshCount]);

  // Refresh the list whenever the panel is opened, so it is never stale.
  useEffect(() => {
    if (!open) return;
    const kickoff = setTimeout(loadList, 0);
    return () => clearTimeout(kickoff);
  }, [open, loadList]);

  // Close on Escape and on a click outside.
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const onPointerDown = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('mousedown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onPointerDown);
    };
  }, [open]);

  const handleApprove = async (item: AttendanceNotification) => {
    const token = tokenOf();
    if (!token) return;

    setPendingId(item.id);
    setError('');
    setNotice('');
    try {
      await api.approveNotification(token, item.id);
      setItems((prev) => prev.filter((row) => row.id !== item.id));
      setUnreadCount((count) => Math.max(0, count - 1));
      setNotice(
        `${item.employeeName}'s ${item.eventType === 'check_in' ? 'check-in' : 'check-out'} was recorded in Attendance.`
      );
    } catch (err) {
      setError((err as Error).message || 'Could not record that as attendance.');
    } finally {
      setPendingId(null);
    }
  };

  const handleDismiss = async (item: AttendanceNotification) => {
    const token = tokenOf();
    if (!token) return;

    setPendingId(item.id);
    setError('');
    setNotice('');
    try {
      await api.acknowledgeNotification(token, item.id);
      setItems((prev) => prev.filter((row) => row.id !== item.id));
      setUnreadCount((count) => Math.max(0, count - 1));
    } catch (err) {
      setError((err as Error).message || 'Could not dismiss that notification.');
    } finally {
      setPendingId(null);
    }
  };

  const handleDismissAll = async () => {
    const token = tokenOf();
    if (!token) return;

    setBusyAll(true);
    setError('');
    setNotice('');
    try {
      await api.acknowledgeAllNotifications(token);
      setItems([]);
      setUnreadCount(0);
      setNotice('All notifications dismissed.');
    } catch (err) {
      setError((err as Error).message || 'Could not dismiss the notifications.');
    } finally {
      setBusyAll(false);
    }
  };

  const badgeLabel = unreadCount > 99 ? '99+' : String(unreadCount);

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setOpen((value) => !value)}
        className="relative p-2 rounded-lg text-silver-700 hover:bg-silver-100 hover:text-brand-800 transition-colors"
        aria-label={
          unreadCount > 0
            ? `Notifications, ${unreadCount} unread`
            : 'Notifications'
        }
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <Bell className="w-5 h-5" />

        {unreadCount > 0 && (
          <span
            aria-hidden="true"
            className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-critical-600 text-white text-[10px] font-semibold leading-[18px] text-center"
          >
            {badgeLabel}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Failed check-ins"
          className="absolute right-0 mt-2 w-[22rem] sm:w-[26rem] max-h-[32rem] overflow-hidden rounded-xl border border-silver-200 bg-white shadow-xl z-20 flex flex-col"
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-silver-200">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-brand-800">
                Failed check-ins
              </p>
              <p className="text-xs text-silver-800 mt-0.5">
                Not recorded as attendance. Approve one to add it.
              </p>
            </div>
            {items.length > 0 && (
              <Button
                size="sm"
                variant="ghost"
                disabled={busyAll}
                onClick={handleDismissAll}
              >
                {busyAll ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  'Clear all'
                )}
              </Button>
            )}
          </div>

          {(error || notice) && (
            <div
              className={`px-4 py-2 text-xs border-b ${
                error
                  ? 'bg-critical-50 text-critical-700 border-critical-100'
                  : 'bg-brand-50 text-brand-800 border-brand-100'
              }`}
              role="status"
            >
              {error || notice}
            </div>
          )}

          <div className="overflow-y-auto flex-1">
            {isLoading ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="w-5 h-5 animate-spin text-silver-700" />
              </div>
            ) : items.length === 0 ? (
              <div className="px-6 py-10 text-center">
                <div className="mx-auto w-10 h-10 rounded-full bg-brand-50 flex items-center justify-center mb-3">
                  <Check className="w-5 h-5 text-brand-700" />
                </div>
                <p className="text-sm font-medium text-ink">Nothing to review</p>
                <p className="text-xs text-silver-800 mt-1">
                  Every check-in has gone through.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-silver-100">
                {items.map((item) => (
                  <li key={item.id} className="px-4 py-3">
                    <div className="flex gap-3">
                      <FaceThumb src={item.captureImage} name={item.employeeName} />

                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-ink truncate">
                              {item.employeeName}
                            </p>
                            <p className="text-xs text-silver-800">
                              {item.employeeCode}
                              {item.siteName ? ` · ${item.siteName}` : ''}
                            </p>
                          </div>
                          <span className="text-[11px] text-silver-700 whitespace-nowrap pt-0.5">
                            {relativeTime(item.serverTimestamp)}
                          </span>
                        </div>

                        <div className="flex items-center gap-1.5 mt-1.5 text-warning-700">
                          <ReasonIcon code={item.reasonCode} />
                          <span className="text-xs font-medium">
                            {REASON_LABELS[item.reasonCode] ?? 'Failed'}
                          </span>
                          <span className="text-xs text-silver-700 capitalize">
                            · {item.eventType === 'check_in' ? 'check-in' : 'check-out'}
                          </span>
                        </div>

                        <p className="text-xs text-silver-800 mt-1 leading-snug">
                          {item.reason}
                        </p>

                        {item.matchScore !== null && (
                          <p className="text-xs text-silver-800 mt-0.5">
                            Match: {(item.matchScore * 100).toFixed(0)}%
                          </p>
                        )}

                        <div className="flex items-center gap-2 mt-2">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={pendingId === item.id}
                            onClick={() => handleApprove(item)}
                          >
                            {pendingId === item.id ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              'Record it'
                            )}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={pendingId === item.id}
                            onClick={() => handleDismiss(item)}
                          >
                            <X className="w-3.5 h-3.5 mr-1" />
                            Dismiss
                          </Button>
                        </div>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {items.length > 0 && (
            <div className="px-4 py-2 border-t border-silver-200 bg-silver-50">
              <button
                onClick={() => {
                  setOpen(false);
                  router.push('/dashboard/attendance');
                }}
                className="text-xs text-brand-800 hover:underline"
              >
                Open the attendance table →
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
