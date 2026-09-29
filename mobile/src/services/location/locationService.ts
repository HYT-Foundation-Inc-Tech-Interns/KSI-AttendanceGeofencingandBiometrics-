import * as Location from 'expo-location';
import { Platform } from 'react-native';
import { GPS_ACCURACY_THRESHOLD_M } from '@/constants/config';

export interface LocationResult {
  latitude: number;
  longitude: number;
  accuracy: number;
  isMockLocation: boolean;
}

export interface LocationError {
  code: string;
  message: string;
}

class LocationService {
  /**
   * Request location permissions from user
   */
  async requestPermissions(): Promise<boolean> {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      return status === 'granted';
    } catch (error) {
      console.error('Permission request error:', error);
      return false;
    }
  }

  /**
   * Check if location permissions are granted
   */
  async hasPermissions(): Promise<boolean> {
    try {
      const { status } = await Location.getForegroundPermissionsAsync();
      return status === 'granted';
    } catch (error) {
      console.error('Permission check error:', error);
      return false;
    }
  }

  /**
   * Get current GPS location with accuracy validation
   */
  async getCurrentLocation(): Promise<LocationResult> {
    // Check permissions
    const hasPermission = await this.hasPermissions();
    if (!hasPermission) {
      throw {
        code: 'PERMISSION_DENIED',
        message: 'Location permission not granted. Please enable location access in settings.',
      } as LocationError;
    }

    try {
      // Get high-accuracy location
      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
        timeInterval: 5000, // 5 seconds max wait
      });

      const result: LocationResult = {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        accuracy: location.coords.accuracy || 999,
        isMockLocation: location.mocked || false,
      };

      // Validate accuracy
      if (result.accuracy > GPS_ACCURACY_THRESHOLD_M) {
        throw {
          code: 'POOR_ACCURACY',
          message: `GPS accuracy is poor (${Math.round(result.accuracy)}m). Please move to an area with better GPS signal.`,
        } as LocationError;
      }

      // Detect mock location (on Android)
      if (Platform.OS === 'android' && result.isMockLocation) {
        console.warn('Mock location detected');
        // Don't throw, but flag it (server will validate)
      }

      return result;
    } catch (error: any) {
      if (error.code === 'POOR_ACCURACY') {
        throw error;
      }

      // Handle various location errors
      if (error.code === 'E_LOCATION_SERVICES_DISABLED') {
        throw {
          code: 'LOCATION_DISABLED',
          message: 'Location services are disabled. Please enable them in your device settings.',
        } as LocationError;
      }

      if (error.code === 'E_LOCATION_TIMEOUT') {
        throw {
          code: 'TIMEOUT',
          message: 'Unable to get location. Please ensure you have a clear view of the sky.',
        } as LocationError;
      }

      throw {
        code: 'UNKNOWN_ERROR',
        message: 'Failed to get location. Please try again.',
      } as LocationError;
    }
  }

  /**
   * Calculate distance between two points using Haversine formula
   * Returns distance in meters
   */
  calculateDistance(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
  ): number {
    const R = 6371000; // Earth radius in meters
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - lat1) * Math.PI) / 180;
    const Δλ = ((lon2 - lon1) * Math.PI) / 180;

    const a =
      Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
      Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c; // Distance in meters
  }

  /**
   * Check if location is within circular geofence (client-side pre-check for UX)
   * Server will always validate authoritatively
   */
  isWithinCircularGeofence(
    userLat: number,
    userLng: number,
    centerLat: number,
    centerLng: number,
    radiusMeters: number,
  ): { withinGeofence: boolean; distance: number } {
    const distance = this.calculateDistance(userLat, userLng, centerLat, centerLng);
    return {
      withinGeofence: distance <= radiusMeters,
      distance: Math.round(distance),
    };
  }

  /**
   * Check if location is within polygon geofence (client-side pre-check)
   * Uses ray casting algorithm
   */
  isWithinPolygonGeofence(
    userLat: number,
    userLng: number,
    polygon: [number, number][], // Array of [lng, lat]
  ): boolean {
    let inside = false;
    const x = userLng;
    const y = userLat;

    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i][0];
      const yi = polygon[i][1];
      const xj = polygon[j][0];
      const yj = polygon[j][1];

      const intersect =
        yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;

      if (intersect) {
        inside = !inside;
      }
    }

    return inside;
  }

  /**
   * Format distance for display
   */
  formatDistance(meters: number): string {
    if (meters < 1000) {
      return `${Math.round(meters)}m`;
    }
    return `${(meters / 1000).toFixed(1)}km`;
  }
}

export const locationService = new LocationService();
