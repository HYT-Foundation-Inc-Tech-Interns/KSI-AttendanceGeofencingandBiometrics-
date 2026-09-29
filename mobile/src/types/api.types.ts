/**
 * API Type Definitions - Mobile App
 * Matches backend contract from database/types.ts
 */

// =============================================================================
// BASE TYPES
// =============================================================================
export type UUID = string;
export type Timestamp = string; // ISO 8601
export type DateString = string; // ISO 8601 date only

// =============================================================================
// ENUMS
// =============================================================================
export enum EmployeeStatus {
  ACTIVE = 'active',
  SUSPENDED = 'suspended',
  OFFBOARDED = 'offboarded',
}

export enum EventType {
  CHECK_IN = 'check_in',
  CHECK_OUT = 'check_out',
}

export enum AttendanceStatus {
  PENDING = 'pending',
  VERIFIED = 'verified',
  FLAGGED = 'flagged',
  REJECTED = 'rejected',
  EXPORTED = 'exported',
}

export enum UserRole {
  ADMIN = 'admin',
  HR = 'hr',
  SUPERVISOR = 'supervisor',
  EMPLOYEE = 'employee',
}

// =============================================================================
// GEO TYPES
// =============================================================================
export interface GeoPoint {
  latitude: number;
  longitude: number;
}

export interface GeoPolygon {
  type: 'Polygon';
  coordinates: number[][][];
}

// =============================================================================
// API REQUEST/RESPONSE TYPES
// =============================================================================

// Auth
export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  access_token: string;
  refresh_token: string;
  user: UserProfile;
}

export interface UserProfile {
  id: UUID;
  email: string;
  full_name: string;
  role: UserRole;
  organization_id: UUID;
  employee_id?: UUID;
}

export interface RefreshTokenRequest {
  refresh_token: string;
}

// Employee
export interface Employee {
  id: UUID;
  organization_id: UUID;
  site_id?: UUID;
  employee_code: string;
  full_name: string;
  email?: string;
  phone?: string;
  status: EmployeeStatus;
  hired_at?: DateString;
  created_at: Timestamp;
}

// Site
export interface Site {
  id: UUID;
  organization_id: UUID;
  name: string;
  address?: string;
  geofence_center?: GeoPoint;
  geofence_radius_m?: number;
  geofence_polygon?: GeoPolygon;
  timezone: string;
  status: string;
}

// Attendance
export interface CheckInRequest {
  client_event_id: UUID;
  site_id: UUID;
  latitude: number;
  longitude: number;
  gps_accuracy_meters?: number;
  is_mock_location?: boolean;
  liveness_score: number;
  face_embedding: string; // Base64 encoded
  device_id: string;
  app_version?: string;
}

export interface CheckOutRequest {
  client_event_id: UUID;
  site_id: UUID;
  latitude: number;
  longitude: number;
  gps_accuracy_meters?: number;
  is_mock_location?: boolean;
  liveness_score: number;
  face_embedding: string;
  device_id: string;
  app_version?: string;
}

export interface AttendanceResponse {
  event_id: UUID;
  status: AttendanceStatus;
  server_timestamp: Timestamp;
  within_geofence: boolean;
  match_verified: boolean;
  message?: string;
}

export interface AttendanceEvent {
  id: UUID;
  employee_id: UUID;
  site_id: UUID;
  event_type: EventType;
  device_timestamp: Timestamp;
  server_timestamp: Timestamp;
  gps_point: GeoPoint;
  liveness_score?: number;
  match_score?: number;
  status: AttendanceStatus;
  flag_reason?: string;
  created_offline: boolean;
}

// Offline Sync
export interface SyncEventPayload {
  client_event_id: UUID;
  employee_id: UUID;
  site_id: UUID;
  event_type: EventType;
  device_timestamp: Timestamp;
  latitude: number;
  longitude: number;
  gps_accuracy_meters?: number;
  is_mock_location?: boolean;
  liveness_score: number;
  face_embedding: string;
  device_id: string;
  app_version?: string;
  created_offline: boolean;
}

export interface SyncRequest {
  events: SyncEventPayload[];
  signature: string;
}

export interface SyncResponse {
  synced_count: number;
  failed_count: number;
  results: Array<{
    client_event_id: UUID;
    status: 'synced' | 'duplicate' | 'failed';
    error?: string;
  }>;
}

// Attendance History
export interface AttendanceHistoryQuery {
  employee_id?: UUID;
  site_id?: UUID;
  start_date?: DateString;
  end_date?: DateString;
  status?: AttendanceStatus;
  limit?: number;
  offset?: number;
}

export interface AttendanceHistoryResponse {
  events: AttendanceEvent[];
  total: number;
  limit: number;
  offset: number;
}

// =============================================================================
// API RESPONSE WRAPPER
// =============================================================================
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
}

export interface ApiError {
  code: string;
  message: string;
  details?: any;
  timestamp?: string;
  path?: string;
}
