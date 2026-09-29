export default () => ({
  name: 'Klassic Attendance',
  slug: 'klassic-attendance',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'light',
  splash: {
    image: './assets/splash.png',
    resizeMode: 'contain',
    backgroundColor: '#285709',
  },
  assetBundlePatterns: ['**/*'],
  ios: {
    supportsTablet: true,
    bundleIdentifier: 'com.klassic.attendance',
    infoPlist: {
      NSCameraUsageDescription:
        'This app needs camera access for facial recognition during check-in/check-out.',
      NSLocationWhenInUseUsageDescription:
        'This app needs your location to verify you are at the correct work site during check-in/check-out.',
      NSLocationAlwaysUsageDescription:
        'This app needs your location to verify you are at the correct work site.',
    },
  },
  android: {
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#285709',
    },
    package: 'com.klassic.attendance',
    permissions: [
      'ACCESS_COARSE_LOCATION',
      'ACCESS_FINE_LOCATION',
      'CAMERA',
      'READ_EXTERNAL_STORAGE',
      'WRITE_EXTERNAL_STORAGE',
    ],
  },
  web: {
    favicon: './assets/favicon.png',
  },
  plugins: [
    'expo-secure-store',
    [
      'expo-location',
      {
        locationAlwaysAndWhenInUsePermission:
          'Allow Klassic Attendance to use your location for site verification.',
      },
    ],
    [
      'expo-camera',
      {
        cameraPermission: 'Allow Klassic Attendance to access your camera for facial recognition.',
      },
    ],
  ],
  extra: {
    // Surfaced through Constants.expoConfig.extra. Expo CLI loads .env when it
    // evaluates this file, so a plain `process.env` read works here even though
    // non-EXPO_PUBLIC_ vars are not inlined into the app bundle itself.
    // Without this the app falls back to localhost, which on a physical device
    // in Expo Go resolves to the phone and cannot reach the backend.
    API_BASE_URL: process.env.API_BASE_URL ?? 'http://localhost:3000/v1',
    eas: {
      projectId: 'your-project-id', // Replace with actual EAS project ID
    },
  },
});
