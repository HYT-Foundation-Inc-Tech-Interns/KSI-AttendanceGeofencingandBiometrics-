'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  CheckCircle2,
  HelpCircle,
  RefreshCw,
} from 'lucide-react';
import { api, type MapEmployee, type MapOverview } from '@/lib/api';
import { readSession } from '@/lib/auth';
import GeoMap, { type MapFence, type MapPin, type PinTone } from '@/components/geo-map';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatCard } from '@/components/ui/stat-card';

/**
 * Where everyone was last seen, on a map.
 *
 * The word "last" is load-bearing. There is no continuous tracking in this
 * system -- a position only exists because somebody punched, so every pin is
 * as old as its most recent check-in or check-out. The panel therefore leads
 * with the time, and the map refuses to call anything "live". An admin acting
 * on a three-day-old pin as though it were current is the failure mode this
 * page has to avoid.
 *
 * The inside/outside verdict is the server's, computed in PostGIS by the same
 * expression that decides whether a punch is accepted. Drawing the boundary in
 * the browser would let the map disagree with the gate.
 */
export default function MapPage() {
  const router = useRouter();
  const [overview, setOverview] = useState<MapOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [onlyOutside, setOnlyOutside] = useState(false);
  /*
   * Faces default to on: the map is already admin/HR only, and the same faces
   * are already visible in the attendance table. The toggle exists because
   * this is the one screen likely to be on a shared or projected display,
   * where an admin wants to hide them without leaving the page.
   */
  const [showFaces, setShowFaces] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.getMapOverview();
      setOverview(data);
    } catch (err) {
      setError((err as Error).message || 'Could not load the map.');
    } finally {
      setLoading(false);
    }
  }, []);

  /*
   * The first fetch is written out rather than calling `load()`.
   *
   * `load` sets `loading` before its first await, so calling it straight from
   * an effect body is a synchronous setState inside an effect -- the cascading
   * render the lint rule exists to stop. Everything below happens after an
   * await instead, which is the shape it asks for. `load` stays for the
   * Refresh button, where a synchronous setState is fine because a click is
   * already an event.
   */
  useEffect(() => {
    if (!readSession()) {
      router.replace('/');
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const data = await api.getMapOverview();
        if (!cancelled) setOverview(data);
      } catch (err) {
        if (!cancelled) {
          setError((err as Error).message || 'Could not load the map.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [router]);

  const employees = useMemo(() => overview?.employees ?? [], [overview]);

  const counts = useMemo(
    () => ({
      inside: employees.filter((e) => e.status === 'inside').length,
      outside: employees.filter((e) => e.status === 'outside').length,
      unknown: employees.filter((e) => e.status === 'unknown').length,
    }),
    [employees],
  );

  const fences: MapFence[] = useMemo(
    () =>
      (overview?.sites ?? [])
        .filter(
          (site) =>
            (Number.isFinite(site.latitude) && Number.isFinite(site.longitude)) ||
            (site.polygon?.length ?? 0) >= 3,
        )
        .map((site) => ({
          id: site.id,
          name: site.name,
          latitude: site.latitude as number,
          longitude: site.longitude as number,
          radiusM: site.radiusM,
          polygon: site.polygon,
        })),
    [overview],
  );

  const pins: MapPin[] = useMemo(
    () =>
      employees
        .filter(
          (e) =>
            e.latitude !== null &&
            e.longitude !== null &&
            Number.isFinite(e.latitude) &&
            Number.isFinite(e.longitude),
        )
        .map((e) => ({
          id: e.id,
          latitude: e.latitude as number,
          longitude: e.longitude as number,
          label: e.fullName,
          tone: e.status as PinTone,
          detail: `${e.siteName ?? 'No site'} \u00b7 ${describePosition(e)}`,
          faceUrl: showFaces ? e.faceImage : null,
        })),
    [employees, showFaces],
  );

  const visible = onlyOutside
    ? employees.filter((e) => e.status === 'outside')
    : employees;

  const selected = employees.find((e) => e.id === selectedId) ?? null;
  const focus =
    selected && selected.latitude !== null && selected.longitude !== null
      ? { latitude: selected.latitude, longitude: selected.longitude }
      : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-brand-800">Live Map</h2>
          <p className="text-sm text-silver-800 mt-0.5">
            Each pin is where that person last punched, not where they are right
            now.
            {overview?.generatedAt
              ? ` Refreshed ${formatRelative(overview.generatedAt)}.`
              : ''}
          </p>
        </div>
        <Button variant="outline" onClick={load} disabled={loading}>
          <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-critical-200 bg-critical-50 p-3">
          <AlertTriangle className="w-4 h-4 text-critical-600 shrink-0 mt-0.5" />
          <p className="text-sm text-critical-700">{error}</p>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          label="Inside their site"
          value={counts.inside}
          icon={CheckCircle2}
        />
        <StatCard
          label="Outside their site"
          value={counts.outside}
          icon={AlertTriangle}
          tone="critical"
        />
        <StatCard
          label="No location yet"
          value={counts.unknown}
          icon={HelpCircle}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle>Site boundaries</CardTitle>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setShowFaces((v) => !v)}
                aria-pressed={showFaces}
                className={`text-xs rounded-full border px-2.5 py-1 transition-colors ${
                  showFaces
                    ? 'bg-brand-50 border-silver-200 text-brand-800'
                    : 'border-silver-200 text-silver-800 hover:bg-silver-50'
                }`}
              >
                Show faces
              </button>
              <MapLegend />
            </div>
          </CardHeader>
          <CardContent>
            <GeoMap
              fences={fences}
              pins={pins}
              focus={focus}
              height={480}
              onPinClick={(id) => setSelectedId(id)}
              emptyMessage="No employee has checked in yet, so there is nothing to place."
            />
            <p className="text-xs text-silver-800 mt-3">
              A pin with a face uses the enrolment photo where one exists, and
              the most recent punch capture otherwise. Anyone with neither keeps
              a symbol pin, and the ring still carries the inside/outside
              verdict either way.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle>People</CardTitle>
            <button
              type="button"
              onClick={() => setOnlyOutside((v) => !v)}
              aria-pressed={onlyOutside}
              className={`text-xs rounded-full border px-2.5 py-1 transition-colors ${
                onlyOutside
                  ? 'bg-critical-50 border-critical-200 text-critical-600'
                  : 'border-silver-200 text-silver-800 hover:bg-silver-50'
              }`}
            >
              Outside only
            </button>
          </CardHeader>
          <CardContent className="p-0">
            {loading && !overview ? (
              <div className="p-6 text-sm text-silver-800">Loading locations…</div>
            ) : visible.length === 0 ? (
              <div className="p-6 text-sm text-silver-800">
                {onlyOutside
                  ? 'Nobody is outside their site right now.'
                  : 'No active employees.'}
              </div>
            ) : (
              <ul className="divide-y divide-silver-200 max-h-[480px] overflow-y-auto">
                {visible.map((employee) => (
                  <li key={employee.id}>
                    <button
                      type="button"
                      onClick={() =>
                        setSelectedId((prev) =>
                          prev === employee.id ? null : employee.id,
                        )
                      }
                      className={`w-full text-left px-5 py-3 transition-colors hover:bg-silver-50 ${
                        selectedId === employee.id ? 'bg-brand-50' : ''
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-ink truncate">
                            {employee.fullName}
                          </p>
                          <p className="text-xs text-silver-800 mt-0.5 truncate">
                            {employee.employeeCode ?? '—'}
                            {employee.siteName ? ` · ${employee.siteName}` : ''}
                          </p>
                        </div>
                        <StatusBadge status={employee.status} />
                      </div>
                      <p className="text-xs text-silver-800 mt-1.5">
                        {describePosition(employee)}
                        {employee.lastSeenAt
                          ? ` · ${formatRelative(employee.lastSeenAt)}`
                          : ''}
                      </p>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <p className="text-xs text-silver-800">
        {employees.length} active {employees.length === 1 ? 'person' : 'people'} ·{' '}
        {fences.length} {fences.length === 1 ? 'boundary' : 'boundaries'}. A
        position is recorded when someone checks in or out, so someone who has
        not punched today will not appear on the map.
      </p>
    </div>
  );
}

function MapLegend() {
  return (
    <div className="hidden sm:flex items-center gap-3 text-xs text-silver-800">
      <span className="flex items-center gap-1.5">
        <CheckCircle2 className="w-3.5 h-3.5 text-brand-600" />
        Inside
      </span>
      <span className="flex items-center gap-1.5">
        <AlertTriangle className="w-3.5 h-3.5 text-critical-600" />
        Outside
      </span>
      <span className="flex items-center gap-1.5">
        <HelpCircle className="w-3.5 h-3.5 text-silver-700" />
        No fix
      </span>
    </div>
  );
}

function StatusBadge({ status }: { status: MapEmployee['status'] }) {
  if (status === 'inside') {
    return (
      <Badge variant="success" className="shrink-0">
        <CheckCircle2 className="w-3 h-3 mr-1" />
        Inside
      </Badge>
    );
  }
  if (status === 'outside') {
    return (
      <Badge variant="error" className="shrink-0">
        <AlertTriangle className="w-3 h-3 mr-1" />
        Outside
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="shrink-0 text-silver-800">
      <HelpCircle className="w-3 h-3 mr-1" />
      No fix
    </Badge>
  );
}

/** Metres from the site centre, or why we cannot say. */
function describePosition(employee: MapEmployee): string {
  if (employee.latitude === null || employee.longitude === null) {
    return 'No location recorded yet';
  }
  if (employee.distanceM === null) {
    return 'Site has no boundary set';
  }
  if (employee.distanceM < 1000) {
    return `${employee.distanceM} m from the site centre`;
  }
  return `${(employee.distanceM / 1000).toFixed(1)} km from the site centre`;
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'unknown time';

  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 60) return 'just now';

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;

  const days = Math.round(hours / 24);
  return `${days} ${days === 1 ? 'day' : 'days'} ago`;
}
