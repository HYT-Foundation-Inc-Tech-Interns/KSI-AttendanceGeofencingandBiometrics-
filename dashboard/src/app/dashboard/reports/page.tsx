'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Select } from '@/components/ui/select';
import { StatCard } from '@/components/ui/stat-card';
import { Users, TrendingUp, AlertTriangle, Clock } from 'lucide-react';
import { api } from '@/lib/api';
import { format, startOfMonth, endOfMonth, subMonths, parseISO } from 'date-fns';

interface Employee {
  id: string;
  employeeCode: string;
  fullName: string;
  email: string;
  site: {
    name: string;
  };
}

interface AttendanceEvent {
  id: string;
  employeeId: string;
  eventType: 'check_in' | 'check_out';
  deviceTimestamp: string;
  status: string;
  employee?: {
    fullName: string;
    employeeCode: string;
  };
}

interface EmployeeSummary {
  employee: Employee;
  totalDays: number;
  presentDays: number;
  checkIns: number;
  checkOuts: number;
  flaggedEvents: number;
  pendingApprovals: number;
  avgCheckInTime: string;
  avgCheckOutTime: string;
}

/**
 * "1 employees" is the kind of thing that makes an otherwise careful report read
 * as machine-written. Only the count varies, so the noun and the verb are chosen
 * together.
 */
function employeeCount(n: number) {
  return n === 1
    ? { noun: 'employee', has: 'has' }
    : { noun: 'employees', has: 'have' };
}

export default function ReportsPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [startDate, setStartDate] = useState(format(startOfMonth(new Date()), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState(format(endOfMonth(new Date()), 'yyyy-MM-dd'));
  const [selectedEmployee, setSelectedEmployee] = useState<string>('all');
  const [summaries, setSummaries] = useState<EmployeeSummary[]>([]);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    loadEmployees();
  }, []);

  useEffect(() => {
    if (employees.length > 0) {
      generateReport();
    }
  }, [startDate, endDate, selectedEmployee, employees]);

  const loadEmployees = async () => {
    try {
      const token = localStorage.getItem('accessToken');
      if (!token) return;

      const data = await api.getEmployees(token);
      setEmployees(Array.isArray(data) ? data : data.data || []);
    } catch (error) {
      console.error('Failed to load employees:', error);
    } finally {
      setLoading(false);
    }
  };

  const generateReport = async () => {
    try {
      const token = localStorage.getItem('accessToken');
      if (!token) return;

      const employeesToProcess = selectedEmployee === 'all' 
        ? employees 
        : employees.filter(e => e.id === selectedEmployee);

      const summariesData: EmployeeSummary[] = [];

      for (const employee of employeesToProcess) {
        // Fetch attendance events for this employee
        const events: AttendanceEvent[] = await api.getEmployeeAttendance(token, employee.id);
        
        // Filter events by date range
        const filteredEvents = events.filter(event => {
          const eventDate = format(parseISO(event.deviceTimestamp), 'yyyy-MM-dd');
          return eventDate >= startDate && eventDate <= endDate;
        });

        // Calculate metrics
        const checkIns = filteredEvents.filter(e => e.eventType === 'check_in');
        const checkOuts = filteredEvents.filter(e => e.eventType === 'check_out');
        const flagged = filteredEvents.filter(e => e.status === 'flagged');
        const pending = filteredEvents.filter(e => e.status === 'pending');

        // Calculate unique days present (days with at least one check-in)
        const uniqueDays = new Set(
          checkIns.map(e => format(parseISO(e.deviceTimestamp), 'yyyy-MM-dd'))
        );

        // Calculate average check-in/out times
        const checkInTimes = checkIns.map(e => new Date(e.deviceTimestamp).getHours() * 60 + new Date(e.deviceTimestamp).getMinutes());
        const checkOutTimes = checkOuts.map(e => new Date(e.deviceTimestamp).getHours() * 60 + new Date(e.deviceTimestamp).getMinutes());
        
        const avgCheckInMinutes = checkInTimes.length > 0 
          ? Math.round(checkInTimes.reduce((a, b) => a + b, 0) / checkInTimes.length)
          : 0;
        const avgCheckOutMinutes = checkOutTimes.length > 0
          ? Math.round(checkOutTimes.reduce((a, b) => a + b, 0) / checkOutTimes.length)
          : 0;

        const formatTime = (minutes: number) => {
          const hours = Math.floor(minutes / 60);
          const mins = minutes % 60;
          return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
        };

        // Calculate total working days in period
        const start = new Date(startDate);
        const end = new Date(endDate);
        const totalDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;

        summariesData.push({
          employee,
          totalDays,
          presentDays: uniqueDays.size,
          checkIns: checkIns.length,
          checkOuts: checkOuts.length,
          flaggedEvents: flagged.length,
          pendingApprovals: pending.length,
          avgCheckInTime: checkInTimes.length > 0 ? formatTime(avgCheckInMinutes) : 'N/A',
          avgCheckOutTime: checkOutTimes.length > 0 ? formatTime(avgCheckOutMinutes) : 'N/A',
        });
      }

      setSummaries(summariesData);
    } catch (error) {
      console.error('Failed to generate report:', error);
    }
  };

  const handleExportCSV = () => {
    setExporting(true);
    
    try {
      // CSV headers
      const headers = [
        'Employee Code',
        'Employee Name',
        'Email',
        'Site',
        'Period Days',
        'Days Present',
        'Attendance Rate',
        'Total Check-ins',
        'Total Check-outs',
        'Flagged Events',
        'Pending Approvals',
        'Avg Check-in Time',
        'Avg Check-out Time',
      ];

      // CSV rows
      const rows = summaries.map(summary => [
        summary.employee.employeeCode,
        summary.employee.fullName,
        summary.employee.email,
        summary.employee.site.name,
        summary.totalDays.toString(),
        summary.presentDays.toString(),
        `${((summary.presentDays / summary.totalDays) * 100).toFixed(1)}%`,
        summary.checkIns.toString(),
        summary.checkOuts.toString(),
        summary.flaggedEvents.toString(),
        summary.pendingApprovals.toString(),
        summary.avgCheckInTime,
        summary.avgCheckOutTime,
      ]);

      // Generate CSV content
      const csvContent = [
        headers.join(','),
        ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
      ].join('\n');

      // Download CSV
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', `attendance_report_${startDate}_to_${endDate}.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (error) {
      console.error('Failed to export CSV:', error);
      alert('Failed to export report');
    } finally {
      setExporting(false);
    }
  };

  const setDatePreset = (preset: string) => {
    const today = new Date();
    switch (preset) {
      case 'today':
        setStartDate(format(today, 'yyyy-MM-dd'));
        setEndDate(format(today, 'yyyy-MM-dd'));
        break;
      case 'this_week':
        const startOfWeek = new Date(today);
        startOfWeek.setDate(today.getDate() - today.getDay());
        setStartDate(format(startOfWeek, 'yyyy-MM-dd'));
        setEndDate(format(today, 'yyyy-MM-dd'));
        break;
      case 'this_month':
        setStartDate(format(startOfMonth(today), 'yyyy-MM-dd'));
        setEndDate(format(endOfMonth(today), 'yyyy-MM-dd'));
        break;
      case 'last_month':
        const lastMonth = subMonths(today, 1);
        setStartDate(format(startOfMonth(lastMonth), 'yyyy-MM-dd'));
        setEndDate(format(endOfMonth(lastMonth), 'yyyy-MM-dd'));
        break;
    }
  };

  const totalStats = {
    totalEmployees: summaries.length,
    avgAttendanceRate: summaries.length > 0
      ? (summaries.reduce((sum, s) => sum + (s.presentDays / s.totalDays), 0) / summaries.length * 100).toFixed(1)
      : '0',
    totalFlagged: summaries.reduce((sum, s) => sum + s.flaggedEvents, 0),
    totalPending: summaries.reduce((sum, s) => sum + s.pendingApprovals, 0),
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-2 border-silver-200 border-b-brand-800"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* The page name is already in the shell's top bar — see employees/page.tsx. */}
      <div className="flex justify-between items-center gap-4">
        <p className="text-sm text-silver-800">Analyze attendance patterns and export data</p>
        <Button onClick={handleExportCSV} disabled={exporting || summaries.length === 0}>
          {exporting ? (
            <>
              <svg className="animate-spin h-5 w-5 mr-2" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Exporting...
            </>
          ) : (
            <>
              <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Export CSV
            </>
          )}
        </Button>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard
          label="Employees in Report"
          value={totalStats.totalEmployees}
          icon={Users}
        />
        <StatCard
          label="Avg Attendance Rate"
          value={`${totalStats.avgAttendanceRate}%`}
          icon={TrendingUp}
        />
        {/* Both wear a status colour only when non-zero — a red "0" would read
            as a problem on a day with nothing wrong. */}
        <StatCard
          label="Flagged Events"
          value={totalStats.totalFlagged}
          icon={AlertTriangle}
          tone="critical"
        />
        <StatCard
          label="Pending Approvals"
          value={totalStats.totalPending}
          icon={Clock}
        />
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle>Report Filters</CardTitle>
          <CardDescription>Select date range and employee to generate report</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {/* Date Presets */}
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setDatePreset('today')}>
                Today
              </Button>
              <Button variant="outline" size="sm" onClick={() => setDatePreset('this_week')}>
                This Week
              </Button>
              <Button variant="outline" size="sm" onClick={() => setDatePreset('this_month')}>
                This Month
              </Button>
              <Button variant="outline" size="sm" onClick={() => setDatePreset('last_month')}>
                Last Month
              </Button>
            </div>

            {/* Custom Date Range */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Start Date</label>
                <Input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">End Date</label>
                <Input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Employee</label>
                <Select value={selectedEmployee} onChange={(e) => setSelectedEmployee(e.target.value)}>
                  <option value="all">All Employees</option>
                  {employees.map(emp => (
                    <option key={emp.id} value={emp.id}>
                      {emp.fullName} ({emp.employeeCode})
                    </option>
                  ))}
                </Select>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Report Table */}
      <Card>
        <CardHeader>
          <CardTitle>
            Attendance Summary ({summaries.length}{' '}
            {employeeCount(summaries.length).noun})
          </CardTitle>
          <CardDescription>
            Period: {format(new Date(startDate), 'MMM dd, yyyy')} - {format(new Date(endDate), 'MMM dd, yyyy')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Site</TableHead>
                  <TableHead className="text-center">Days Present</TableHead>
                  <TableHead className="text-center">Attendance Rate</TableHead>
                  <TableHead className="text-center">Check-ins</TableHead>
                  <TableHead className="text-center">Check-outs</TableHead>
                  <TableHead className="text-center">Avg In Time</TableHead>
                  <TableHead className="text-center">Avg Out Time</TableHead>
                  <TableHead className="text-center">Flagged</TableHead>
                  <TableHead className="text-center">Pending</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summaries.map((summary) => {
                  const attendanceRate = (summary.presentDays / summary.totalDays) * 100;
                  const rateColor = attendanceRate >= 95 ? 'text-brand-700' : 
                                   attendanceRate >= 85 ? 'text-warning-600' : 'text-critical-600';
                  
                  return (
                    <TableRow key={summary.employee.id}>
                      <TableCell>
                        <div>
                          <div className="font-medium">{summary.employee.fullName}</div>
                          <div className="text-sm text-silver-800">{summary.employee.employeeCode}</div>
                        </div>
                      </TableCell>
                      <TableCell>{summary.employee.site.name}</TableCell>
                      <TableCell className="text-center">
                        {summary.presentDays} / {summary.totalDays}
                      </TableCell>
                      <TableCell className="text-center">
                        <span className={`font-semibold ${rateColor}`}>
                          {attendanceRate.toFixed(1)}%
                        </span>
                      </TableCell>
                      <TableCell className="text-center">{summary.checkIns}</TableCell>
                      <TableCell className="text-center">{summary.checkOuts}</TableCell>
                      <TableCell className="text-center font-mono text-sm">
                        {summary.avgCheckInTime}
                      </TableCell>
                      <TableCell className="text-center font-mono text-sm">
                        {summary.avgCheckOutTime}
                      </TableCell>
                      <TableCell className="text-center">
                        {summary.flaggedEvents > 0 ? (
                          <Badge variant="error">
                            {summary.flaggedEvents}
                          </Badge>
                        ) : (
                          <span className="text-silver-800">0</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        {summary.pendingApprovals > 0 ? (
                          <Badge variant="warning">
                            {summary.pendingApprovals}
                          </Badge>
                        ) : (
                          <span className="text-silver-800">0</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {summaries.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center py-8 text-silver-800">
                      No data available for the selected period
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Report Insights */}
      {summaries.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Insights</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex items-start gap-3">
                <svg className="w-5 h-5 text-brand-700 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div>
                  <p className="font-medium">Perfect Attendance</p>
                  <p className="text-sm text-silver-800">
                    {(() => {
                      const n = summaries.filter(s => s.presentDays === s.totalDays).length;
                      const { noun } = employeeCount(n);
                      return `${n} ${noun} with 100% attendance rate`;
                    })()}
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <svg className="w-5 h-5 text-critical-600 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <div>
                  <p className="font-medium">Needs Review</p>
                  <p className="text-sm text-silver-800">
                    {(() => {
                      const n = summaries.filter(s => s.flaggedEvents > 0 || s.pendingApprovals > 0).length;
                      const { noun, has } = employeeCount(n);
                      return `${n} ${noun} ${has} events requiring attention`;
                    })()}
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <svg className="w-5 h-5 text-warning-600 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div>
                  <p className="font-medium">Low Attendance</p>
                  <p className="text-sm text-silver-800">
                    {(() => {
                      const n = summaries.filter(s => (s.presentDays / s.totalDays) < 0.85).length;
                      const { noun } = employeeCount(n);
                      return `${n} ${noun} below 85% attendance rate`;
                    })()}
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
