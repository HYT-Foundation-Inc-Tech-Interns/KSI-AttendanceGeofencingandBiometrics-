import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  ActivityIndicator,
  Alert,
  Image,
} from 'react-native';
import { Camera, CameraType } from 'expo-camera';
import { apiClient } from '@/services/api/apiClient';
import { colors } from '@/theme';

interface BiometricVerifyModalProps {
  visible: boolean;
  employeeId: string;
  onVerified: (verified: boolean, faceImage: string, confidence?: number) => void;
  onCancel: () => void;
}

export const BiometricVerifyModal: React.FC<BiometricVerifyModalProps> = ({
  visible,
  employeeId,
  onVerified,
  onCancel,
}) => {
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const cameraRef = useRef<Camera>(null);

  // Request camera permissions
  useEffect(() => {
    if (visible) {
      (async () => {
        const { status } = await Camera.requestCameraPermissionsAsync();
        setHasPermission(status === 'granted');
      })();
    }
  }, [visible]);

  // Reset state when modal closes
  useEffect(() => {
    if (!visible) {
      setCapturedImage(null);
      setIsVerifying(false);
      setCountdown(null);
    }
  }, [visible]);

  const handleAutoCapture = () => {
    // Start countdown
    setCountdown(3);
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev === 1) {
          clearInterval(timer);
          handleCaptureFace();
          return null;
        }
        return prev ? prev - 1 : null;
      });
    }, 1000);
  };

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
        await handleVerify(base64Image);
      }
    } catch (error) {
      console.error('Failed to capture photo:', error);
      Alert.alert('Error', 'Failed to capture photo. Please try again.');
    }
  };

  const handleVerify = async (faceImage: string) => {
    setIsVerifying(true);

    try {
      // apiClient unwraps to the response body, so this is the payload itself.
      const result = await apiClient.post<{
        verified: boolean;
        confidence: number;
        threshold?: number;
        message: string;
      }>('/biometric/verify', {
        employeeId,
        faceImage,
        deviceIdentifier: 'mobile-device-001', // In production, use actual device ID
      });

      if (result.verified) {
        // Success - pass back to parent
        onVerified(true, faceImage, result.confidence);
      } else {
        // Verification failed
        Alert.alert(
          'Verification Failed',
          `Face match confidence: ${((result.confidence ?? 0) * 100).toFixed(1)}%\nRequired: ${((result.threshold ?? 0) * 100).toFixed(1)}%`,
          [
            {
              text: 'Try Again',
              onPress: () => {
                setCapturedImage(null);
                setIsVerifying(false);
              },
            },
            {
              text: 'Cancel',
              style: 'cancel',
              onPress: onCancel,
            },
          ],
        );
      }
    } catch (error: any) {
      console.error('Verification error:', error);
      // apiClient rejects with a normalized { code, message } error.
      const errorMessage =
        error?.message || 'Face verification failed. Please try again.';

      Alert.alert('Verification Error', errorMessage, [
        {
          text: 'Try Again',
          onPress: () => {
            setCapturedImage(null);
            setIsVerifying(false);
          },
        },
        {
          text: 'Cancel',
          style: 'cancel',
          onPress: onCancel,
        },
      ]);
    } finally {
      setIsVerifying(false);
    }
  };

  const handleRetake = () => {
    setCapturedImage(null);
    setIsVerifying(false);
  };

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onCancel}
    >
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={onCancel} style={styles.cancelButton}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Face Verification</Text>
          <View style={styles.placeholder} />
        </View>

        {/* Permission check */}
        {hasPermission === null && (
          <View style={styles.centerContent}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.loadingText}>Requesting camera permission...</Text>
          </View>
        )}

        {hasPermission === false && (
          <View style={styles.centerContent}>
            <Text style={styles.errorText}>Camera permission denied</Text>
            <Text style={styles.helpText}>
              Please enable camera access in settings
            </Text>
          </View>
        )}

        {/* Camera view */}
        {hasPermission === true && !capturedImage && (
          <>
            <View style={styles.cameraContainer}>
              <Camera
                ref={cameraRef}
                style={styles.camera}
                type={CameraType.front}
                ratio="16:9"
              >
                <View style={styles.cameraOverlay}>
                  {countdown !== null && (
                    <View style={styles.countdownContainer}>
                      <Text style={styles.countdownText}>{countdown}</Text>
                    </View>
                  )}
                  <View style={styles.faceGuide}>
                    <Text style={styles.guideText}>
                      {countdown
                        ? `Taking photo in ${countdown}...`
                        : 'Position your face'}
                    </Text>
                  </View>
                </View>
              </Camera>
            </View>

            <View style={styles.instructionsContainer}>
              <Text style={styles.instructionText}>
                • Look directly at the camera
              </Text>
              <Text style={styles.instructionText}>
                • Ensure good lighting
              </Text>
              <Text style={styles.instructionText}>
                • Remove glasses or masks
              </Text>
            </View>

            <TouchableOpacity
              style={styles.captureButton}
              onPress={handleAutoCapture}
              disabled={countdown !== null}
            >
              <Text style={styles.captureButtonText}>
                {countdown ? 'Capturing...' : 'Capture Face'}
              </Text>
            </TouchableOpacity>
          </>
        )}

        {/* Preview + verifying */}
        {capturedImage && (
          <View style={styles.centerContent}>
            <View style={styles.previewContainer}>
              {/* `<img>` is a DOM element; React Native has no such component and
                  threw before verification could be reported. */}
              <Image
                source={{ uri: capturedImage }}
                style={styles.preview}
                resizeMode="cover"
              />
            </View>

            {isVerifying && (
              <View style={styles.verifyingContainer}>
                <ActivityIndicator size="large" color={colors.primary} />
                <Text style={styles.verifyingText}>Verifying your face...</Text>
                <Text style={styles.verifyingSubtext}>
                  This may take a few seconds
                </Text>
              </View>
            )}

            {!isVerifying && (
              <TouchableOpacity style={styles.retakeButton} onPress={handleRetake}>
                <Text style={styles.retakeButtonText}>Retake</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
  },
  cancelButton: {
    padding: 4,
  },
  cancelText: {
    fontSize: 16,
    color: colors.primary,
  },
  placeholder: {
    width: 60,
  },
  centerContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
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
  countdownContainer: {
    position: 'absolute',
    top: '30%',
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.primaryOverlay,
    justifyContent: 'center',
    alignItems: 'center',
  },
  countdownText: {
    fontSize: 48,
    fontWeight: '700',
    color: colors.textOnBrand,
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
  instructionsContainer: {
    padding: 20,
    backgroundColor: colors.surface,
    marginHorizontal: 20,
    marginBottom: 12,
    borderRadius: 12,
  },
  instructionText: {
    fontSize: 14,
    color: colors.textSecondary,
    marginBottom: 8,
  },
  captureButton: {
    backgroundColor: colors.primary,
    marginHorizontal: 20,
    marginBottom: 20,
    height: 50,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  captureButtonText: {
    color: colors.textOnBrand,
    fontSize: 16,
    fontWeight: '600',
  },
  previewContainer: {
    width: 300,
    height: 400,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: colors.cameraBackdrop,
    marginBottom: 20,
  },
  preview: {
    width: '100%',
    height: '100%',
  },
  verifyingContainer: {
    alignItems: 'center',
    padding: 20,
  },
  verifyingText: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
    marginTop: 16,
  },
  verifyingSubtext: {
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: 4,
  },
  retakeButton: {
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.primary,
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 12,
  },
  retakeButtonText: {
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
  },
  helpText: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});
