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
 *
 * The explicit z-indexes are load-bearing. Leaflet's own stylesheet contains
 * `.leaflet-map-pane svg { z-index: 200; }`, which exists to lift its overlay
 * and tile SVG panes above the tile images -- but it is a descendant selector,
 * so it also matches the inline SVG in a `divIcon` marker. Left alone, the
 * teardrop therefore paints *over* the face and the badge, and the pin reads as
 * a plain green marker with its face invisible. Anything that has to sit on top
 * of the pin has to out-rank that 200.
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
           style="position:absolute;left:6px;top:4px;width:28px;height:28px;border-radius:50%;object-fit:cover;border:2px solid #ffffff;box-sizing:border-box;z-index:201;"/>
      <span style="position:absolute;left:21px;top:20px;width:15px;height:15px;border-radius:50%;background:${t.fill};border:1.5px solid #ffffff;color:#ffffff;font:700 10px/15px Arial,Helvetica,sans-serif;text-align:center;box-sizing:content-box;z-index:202;">${t.glyph}</span>
    </div>
  `;
}

/**
 * How far apart two pins must be before they stop reading as one, in pixels.
 *
 * Sized for the wider face pin (40 px) with a little air around it. Below this
 * the faces overlap enough that a glance reads a crowd as a single person.
 */
const PIN_SEPARATION_PX = 46;

/**
 * The zoom the spread is sized against.
 *
 * The offset is a fixed number of metres rather than one recomputed from the
 * live zoom, because the live zoom changes as a result of the draw -- fitting
 * bounds to spread-out pins would move the zoom, which would change the spread,
 * which would move the bounds again. A fixed reference breaks that loop and
 * makes a pin's drawn offset stable while the admin zooms.
 */
const SPREAD_REFERENCE_ZOOM = 17;

/**
 * The furthest a pin may be drawn from the position it actually reports.
 *
 * Uncapped, a cluster seen at a wide zoom would ask for a circle hundreds of
 * metres across and the pins would sail off the building. Capped, a tight
 * cluster still overlaps when zoomed out, which is honest -- and the leader
 * line still points at the truth.
 */
const MAX_SPREAD_RADIUS_M = 45;

/** Web Mercator pixel coordinates. Comparable between any two points at one zoom. */
function projectToPixels(latitude: number, longitude: number, zoom: number) {
  const scale = 256 * Math.pow(2, zoom);
  const sinLat = Math.sin((latitude * Math.PI) / 180);
  return {
    x: ((longitude + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale,
  };
}

/** Ground metres per screen pixel, for the Web Mercator projection. */
function metresPerPixel(latitude: number, zoom: number): number {
  return (156543.03392 * Math.cos((latitude * Math.PI) / 180)) / Math.pow(2, zoom);
}

interface PlacedPin {
  pin: MapPin;
  /** Where the pin is drawn. Equal to the reported position unless `moved`. */
  latitude: number;
  longitude: number;
  /** Where the pin really is. */
  originLatitude: number;
  originLongitude: number;
  moved: boolean;
}

/**
 * Pull overlapping pins apart so that every one of them can be seen.
 *
 * Six people punching in at the same doorway produced six pins inside 6 px of
 * each other while a face pin is 40 px wide. The map therefore looked like it
 * held one person, and whichever face was drawn last hid the other five -- the
 * data was right the whole time, the drawing was not.
 *
 * Pins that share a spot are fanned onto a circle around their common centre,
 * and the caller draws a leader line from each one back to its true position.
 * So the separation never invents a location: it is legible *and* honest.
 */
function spreadOverlappingPins(pins: MapPin[]): PlacedPin[] {
  const placed: PlacedPin[] = pins.map((pin) => ({
    pin,
    latitude: pin.latitude,
    longitude: pin.longitude,
    originLatitude: pin.latitude,
    originLongitude: pin.longitude,
    moved: false,
  }));

  const pixels = placed.map((p) =>
    projectToPixels(p.latitude, p.longitude, SPREAD_REFERENCE_ZOOM),
  );

  // Single-linkage grouping: anything within the separation distance joins the
  // group, and the group keeps growing while it finds new neighbours. Six
  // people in a doorway are one group however the pairs happen to be spaced.
  const groups: number[][] = [];
  const assigned = new Array<boolean>(placed.length).fill(false);

  for (let i = 0; i < placed.length; i++) {
    if (assigned[i]) continue;

    const group = [i];
    assigned[i] = true;

    for (let scan = 0; scan < group.length; scan++) {
      const a = pixels[group[scan]];
      for (let j = 0; j < placed.length; j++) {
        if (assigned[j]) continue;
        const b = pixels[j];
        if (Math.hypot(a.x - b.x, a.y - b.y) <= PIN_SEPARATION_PX) {
          assigned[j] = true;
          group.push(j);
        }
      }
    }

    groups.push(group);
  }

  for (const group of groups) {
    if (group.length < 2) continue;

    const centreLat =
      group.reduce((sum, i) => sum + placed[i].latitude, 0) / group.length;
    const centreLng =
      group.reduce((sum, i) => sum + placed[i].longitude, 0) / group.length;

    // Radius that puts neighbouring pins exactly PIN_SEPARATION_PX apart:
    // the chord between neighbours is 2R*sin(pi/n).
    const wantedM =
      (PIN_SEPARATION_PX / (2 * Math.sin(Math.PI / group.length))) *
      metresPerPixel(centreLat, SPREAD_REFERENCE_ZOOM);
    const radiusM = Math.min(wantedM, MAX_SPREAD_RADIUS_M);

    const mPerDegreeLat = 111320;
    const mPerDegreeLng = 111320 * Math.cos((centreLat * Math.PI) / 180);

    group.forEach((index, n) => {
      // Start at the top and go clockwise, so the order is stable between
      // draws rather than depending on how the roster happened to be sorted.
      const angle = (2 * Math.PI * n) / group.length - Math.PI / 2;
      placed[index].latitude = centreLat + (radiusM * Math.cos(angle)) / mPerDegreeLat;
      placed[index].longitude =
        centreLng + (radiusM * Math.sin(angle)) / mPerDegreeLng;
      placed[index].moved = true;
    });
  }

  return placed;
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

          /*
           * Leader lines are added before the pins so they render underneath.
           * Only a pin that was actually moved gets one: a line from a pin to
           * itself would just be noise.
           */
          const placedPins = spreadOverlappingPins(data.pins ?? []);

          for (const spot of placedPins) {
            if (!spot.moved) continue;
            leaflet
              .polyline(
                [
                  [spot.originLatitude, spot.originLongitude],
                  [spot.latitude, spot.longitude],
                ],
                { color: '#6b6a6a', weight: 1, opacity: 0.65, dashArray: '3,3' },
              )
              .addTo(layer);
          }

          for (const spot of placedPins) {
            const pin = spot.pin;

            if (
              !Number.isFinite(spot.latitude) ||
              !Number.isFinite(spot.longitude)
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

            const marker = leaflet.marker([spot.latitude, spot.longitude], {
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
              }${
                /*
                 * Say so when a pin has been fanned out. The leader line shows
                 * it on the map, but a popup is where someone reads a position
                 * as a fact, and this one is deliberately not exact.
                 */
                spot.moved
                  ? `<br/><span style="color:#6b6a6a;font-size:11px">Pin moved aside to stay visible; the dashed line points at the exact spot.</span>`
                  : ''
              }</div></div>`,
            );

            marker.on('click', () => clickRef.current?.(pin.id));
            marker.addTo(layer);

            // Bounds follow the real positions, so framing the map is decided
            // by where people are, not by how far the pins were fanned out.
            bounds.push([spot.originLatitude, spot.originLongitude]);
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
