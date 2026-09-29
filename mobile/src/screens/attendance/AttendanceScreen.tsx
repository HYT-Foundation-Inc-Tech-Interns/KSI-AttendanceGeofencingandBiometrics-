import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@/store/authStore';
import { locationService, LocationResult } from '@/services/location/locationService';
import { sitesApi, GeofenceData } from '@/services/api/sitesApi';
import { employeesApi } from '@/services/api/employeesApi';
import { attendanceApi } from '@/services/api/attendanceApi';
import { BiometricVerifyModal } from '@/screens/biometric';
import { colors } from '@/theme';

const DEVICE_IDENTIFIER = 'mobile-device-001';

const AttendanceScreen: React.FC = () => {
  const { user } = useAuthStore();

  const [loading, setLoading] = useState(false);
  const [locationLoading, setLocationLoading] = useState(false);
  const [currentLocation, setCurrentLocation] = useState<LocationResult | null>(null);
  const [siteData, setSiteData] = useState<GeofenceData | null>(null);
  const [distance, setDistance] = useState<number | null>(null);
  const [withinGeofence, setWithinGeofence] = useState<boolean>(false);
  const [showBiometricModal, setShowBiometricModal] = useState(false);
  const [pendingAction, setPendingAction] = useState<'check-in' | 'check-out' | null>(null);
  const [isCheckedIn, setIsCheckedIn] = useState(false);

  // The employee is resolved from the signed-in user rather than hardcoded.
  const employeeId = user?.employee_id ?? null;
  // Assigned site comes from the employee record, not a demo constant.
  const siteId = siteData?.site_id ?? null;

  useEffect(() => {
    loadAssignment();
    requestLocationPermission();
  }, [employeeId]);

  const requestLocationPermission = async () => {
    const granted = await locationService.requestPermissions();
    if (!granted) {
      Alert.alert(
        'Location Permission Required',
        'This app needs location access to verify you are at the correct work site.',
        [{ text: 'OK' }],
      );
    }
  };

  const loadAssignment = useCallback(async () => {
    if (!employeeId) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);

      const employee = await employeesApi.getById(employeeId);

      if (!employee.siteId) {
        setSiteData(null);
        return;
      }

      const geofence = await sitesApi.getGeofence(employee.siteId);
      setSiteData(geofence);
    } catch (error: any) {
      Alert.alert('Error', error?.message || 'Failed to load your work site.');
    } finally {
      setLoading(false);
    }
  }, [employeeId]);

  const updateLocation = async () => {
    try {
      setLocationLoading(true);
      const location = await locationService.getCurrentLocation();
      setCurrentLocation(location);

      // Client-side pre-check for UX feedback only; the server re-checks.
      if (siteData?.geofence_center && siteData?.geofence_radius_m) {
        const result = locationService.isWithinCircularGeofence(
          location.latitude,
          location.longitude,
          siteData.geofence_center.latitude,
          siteData.geofence_center.longitude,
          siteData.geofence_radius_m,
        );
        setDistance(result.distance);
        setWithinGeofence(result.withinGeofence);
      } else {
        setDistance(null);
        setWithinGeofence(false);
      }
    } catch (error: any) {
      Alert.alert('Location Error', error?.message || 'Failed to get location');
      setCurrentLocation(null);
    } finally {
      setLocationLoading(false);
    }
  };

  const handleCheckIn = async () => {
    if (!currentLocation) {
      Alert.alert('Location Required', 'Please enable location to check in');
      return;
    }

    setPendingAction('check-in');
    setShowBiometricModal(true);
  };

  const handleCheckOut = async () => {
    if (!currentLocation) {
      Alert.alert('Location Required', 'Please enable location to check out');
      return;
    }

    setPendingAction('check-out');
    setShowBiometricModal(true);
  };

  const handleBiometricVerified = async (
    verified: boolean,
    faceImage: string,
    confidence?: number,
  ) => {
    setShowBiometricModal(false);

    if (!verified || !currentLocation || !pendingAction || !employeeId || !siteId) {
      setPendingAction(null);
      return;
    }

    setLoading(true);

    try {
      const payload = {
        employeeId,
        siteId,
        latitude: currentLocation.latitude,
        longitude: currentLocation.longitude,
        faceImage,
        deviceIdentifier: DEVICE_IDENTIFIER,
      };

      const result =
        pendingAction === 'check-in'
          ? await attendanceApi.checkIn(payload)
          : await attendanceApi.checkOut(payload);

      // apiClient already unwraps to the response body.
      setIsCheckedIn(pendingAction === 'check-in');

      const action = pendingAction === 'check-in' ? 'Check-In' : 'Check-Out';
      const confidenceLine = confidence ? `\nFace confidence: ${(confidence * 100).toFixed(1)}%` : '';

      Alert.alert(
        `${action} Successful`,
        `Time: ${new Date(result.timestamp).toLocaleTimeString()}${confidenceLine}`,
        [{ text: 'OK' }],
      );
    } catch (error: any) {
      Alert.alert('Error', error?.message || `${pendingAction} failed. Please try again.`);
    } finally {
      setLoading(false);
      setPendingAction(null);
    }
  };

  const handleBiometricCanceled = () => {
    setShowBiometricModal(false);
    setPendingAction(null);
  };

  if (!employeeId) {
    return (
      <View style={styles.loadingContainer}>
        <Ionicons name="alert-circle-outline" size={48} color={colors.danger} />
        <Text style={styles.loadingText}>
          This account isn&apos;t linked to an employee record yet, so attendance can&apos;t be
          recorded. Ask an administrator to link your user to an employee.
        </Text>
      </View>
    );
  }

  if (loading && !siteData) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Loading your work site…</Text>
      </View>
    );
  }

  // Both actions are blocked until we know the device is inside the geofence —
  // the geofence banner above the buttons explains why.
  const actionsDisabled = !currentLocation || !withinGeofence || loading;

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        {/* Site Card */}
        <View style={styles.siteCard}>
          <View style={styles.siteHeader}>
            <Ionicons name="business" size={24} color={colors.primary} />
            <Text style={styles.siteName}>{siteData?.site_name || 'No site assigned'}</Text>
            <TouchableOpacity
              style={styles.refreshButton}
              onPress={loadAssignment}
              disabled={loading}
            >
              <Ionicons name="refresh" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          {siteData?.geofence_radius_m ? (
            <Text style={styles.siteDetail}>
              Geofence radius: {siteData.geofence_radius_m}m
            </Text>
          ) : (
            <Text style={styles.siteDetail}>
              No geofence configured for this site
            </Text>
          )}

          {siteData?.geofence_center && (
            <Text style={styles.siteDetail}>
              {siteData.geofence_center.latitude.toFixed(6)},{' '}
              {siteData.geofence_center.longitude.toFixed(6)}
            </Text>
          )}
        </View>

        {/* Location Card */}
        <View style={styles.locationCard}>
          <View style={styles.locationHeader}>
            <Ionicons name="location" size={20} color={colors.primary} />
            <Text style={styles.locationTitle}>Your Location</Text>
            <TouchableOpacity
              style={styles.refreshButton}
              onPress={updateLocation}
              disabled={locationLoading}
            >
              <Ionicons name="refresh" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          {currentLocation ? (
            <>
              <View style={styles.locationRow}>
                <Text style={styles.locationLabel}>Accuracy:</Text>
                <Text style={styles.locationValue}>
                  ±{Math.round(currentLocation.accuracy)}m
                </Text>
              </View>
              {distance !== null && (
                <View style={styles.locationRow}>
                  <Text style={styles.locationLabel}>Distance from site:</Text>
                  <Text
                    style={[
                      styles.locationValue,
                      { color: withinGeofence ? colors.success : colors.danger },
                    ]}
                  >
                    {locationService.formatDistance(distance)}
                  </Text>
                </View>
              )}
              <View
                style={[
                  styles.geofenceStatus,
                  { backgroundColor: withinGeofence ? colors.successSoft : colors.dangerSoft },
                ]}
              >
                <Ionicons
                  name={withinGeofence ? 'checkmark-circle' : 'close-circle'}
                  size={20}
                  color={withinGeofence ? colors.success : colors.danger}
                />
                <Text
                  style={[
                    styles.geofenceStatusText,
                    { color: withinGeofence ? colors.success : colors.danger },
                  ]}
                >
                  {withinGeofence ? 'Within site boundary' : 'Outside site boundary'}
                </Text>
              </View>
              {currentLocation.isMockLocation && (
                <View style={styles.warningBanner}>
                  <Ionicons name="warning" size={16} color={colors.warning} />
                  <Text style={styles.warningText}>Mock location detected</Text>
                </View>
              )}
            </>
          ) : (
            <TouchableOpacity
              style={styles.locationButton}
              onPress={updateLocation}
              disabled={locationLoading}
            >
              <Text style={styles.locationButtonText}>
                {locationLoading ? 'Getting location...' : 'Get My Location'}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Check In/Out Buttons */}
        <View style={styles.buttonContainer}>
          <TouchableOpacity
            style={[
              styles.button,
              styles.checkInButton,
              actionsDisabled && styles.buttonDisabled,
            ]}
            onPress={handleCheckIn}
            disabled={actionsDisabled}
          >
            {loading && pendingAction === 'check-in' ? (
              <ActivityIndicator size="small" color={actionsDisabled ? colors.text : colors.textOnBrand} />
            ) : (
              <>
                <Ionicons name="log-in" size={24} color={actionsDisabled ? colors.text : colors.textOnBrand} />
                <Text style={[styles.buttonText, actionsDisabled && styles.buttonTextDisabled]}>
                  Check In
                </Text>
              </>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.button,
              styles.checkOutButton,
              actionsDisabled && styles.buttonDisabled,
            ]}
            onPress={handleCheckOut}
            disabled={actionsDisabled}
          >
            {loading && pendingAction === 'check-out' ? (
              <ActivityIndicator size="small" color={actionsDisabled ? colors.text : colors.textOnBrand} />
            ) : (
              <>
                <Ionicons name="log-out" size={24} color={actionsDisabled ? colors.text : colors.textOnBrand} />
                <Text style={[styles.buttonText, actionsDisabled && styles.buttonTextDisabled]}>
                  Check Out
                </Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        {/* Status Banner */}
        <View style={styles.infoBanner}>
          <Ionicons name="information-circle-outline" size={16} color={colors.primary} />
          <Text style={styles.infoText}>
            {isCheckedIn
              ? 'You are checked in. Remember to check out at the end of your shift.'
              : 'GPS geofence + biometric verification required for check-in/out'}
          </Text>
        </View>
      </View>

      {/* Biometric Verification Modal */}
      {employeeId && (
        <BiometricVerifyModal
          visible={showBiometricModal}
          employeeId={employeeId}
          onVerified={handleBiometricVerified}
          onCancel={handleBiometricCanceled}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
    padding: 24,
    gap: 12,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  content: {
    flex: 1,
    padding: 16,
  },
  siteCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  siteHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 8,
  },
  siteName: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
    flex: 1,
  },
  siteDetail: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  locationCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  locationHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
    // Was `colors.background`, which is the page colour behind the card — the
    // divider was invisible. `border` is the hairline used everywhere else.
    borderBottomColor: colors.border,
  },
  locationTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    flex: 1,
  },
  refreshButton: {
    padding: 4,
  },
  locationRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  locationLabel: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  locationValue: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  geofenceStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderRadius: 8,
    marginTop: 8,
  },
  geofenceStatusText: {
    fontSize: 14,
    fontWeight: '600',
  },
  warningBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.warningSoft,
    padding: 8,
    borderRadius: 6,
    marginTop: 8,
  },
  warningText: {
    fontSize: 12,
    color: colors.warning,
  },
  locationButton: {
    backgroundColor: colors.primary,
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  locationButtonText: {
    color: colors.textOnBrand,
    fontSize: 14,
    fontWeight: '600',
  },
  buttonContainer: {
    gap: 12,
    marginBottom: 16,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 56,
    borderRadius: 12,
    gap: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  checkInButton: {
    backgroundColor: colors.success,
  },
  checkOutButton: {
    backgroundColor: colors.danger,
  },
  /*
   * Disabled keeps the label legible: silver200 with ink text is 11.3:1. The
   * previous treatment (silver500 fill at 0.6 opacity under white text) left the
   * label at roughly 1.4:1 — invisible exactly when the user needs to read it.
   */
  buttonDisabled: {
    backgroundColor: colors.border,
  },
  buttonText: {
    color: colors.textOnBrand,
    fontSize: 16,
    fontWeight: '600',
  },
  buttonTextDisabled: {
    color: colors.text,
  },
  infoBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.primarySoft,
    padding: 12,
    borderRadius: 8,
  },
  infoText: {
    flex: 1,
    fontSize: 12,
    color: colors.primaryDark,
  },
});

export default AttendanceScreen;
