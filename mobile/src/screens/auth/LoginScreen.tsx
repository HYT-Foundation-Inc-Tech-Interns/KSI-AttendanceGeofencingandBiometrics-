import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useAuthStore } from '@/store/authStore';
import { colors } from '@/theme';

const LoginScreen: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { login, isLoading, error, clearError } = useAuthStore();

  const handleLogin = async () => {
    if (!email || !password) {
      Alert.alert('Error', 'Please enter both email and password');
      return;
    }

    try {
      clearError();
      await login({ email: email.trim().toLowerCase(), password });
    } catch (err: any) {
      Alert.alert('Login Failed', err.message || 'Please check your credentials');
    }
  };

  // Dev shortcuts
  const fillEmployeeCredentials = () => {
    setEmail('juan.delacruz@klassic.ph');
    setPassword('employee123');
  };

  const fillAdminCredentials = () => {
    setEmail('admin@klassic.ph');
    setPassword('admin123');
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <StatusBar style="light" />
      
      <View style={styles.content}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Klassic Attendance</Text>
          <Text style={styles.subtitle}>GPS-Geofenced Timekeeping</Text>
        </View>

        {/* Form */}
        <View style={styles.form}>
          <TextInput
            style={styles.input}
            placeholder="Email"
            placeholderTextColor={colors.disabled}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
            editable={!isLoading}
          />

          <TextInput
            style={styles.input}
            placeholder="Password"
            placeholderTextColor={colors.disabled}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="password"
            editable={!isLoading}
          />

          {error && (
            <Text style={styles.errorText}>{error}</Text>
          )}

          <TouchableOpacity
            style={[styles.button, isLoading && styles.buttonDisabled]}
            onPress={handleLogin}
            disabled={isLoading}
          >
            <Text style={[styles.buttonText, isLoading && styles.buttonTextDisabled]}>
              {isLoading ? 'Logging in...' : 'Login'}
            </Text>
          </TouchableOpacity>

          {/* Dev shortcuts (only in development) */}
          {__DEV__ && (
            <View style={styles.devShortcuts}>
              <Text style={styles.devTitle}>Development Shortcuts:</Text>
              <View style={styles.devButtons}>
                <TouchableOpacity
                  style={styles.devButton}
                  onPress={fillEmployeeCredentials}
                >
                  <Text style={styles.devButtonText}>Employee</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.devButton}
                  onPress={fillAdminCredentials}
                >
                  <Text style={styles.devButtonText}>Admin</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>Klassic Inc. © 2026</Text>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  /*
   * A full brand800 plane with lime accents — the same dark surface the
   * dashboard shell uses, and the one place lime is legal as text (5.04:1 on
   * brand800; on white it would be 1.70:1).
   */
  container: {
    flex: 1,
    backgroundColor: colors.primaryDark,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  header: {
    alignItems: 'center',
    marginBottom: 48,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: colors.textOnBrand,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: colors.textOnBrandMuted,
  },
  form: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  input: {
    height: 50,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 16,
    marginBottom: 16,
    fontSize: 16,
    color: colors.text,
  },
  button: {
    backgroundColor: colors.primary,
    height: 50,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 8,
  },
  // Disabled reads as "not available yet" without dropping the label below
  // legibility: silver200 fill with ink text is 11.3:1, where the previous
  // light-green fill left white text at roughly 1.9:1.
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
  errorText: {
    color: colors.danger,
    fontSize: 14,
    marginBottom: 12,
    textAlign: 'center',
  },
  footer: {
    alignItems: 'center',
    marginTop: 24,
  },
  footerText: {
    color: colors.textOnBrandMuted,
    fontSize: 12,
  },
  devShortcuts: {
    marginTop: 24,
    paddingTop: 24,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  devTitle: {
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: 12,
    textAlign: 'center',
  },
  devButtons: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  devButton: {
    backgroundColor: colors.warningSoft,
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.warningSoftBorder,
  },
  devButtonText: {
    color: colors.warning,
    fontSize: 12,
    fontWeight: '600',
  },
});

export default LoginScreen;
