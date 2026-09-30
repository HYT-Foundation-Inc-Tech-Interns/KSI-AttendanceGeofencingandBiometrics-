'use client';

import { useEffect, useRef, useState } from 'react';
import type * as Leaflet from 'leaflet';
import 'leaflet/dist/leaflet.css';

/**
 * A Leaflet map, loaded lazily and only in the browser.
 *
 * Leaflet touches `window` at import time, and this app is a static export --
 * every route is prerendered to HTML in Node, where `window` does not exist. A
 * top-level `import 'leaflet'` therefore breaks the build outright, so the
 * library is pulled in inside an effect instead. That also keeps ~150 kB of
 * map code out of the bundle for anyone who never opens a map page.
 *
 * Markers are drawn with `divIcon` rather than Leaflet's default marker image.
 * The default icon is resolved by URL at runtime, and bundlers famously break
 * it, leaving invisible markers with a broken-image fallback. Inline SVG has no
 * asset to resolve and lets each pin carry a glyph, which matters because
 * status here is never allowed to be colour-alone.
 */

export interface MapFence {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radiusM?: number | null;
  /** Outer ring as GeoJSON `[longitude, latitude]` pairs. */
  polygon?: number[][] | null;
}

export type PinTone = 'inside' | 'outside' | 'unknown' | 'self';

export interface MapPin {
  id: string;
  latitude: number;
  longitude: number;
  label: string;
  tone: PinTone;
  detail?: string;
  /**
   * This person's face as a JPEG data URL, or null/absent to draw a glyph pin.
   *
   * Half the roster has no face on file, so this is genuinely optional and the
   * glyph pin is a first-class outcome rather than an error state.
   */
  faceUrl?: string | null;
}

interface GeoMapProps {
  fences?: MapFence[];
  pins?: MapPin[];
  /** When set, the view jumps here instead of fitting everything. */
  focus?: { latitude: number; longitude: number } | null;
  zoom?: number;
  height?: number | string;
  className?: string;
  onPinClick?: (id: string) => void;
  emptyMessage?: string;
}

/**
 * Fallback view: the Paltok site as it is currently fenced, so an empty map is
 * not in the ocean. This only shows before the first data arrives -- once there
 * is anything to draw, the bounds come from the real coordinates.
 */
const DEFAULT_CENTER: [number, number] = [14.642592, 121.024509];

/**
 * Pin styling per tone.
 *
 * Every tone pairs its colour with a distinct glyph, because colour alone is
 * not a status channel -- the same rule the status badges follow. The glyph is
 * what makes "outside" readable to someone who cannot separate the two hues.
 */
const TONES: Record<
  PinTone,
  { fill: string; ring: string; glyph: string; title: string }
> = {
  inside: { fill: '#519b24', ring: '#285709', glyph: '\u2713', title: 'Inside site' },
  outside: { fill: '#a33a2e', ring: '#862f25', glyph: '!', title: 'Outside site' },
  unknown: { fill: '#858585', ring: '#4a4949', glyph: '?', title: 'No location' },
  self: { fill: '#285709', ring: '#133005', glyph: '\u25CF', title: 'Your position' },
};

const FENCE_STROKE = '#285709';

/**
 * Pin geometry, per shape.
 *
 * A pin carrying a face is drawn larger, because a face only earns its place
 * if it is big enough to recognise at a glance. The tip sits on the coordinate
 * in both shapes, so a face pin is no less precise than a glyph pin -- it just
 * takes up more room above the point.
 */
const PIN_GLYPH = { width: 30, height: 40, anchorX: 15, anchorY: 40 };
const PIN_FACE = { width: 40, height: 54, anchorX: 20, anchorY: 54 };

/** A teardrop pin whose tip sits on the coordinate, marked with a glyph. */
function glyphPinHtml(tone: PinTone): string {
  const t = TONES[tone];
  return `
    <div style="position:relative;width:30px;height:40px;">
      <svg width="30" height="40" viewBox="0 0 30 40" xmlns="http://www.w3.org/2000/svg">
        <path d="M15 1.5c-6.9 0-12.5 5.6-12.5 12.5 0 8.6 10.6 22 11.7 23.4a1 1 0 0 0 1.6 0C16.9 36 27.5 22.6 27.5 14 27.5 7.1 21.9 1.5 15 1.5Z"
              fill="${t.fill}" stroke="#ffffff" stroke-width="2.5"/>
        <circle cx="15" cy="14" r="7.5" fill="#ffffff" fill-opacity="0.22"/>
        <text x="15" y="18.5" text-anchor="middle" font-family="Arial,Helvetica,sans-serif"
              font-size="12" font-weight="700" fill="#ffffff">${t.glyph}</text>
      </svg>
    </div>
  `;
}

/**
 * A teardrop pin with the person's face in the head.
 *
 * The face is an HTML `<img>` with `border-radius: 50%` layered over the SVG
 * rather than an SVG `<image>` inside a `<clipPath>`. A clip path needs an
 * `id`, every marker injects its own markup into the same document, and
 * duplicate ids resolve to whichever element the browser saw first -- so the
 * pins would silently steal each other's clips. A CSS radius has no such
 * shared state.
 *
 * The teardrop path is the 40x54 form of the same shape: a head circle centred
 * on (20, 18) with r = 16.5, and a tip at (20, 52). The two straight edges are
 * tangents from the tip, meeting the circle at +/-60.96 degrees, which is
 * `acos(16.5 / 34)` -- hence the two arc endpoints at x = 34.43 and x = 5.57.
 *
 * The status glyph survives as a badge on the rim. A face says who, never
 * whether they were inside, and status in this app is not allowed to rest on
 * colour alone.
 */
function facePinHtml(tone: PinTone, faceUrl: string): string {
  const t = TONES[tone];
  return `
    <div style="position:relative;width:40px;height:54px;">
      <svg width="40" height="54" viewBox="0 0 40 54" xmlns="http://www.w3.org/2000/svg"
           style="position:absolute;left:0;top:0;">
        <path d="M20 1.5A16.5 16.5 0 0 1 34.43 26L20 52 5.57 26A16.5 16.5 0 0 1 20 1.5Z"
              fill="${t.fill}" stroke="#ffffff" stroke-width="2.5"/>
      </svg>
      <img src="${faceUrl}" alt=""
           style="position:absolute;left:6px;top:4px;width:28px;height:28px;border-radius:50%;object-fit:cover;border:2px solid #ffffff;box-sizing:border-box;"/>
      <span style="position:absolute;left:21px;top:20px;width:15px;height:15px;border-radius:50%;background:${t.fill};border:1.5px solid #ffffff;color:#ffffff;font:700 10px/15px Arial,Helvetica,sans-serif;text-align:center;box-sizing:content-box;">${t.glyph}</span>
    </div>
  `;
}

export default function GeoMap({
  fences = [],
  pins = [],
  focus = null,
  zoom = 16,
  height = 420,
  className = '',
  onPinClick,
  emptyMessage = 'No locations to show yet.',
}: GeoMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<Leaflet.Map | null>(null);
  const layerRef = useRef<Leaflet.LayerGroup | null>(null);
  const leafletRef = useRef<typeof import('leaflet') | null>(null);
  const drawRef = useRef<(() => void) | null>(null);
  const clickRef = useRef<GeoMapProps['onPinClick']>(onPinClick);
  const [failed, setFailed] = useState(false);

  // Kept in a ref so the draw closure always sees current props without the
  // map having to be rebuilt -- rebuilding would throw away the user's pan and
  // zoom on every parent re-render.
  const dataRef = useRef({ fences, pins, focus, zoom });

  // Written in an effect, not during render: mutating a ref while rendering is
  // what the refs lint rule exists to prevent.
  useEffect(() => {
    clickRef.current = onPinClick;
  }, [onPinClick]);

  /*
   * The effect below is keyed on a signature rather than on the arrays
   * themselves. Parents routinely pass freshly-built arrays each render, and
   * depending on identity would re-fit the bounds constantly, yanking the map
   * back while the admin is panning around it.
   */
  const signature = JSON.stringify({
    fences,
    pins: pins.map((pin) => ({
      ...pin,
      /*
       * Only a tail of the data URL enters the signature. A face is a base64
       * JPEG of up to ~21 KB, and stringifying eight of them on every render
       * to decide whether anything moved is a lot of work to answer a question
       * a few characters already answer.
       */
      faceUrl: pin.faceUrl ? pin.faceUrl.slice(-24) : '',
    })),
    focus,
    zoom,
  });

  useEffect(() => {
    let cancelled = false;
    let created: Leaflet.Map | null = null;

    (async () => {
      try {
        const L = await import('leaflet');
        if (cancelled || !containerRef.current) return;

        leafletRef.current = L;

        const map = L.map(containerRef.current, {
          zoomControl: true,
          attributionControl: true,
          scrollWheelZoom: true,
        }).setView(DEFAULT_CENTER, zoom);

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
          attribution: '&copy; OpenStreetMap contributors',
        }).addTo(map);

        layerRef.current = L.layerGroup().addTo(map);
        mapRef.current = map;
        created = map;

        drawRef.current = () => {
          const leaflet = leafletRef.current;
          const m = mapRef.current;
          const layer = layerRef.current;
          if (!leaflet || !m || !layer) return;

          const data = dataRef.current;
          layer.clearLayers();

          const bounds: [number, number][] = [];

          for (const fence of data.fences ?? []) {
            const ring = fence.polygon;
            if (Array.isArray(ring) && ring.length >= 3) {
              const latlngs = ring.map(
                ([lng, lat]) => [lat, lng] as [number, number],
              );
              leaflet
                .polygon(latlngs, {
                  color: FENCE_STROKE,
                  weight: 2,
                  fillColor: '#519b24',
                  fillOpacity: 0.1,
                })
                .addTo(layer)
                .bindTooltip(fence.name);
              latlngs.forEach((p) => bounds.push(p));
              continue;
            }

            if (
              Number.isFinite(fence.latitude) &&
              Number.isFinite(fence.longitude) &&
              fence.radiusM
            ) {
              leaflet
                .circle([fence.latitude, fence.longitude], {
                  radius: fence.radiusM,
                  color: FENCE_STROKE,
                  weight: 2,
                  fillColor: '#519b24',
                  fillOpacity: 0.1,
                })
                .addTo(layer)
                .bindTooltip(`${fence.name} \u2014 ${fence.radiusM} m radius`);
              bounds.push([fence.latitude, fence.longitude]);
            }
          }

          for (const pin of data.pins ?? []) {
            if (
              !Number.isFinite(pin.latitude) ||
              !Number.isFinite(pin.longitude)
            ) {
              continue;
            }

            /*
             * Only a data URL that really is an image is trusted into the
             * markup. It comes from our own database, but it is interpolated
             * into HTML, so it gets a shape check rather than the benefit of
             * the doubt.
             */
            const face =
              typeof pin.faceUrl === 'string' &&
              pin.faceUrl.startsWith('data:image/')
                ? pin.faceUrl
                : null;

            const geo = face ? PIN_FACE : PIN_GLYPH;

            const marker = leaflet.marker([pin.latitude, pin.longitude], {
              icon: leaflet.divIcon({
                className: '',
                html: face
                  ? facePinHtml(pin.tone, face)
                  : glyphPinHtml(pin.tone),
                iconSize: [geo.width, geo.height],
                iconAnchor: [geo.anchorX, geo.anchorY],
                popupAnchor: [0, -(geo.height - 4)],
              }),
              title: `${pin.label} \u2014 ${TONES[pin.tone].title}`,
            });

            marker.bindPopup(
              `<div style="display:flex;gap:8px;align-items:center;">${
                face
                  ? `<img src="${face}" alt="" style="width:44px;height:44px;border-radius:50%;object-fit:cover;border:1px solid #d3d1c7;flex:none;"/>`
                  : ''
              }<div><strong>${escapeHtml(pin.label)}</strong>${
                pin.detail
                  ? `<br/><span style="color:#6b6a6a">${escapeHtml(pin.detail)}</span>`
                  : ''
              }</div></div>`,
            );

            marker.on('click', () => clickRef.current?.(pin.id));
            marker.addTo(layer);
            bounds.push([pin.latitude, pin.longitude]);
          }

          /*
           * A focus overrides fitting: the admin clicked a specific person and
           * expects the map to go to them, not to re-frame the whole estate.
           */
          if (data.focus) {
            m.setView([data.focus.latitude, data.focus.longitude], 17);
          } else if (bounds.length === 1) {
            m.setView(bounds[0], 17);
          } else if (bounds.length > 1) {
            m.fitBounds(bounds, { padding: [40, 40], maxZoom: 17 });
          }

          // The container is often still settling when the async import
          // resolves, which leaves Leaflet with a stale size and grey tiles.
          m.invalidateSize();
        };

        drawRef.current();
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      drawRef.current = null;
      layerRef.current = null;
      leafletRef.current = null;
      if (created) created.remove();
      mapRef.current = null;
    };
    // Intentionally mount-only: the map instance outlives prop changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    dataRef.current = { fences, pins, focus, zoom };
    drawRef.current?.();
    // `signature` is the stable encoding of the four values above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  const hasAnything =
    (fences?.length ?? 0) > 0 || (pins?.length ?? 0) > 0;

  return (
    <div className={`relative ${className}`}>
      <div
        ref={containerRef}
        style={{ height, width: '100%' }}
        className="rounded-lg overflow-hidden border border-silver-200 bg-silver-100 z-0"
        role="application"
        aria-label="Map of site geofences and employee locations"
      />

      {failed && (
        <div className="absolute inset-0 flex items-center justify-center rounded-lg border border-silver-200 bg-silver-50 p-4 text-center">
          <p className="text-sm text-silver-800">
            The map could not be loaded. Check your connection and reload.
          </p>
        </div>
      )}

      {!failed && !hasAnything && (
        <div className="absolute inset-x-0 bottom-0 flex justify-center p-3 pointer-events-none">
          <p className="rounded-md bg-white/95 border border-silver-200 px-3 py-1.5 text-xs text-silver-800">
            {emptyMessage}
          </p>
        </div>
      )}
    </div>
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
