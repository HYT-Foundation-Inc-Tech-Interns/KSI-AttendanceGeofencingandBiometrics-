import Constants from 'expo-constants';

// API Configuration
export const API_BASE_URL =
  process.env.API_BASE_URL ||
  Constants.expoConfig?.extra?.API_BASE_URL ||
  'http://localhost:3000/v1';

// App Configuration
export const APP_VERSION = Constants.expoConfig?.version || '1.0.0';
export const APP_NAME = Constants.expoConfig?.name || 'Klassic Attendance';

// Biometric Configuration
export const LIVENESS_THRESHOLD =
  parseFloat(process.env.LIVENESS_THRESHOLD || '0.7');
export const FACE_DETECTION_CONFIDENCE =
  parseFloat(process.env.FACE_DETECTION_CONFIDENCE || '0.8');

// Geofencing Configuration
export const GPS_ACCURACY_THRESHOLD_M =
  parseInt(process.env.GPS_ACCURACY_THRESHOLD_M || '50', 10);
export const GEOFENCE_BUFFER_M =
  parseInt(process.env.GEOFENCE_BUFFER_M || '20', 10);

// Offline Sync Configuration
export const MAX_OFFLINE_QUEUE_SIZE =
  parseInt(process.env.MAX_OFFLINE_QUEUE_SIZE || '100', 10);
export const SYNC_RETRY_INTERVAL_SEC =
  parseInt(process.env.SYNC_RETRY_INTERVAL_SEC || '60', 10);
export const MAX_SYNC_RETRY_ATTEMPTS =
  parseInt(process.env.MAX_SYNC_RETRY_ATTEMPTS || '5', 10);

// Development flags
export const IS_DEV = __DEV__;
export const ENABLE_DEV_MENU = IS_DEV && (process.env.ENABLE_DEV_MENU === 'true');
export const DEV_MOCK_LOCATION = IS_DEV && (process.env.DEV_MOCK_LOCATION === 'true');
export const DEV_SKIP_BIOMETRIC = IS_DEV && (process.env.DEV_SKIP_BIOMETRIC === 'true');
