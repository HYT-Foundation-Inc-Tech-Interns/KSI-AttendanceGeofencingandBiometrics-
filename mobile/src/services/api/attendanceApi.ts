import { apiClient } from './apiClient';
import { AttendanceEvent } from '@/types/api.types';

export interface AttendanceRequest {
  employeeId: string;
  siteId: string;
  latitude: number;
  longitude: number;
  faceImage: string;
  deviceIdentifier?: string;
}

export interface AttendanceResponse {
  id: string;
  eventType: string;
  timestamp: string;
  withinGeofence: boolean;
  biometricVerified: boolean;
  status: string;
  message: string;
}

export const attendanceApi = {
  /**
   * Check in. The server is authoritative for the geofence decision, so it may
   * reject the call even when the client-side pre-check passed.
   */
  checkIn: async (data: AttendanceRequest): Promise<AttendanceResponse> => {
    return apiClient.post<AttendanceResponse>('/attendance/check-in', data);
  },

  checkOut: async (data: AttendanceRequest): Promise<AttendanceResponse> => {
    return apiClient.post<AttendanceResponse>('/attendance/check-out', data);
  },

  /**
   * Attendance history for one employee
   */
  getEmployeeHistory: async (
    employeeId: string,
    params?: { startDate?: string; endDate?: string },
  ): Promise<AttendanceEvent[]> => {
    return apiClient.get<AttendanceEvent[]>(`/attendance/employee/${employeeId}`, {
      params,
    });
  },
};
