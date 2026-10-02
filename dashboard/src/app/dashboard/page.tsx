'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { StatCard } from '@/components/ui/stat-card';
import { Users, MapPin, CheckCircle, AlertCircle, RefreshCw, ArrowRight } from 'lucide-react';
import { api } from '@/lib/api';
import { formatLate } from '@/lib/format';

interface DashboardStats {
  totalEmployees: number;
  totalSites: number;
  checkedInToday: number;
  flaggedEvents: number;
  detailLimit: number;
  details: {
    employees: Array<{
      id: string;
      employeeName: string;
      employeeCode: string | null;
      siteId: string | null;
      siteName: string | null;
      hiredAt: string | null;
    }>;
    sites: Array<{
      id: string;
      name: string;
      address: string | null;
      radiusM: number | null;
      hasPolygon: boolean;
      shiftStartTime: string | null;
      status: string;
    }>;
    checkedIn: Array<{
      id: string;
      employeeId: string;
      employeeName: string;
      employeeCode: string | null;
      siteId: string | null;
      siteName: string | null;
      checkInTime: string;
      shiftStartTime: string | null;
      lateMinutes: number | null;
      isLate: boolean;
    }>;
    flagged: Array<{
      id: string;
      employeeId: string;
      employeeName: string;
      employeeCode: string | null;
      siteName: string | null;
      eventType: 'check_in' | 'check_out';
      reasonCode: string;
      reason: string;
      timestamp: string;
      captureImage: string | null;
    }>;
  };
}

interface RecentCheckIn {
  id: string;
  employeeName: string;
  siteName: string;
  checkInTime: string;
  verificationStatus: string;
}

interface FlaggedEvent {
  id: string;
  employeeName: string;
  reason: string;
  timestamp: string;
}

/** The empty value every tile falls back to until the first response lands. */
const EMPTY_STATS: DashboardStats = {
  totalEmployees: 0,
  totalSites: 0,
  checkedInToday: 0,
  flaggedEvents: 0,
  detailLimit: 50,
  details: { employees: [], sites: [], checkedIn: [], flagged: [] },
};

/*
 * Hover-detail primitives.
 *
 * These are local to the dashboard on purpose: they are the shape a stat
 * tile's popup needs, and nothing else in the app renders one yet. They live
 * here rather than in `components/ui` so they are not mistaken for a general
 * list component before a second caller exists.
 */
function DetailRows({ children }: { children: ReactNode }) {
  return (
    <div className="divide-y divide-silver-100" data-detail-list="">
      {children}
    </div>
  );
}

function DetailRow({
  title,
  subtitle,
  right,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
}) {
  return (
    // `data-detail-row` is the hook a test counts to prove the popup and the
    // number above it agree -- the one promise this feature makes.
    <div
      data-detail-row=""
      className="flex items-start justify-between gap-3 py-2 first:pt-0 last:pb-0"
    >
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink truncate">{title}</p>
        {subtitle && <p className="text-xs text-silver-800 truncate">{subtitle}</p>}
      </div>
      {right && <div className="shrink-0 text-right">{right}</div>}
    </div>
  );
}

/**
 * Says so when a list is not the whole story.
 *
 * The tile shows the true total while the list is capped, so a full list that
 * silently stopped at 50 would read as "there are only 50" -- the popup would
 * be lying about the number printed directly above it.
 */
function TruncationNote({ shown, total }: { shown: number; total: number }) {
  if (shown >= total) return null;

  return (
    <p className="pt-2 text-xs text-silver-800">
      Showing {shown} of {total}.
    </p>
  );
}

/** `HH:mm` from a Postgres time column, or a dash when the site has none. */
function shiftStartLabel(shiftStartTime: string | null) {
  return shiftStartTime ? `Shift starts ${shiftStartTime}` : 'No shift start set';
}

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats>(EMPTY_STATS);
  const [recentCheckIns, setRecentCheckIns] = useState<RecentCheckIn[]>([]);
  const [flaggedEvents, setFlaggedEvents] = useState<FlaggedEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchDashboardData = useCallback(async () => {
    try {
      setLoading(true);
      const [statsData, checkInsData, flaggedData] = await Promise.all([
        api.getDashboardStatistics(),
        api.getRecentCheckIns(),
        api.getFlaggedEvents(),
      ]);

      setStats(statsData);
      setRecentCheckIns(checkInsData);
      setFlaggedEvents(flaggedData);
    } catch (error) {
      console.error('Failed to fetch dashboard data:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDashboardData();
  }, [fetchDashboardData]);

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  };

  const { employees, sites, checkedIn, flagged } = stats.details;

  /*
   * Stat tiles carry ONE brand treatment, not four different hues. Colouring
   * each tile differently spends the colour channel re-encoding what the label
   * already says. The single exception is "Flagged Events", which genuinely
   * means *bad* and so wears the reserved critical token.
   *
   * Each tile also carries the rows behind its number, so the figure can be
   * read as people and places rather than as a count.
   */
  const statCards = [
    {
      title: 'Total Employees',
      value: stats.totalEmployees,
      icon: Users,
      detailsHint: 'Active employees in this organization',
      details: (
        <>
          <DetailRows>
            {employees.map((employee) => (
              <DetailRow
                key={employee.id}
                title={employee.employeeName}
                subtitle={`${employee.employeeCode ?? 'No code'} · ${
                  employee.siteName ?? 'No site assigned'
                }`}
              />
            ))}
          </DetailRows>
          <TruncationNote shown={employees.length} total={stats.totalEmployees} />
        </>
      ),
      emptyDetails: 'No active employees yet.',
    },
    {
      title: 'Active Sites',
      value: stats.totalSites,
      icon: MapPin,
      detailsHint: 'Sites that can currently take a punch',
      details: (
        <>
          <DetailRows>
            {sites.map((site) => (
              <DetailRow
                key={site.id}
                title={site.name}
                subtitle={site.address || 'No address on file'}
                right={
                  <p className="text-xs text-silver-800 whitespace-nowrap">
                    {site.radiusM !== null
                      ? `${site.radiusM} m fence`
                      : site.hasPolygon
                        ? 'Polygon fence'
                        : 'No fence set'}
                  </p>
                }
              />
            ))}
          </DetailRows>
          <TruncationNote shown={sites.length} total={stats.totalSites} />
        </>
      ),
      emptyDetails: 'No active sites yet.',
    },
    {
      title: 'Checked In Today',
      value: stats.checkedInToday,
      icon: CheckCircle,
      detailsHint: 'Today in Manila time, one row per employee',
      details: (
        <>
          <DetailRows>
            {checkedIn.map((event) => (
              <DetailRow
                key={event.id}
                title={event.employeeName}
                subtitle={`${event.employeeCode ?? 'No code'} · ${
                  event.siteName ?? 'Unknown site'
                }`}
                right={
                  <>
                    <p className="text-xs text-silver-800 whitespace-nowrap">
                      {formatTime(event.checkInTime)}
                    </p>
                    {event.isLate && event.lateMinutes !== null && (
                      <Badge variant="warning" className="mt-1">
                        Late {formatLate(event.lateMinutes)}
                      </Badge>
                    )}
                  </>
                }
              />
            ))}
          </DetailRows>
          <TruncationNote shown={checkedIn.length} total={stats.checkedInToday} />
        </>
      ),
      emptyDetails: 'Nobody has checked in yet today.',
    },
    {
      title: 'Flagged Events',
      value: stats.flaggedEvents,
      icon: AlertCircle,
      tone: 'critical' as const,
      detailsHint: 'Refused punches not yet reviewed',
      details: (
        <>
          <DetailRows>
            {flagged.map((event) => (
              <DetailRow
                key={event.id}
                title={event.employeeName}
                subtitle={`${event.reason} · ${event.siteName ?? 'Unknown site'}`}
                right={
                  <p className="text-xs text-silver-800 whitespace-nowrap">
                    {formatTime(event.timestamp)}
                  </p>
                }
              />
            ))}
          </DetailRows>
          <TruncationNote shown={flagged.length} total={stats.flaggedEvents} />
        </>
      ),
      emptyDetails: 'Nothing is waiting for review.',
    },
  ];

  const quickActions = [
    { href: '/dashboard/employees', icon: Users, title: 'Add Employee', hint: 'Enroll new employee' },
    { href: '/dashboard/sites', icon: MapPin, title: 'Add Site', hint: 'Create new site' },
    { href: '/dashboard/attendance', icon: CheckCircle, title: 'Review Flags', hint: 'Check flagged events' },
    { href: '/dashboard/reports', icon: AlertCircle, title: 'Export Report', hint: 'Generate payroll' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-silver-800">
          {loading
            ? 'Loading latest figures…'
            : 'Figures below are live from the API. Hover a tile to see who it covers.'}
        </p>
        <Button variant="outline" size="sm" onClick={fetchDashboardData} disabled={loading}>
          <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {statCards.map((stat) => (
          <StatCard
            key={stat.title}
            label={stat.title}
            value={loading ? '—' : stat.value}
            icon={stat.icon}
            tone={stat.tone}
            details={stat.details}
            detailsHint={stat.detailsHint}
            emptyDetails={stat.emptyDetails}
          />
        ))}
      </div>

      {/* Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Recent Check-Ins</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-sm text-silver-800">Loading…</p>
            ) : recentCheckIns.length === 0 ? (
              <p className="text-sm text-silver-800">No recent check-ins</p>
            ) : (
              <div className="divide-y divide-silver-200">
                {recentCheckIns.map((activity) => (
                  <div key={activity.id} className="flex items-center justify-between py-3 gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-9 h-9 bg-silver-100 rounded-full flex items-center justify-center shrink-0">
                        <span className="text-brand-800 font-medium text-sm">
                          {(activity.employeeName || '?')[0]}
                        </span>
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium text-ink truncate">{activity.employeeName}</p>
                        <p className="text-sm text-silver-800 truncate">{activity.siteName}</p>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm text-silver-800">{formatTime(activity.checkInTime)}</p>
                      <Badge
                        variant={activity.verificationStatus === 'verified' ? 'success' : 'error'}
                        className="mt-1"
                      >
                        {activity.verificationStatus}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Flagged Events</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-sm text-silver-800">Loading…</p>
            ) : flaggedEvents.length === 0 ? (
              <p className="text-sm text-silver-800">No flagged events</p>
            ) : (
              <div className="divide-y divide-silver-200">
                {flaggedEvents.map((event) => (
                  <div key={event.id} className="flex items-center justify-between py-3 gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-ink truncate">{event.employeeName}</p>
                      <p className="text-sm text-critical-600 truncate">{event.reason}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm text-silver-800">{formatTime(event.timestamp)}</p>
                      <a
                        href="/dashboard/attendance"
                        className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:text-brand-800 hover:underline mt-1"
                      >
                        Review
                        <ArrowRight className="w-3 h-3" />
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions */}
      <Card>
        <CardHeader>
          <CardTitle>Quick Actions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {quickActions.map((action) => (
              <a
                key={action.href}
                href={action.href}
                className="group p-4 border border-silver-200 rounded-lg hover:border-brand-600 hover:bg-brand-50 transition-colors"
              >
                <action.icon className="w-5 h-5 text-brand-800 mb-2.5" />
                <p className="font-medium text-ink text-sm">{action.title}</p>
                <p className="text-xs text-silver-800 mt-0.5">{action.hint}</p>
              </a>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
