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
import { Users, UserCheck, UserMinus, UserX, Copy, Check, AlertTriangle, Mail } from 'lucide-react';
import { api } from '@/lib/api';

interface Employee {
  id: string;
  employeeCode: string;
  fullName: string;
  email: string;
  phone: string;
  // Mirrors EmployeeStatus in backend/src/database/entities/employee.entity.ts.
  // 'inactive' is NOT a member -- offering it made the create form fail with a
  // 400 from @IsEnum, and made the "Inactive" tile always read zero.
  status: 'active' | 'suspended' | 'offboarded';
  hiredAt: string;
  offboardedAt: string | null;
  site: {
    id: string;
    name: string;
    address: string;
  };
  createdAt: string;
}

interface Site {
  id: string;
  name: string;
  address: string;
}

/**
 * Credentials shown once, immediately after they are issued.
 *
 * The password is returned only by the credentials call and is never stored in
 * retrievable form, so this panel is the admin's single chance to record it.
 * Creating an employee does not produce one — credentials are issued
 * deliberately, per employee, from the row action.
 */
interface IssuedAccount {
  employeeName: string;
  email: string;
  temporaryPassword?: string;
  emailSent: boolean;
  emailError?: string;
  created: boolean;
}

export default function EmployeesPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [siteFilter, setSiteFilter] = useState<string>('all');
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [issuedAccount, setIssuedAccount] = useState<IssuedAccount | null>(null);
  const [notice, setNotice] = useState('');
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [formData, setFormData] = useState({
    employeeCode: '',
    fullName: '',
    email: '',
    phone: '',
    siteId: '',
    hiredAt: new Date().toISOString().split('T')[0],
    status: 'active',
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const token = localStorage.getItem('accessToken');
      if (!token) return;

      const [employeesData, sitesData] = await Promise.all([
        api.getEmployees(token),
        api.getSites(token),
      ]);

      // Handle both array and object responses
      const employeesList = Array.isArray(employeesData)
        ? employeesData
        : employeesData.data || [employeesData];

      const sitesList = Array.isArray(sitesData)
        ? sitesData
        : sitesData.data || [sitesData];

      setEmployees(employeesList);
      setSites(sitesList);
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleAddEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const token = localStorage.getItem('accessToken');
      if (!token) return;

      const payload: any = { ...formData };

      // Validate siteId is a UUID
      if (payload.siteId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payload.siteId)) {
        alert(`Invalid site selected. The siteId "${payload.siteId}" is not a valid UUID. Please select a valid site from the dropdown.`);
        return;
      }

      if (!payload.email) delete payload.email;
      if (!payload.phone) delete payload.phone;
      if (!payload.siteId) delete payload.siteId;
      if (!payload.hiredAt) delete payload.hiredAt;

      const created = await api.createEmployee(token, payload);
      setShowAddModal(false);
      resetForm();
      loadData();

      // No credentials come back any more: creating an employee no longer
      // provisions a login. Point the admin at the next step rather than
      // leaving them to wonder where the password went.
      setNotice(
        `${created?.fullName ?? payload.fullName} was added. ` +
          `Click "Generate Account" on their row to create their login and email the password.`
      );
    } catch (error: any) {
      console.error('Failed to create employee:', error);
      alert(`Failed to create employee: ${error.message || 'Unknown error'}`);
    }
  };

  const handleIssueCredentials = async (employee: Employee) => {
    if (
      !confirm(
        `Generate login credentials for ${employee.fullName}?\n\n` +
          `This creates their account if they do not have one, emails a temporary ` +
          `password to ${employee.email ?? 'their address'}, and invalidates any ` +
          `password they currently use.`
      )
    ) {
      return;
    }

    try {
      const token = localStorage.getItem('accessToken');
      if (!token) return;

      setNotice('');
      const result = await api.issueEmployeeCredentials(token, employee.id);
      setIssuedAccount({
        employeeName: employee.fullName,
        email: result?.email ?? employee.email,
        temporaryPassword: result?.temporaryPassword,
        emailSent: result?.emailSent ?? false,
        emailError: result?.emailError,
        created: result?.created ?? false,
      });
    } catch (error: any) {
      console.error('Failed to issue credentials:', error);
      alert(`Failed to issue credentials: ${error.message || 'Unknown error'}`);
    }
  };

  const handleUpdateEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEmployee) return;

    try {
      const token = localStorage.getItem('accessToken');
      if (!token) return;

      const payload: any = { ...formData };
      if (!payload.email) delete payload.email;
      if (!payload.phone) delete payload.phone;
      if (!payload.siteId) delete payload.siteId;
      if (!payload.hiredAt) delete payload.hiredAt;

      await api.updateEmployee(token, selectedEmployee.id, payload);
      setShowEditModal(false);
      setSelectedEmployee(null);
      resetForm();
      loadData();
    } catch (error: any) {
      console.error('Failed to update employee:', error);
      alert(`Failed to update employee: ${error.message || 'Unknown error'}`);
    }
  };

  const handleDeleteEmployee = async (id: string) => {
    if (!confirm('Are you sure you want to delete this employee?')) return;

    try {
      const token = localStorage.getItem('accessToken');
      if (!token) return;

      await api.deleteEmployee(token, id);
      loadData();
    } catch (error: any) {
      console.error('Failed to delete employee:', error);
      alert(`Failed to delete employee: ${error.message || 'Unknown error'}`);
    }
  };

  const openEditModal = (employee: Employee) => {
    setSelectedEmployee(employee);
    setFormData({
      employeeCode: employee.employeeCode,
      fullName: employee.fullName,
      email: employee.email,
      phone: employee.phone || '',
      siteId: employee.site.id,
      hiredAt: employee.hiredAt ? new Date(employee.hiredAt).toISOString().split('T')[0] : '',
      status: employee.status,
    });
    setShowEditModal(true);
  };

  const resetForm = () => {
    setFormData({
      employeeCode: '',
      fullName: '',
      email: '',
      phone: '',
      siteId: '',
      hiredAt: new Date().toISOString().split('T')[0],
      status: 'active',
    });
  };

  const filteredEmployees = employees.filter(emp => {
    const matchesSearch = 
      emp.fullName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      emp.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
      emp.employeeCode.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === 'all' || emp.status === statusFilter;
    const matchesSite = siteFilter === 'all' || emp.site.id === siteFilter;
    
    return matchesSearch && matchesStatus && matchesSite;
  });

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
        return 'bg-brand-100 text-brand-800';
      case 'offboarded':
        return 'bg-silver-100 text-silver-800';
      case 'suspended':
        return 'bg-critical-100 text-critical-600';
      default:
        return 'bg-silver-100 text-silver-800';
    }
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
      {/* The page name is already in the shell's top bar, so this row carries
          only the lead-in description and the primary action. */}
      <div className="flex justify-between items-center gap-4">
        <p className="text-sm text-silver-800">Manage employee profiles and assignments</p>
        <Button onClick={() => setShowAddModal(true)}>
          <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
          </svg>
          Add Employee
        </Button>
      </div>

      {/* Created-but-not-yet-provisioned hint. Creating an employee no longer
          issues a login, so the admin needs to be told what the next step is
          rather than being left to hunt for a password that was never made. */}
      {notice && (
        <div
          role="status"
          className="flex items-start gap-2 p-3 text-sm text-brand-800 bg-brand-50 border border-brand-200 rounded-lg"
        >
          <Check className="w-4 h-4 mt-0.5 shrink-0" />
          <span className="flex-1">{notice}</span>
          <button
            type="button"
            onClick={() => setNotice('')}
            className="text-brand-700 hover:text-brand-900 font-medium"
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard label="Total Employees" value={employees.length} icon={Users} />
        <StatCard
          label="Active"
          value={employees.filter(e => e.status === 'active').length}
          icon={UserCheck}
        />
        <StatCard
          label="Offboarded"
          value={employees.filter(e => e.status === 'offboarded').length}
          icon={UserMinus}
        />
        {/* Critical only when non-zero — see StatCard. */}
        <StatCard
          label="Suspended"
          value={employees.filter(e => e.status === 'suspended').length}
          icon={UserX}
          tone="critical"
        />
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle>Filter Employees</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Search</label>
              <Input
                placeholder="Name, email, or code..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Status</label>
              <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                <option value="all">All Statuses</option>
                <option value="active">Active</option>
                <option value="suspended">Suspended</option>
                <option value="offboarded">Offboarded</option>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Site</label>
              <Select value={siteFilter} onChange={(e) => setSiteFilter(e.target.value)}>
                <option value="all">All Sites</option>
                {sites.map(site => (
                  <option key={site.id} value={site.id}>{site.name}</option>
                ))}
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Employees Table */}
      <Card>
        <CardHeader>
          <CardTitle>Employee List ({filteredEmployees.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Site</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Hired Date</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredEmployees.map((employee) => (
                <TableRow key={employee.id}>
                  <TableCell className="font-medium">{employee.employeeCode}</TableCell>
                  <TableCell>{employee.fullName}</TableCell>
                  <TableCell>{employee.email}</TableCell>
                  <TableCell>
                    <div className="text-sm">
                      <div className="font-medium">{employee.site.name}</div>
                      <div className="text-silver-800">{employee.site.address}</div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge className={`capitalize ${getStatusColor(employee.status)}`}>
                      {employee.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {employee.hiredAt ? new Date(employee.hiredAt).toLocaleDateString() : 'N/A'}
                  </TableCell>
                  <TableCell className="text-right">
                    {/* `space-x-2` on the cell left the two buttons wrapping
                        onto separate lines in the narrow actions column. */}
                    <div className="flex justify-end gap-2 whitespace-nowrap">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openEditModal(employee)}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleIssueCredentials(employee)}
                        title="Create or reset this employee's login and email them the password"
                      >
                        Generate Account
                      </Button>
                      <Button
                        variant="critical"
                        size="sm"
                        onClick={() => handleDeleteEmployee(employee.id)}
                      >
                        Delete
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {filteredEmployees.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-silver-800">
                    No employees found
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Add Employee Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-silver-950/40 backdrop-blur-sm flex items-center justify-center z-50">
          <Card className="w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <CardHeader>
              <CardTitle>Add New Employee</CardTitle>
              <CardDescription>Create a new employee profile</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleAddEmployee} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Employee Code *</label>
                    <Input
                      required
                      value={formData.employeeCode}
                      onChange={(e) => setFormData({ ...formData, employeeCode: e.target.value })}
                      placeholder="EMP001"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Full Name *</label>
                    <Input
                      required
                      value={formData.fullName}
                      onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                      placeholder="Juan Dela Cruz"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Email *</label>
                    <Input
                      required
                      type="email"
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      placeholder="juan@klassic.ph"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Phone</label>
                    <Input
                      value={formData.phone}
                      onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                      placeholder="+639171234567"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Site *</label>
                    <select 
                      required
                      value={formData.siteId} 
                      onChange={(e) => setFormData({ ...formData, siteId: e.target.value })}
                      className="w-full px-3 py-2 border border-silver-300 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-600"
                    >
                      <option value="">Select site</option>
                      {sites.map(site => (
                        <option key={site.id} value={site.id}>{site.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Hired Date</label>
                    <Input
                      type="date"
                      value={formData.hiredAt}
                      onChange={(e) => setFormData({ ...formData, hiredAt: e.target.value })}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Status</label>
                  <Select 
                    value={formData.status} 
                    onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                  >
                    <option value="active">Active</option>
                    <option value="suspended">Suspended</option>
                    <option value="offboarded">Offboarded</option>
                  </Select>
                </div>
                <div className="flex justify-end gap-2 pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setShowAddModal(false);
                      resetForm();
                    }}
                  >
                    Cancel
                  </Button>
                  <Button type="submit">Create Employee</Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Edit Employee Modal */}
      {showEditModal && selectedEmployee && (
        <div className="fixed inset-0 bg-silver-950/40 backdrop-blur-sm flex items-center justify-center z-50">
          <Card className="w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <CardHeader>
              <CardTitle>Edit Employee</CardTitle>
              <CardDescription>Update employee information</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleUpdateEmployee} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Employee Code *</label>
                    <Input
                      required
                      value={formData.employeeCode}
                      onChange={(e) => setFormData({ ...formData, employeeCode: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Full Name *</label>
                    <Input
                      required
                      value={formData.fullName}
                      onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Email *</label>
                    <Input
                      required
                      type="email"
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Phone</label>
                    <Input
                      value={formData.phone}
                      onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Site *</label>
                    <Select 
                      value={formData.siteId} 
                      onChange={(e) => setFormData({ ...formData, siteId: e.target.value })}
                    >
                      {sites.map(site => (
                        <option key={site.id} value={site.id}>{site.name}</option>
                      ))}
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Hired Date</label>
                    <Input
                      type="date"
                      value={formData.hiredAt}
                      onChange={(e) => setFormData({ ...formData, hiredAt: e.target.value })}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Status</label>
                  <Select 
                    value={formData.status} 
                    onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                  >
                    <option value="active">Active</option>
                    <option value="suspended">Suspended</option>
                    <option value="offboarded">Offboarded</option>
                  </Select>
                </div>
                <div className="flex justify-end gap-2 pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setShowEditModal(false);
                      setSelectedEmployee(null);
                      resetForm();
                    }}
                  >
                    Cancel
                  </Button>
                  <Button type="submit">Save Changes</Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Issued credentials.
          Shown once and only once: the password is stored as a bcrypt hash and
          cannot be read back, so if the admin closes this without recording it
          the only remedy is Generate Account, which issues a fresh one. */}
      {issuedAccount && (
        <div className="fixed inset-0 bg-silver-950/40 backdrop-blur-sm flex items-center justify-center z-50">
          <Card className="w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <CardHeader>
              <CardTitle>
                {issuedAccount.created ? 'Account Created' : 'New Password Issued'}
              </CardTitle>
              <CardDescription>
                Login details for {issuedAccount.employeeName}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1">
                <label className="text-sm font-medium">Email</label>
                <div className="flex items-center gap-2">
                  <code className="flex-1 px-3 py-2 bg-silver-100 rounded-md text-sm break-all">
                    {issuedAccount.email}
                  </code>
                  <CopyButton value={issuedAccount.email} label="Copy email" />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-sm font-medium">Temporary Password</label>
                {issuedAccount.temporaryPassword ? (
                  <div className="flex items-center gap-2">
                    <code className="flex-1 px-3 py-2 bg-silver-100 rounded-md text-sm font-semibold tracking-wide break-all">
                      {issuedAccount.temporaryPassword}
                    </code>
                    <CopyButton
                      value={issuedAccount.temporaryPassword}
                      label="Copy password"
                    />
                  </div>
                ) : (
                  <p className="text-sm text-silver-800">
                    The server did not return a password for this action.
                  </p>
                )}
              </div>

              {/* Delivery status. When SMTP is not configured the password is
                  only ever visible here, so this cannot be a quiet footnote. */}
              {issuedAccount.emailSent ? (
                <div className="flex items-start gap-2 p-3 rounded-md bg-brand-50 text-brand-800 text-sm">
                  <Mail className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>
                    These details were also emailed to {issuedAccount.email}.
                  </span>
                </div>
              ) : (
                <div className="flex items-start gap-2 p-3 rounded-md bg-warning-50 text-warning-700 text-sm">
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>
                    <strong>Not emailed.</strong>{' '}
                    {issuedAccount.emailError ||
                      'Email delivery is not configured.'}{' '}
                    Record the password above and pass it on yourself — it will
                    not be shown again.
                  </span>
                </div>
              )}

              <p className="text-sm text-silver-800">
                The employee signs in at <strong>/checkin</strong> on their
                phone using this email and password.
              </p>

              <div className="flex justify-end pt-2">
                <Button onClick={() => setIssuedAccount(null)}>
                  I&apos;ve recorded it
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

/**
 * Copy-to-clipboard with a confirmed state.
 *
 * navigator.clipboard is undefined outside a secure context, and this
 * dashboard is also used over plain http on a LAN during development, so the
 * textarea/execCommand path is kept as a fallback rather than left to throw.
 */
function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(value);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = value;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Copy failed:', error);
    }
  };

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={copy}
      aria-label={label}
    >
      {copied ? (
        <>
          <Check className="w-4 h-4 mr-1" /> Copied
        </>
      ) : (
        <>
          <Copy className="w-4 h-4 mr-1" /> Copy
        </>
      )}
    </Button>
  );
}
