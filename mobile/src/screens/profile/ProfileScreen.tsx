import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@/store/authStore';
import { APP_VERSION } from '@/constants/config';
import { colors } from '@/theme';

const ProfileScreen: React.FC = () => {
  const { user, logout } = useAuthStore();

  const handleLogout = () => {
    Alert.alert(
      'Logout',
      'Are you sure you want to logout?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Logout',
          style: 'destructive',
          onPress: async () => {
            try {
              await logout();
            } catch (error) {
              Alert.alert('Error', 'Failed to logout');
            }
          },
        },
      ]
    );
  };

  const MenuItem: React.FC<{
    icon: keyof typeof Ionicons.glyphMap;
    label: string;
    value?: string;
    onPress?: () => void;
    showChevron?: boolean;
  }> = ({ icon, label, value, onPress, showChevron = false }) => (
    <TouchableOpacity
      style={styles.menuItem}
      onPress={onPress}
      disabled={!onPress}
    >
      <View style={styles.menuItemLeft}>
        <Ionicons name={icon} size={24} color={colors.primary} />
        <Text style={styles.menuItemLabel}>{label}</Text>
      </View>
      <View style={styles.menuItemRight}>
        {value && <Text style={styles.menuItemValue}>{value}</Text>}
        {showChevron && (
          <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
        )}
      </View>
    </TouchableOpacity>
  );

  return (
    <ScrollView style={styles.container}>
      {/* Profile Header */}
      <View style={styles.header}>
        <View style={styles.avatarContainer}>
          <Ionicons name="person" size={48} color={colors.textOnBrand} />
        </View>
        <Text style={styles.name}>{user?.full_name || 'Unknown'}</Text>
        <Text style={styles.email}>{user?.email || ''}</Text>
        <View style={styles.roleBadge}>
          <Text style={styles.roleText}>{user?.role?.toUpperCase() || 'EMPLOYEE'}</Text>
        </View>
      </View>

      {/* Account Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Account</Text>
        <View style={styles.menuCard}>
          <MenuItem
            icon="person-outline"
            label="Employee Code"
            value={user?.employee_id?.substring(0, 8) || 'N/A'}
          />
          <MenuItem
            icon="business-outline"
            label="Organization"
            value={user?.organization_id?.substring(0, 8) || 'N/A'}
          />
        </View>
      </View>

      {/* Settings Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Settings</Text>
        <View style={styles.menuCard}>
          <MenuItem
            icon="notifications-outline"
            label="Notifications"
            onPress={() => Alert.alert('Coming Soon', 'Notification settings will be added later')}
            showChevron
          />
          <MenuItem
            icon="language-outline"
            label="Language"
            value="English"
            onPress={() => Alert.alert('Coming Soon', 'Language settings will be added later')}
            showChevron
          />
          <MenuItem
            icon="lock-closed-outline"
            label="Privacy"
            onPress={() => Alert.alert('Coming Soon', 'Privacy settings will be added later')}
            showChevron
          />
        </View>
      </View>

      {/* About Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>About</Text>
        <View style={styles.menuCard}>
          <MenuItem icon="information-circle-outline" label="App Version" value={APP_VERSION} />
          <MenuItem
            icon="help-circle-outline"
            label="Help & Support"
            onPress={() => Alert.alert('Help', 'Contact: support@klassic.ph')}
            showChevron
          />
        </View>
      </View>

      {/* Logout Button */}
      <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
        <Ionicons name="log-out-outline" size={24} color={colors.danger} />
        <Text style={styles.logoutText}>Logout</Text>
      </TouchableOpacity>

      <View style={styles.footer}>
        <Text style={styles.footerText}>Klassic Inc. © 2026</Text>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    // brand800, matching the dashboard shell and the other screen headers.
    backgroundColor: colors.primaryDark,
    padding: 24,
    alignItems: 'center',
  },
  avatarContainer: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  name: {
    fontSize: 24,
    fontWeight: 'bold',
    color: colors.textOnBrand,
    marginBottom: 4,
  },
  email: {
    fontSize: 14,
    // Lime on brand800 measures 5.04:1, so it is legible here — it would be
    // 1.70:1 on white and is never used as text on a light surface.
    color: colors.textOnBrandMuted,
    marginBottom: 12,
  },
  roleBadge: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  roleText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textOnBrand,
  },
  section: {
    padding: 16,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  menuCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  menuItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  menuItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  menuItemLabel: {
    fontSize: 16,
    color: colors.text,
  },
  menuItemRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  menuItemValue: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    marginHorizontal: 16,
    marginTop: 8,
    padding: 16,
    borderRadius: 12,
    gap: 8,
    borderWidth: 1,
    borderColor: colors.dangerSoftBorder,
  },
  logoutText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.danger,
  },
  footer: {
    alignItems: 'center',
    padding: 24,
  },
  footerText: {
    fontSize: 12,
    // `colors.disabled` (#A8A7A7) is a fill/placeholder token at 2.38:1 — it is
    // not readable as text. Secondary ink is 5.39:1.
    color: colors.textSecondary,
  },
});

export default ProfileScreen;
