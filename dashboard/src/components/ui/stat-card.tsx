'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import { Card, CardContent } from '@/components/ui/card';

/*
 * One KPI tile, shared by every page that shows a row of counts.
 *
 * Before this existed, `dashboard` and `attendance` drew a label-above tile
 * with an icon chip while `employees` and `sites` drew a value-above tile with
 * no icon and a smaller number — the same row of figures, two different
 * designs, on adjacent nav items.
 *
 * The tone rule: `critical` is a signal, so it only fires on a non-zero count.
 * A red "0 Suspended" reads as a problem when the news is good, and it spends
 * the reserved colour on nothing.
 *
 * ---------------------------------------------------------------------------
 * Hover detail
 *
 * A count is a number without a subject: "1" is not information until you know
 * *who* it is about. So a tile can carry the rows behind its number, revealed
 * on hover and on keyboard focus.
 *
 * The popup is portalled to `document.body` and positioned `fixed` from the
 * tile's own rect rather than rendered inside it. Nested, any ancestor with
 * `overflow: hidden` -- a rounded card is the usual suspect -- would silently
 * clip a long list, and the tile itself is far too narrow to hold one.
 *
 * It stays pointer-interactive instead of `pointer-events-none` so a long list
 * can be scrolled. That needs a short grace period on mouse-out: the popup sits
 * 8px below the tile, and without the delay the pointer crossing that gap would
 * dismiss the popup before it ever arrived.
 */
export interface StatCardProps {
  label: string;
  value: number | string;
  icon?: React.ComponentType<{ className?: string }>;
  /** Only `critical` is defined — the one status a headline count can carry. */
  tone?: 'critical';
  /**
   * Who and what the number is about. When supplied, the tile becomes
   * hoverable/focusable and this is revealed beneath it.
   */
  details?: React.ReactNode;
  /** One line above `details`, e.g. "Active employees in this organization". */
  detailsHint?: string;
  /** Shown when `details` is empty, instead of an empty popup. */
  emptyDetails?: string;
}

/** Popup width, and the breathing room kept between it and the viewport edge. */
const POPUP_WIDTH = 340;
const POPUP_GAP = 8;
const VIEWPORT_MARGIN = 12;
/** How long the popup survives a mouse-out, so the pointer can reach it. */
const HIDE_DELAY_MS = 140;

export function StatCard({
  label,
  value,
  icon: Icon,
  tone,
  details,
  detailsHint,
  emptyDetails = 'Nothing to show.',
}: StatCardProps) {
  const isCritical = tone === 'critical' && Number(value) > 0;
  const interactive = Boolean(details);

  const triggerRef = React.useRef<HTMLDivElement>(null);
  const hideTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = React.useState(false);
  const [position, setPosition] = React.useState<{
    left: number;
    top: number;
    width: number;
    maxHeight: number;
  } | null>(null);
  const popupId = React.useId();

  const cancelHide = React.useCallback(() => {
    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  }, []);

  /*
   * Measured against the viewport, not the document. The popup is `fixed`, so
   * page scroll does not move it -- which is why the listeners below re-measure
   * rather than leaving it stranded over whatever scrolled into that spot.
   */
  const place = React.useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    const width = Math.min(POPUP_WIDTH, window.innerWidth - VIEWPORT_MARGIN * 2);

    // Centred under the tile, then pushed back inside the viewport. Clamping
    // after centring (rather than before) is what keeps a tile in the last
    // column from hanging its popup off the right edge.
    const centred = rect.left + rect.width / 2 - width / 2;
    const left = Math.max(
      VIEWPORT_MARGIN,
      Math.min(centred, window.innerWidth - width - VIEWPORT_MARGIN),
    );

    const top = rect.bottom + POPUP_GAP;
    const maxHeight = Math.max(180, window.innerHeight - top - VIEWPORT_MARGIN);

    setPosition({ left, top, width, maxHeight });
  }, []);

  const show = React.useCallback(() => {
    cancelHide();
    place();
    setOpen(true);
  }, [cancelHide, place]);

  const scheduleHide = React.useCallback(() => {
    cancelHide();
    hideTimer.current = setTimeout(() => setOpen(false), HIDE_DELAY_MS);
  }, [cancelHide]);

  // A timer that outlives the component would call setState on an unmounted
  // node, so it is cleared on teardown.
  React.useEffect(() => cancelHide, [cancelHide]);

  React.useEffect(() => {
    if (!open) return;

    const reposition = () => place();
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);

    return () => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, place]);

  return (
    <>
      <div
        ref={triggerRef}
        className="relative"
        onMouseEnter={interactive ? show : undefined}
        onMouseLeave={interactive ? scheduleHide : undefined}
        // focus/blur rather than focusin/out: the popup is portalled out of this
        // subtree, so it cannot steal focus from the tile and close it.
        onFocus={interactive ? show : undefined}
        onBlur={interactive ? scheduleHide : undefined}
        tabIndex={interactive ? 0 : undefined}
        aria-describedby={interactive && open ? popupId : undefined}
      >
        <Card
          className={
            interactive
              ? 'cursor-help outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2'
              : undefined
          }
        >
          <CardContent className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                {/*
                 * The dotted underline is the whole affordance: without it there
                 * is nothing on screen to suggest the tile is worth pointing at.
                 */}
                <p
                  className={`text-sm text-silver-800 truncate ${
                    interactive
                      ? 'underline decoration-dotted decoration-silver-500 underline-offset-4'
                      : ''
                  }`}
                >
                  {label}
                </p>
                <p
                  className={`text-3xl font-semibold mt-1.5 tabular-nums ${
                    isCritical ? 'text-critical-600' : 'text-brand-800'
                  }`}
                >
                  {value}
                </p>
              </div>
              {Icon && (
                <div
                  aria-hidden="true"
                  className={`p-2.5 rounded-lg shrink-0 ${
                    isCritical
                      ? 'bg-critical-50 text-critical-600'
                      : 'bg-brand-50 text-brand-800'
                  }`}
                >
                  <Icon className="w-5 h-5" />
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {interactive &&
        open &&
        position &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            id={popupId}
            role="tooltip"
            onMouseEnter={cancelHide}
            onMouseLeave={scheduleHide}
            style={{
              position: 'fixed',
              left: position.left,
              top: position.top,
              width: position.width,
              maxHeight: position.maxHeight,
            }}
            className="z-50 overflow-y-auto rounded-xl border border-silver-200 bg-white shadow-lg"
          >
            <div className="sticky top-0 border-b border-silver-200 bg-white px-4 py-3">
              <p className="text-sm font-semibold text-ink">{label}</p>
              {detailsHint && (
                <p className="mt-0.5 text-xs text-silver-800">{detailsHint}</p>
              )}
            </div>
            <div className="px-4 py-3">
              {details || (
                <p className="text-sm text-silver-800">{emptyDetails}</p>
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

export default StatCard;
