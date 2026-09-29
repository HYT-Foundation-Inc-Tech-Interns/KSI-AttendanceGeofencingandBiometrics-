'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { StatCard } from '@/components/ui/stat-card';
import { Users, MapPin, CheckCircle, AlertCircle, RefreshCw, ArrowRight } from 'lucide-react';
import { api } from '@/lib/api';

interface DashboardStats {
  totalEmployees: number;
  totalSites: number;
  checkedInToday: number;
  flaggedEvents: number;
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

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats>({
    totalEmployees: 0,
    totalSites: 0,
    checkedInToday: 0,
    flaggedEvents: 0,
  });
  const [recentCheckIns, setRecentCheckIns] = useState<RecentCheckIn[]>([]);
  const [flaggedEvents, setFlaggedEvents] = useState<FlaggedEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const fetchDashboardData = async () => {
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
  };

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  };

  /*
   * Stat tiles carry ONE brand treatment, not four different hues. Colouring
   * each tile differently spends the colour channel re-encoding what the label
   * already says. The single exception is "Flagged Events", which genuinely
   * means *bad* and so wears the reserved critical token.
   */
  const statCards = [
    { title: 'Total Employees', value: stats.totalEmployees, icon: Users },
    { title: 'Active Sites', value: stats.totalSites, icon: MapPin },
    { title: 'Checked In Today', value: stats.checkedInToday, icon: CheckCircle },
    { title: 'Flagged Events', value: stats.flaggedEvents, icon: AlertCircle, tone: 'critical' as const },
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
          {loading ? 'Loading latest figures…' : 'Figures below are live from the API.'}
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
