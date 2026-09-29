import { apiClient } from './apiClient';
import { Site } from '@/types/api.types';

export interface GeofenceData {
  site_id: string;
  site_name: string;
  geofence_center?: {
    latitude: number;
    longitude: number;
  };
  geofence_radius_m?: number;
  geofence_polygon?: {
    type: 'Polygon';
    coordinates: number[][][];
  };
  timezone: string;
}

export interface GeofenceValidationRequest {
  latitude: number;
  longitude: number;
}

export interface GeofenceValidationResponse {
  withinGeofence: boolean;
  distance?: number;
}

export const sitesApi = {
  /**
   * Get all sites for the user's organization
   */
  getAll: async (): Promise<Site[]> => {
    return apiClient.get<Site[]>('/sites');
  },

  /**
   * Get site by ID
   */
  getById: async (siteId: string): Promise<Site> => {
    return apiClient.get<Site>(`/sites/${siteId}`);
  },

  /**
   * Get site geofence configuration (for client-side display)
   */
  getGeofence: async (siteId: string): Promise<GeofenceData> => {
    return apiClient.get<GeofenceData>(`/sites/${siteId}/geofence`);
  },

  /**
   * Validate if coordinates are within geofence (server-authoritative)
   */
  validateGeofence: async (
    siteId: string,
    data: GeofenceValidationRequest,
  ): Promise<GeofenceValidationResponse> => {
    return apiClient.post<GeofenceValidationResponse>(
      `/sites/${siteId}/validate-geofence`,
      data,
    );
  },
};
