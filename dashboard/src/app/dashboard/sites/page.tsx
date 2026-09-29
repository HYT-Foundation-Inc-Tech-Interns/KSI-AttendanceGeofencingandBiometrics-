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
import { MapPin, CheckCircle, XCircle } from 'lucide-react';
import { api } from '@/lib/api';

interface Site {
  id: string;
  name: string;
  address: string;
  geofenceCenter: {
    type: string;
    coordinates: [number, number]; // [lng, lat]
  } | null;
  geofenceRadiusM: number;
  timezone: string;
  status: 'active' | 'inactive';
  createdAt: string;
  updatedAt: string;
}

export default function SitesPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedSite, setSelectedSite] = useState<Site | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    address: '',
    latitude: '',
    longitude: '',
    geofenceRadiusM: '100',
    timezone: 'Asia/Manila',
    status: 'active',
  });

  useEffect(() => {
    loadSites();
  }, []);

  const loadSites = async () => {
    try {
      const token = localStorage.getItem('accessToken');
      if (!token) return;

      const data = await api.getSites(token);
      setSites(Array.isArray(data) ? data : [data]);
    } catch (error) {
      console.error('Failed to load sites:', error);
    } finally {
      setLoading(false);
    }
  };

  const parseCoordinates = (geofenceCenter: { type: string; coordinates: [number, number] } | null) => {
    // Handle GeoJSON format from API
    if (!geofenceCenter || !geofenceCenter.coordinates) {
      return { lng: 0, lat: 0 };
    }
    
    const [lng, lat] = geofenceCenter.coordinates;
    return { lng, lat };
  };

  const handleAddSite = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const token = localStorage.getItem('accessToken');
      if (!token) return;

      const payload = {
        name: formData.name,
        address: formData.address,
        geofenceCenterLat: parseFloat(formData.latitude),
        geofenceCenterLng: parseFloat(formData.longitude),
        geofenceRadiusM: parseInt(formData.geofenceRadiusM),
        timezone: formData.timezone,
        status: formData.status,
      };

      await api.createSite(token, payload);
      setShowAddModal(false);
      resetForm();
      loadSites();
    } catch (error: any) {
      console.error('Failed to create site:', error);
      alert(`Failed to create site: ${error.message || 'Unknown error'}`);
    }
  };

  const handleUpdateSite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSite) return;

    try {
      const token = localStorage.getItem('accessToken');
      if (!token) return;

      const payload = {
        name: formData.name,
        address: formData.address,
        geofenceCenterLat: parseFloat(formData.latitude),
        geofenceCenterLng: parseFloat(formData.longitude),
        geofenceRadiusM: parseInt(formData.geofenceRadiusM),
        timezone: formData.timezone,
        status: formData.status,
      };

      await api.updateSite(token, selectedSite.id, payload);
      setShowEditModal(false);
      setSelectedSite(null);
      resetForm();
      loadSites();
    } catch (error: any) {
      console.error('Failed to update site:', error);
      alert(`Failed to update site: ${error.message || 'Unknown error'}`);
    }
  };

  const handleDeleteSite = async (id: string) => {
    if (!confirm('Are you sure you want to delete this site? All associated employees will need to be reassigned.')) return;

    try {
      const token = localStorage.getItem('accessToken');
      if (!token) return;

      await api.deleteSite(token, id);
      loadSites();
    } catch (error) {
      console.error('Failed to delete site:', error);
      alert('Failed to delete site. Make sure all employees are reassigned first.');
    }
  };

  const openEditModal = (site: Site) => {
    setSelectedSite(site);
    const coords = parseCoordinates(site.geofenceCenter);
    setFormData({
      name: site.name,
      address: site.address,
      latitude: coords.lat.toString(),
      longitude: coords.lng.toString(),
      geofenceRadiusM: site.geofenceRadiusM.toString(),
      timezone: site.timezone,
      status: site.status,
    });
    setShowEditModal(true);
  };

  const openGoogleMaps = (site: Site) => {
    const coords = parseCoordinates(site.geofenceCenter);
    window.open(`https://www.google.com/maps?q=${coords.lat},${coords.lng}`, '_blank');
  };

  const resetForm = () => {
    setFormData({
      name: '',
      address: '',
      latitude: '',
      longitude: '',
      geofenceRadiusM: '100',
      timezone: 'Asia/Manila',
      status: 'active',
    });
  };

  const filteredSites = sites.filter(site => {
    const matchesSearch = 
      site.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      site.address.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === 'all' || site.status === statusFilter;
    
    return matchesSearch && matchesStatus;
  });

  const getStatusColor = (status: string) => {
    return status === 'active' 
      ? 'bg-brand-100 text-brand-800' 
      : 'bg-silver-100 text-silver-800';
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
        <p className="text-sm text-silver-800">Manage work sites and geofence boundaries</p>
        <Button onClick={() => setShowAddModal(true)}>
          <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
          </svg>
          Add Site
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard label="Total Sites" value={sites.length} icon={MapPin} />
        <StatCard
          label="Active Sites"
          value={sites.filter(s => s.status === 'active').length}
          icon={CheckCircle}
        />
        <StatCard
          label="Inactive Sites"
          value={sites.filter(s => s.status === 'inactive').length}
          icon={XCircle}
        />
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle>Filter Sites</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Search</label>
              <Input
                placeholder="Site name or address..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Status</label>
              <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                <option value="all">All Statuses</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Sites Table */}
      <Card>
        <CardHeader>
          <CardTitle>Site List ({filteredSites.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Site Name</TableHead>
                <TableHead>Address</TableHead>
                <TableHead>Geofence</TableHead>
                <TableHead>Timezone</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredSites.map((site) => {
                const coords = parseCoordinates(site.geofenceCenter);
                return (
                  <TableRow key={site.id}>
                    <TableCell className="font-medium">{site.name}</TableCell>
                    <TableCell>{site.address}</TableCell>
                    <TableCell>
                      <div className="text-sm">
                        <div className="font-mono text-xs text-silver-800">
                          {coords.lat.toFixed(6)}, {coords.lng.toFixed(6)}
                        </div>
                        <div className="text-silver-800">
                          Radius: {site.geofenceRadiusM}m
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>{site.timezone}</TableCell>
                    <TableCell>
                      <Badge className={`capitalize ${getStatusColor(site.status)}`}>
                        {site.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {/* Same fix as the employees table: `space-x-2` on the
                          cell let the buttons wrap in this narrow column. */}
                      <div className="flex justify-end gap-2 whitespace-nowrap">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openGoogleMaps(site)}
                          aria-label="Open in Google Maps"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                          </svg>
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openEditModal(site)}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="critical"
                          size="sm"
                          onClick={() => handleDeleteSite(site.id)}
                        >
                          Delete
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
              {filteredSites.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-silver-800">
                    No sites found
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Add Site Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-silver-950/40 backdrop-blur-sm flex items-center justify-center z-50">
          <Card className="w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <CardHeader>
              <CardTitle>Add New Site</CardTitle>
              <CardDescription>Create a new work site with geofence</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleAddSite} className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Site Name *</label>
                  <Input
                    required
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="SM Manila Office"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Address *</label>
                  <Input
                    required
                    value={formData.address}
                    onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                    placeholder="SM City Manila, Manila"
                  />
                </div>
                <div className="bg-brand-50 border border-brand-200 rounded-lg p-4 space-y-2">
                  <div className="flex items-start gap-2">
                    <svg className="w-5 h-5 text-brand-700 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <div className="text-sm text-brand-800">
                      <p className="font-medium">Finding GPS Coordinates</p>
                      <ol className="list-decimal list-inside mt-1 space-y-1">
                        <li>Open Google Maps</li>
                        <li>Search for the location</li>
                        <li>Right-click on the exact spot</li>
                        <li>Click the coordinates to copy them</li>
                        <li>Paste below (format: 14.5964, 120.9842)</li>
                      </ol>
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Latitude *</label>
                    <Input
                      required
                      type="number"
                      step="any"
                      value={formData.latitude}
                      onChange={(e) => setFormData({ ...formData, latitude: e.target.value })}
                      placeholder="14.5964"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Longitude *</label>
                    <Input
                      required
                      type="number"
                      step="any"
                      value={formData.longitude}
                      onChange={(e) => setFormData({ ...formData, longitude: e.target.value })}
                      placeholder="120.9842"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Geofence Radius (meters) *</label>
                    <Input
                      required
                      type="number"
                      min="50"
                      value={formData.geofenceRadiusM}
                      onChange={(e) => setFormData({ ...formData, geofenceRadiusM: e.target.value })}
                      placeholder="100"
                    />
                    <p className="text-xs text-silver-800">Minimum: 50 meters, Recommended: 50-200 meters</p>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Timezone</label>
                    <Select 
                      value={formData.timezone} 
                      onChange={(e) => setFormData({ ...formData, timezone: e.target.value })}
                    >
                      <option value="Asia/Manila">Asia/Manila (GMT+8)</option>
                      <option value="Asia/Singapore">Asia/Singapore (GMT+8)</option>
                      <option value="Asia/Hong_Kong">Asia/Hong_Kong (GMT+8)</option>
                      <option value="Asia/Tokyo">Asia/Tokyo (GMT+9)</option>
                    </Select>
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Status</label>
                  <Select 
                    value={formData.status} 
                    onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
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
                  <Button type="submit">Create Site</Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Edit Site Modal */}
      {showEditModal && selectedSite && (
        <div className="fixed inset-0 bg-silver-950/40 backdrop-blur-sm flex items-center justify-center z-50">
          <Card className="w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <CardHeader>
              <CardTitle>Edit Site</CardTitle>
              <CardDescription>Update site information and geofence</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleUpdateSite} className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Site Name *</label>
                  <Input
                    required
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Address *</label>
                  <Input
                    required
                    value={formData.address}
                    onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Latitude *</label>
                    <Input
                      required
                      type="number"
                      step="any"
                      value={formData.latitude}
                      onChange={(e) => setFormData({ ...formData, latitude: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Longitude *</label>
                    <Input
                      required
                      type="number"
                      step="any"
                      value={formData.longitude}
                      onChange={(e) => setFormData({ ...formData, longitude: e.target.value })}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Geofence Radius (meters) *</label>
                    <Input
                      required
                      type="number"
                      value={formData.geofenceRadiusM}
                      onChange={(e) => setFormData({ ...formData, geofenceRadiusM: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Timezone</label>
                    <Select 
                      value={formData.timezone} 
                      onChange={(e) => setFormData({ ...formData, timezone: e.target.value })}
                    >
                      <option value="Asia/Manila">Asia/Manila (GMT+8)</option>
                      <option value="Asia/Singapore">Asia/Singapore (GMT+8)</option>
                      <option value="Asia/Hong_Kong">Asia/Hong_Kong (GMT+8)</option>
                      <option value="Asia/Tokyo">Asia/Tokyo (GMT+9)</option>
                    </Select>
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Status</label>
                  <Select 
                    value={formData.status} 
                    onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </Select>
                </div>
                <div className="flex justify-end gap-2 pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setShowEditModal(false);
                      setSelectedSite(null);
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
    </div>
  );
}
