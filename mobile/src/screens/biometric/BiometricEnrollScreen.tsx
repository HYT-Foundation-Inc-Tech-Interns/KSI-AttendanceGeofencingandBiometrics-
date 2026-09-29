import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Image,
} from 'react-native';
import { Camera, CameraType } from 'expo-camera';
import { useNavigation } from '@react-navigation/native';
import { apiClient } from '@/services/api/apiClient';
import { colors } from '@/theme';

interface BiometricEnrollScreenProps {
  route: {
    params: {
      employeeId: string;
      employeeName: string;
    };
  };
}

export const BiometricEnrollScreen: React.FC<BiometricEnrollScreenProps> = ({
  route,
}) => {
  const { employeeId, employeeName } = route.params;
  const navigation = useNavigation();

  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [isEnrolling, setIsEnrolling] = useState(false);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const cameraRef = useRef<Camera>(null);

  // Request camera permissions
  React.useEffect(() => {
    (async () => {
      const { status } = await Camera.requestCameraPermissionsAsync();
      setHasPermission(status === 'granted');
    })();
  }, []);

  const handleCaptureFace = async () => {
    if (!cameraRef.current) return;

    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.8,
        base64: true,
        skipProcessing: false,
      });

      if (photo.base64) {
        const base64Image = `data:image/jpeg;base64,${photo.base64}`;
        setCapturedImage(base64Image);
      }
    } catch (error) {
      console.error('Failed to capture photo:', error);
      Alert.alert('Error', 'Failed to capture photo. Please try again.');
    }
  };

  const handleRetake = () => {
    setCapturedImage(null);
  };

  const handleEnroll = async () => {
    if (!capturedImage) return;

    setIsEnrolling(true);

    try {
      // apiClient unwraps to the response body, so this is the DTO itself —
      // reading `response.data.success` here meant `.data` was undefined and
      // the success branch was unreachable.
      const result = await apiClient.post<{
        success: boolean;
        enrollmentId: string;
        faceQuality?: number;
        message: string;
      }>('/biometric/enroll', {
        employeeId,
        faceImage: capturedImage,
        deviceIdentifier: 'mobile-device-001', // In production, use actual device ID
        deviceName: 'iPhone 14 Pro', // In production, get from device info
      });

      if (result.success) {
        Alert.alert(
          'Success',
          'Face enrollment successful! You can now use biometric check-in.',
          [
            {
              text: 'OK',
              onPress: () => navigation.goBack(),
            },
          ],
        );
      }
    } catch (error: any) {
      console.error('Enrollment error:', error);
      // apiClient rejects with a normalized { code, message } error, not an
      // axios error — `error.response.data.message` was always undefined.
      const errorMessage =
        error?.message ||
        'Face enrollment failed. Please ensure good lighting and try again.';
      Alert.alert('Enrollment Failed', errorMessage);
    } finally {
      setIsEnrolling(false);
    }
  };

  if (hasPermission === null) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Requesting camera permission...</Text>
      </View>
    );
  }

  if (hasPermission === false) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>Camera permission denied</Text>
        <Text style={styles.helpText}>
          Please enable camera access in your device settings to enroll your face.
        </Text>
      </View>
    );
  }

  if (capturedImage) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Review Your Photo</Text>
          <Text style={styles.subtitle}>
            Enrolling: {employeeName}
          </Text>
        </View>

        <View style={styles.previewContainer}>
          {/* `<img>` is a DOM element; React Native has no such component and
              threw on the preview step. `Image` with a data URI is the RN way. */}
          <Image
            source={{ uri: capturedImage }}
            style={styles.preview}
            resizeMode="cover"
          />
        </View>

        <View style={styles.instructionsContainer}>
          <Text style={styles.instructionText}>
            ✓ Ensure your face is clearly visible
          </Text>
          <Text style={styles.instructionText}>
            ✓ Good lighting with no shadows
          </Text>
          <Text style={styles.instructionText}>
            ✓ Look directly at the camera
          </Text>
        </View>

        <View style={styles.buttonContainer}>
          <TouchableOpacity
            style={[styles.button, styles.secondaryButton]}
            onPress={handleRetake}
            disabled={isEnrolling}
          >
            <Text style={styles.secondaryButtonText}>Retake</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.button, styles.primaryButton]}
            onPress={handleEnroll}
            disabled={isEnrolling}
          >
            {isEnrolling ? (
              <ActivityIndicator color={colors.textOnBrand} />
            ) : (
              <Text style={styles.primaryButtonText}>Enroll Face</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Biometric Enrollment</Text>
        <Text style={styles.subtitle}>Enrolling: {employeeName}</Text>
      </View>

      <View style={styles.cameraContainer}>
        <Camera
          ref={cameraRef}
          style={styles.camera}
          type={CameraType.front}
          ratio="16:9"
        >
          <View style={styles.cameraOverlay}>
            <View style={styles.faceGuide}>
              <Text style={styles.guideText}>
                Position your face in the frame
              </Text>
            </View>
          </View>
        </Camera>
      </View>

      <View style={styles.instructionsContainer}>
        <Text style={styles.instructionTitle}>Instructions:</Text>
        <Text style={styles.instructionText}>
          • Remove glasses, hats, or masks
        </Text>
        <Text style={styles.instructionText}>
          • Ensure good lighting on your face
        </Text>
        <Text style={styles.instructionText}>
          • Look directly at the camera
        </Text>
        <Text style={styles.instructionText}>
          • Keep a neutral expression
        </Text>
      </View>

      <TouchableOpacity
        style={[styles.button, styles.captureButton]}
        onPress={handleCaptureFace}
      >
        <Text style={styles.captureButtonText}>Capture Face</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    padding: 20,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  cameraContainer: {
    flex: 1,
    margin: 20,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: colors.cameraBackdrop,
  },
  camera: {
    flex: 1,
  },
  cameraOverlay: {
    flex: 1,
    backgroundColor: 'transparent',
    justifyContent: 'center',
    alignItems: 'center',
  },
  faceGuide: {
    width: 250,
    height: 300,
    borderWidth: 3,
    borderColor: colors.surface,
    borderRadius: 125,
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingBottom: 20,
  },
  guideText: {
    color: colors.textOnBrand,
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
    backgroundColor: colors.scrim,
    padding: 8,
    borderRadius: 8,
  },
  previewContainer: {
    flex: 1,
    margin: 20,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: colors.cameraBackdrop,
  },
  preview: {
    width: '100%',
    height: '100%',
  },
  instructionsContainer: {
    padding: 20,
    backgroundColor: colors.surface,
    marginHorizontal: 20,
    marginBottom: 20,
    borderRadius: 12,
  },
  instructionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 12,
  },
  instructionText: {
    fontSize: 14,
    color: colors.textSecondary,
    marginBottom: 8,
    lineHeight: 20,
  },
  buttonContainer: {
    flexDirection: 'row',
    padding: 20,
    gap: 12,
  },
  button: {
    flex: 1,
    height: 50,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  captureButton: {
    backgroundColor: colors.primary,
    marginHorizontal: 20,
    marginBottom: 20,
  },
  captureButtonText: {
    color: colors.textOnBrand,
    fontSize: 16,
    fontWeight: '600',
  },
  primaryButton: {
    backgroundColor: colors.primary,
  },
  primaryButtonText: {
    color: colors.textOnBrand,
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryButton: {
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.primary,
  },
  secondaryButtonText: {
    color: colors.primary,
    fontSize: 16,
    fontWeight: '600',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: colors.textSecondary,
  },
  errorText: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.danger,
    marginBottom: 8,
    textAlign: 'center',
  },
  helpText: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    paddingHorizontal: 40,
  },
});
