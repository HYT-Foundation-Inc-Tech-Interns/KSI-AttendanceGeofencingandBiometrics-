/**
 * Klassic Field Attendance System - TypeScript Type Definitions
 * Generated from database schema - keep in sync with schema.sql
 */

// =============================================================================
// BASE TYPES
// =============================================================================

export type UUID = string;
export type Timestamp = string; // ISO 8601
export type Date = string; // ISO 8601 date only

// =============================================================================
// ENUMS
// =============================================================================

export enum EmployeeStatus {
  ACTIVE = 'active',
  SUSPENDED = 'suspended',
  OFFBOARDED = 'offboarded',
}

export enum SiteStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  SUSPENDED = 'suspended',
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

export enum AuditAction {
  RECEIVED = 'received',
  VERIFIED = 'verified',
  FLAGGED = 'flagged',
  REJECTED = 'rejected',
  MANUAL_OVERRIDE = 'manual_override',
  EXPORTED_TO_PAYROLL = 'exported_to_payroll',
  SYNC_RETRY = 'sync_retry',
}

export enum PayrollExportStatus {
  PENDING = 'pending',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

export enum UserRole {
  ADMIN = 'admin',
  HR = 'hr',
  SUPERVISOR = 'supervisor',
  EMPLOYEE = 'employee',
}

// =============================================================================
// DATABASE MODELS
// =============================================================================

export interface Organization {
  id: UUID;
  name: string;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

export interface GeoPolygon {
  type: 'Polygon';
  coordinates: number[][][]; // GeoJSON format
}

export interface Site {
  id: UUID;
  organization_id: UUID;
  name: string;
  address?: string;
  // Circular geofence
  geofence_center?: GeoPoint;
  geofence_radius_m?: number;
  // Polygon geofence
  geofence_polygon?: GeoPolygon;
  timezone: string;
  status: SiteStatus;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface Employee {
  id: UUID;
  organization_id: UUID;
  site_id?: UUID;
  employee_code: string;
  full_name: string;
  email?: string;
  phone?: string;
  status: EmployeeStatus;
  hired_at?: Date;
  offboarded_at?: Date;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface DeviceEnrollment {
  id: UUID;
  employee_id: UUID;
  device_id: string;
  face_embedding_ref: string; // Reference/pointer, never raw photo
  enrolled_by?: UUID;
  enrolled_at: Timestamp;
  revoked_at?: Timestamp;
  revoked_by?: UUID;
  revoke_reason?: string;
  device_model?: string;
  device_os?: string;
  app_version?: string;
  created_at: Timestamp;
}

export interface AttendanceEvent {
  id: UUID;
  client_event_id: UUID; // Idempotency key
  employee_id: UUID;
  site_id: UUID;
  event_type: EventType;
  device_timestamp: Timestamp;
  server_timestamp: Timestamp;
  gps_point: GeoPoint;
  gps_accuracy_meters?: number;
  is_mock_location: boolean;
  liveness_score?: number; // 0-1
  match_score?: number; // 0-1
  status: AttendanceStatus;
  flag_reason?: string;
  created_offline: boolean;
  sync_attempt_count: number;
  device_id?: string;
  app_version?: string;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface SyncAuditLog {
  id: UUID;
  attendance_event_id?: UUID;
  action: AuditAction;
  actor?: string;
  actor_role?: string;
  notes?: string;
  metadata?: Record<string, any>;
  at: Timestamp;
}

export interface PayrollExport {
  id: UUID;
  organization_id: UUID;
  export_date: Date;
  date_range_start: Date;
  date_range_end: Date;
  total_records: number;
  status: PayrollExportStatus;
  export_file_url?: string;
  error_message?: string;
  exported_by?: UUID;
  created_at: Timestamp;
}

export interface User {
  id: UUID;
  organization_id: UUID;
  email: string;
  full_name: string;
  role: UserRole;
  employee_id?: UUID;
  password_hash: string;
  is_active: boolean;
  last_login_at?: Timestamp;
  created_at: Timestamp;
  updated_at: Timestamp;
}

// =============================================================================
// API REQUEST/RESPONSE DTOS
// =============================================================================

// Auth
export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  access_token: string;
  refresh_token: string;
  user: Omit<User, 'password_hash'>;
}

export interface RefreshTokenRequest {
  refresh_token: string;
}

export interface RefreshTokenResponse {
  access_token: string;
  refresh_token: string;
}

// Biometric Enrollment
export interface EnrollFaceRequest {
  employee_id: UUID;
  device_id: string;
  face_embedding: string; // Base64 encoded embedding vector
  device_model?: string;
  device_os?: string;
  app_version?: string;
}

export interface EnrollFaceResponse {
  enrollment_id: UUID;
  employee_id: UUID;
  enrolled_at: Timestamp;
}

// Geofence
export interface GetGeofenceResponse {
  site_id: UUID;
  site_name: string;
  geofence_center?: GeoPoint;
  geofence_radius_m?: number;
  geofence_polygon?: GeoPolygon;
  timezone: string;
}

// Attendance
export interface CheckInRequest {
  client_event_id: UUID; // Generated by client for idempotency
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
  signature: string; // HMAC signature
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
  start_date?: Date;
  end_date?: Date;
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

// Admin Override
export interface AttendanceOverrideRequest {
  event_id: UUID;
  new_status: AttendanceStatus;
  notes: string;
}

export interface AttendanceOverrideResponse {
  event_id: UUID;
  old_status: AttendanceStatus;
  new_status: AttendanceStatus;
  overridden_by: UUID;
  overridden_at: Timestamp;
}

// Payroll Export
export interface PayrollExportQuery {
  organization_id: UUID;
  start_date: Date;
  end_date: Date;
}

export interface PayrollRecord {
  employee_id: UUID;
  employee_code: string;
  full_name: string;
  site_id: UUID;
  site_name: string;
  date: Date;
  check_in_time?: Timestamp;
  check_out_time?: Timestamp;
  worked_hours?: number;
  status: string;
  flagged: boolean;
  flag_reason?: string;
}

export interface PayrollExportResponse {
  export_id: UUID;
  organization_id: UUID;
  date_range_start: Date;
  date_range_end: Date;
  records: PayrollRecord[];
  total_records: number;
  exported_at: Timestamp;
}

// =============================================================================
// CLIENT-SIDE MODELS (for mobile app local storage)
// =============================================================================

export interface LocalAttendanceQueue {
  id: string; // Local SQLite ID
  client_event_id: UUID;
  payload: SyncEventPayload;
  signature: string;
  sync_status: 'pending' | 'syncing' | 'synced' | 'failed';
  sync_attempts: number;
  created_at: Timestamp;
  last_sync_attempt_at?: Timestamp;
  error_message?: string;
}

export interface LocalEmployeeProfile {
  id: UUID;
  employee_code: string;
  full_name: string;
  email?: string;
  site_id: UUID;
  site_name: string;
  status: EmployeeStatus;
  face_embedding_ref?: string; // Encrypted local copy for offline matching
}

// =============================================================================
// UTILITY TYPES
// =============================================================================

export interface PaginationQuery {
  limit?: number;
  offset?: number;
}

export interface PaginationMeta {
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
  meta?: PaginationMeta;
}

export interface HealthCheckResponse {
  status: 'ok' | 'degraded' | 'down';
  timestamp: Timestamp;
  version: string;
  services: {
    database: 'up' | 'down';
    redis?: 'up' | 'down';
    face_matching_api?: 'up' | 'down';
  };
}
