'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { StatCard } from '@/components/ui/stat-card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Search,
  Download,
  MapPin,
  CheckCircle,
  XCircle,
  AlertCircle,
  Clock,
  Calendar,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  ScanFace,
} from 'lucide-react';
import {
  format,
  startOfDay,
  endOfDay,
  subDays,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
} from 'date-fns';
import { api } from '@/lib/api';
import FaceThumb from '@/components/face-thumb';
import {
  createZip,
  dataUrlExtension,
  dataUrlToBytes,
  downloadBlob,
  type ZipEntry,
} from '@/lib/zip';

/**
 * Mirrors the statuses the backend actually stores (AttendanceStatus enum).
 * There is no `approved` value — approving an event moves it to `verified`.
 */
type AttendanceStatus = 'pending' | 'verified' | 'flagged' | 'rejected' | 'exported';
type EventType = 'check_in' | 'check_out';
type DateFilter = 'today' | 'yesterday' | 'week' | 'month' | 'custom' | 'all';

interface AttendanceEvent {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  siteId: string;
  siteName: string;
  eventType: EventType;
  deviceTimestamp: string;
  serverTimestamp: string;
  status: AttendanceStatus;
  latitude: number | null;
  longitude: number | null;
  gpsAccuracyMeters: number | null;
  livenessScore: number | null;
  matchScore: number | null;
  flagReason: string | null;
  isMockLocation: boolean;
  createdOffline: boolean;
  /**
   * The face captured at this punch, as a small JPEG data URL, or null when no
   * image was taken or the retention sweep has cleared it.
   *
   * Inline rather than a URL because the dashboard authenticates with a Bearer
   * token, which an `<img src>` cannot send.
   */
  captureImage: string | null;
}

interface Counts {
  checkInsToday: number;
  flagged: number;
  verified: number;
  total: number;
}

const EMPTY_COUNTS: Counts = { checkInsToday: 0, flagged: 0, verified: 0, total: 0 };

/** Resolve the date-range filter into the ISO bounds the API expects. */
function resolveDateRange(
  filter: DateFilter,
  customStart: string,
  customEnd: string
): { startDate?: string; endDate?: string } {
  const now = new Date();

  switch (filter) {
    case 'today':
      return { startDate: startOfDay(now).toISOString(), endDate: endOfDay(now).toISOString() };
    case 'yesterday': {
      const yesterday = subDays(now, 1);
      return {
        startDate: startOfDay(yesterday).toISOString(),
        endDate: endOfDay(yesterday).toISOString(),
      };
    }
    case 'week':
      return {
        startDate: startOfWeek(now, { weekStartsOn: 1 }).toISOString(),
        endDate: endOfWeek(now, { weekStartsOn: 1 }).toISOString(),
      };
    case 'month':
      return {
        startDate: startOfMonth(now).toISOString(),
        endDate: endOfMonth(now).toISOString(),
      };
    case 'custom': {
      // A partial custom range is still useful: respect whichever end is set.
      const range: { startDate?: string; endDate?: string } = {};
      if (customStart) range.startDate = startOfDay(new Date(customStart)).toISOString();
      if (customEnd) range.endDate = endOfDay(new Date(customEnd)).toISOString();
      return range;
    }
    case 'all':
    default:
      return {};
  }
}

export default function AttendancePage() {
  const [events, setEvents] = useState<AttendanceEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<Counts>(EMPTY_COUNTS);
  const [isLoading, setIsLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [isExportingFaces, setIsExportingFaces] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingActionId, setPendingActionId] = useState<string | null>(null);

  const [searchInput, setSearchInput] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [dateFilter, setDateFilter] = useState<DateFilter>('today');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  const [page, setPage] = useState(1);
  const [limit] = useState(50);

  const [selectedEvent, setSelectedEvent] = useState<AttendanceEvent | null>(null);

  // Debounce the search box so typing does not fire a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchTerm(searchInput.trim());
      setPage(1);
    }, 400);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // Any filter change should return to the first page.
  useEffect(() => {
    setPage(1);
  }, [statusFilter, typeFilter, dateFilter, customStart, customEnd]);

  /** The filter set shared by the table query and the CSV export. */
  const buildFilters = useCallback(
    (forExport = false) => {
      const range = resolveDateRange(dateFilter, customStart, customEnd);
      return {
        ...(searchTerm ? { search: searchTerm } : {}),
        ...(statusFilter !== 'all' ? { status: statusFilter } : {}),
        ...(typeFilter !== 'all' ? { eventType: typeFilter } : {}),
        ...range,
        ...(forExport ? { page: 1, limit: 200 } : { page, limit }),
      };
    },
    [searchTerm, statusFilter, typeFilter, dateFilter, customStart, customEnd, page, limit]
  );

  const fetchEvents = useCallback(async () => {
    const token = localStorage.getItem('accessToken');
    if (!token) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const result = await api.getAttendanceEvents(token, buildFilters());
      setEvents(result.data ?? []);
      setTotal(result.total ?? 0);
    } catch (err: any) {
      setError(err?.message || 'Failed to load attendance events.');
      setEvents([]);
      setTotal(0);
    } finally {
      setIsLoading(false);
    }
  }, [buildFilters]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  /**
   * Headline cards. These are counted server-side with limit=1 so they reflect
   * the whole organisation rather than just the page on screen.
   */
  const fetchCounts = useCallback(async () => {
    const token = localStorage.getItem('accessToken');
    if (!token) return;

    const today = resolveDateRange('today', '', '');
    const countOf = async (filters: Record<string, any>) => {
      const res = await api.getAttendanceEvents(token, { ...filters, page: 1, limit: 1 });
      return res.total ?? 0;
    };

    try {
      const [checkInsToday, flagged, verified, all] = await Promise.all([
        countOf({ eventType: 'check_in', ...today }),
        countOf({ status: 'flagged' }),
        countOf({ status: 'verified' }),
        countOf({}),
      ]);
      setCounts({ checkInsToday, flagged, verified, total: all });
    } catch {
      // The table already surfaces load errors; cards just keep their last value.
    }
  }, []);

  useEffect(() => {
    fetchCounts();
  }, [fetchCounts]);

  const refreshAll = () => {
    fetchEvents();
    fetchCounts();
  };

  const applyUpdatedStatus = (eventId: string, status: AttendanceStatus) => {
    setEvents((prev) =>
      prev.map((e) => (e.id === eventId ? { ...e, status, flagReason: null } : e))
    );
    // The status filters and counters are now stale.
    fetchCounts();
  };

  const handleApprove = async (eventId: string) => {
    const token = localStorage.getItem('accessToken');
    if (!token) return;

    setPendingActionId(eventId);
    try {
      await api.approveAttendanceEvent(token, eventId);
      applyUpdatedStatus(eventId, 'verified');
      setSelectedEvent(null);
    } catch (err: any) {
      alert(err?.message || 'Failed to approve event');
    } finally {
      setPendingActionId(null);
    }
  };

  const handleReject = async (eventId: string) => {
    const reason = window.prompt('Enter rejection reason:');
    if (!reason) return;

    const token = localStorage.getItem('accessToken');
    if (!token) return;

    setPendingActionId(eventId);
    try {
      await api.rejectAttendanceEvent(token, eventId, reason);
      applyUpdatedStatus(eventId, 'rejected');
      setSelectedEvent(null);
    } catch (err: any) {
      alert(err?.message || 'Failed to reject event');
    } finally {
      setPendingActionId(null);
    }
  };

  const handleExport = async () => {
    const token = localStorage.getItem('accessToken');
    if (!token) return;

    setIsExporting(true);
    try {
      // Export every row matching the current filters, not just this page.
      const result = await api.getAttendanceEvents(token, buildFilters(true));
      const rows: AttendanceEvent[] = result.data ?? [];

      if (rows.length === 0) {
        alert('No events match the current filters.');
        return;
      }

      const headers = [
        'Employee',
        'Employee Code',
        'Site',
        'Type',
        'Device Time',
        'Server Time',
        'Status',
        'Latitude',
        'Longitude',
        'Flag Reason',
        'Offline Sync',
      ];

      const escape = (value: unknown) => {
        const text = value === null || value === undefined ? '' : String(value);
        return `"${text.replace(/"/g, '""')}"`;
      };

      const csv = [
        headers.map(escape).join(','),
        ...rows.map((e) =>
          [
            e.employeeName,
            e.employeeCode,
            e.siteName,
            e.eventType,
            e.deviceTimestamp,
            e.serverTimestamp,
            e.status,
            e.latitude,
            e.longitude,
            e.flagReason,
            e.createdOffline ? 'Yes' : 'No',
          ]
            .map(escape)
            .join(',')
        ),
      ].join('\r\n');

      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `attendance-${format(new Date(), 'yyyy-MM-dd')}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      alert(err?.message || 'Failed to export events');
    } finally {
      setIsExporting(false);
    }
  };

  /**
   * Download the captured faces as a ZIP, one image per attendance row.
   *
   * A ZIP rather than extra columns on the CSV: a face is roughly 8-12 KB of
   * base64, so two hundred rows would put a 2 MB blob in a single cell and most
   * spreadsheet programs would refuse to open it. The archive carries an index
   * CSV as well, so the images can be matched back to rows without guessing
   * from filenames.
   */
  const handleExportFaces = async () => {
    const token = localStorage.getItem('accessToken');
    if (!token) return;

    setIsExportingFaces(true);
    try {
      const result = await api.getAttendanceEvents(token, buildFilters(true));
      const rows: AttendanceEvent[] = result.data ?? [];
      const withFaces = rows.filter((event) => dataUrlToBytes(event.captureImage));

      if (withFaces.length === 0) {
        alert(
          rows.length === 0
            ? 'No events match the current filters.'
            : 'None of the matching events has a face image on file. They may have been cleared by the retention window.'
        );
        return;
      }

      const entries: ZipEntry[] = [];
      const indexRows: string[][] = [];
      /** Guards against two punches in the same second overwriting each other. */
      const usedNames = new Set<string>();

      for (const event of withFaces) {
        const bytes = dataUrlToBytes(event.captureImage);
        if (!bytes) continue;

        const extension = dataUrlExtension(event.captureImage as string);
        const stamp = format(new Date(event.serverTimestamp), 'yyyy-MM-dd_HHmmss');
        const kind = event.eventType === 'check_in' ? 'check-in' : 'check-out';

        let filename = `${event.employeeCode}_${stamp}_${kind}.${extension}`;
        let suffix = 1;
        while (usedNames.has(filename)) {
          filename = `${event.employeeCode}_${stamp}_${kind}_${suffix}.${extension}`;
          suffix += 1;
        }
        usedNames.add(filename);

        entries.push({ name: `faces/${filename}`, data: bytes });
        indexRows.push([
          event.employeeName,
          event.employeeCode,
          event.siteName,
          event.eventType,
          event.serverTimestamp,
          event.status,
          filename,
        ]);
      }

      const escape = (value: unknown) => {
        const text = value === null || value === undefined ? '' : String(value);
        return `"${text.replace(/"/g, '""')}"`;
      };

      const indexCsv = [
        ['Employee', 'Employee Code', 'Site', 'Type', 'Server Time', 'Status', 'Face File']
          .map(escape)
          .join(','),
        ...indexRows.map((row) => row.map(escape).join(',')),
      ].join('\r\n');

      // Listed first so the index is the obvious entry point when opened.
      entries.unshift({
        name: 'faces.csv',
        data: new TextEncoder().encode(indexCsv),
      });

      const today = format(new Date(), 'yyyy-MM-dd');
      downloadBlob(createZip(entries), `attendance-faces-${today}.zip`);
    } catch (err: any) {
      alert(err?.message || 'Failed to export faces');
    } finally {
      setIsExportingFaces(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'verified':
        return (
          <Badge variant="success" className="flex items-center gap-1">
            <CheckCircle className="w-3 h-3" />
            Verified
          </Badge>
        );
      case 'flagged':
        return (
          <Badge variant="error" className="flex items-center gap-1">
            <AlertCircle className="w-3 h-3" />
            Flagged
          </Badge>
        );
      case 'pending':
        return (
          <Badge variant="warning" className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            Pending
          </Badge>
        );
      case 'rejected':
        return (
          <Badge variant="error" className="flex items-center gap-1">
            <XCircle className="w-3 h-3" />
            Rejected
          </Badge>
        );
      case 'exported':
        return (
          <Badge variant="secondary" className="flex items-center gap-1">
            <Download className="w-3 h-3" />
            Exported
          </Badge>
        );
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  /*
   * Check-in wears the brand token; check-out is deliberately neutral. There is
   * no "check-out hue" in the logo palette, and inventing one (the previous
   * blue) would put an off-brand colour on the busiest screen in the app. The
   * words "Check In" / "Check Out" are always present, so nothing is carried by
   * colour alone.
   */
  const getEventTypeBadge = (type: string) => {
    return type === 'check_in' ? (
      <Badge variant="success">Check In</Badge>
    ) : (
      <Badge variant="secondary">Check Out</Badge>
    );
  };

  const formatTime = (timestamp: string) => {
    try {
      return format(new Date(timestamp), 'h:mm a');
    } catch {
      return timestamp;
    }
  };

  const formatDate = (timestamp: string) => {
    try {
      return format(new Date(timestamp), 'MMM dd, yyyy');
    } catch {
      return timestamp;
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / limit));
  const rangeStart = total === 0 ? 0 : (page - 1) * limit + 1;
  const rangeEnd = Math.min(page * limit, total);

  // Admins act on events that are not yet in a final state.
  const canReview = (status: AttendanceStatus) =>
    status === 'flagged' || status === 'pending';

  /*
   * Headline counters. One brand treatment for the neutral counts; only
   * "Flagged Events" wears the reserved critical token, because it is the one
   * figure that means *bad*. A different hue per tile would spend the colour
   * channel re-encoding what the label already says.
   */
  const stats = useMemo(
    () => [
      { label: "Today's Check-Ins", value: counts.checkInsToday, icon: CheckCircle },
      { label: 'Flagged Events', value: counts.flagged, icon: AlertCircle, tone: 'critical' as const },
      { label: 'Verified', value: counts.verified, icon: CheckCircle },
      { label: 'Total Events', value: counts.total, icon: RefreshCw },
    ],
    [counts]
  );

  return (
    <div className="space-y-6">
      {/* Header with Stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <StatCard
            key={stat.label}
            label={stat.label}
            value={stat.value}
            icon={stat.icon}
            tone={stat.tone}
          />
        ))}
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            {/* Search */}
            <div className="lg:col-span-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-silver-700 w-4 h-4" />
                <Input
                  placeholder="Search employee, code, or site..."
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>

            {/* Status Filter — values must match the backend AttendanceStatus enum */}
            <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="all">All Status</option>
              <option value="verified">Verified</option>
              <option value="flagged">Flagged</option>
              <option value="pending">Pending</option>
              <option value="rejected">Rejected</option>
              <option value="exported">Exported</option>
            </Select>

            {/* Type Filter */}
            <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
              <option value="all">All Types</option>
              <option value="check_in">Check In</option>
              <option value="check_out">Check Out</option>
            </Select>

            {/* Date Filter */}
            <Select
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value as DateFilter)}
            >
              <option value="today">Today</option>
              <option value="yesterday">Yesterday</option>
              <option value="week">This Week</option>
              <option value="month">This Month</option>
              <option value="custom">Custom Range</option>
              <option value="all">All Time</option>
            </Select>
          </div>

          {/* Custom range inputs */}
          {dateFilter === 'custom' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
              <div>
                <label className="block text-sm font-medium text-silver-800 mb-1">From</label>
                <Input
                  type="date"
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-silver-800 mb-1">To</label>
                <Input
                  type="date"
                  value={customEnd}
                  onChange={(e) => setCustomEnd(e.target.value)}
                />
              </div>
            </div>
          )}

          <div className="flex items-center gap-2 mt-4">
            <Button onClick={refreshAll} variant="outline" size="sm" disabled={isLoading}>
              <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            <Button onClick={handleExport} variant="outline" size="sm" disabled={isExporting}>
              <Download className="w-4 h-4 mr-2" />
              {isExporting ? 'Exporting...' : 'Export CSV'}
            </Button>
            <Button
              onClick={handleExportFaces}
              variant="outline"
              size="sm"
              disabled={isExportingFaces}
            >
              <ScanFace className="w-4 h-4 mr-2" />
              {isExportingFaces ? 'Exporting...' : 'Export Faces'}
            </Button>
            <div className="ml-auto text-sm text-silver-800">
              {total === 0
                ? 'No events'
                : `Showing ${rangeStart}-${rangeEnd} of ${total} events`}
            </div>
          </div>

          {error && (
            <div role="alert" className="mt-4 p-3 bg-critical-50 border border-critical-200 rounded-lg">
              <p className="text-sm text-critical-600">{error}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Attendance Table */}
      <Card>
        <CardHeader>
          <CardTitle>Attendance Events</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center h-64">
              <div className="animate-spin rounded-full h-10 w-10 border-2 border-silver-200 border-b-brand-800"></div>
            </div>
          ) : events.length === 0 ? (
            <div className="text-center py-12 text-silver-800">
              <Calendar className="w-10 h-10 mx-auto mb-3 text-silver-400" />
              <p>No attendance events found</p>
              <p className="text-sm mt-1">Try adjusting your filters</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Face</TableHead>
                  <TableHead>Site</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Time</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Scores</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.map((event) => (
                  <TableRow key={event.id}>
                    <TableCell>
                      <div>
                        <p className="font-medium text-ink">{event.employeeName}</p>
                        <p className="text-sm text-silver-800">{event.employeeCode}</p>
                      </div>
                    </TableCell>
                    {/*
                      The face as it was at this punch. Clicking opens the full
                      frame, which is the only way to answer "was that actually
                      them?" from the table without opening every row.
                    */}
                    <TableCell>
                      <button
                        onClick={() => setSelectedEvent(event)}
                        className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
                        aria-label={`View the captured face for ${event.employeeName}`}
                      >
                        <FaceThumb src={event.captureImage} name={event.employeeName} />
                      </button>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <MapPin className="w-4 h-4 text-silver-700 shrink-0" />
                        <span className="text-sm">{event.siteName}</span>
                      </div>
                    </TableCell>
                    <TableCell>{getEventTypeBadge(event.eventType)}</TableCell>
                    <TableCell>
                      <div>
                        <p className="text-sm font-medium">
                          {formatTime(event.serverTimestamp)}
                        </p>
                        <p className="text-xs text-silver-800">
                          {formatDate(event.serverTimestamp)}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>
                      {getStatusBadge(event.status)}
                      {event.flagReason && (
                        <p className="text-xs text-critical-600 mt-1">{event.flagReason}</p>
                      )}
                      {event.createdOffline && (
                        <Badge variant="outline" className="mt-1 text-xs">
                          Offline Sync
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="text-xs space-y-1">
                        {event.livenessScore !== null && (
                          <div className="flex items-center gap-1">
                            <span className="text-silver-800">Liveness:</span>
                            <span
                              className={
                                event.livenessScore >= 0.8
                                  ? 'text-brand-700 font-medium'
                                  : 'text-critical-600 font-medium'
                              }
                            >
                              {(event.livenessScore * 100).toFixed(0)}%
                            </span>
                          </div>
                        )}
                        {event.matchScore !== null && (
                          <div className="flex items-center gap-1">
                            <span className="text-silver-800">Match:</span>
                            <span
                              className={
                                event.matchScore >= 0.85
                                  ? 'text-brand-700 font-medium'
                                  : 'text-warning-600 font-medium'
                              }
                            >
                              {(event.matchScore * 100).toFixed(0)}%
                            </span>
                          </div>
                        )}
                        {event.livenessScore === null && event.matchScore === null && (
                          <span className="text-silver-800">—</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {canReview(event.status) && (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={pendingActionId === event.id}
                              onClick={() => handleApprove(event.id)}
                            >
                              Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="critical"
                              disabled={pendingActionId === event.id}
                              onClick={() => handleReject(event.id)}
                            >
                              Reject
                            </Button>
                          </>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => setSelectedEvent(event)}>
                          View
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {/* Pagination */}
          {!isLoading && totalPages > 1 && (
            <div className="flex items-center justify-between mt-4 pt-4 border-t border-silver-200">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                <ChevronLeft className="w-4 h-4 mr-1" />
                Previous
              </Button>
              <span className="text-sm text-silver-800">
                Page {page} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Next
                <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Event Detail Modal */}
      {selectedEvent && (
        <div
          className="fixed inset-0 bg-silver-950/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setSelectedEvent(null)}
        >
          <Card className="max-w-2xl w-full" onClick={(e) => e.stopPropagation()}>
            <CardHeader>
              <CardTitle>Attendance Event Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/*
                The face captured at this punch, at a size worth looking at.
                Sits above the field grid because it is the one piece of
                evidence that answers whether the right person was there -- the
                scores and coordinates below only say how confident the system
                was and where it thought it was.
              */}
              <div className="flex items-start gap-4">
                <FaceThumb
                  src={selectedEvent.captureImage}
                  name={selectedEvent.employeeName}
                  size="lg"
                />
                <div className="min-w-0">
                  <p className="text-sm text-silver-800">Face captured at check-in</p>
                  {selectedEvent.captureImage ? (
                    <p className="text-sm text-ink mt-1">
                      Cropped around the detected face at the moment of the punch.
                    </p>
                  ) : (
                    <p className="text-sm text-silver-800 mt-1">
                      No face image on file. Either none was captured, or it has
                      passed the retention window and been cleared.
                    </p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-silver-800">Employee</p>
                  <p className="font-medium">{selectedEvent.employeeName}</p>
                  <p className="text-sm text-silver-800">{selectedEvent.employeeCode}</p>
                </div>
                <div>
                  <p className="text-sm text-silver-800">Site</p>
                  <p className="font-medium">{selectedEvent.siteName}</p>
                </div>
                <div>
                  <p className="text-sm text-silver-800">Event Type</p>
                  {getEventTypeBadge(selectedEvent.eventType)}
                </div>
                <div>
                  <p className="text-sm text-silver-800">Status</p>
                  {getStatusBadge(selectedEvent.status)}
                </div>
                <div>
                  <p className="text-sm text-silver-800">Device Time</p>
                  <p className="font-medium">{formatTime(selectedEvent.deviceTimestamp)}</p>
                  <p className="text-sm text-silver-800">
                    {formatDate(selectedEvent.deviceTimestamp)}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-silver-800">Server Time</p>
                  <p className="font-medium">{formatTime(selectedEvent.serverTimestamp)}</p>
                  <p className="text-sm text-silver-800">
                    {formatDate(selectedEvent.serverTimestamp)}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-silver-800">Location</p>
                  <p className="font-mono text-xs">
                    {selectedEvent.latitude !== null && selectedEvent.longitude !== null
                      ? `${selectedEvent.latitude.toFixed(6)}, ${selectedEvent.longitude.toFixed(6)}`
                      : 'Not recorded'}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-silver-800">Capture</p>
                  <p className="text-sm">
                    {selectedEvent.createdOffline ? 'Offline (synced)' : 'Online'}
                    {selectedEvent.isMockLocation && ' · Mock location'}
                  </p>
                </div>
              </div>

              {selectedEvent.flagReason && (
                <div className="p-4 bg-critical-50 border border-critical-200 rounded-lg">
                  <p className="text-sm font-medium text-critical-600">Flag Reason</p>
                  <p className="text-sm text-critical-600 mt-1">{selectedEvent.flagReason}</p>
                </div>
              )}

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setSelectedEvent(null)}>
                  Close
                </Button>
                {canReview(selectedEvent.status) && (
                  <>
                    <Button
                      disabled={pendingActionId === selectedEvent.id}
                      onClick={() => handleApprove(selectedEvent.id)}
                    >
                      Approve
                    </Button>
                    <Button
                      disabled={pendingActionId === selectedEvent.id}
                      onClick={() => handleReject(selectedEvent.id)}
                      variant="destructive"
                    >
                      Reject
                    </Button>
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
