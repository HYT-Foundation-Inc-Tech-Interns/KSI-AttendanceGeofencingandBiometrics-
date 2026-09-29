# Klassic Field Attendance System - Mobile App

React Native + Expo mobile application for GPS-geofenced biometric attendance tracking.

## 🚀 Quick Start

### Prerequisites
- Node.js >= 18.x
- Expo CLI: `npm install -g expo-cli`
- iOS: Xcode (Mac only)
- Android: Android Studio

### Installation

```bash
# Install dependencies
npm install

# Copy environment variables
cp .env.example .env

# Edit .env with your backend URL
# API_BASE_URL=http://localhost:3000/v1
```

### Development

```bash
# Start Expo development server
npm start

# Run on Android
npm run android

# Run on iOS (Mac only)
npm run ios

# Run on Web (limited functionality)
npm run web
```

## 📁 Project Structure

```
mobile/
├── src/
│   ├── components/          # Reusable UI components
│   │   └── common/          # Common components (Button, Input, etc.)
│   ├── screens/             # Screen components
│   │   ├── auth/            # ✅ Login screen
│   │   ├── home/            # ✅ Home dashboard
│   │   ├── attendance/      # 🚧 Check-in/out (Phase 3-4)
│   │   └── profile/         # ✅ User profile
│   ├── navigation/          # ✅ Navigation setup (Auth & Main)
│   │   ├── AuthNavigator.tsx
│   │   ├── MainNavigator.tsx
│   │   ├── RootNavigator.tsx
│   │   └── types.ts
│   ├── services/            # API services
│   │   └── api/             # ✅ API client with auth interceptors
│   │       ├── apiClient.ts
│   │       └── authApi.ts
│   ├── store/               # State management (Zustand)
│   │   └── authStore.ts     # ✅ Auth state (login, logout, user)
│   ├── utils/               # Utility functions
│   │   └── tokenStorage.ts  # ✅ Secure token storage
│   ├── types/               # TypeScript type definitions
│   │   └── api.types.ts     # ✅ API types (matches backend contract)
│   └── constants/           # App constants
│       └── config.ts        # ✅ Environment config
├── assets/                  # Images, fonts, icons
├── App.tsx                  # ✅ Root component
├── app.config.ts            # ✅ Expo configuration
├── babel.config.js          # ✅ Babel configuration
├── tsconfig.json            # ✅ TypeScript configuration
└── package.json
```

## 🔐 Authentication

The app uses JWT-based authentication with automatic token refresh:

### Login Flow
1. User enters email/password
2. App calls `/auth/login` endpoint
3. Tokens stored in SecureStore (encrypted on device)
4. User redirected to main app

### Token Refresh
- Access token: 15 minutes (auto-refreshed by axios interceptor)
- Refresh token: 7 days
- Automatic refresh on 401 errors

### Test Credentials

```
Employee:
  Email: juan.delacruz@klassic.ph
  Password: employee123

Admin:
  Email: admin@klassic.ph
  Password: password123
```

⚠️ **Development shortcuts available in login screen when `__DEV__` is true**

## 📱 Navigation Structure

```
Root Navigator
├── Auth Stack (unauthenticated)
│   └── Login
└── Main Tab Navigator (authenticated)
    ├── Home
    ├── Attendance (Check In/Out)
    ├── History
    └── Profile
```

## 🧪 Features Status

| Feature | Status | Phase |
|---------|--------|-------|
| **Authentication** | ✅ Complete | Phase 2 |
| Login/Logout | ✅ | |
| Token refresh | ✅ | |
| Secure storage | ✅ | |
| **Navigation** | ✅ Complete | Phase 2 |
| Auth/Main navigation | ✅ | |
| Bottom tabs | ✅ | |
| **Screens** | ✅ Skeleton | Phase 2 |
| Login | ✅ | |
| Home dashboard | ✅ | |
| Profile | ✅ | |
| Attendance (placeholder) | 🚧 | Phase 3-4 |
| History (mock data) | 🚧 | Phase 6 |
| **GPS Geofencing** | 🔜 TODO | Phase 3 |
| Location permissions | 🔜 | |
| GPS capture | 🔜 | |
| Geofence validation | 🔜 | |
| **Biometric Recognition** | 🔜 TODO | Phase 4 |
| Camera permissions | 🔜 | |
| Liveness detection | 🔜 | |
| Face embedding | 🔜 | |
| **Offline Sync** | 🔜 TODO | Phase 5 |
| SQLite local storage | 🔜 | |
| Offline queue | 🔜 | |
| HMAC signing | 🔜 | |
| Batch sync | 🔜 | |

## 🔧 Configuration

### Environment Variables (`.env`)

```env
# Backend API
API_BASE_URL=http://localhost:3000/v1

# App Config
APP_VERSION=1.0.0
APP_ENVIRONMENT=development

# Biometric Config
LIVENESS_THRESHOLD=0.7
FACE_DETECTION_CONFIDENCE=0.8

# Geofencing Config
GPS_ACCURACY_THRESHOLD_M=50
GEOFENCE_BUFFER_M=20

# Offline Sync Config
MAX_OFFLINE_QUEUE_SIZE=100
SYNC_RETRY_INTERVAL_SEC=60
MAX_SYNC_RETRY_ATTEMPTS=5

# Development Flags
ENABLE_DEV_MENU=true
DEV_MOCK_LOCATION=false
DEV_SKIP_BIOMETRIC=false
```

### Expo Config (`app.config.ts`)

Key permissions required:
- **Camera**: Facial recognition
- **Location**: Geofence validation
- **Storage**: Offline data

## 📦 Key Dependencies

### Core
- `expo` - Development platform
- `react-native` - Mobile framework
- `typescript` - Type safety

### Navigation
- `@react-navigation/native` - Navigation library
- `@react-navigation/native-stack` - Stack navigator
- `@react-navigation/bottom-tabs` - Tab navigator

### State Management
- `zustand` - Lightweight state management
- `@tanstack/react-query` - Server state caching

### API & Storage
- `axios` - HTTP client
- `expo-secure-store` - Encrypted storage

### UI
- `react-native-paper` - Material Design components
- `@expo/vector-icons` - Icon library

### Future (Phase 3-5)
- `expo-location` - GPS
- `expo-camera` - Camera access
- `react-native-maps` - Map display
- `expo-sqlite` - Local database (offline)

## 🧪 Testing

```bash
# Run tests
npm test

# Watch mode
npm run test:watch

# Coverage
npm run test:cov
```

## 🚢 Building for Production

### Using EAS Build (Recommended)

```bash
# Configure EAS
eas build:configure

# Build for Android
eas build --platform android --profile production

# Build for iOS (requires Apple Developer account)
eas build --platform ios --profile production
```

### Local Builds

```bash
# Generate native projects
npx expo prebuild

# Build Android (requires Android Studio)
cd android && ./gradlew assembleRelease

# Build iOS (Mac only, requires Xcode)
cd ios && xcodebuild ...
```

## 📈 Performance

- Bundle size: ~5MB (minified)
- Cold start: < 2s on mid-range device
- Navigation: 60fps
- Token refresh: < 300ms

## 🐛 Troubleshooting

### Metro bundler issues
```bash
# Clear cache
expo start -c
```

### iOS build errors
```bash
cd ios
pod install
cd ..
expo run:ios
```

### Android build errors
```bash
cd android
./gradlew clean
cd ..
expo run:android
```

### Token refresh loop
- Check backend JWT secrets match
- Verify refresh token expiry (7 days)
- Clear app data and login again

## 🔒 Security Notes

- ✅ Tokens stored in SecureStore (encrypted)
- ✅ API client auto-refreshes tokens
- ✅ No sensitive data in AsyncStorage
- 🔜 Biometric templates encrypted (Phase 4)
- 🔜 HMAC signature on offline events (Phase 5)

## 📞 Support

- **Technical Issues**: DevOps Team <devops@klassic.ph>
- **Bug Reports**: Create issue in repository

---

## Phase 2 Completion Status

✅ **Completed:**
- [x] React Native + Expo project initialization
- [x] TypeScript configuration
- [x] Navigation structure (Auth & Main)
- [x] API client with token refresh
- [x] Auth store (Zustand)
- [x] Secure token storage
- [x] Login screen (with dev shortcuts)
- [x] Home screen
- [x] Attendance screen (placeholder)
- [x] History screen (mock data)
- [x] Profile screen
- [x] Environment configuration
- [x] Babel/ESLint/Prettier setup

🔜 **Next (Phase 3):**
- [ ] GPS location service
- [ ] Geofence validation (client-side)
- [ ] Site API integration
- [ ] Check-in/out API integration

---

**Built with ❤️ by the Klassic Engineering Team**
