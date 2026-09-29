import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@/store/authStore';
import { colors } from '@/theme';

const HomeScreen: React.FC = () => {
  const navigation = useNavigation();
  const { user } = useAuthStore();

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.greeting}>Welcome back,</Text>
        <Text style={styles.name}>{user?.full_name || 'Employee'}</Text>
      </View>

      <View style={styles.content}>
        {/* Quick Actions */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Quick Actions</Text>
          
          <View style={styles.actionGrid}>
            <TouchableOpacity
              style={[styles.actionCard, styles.checkInCard]}
              onPress={() => navigation.navigate('Attendance' as never)}
            >
              <Ionicons name="log-in-outline" size={32} color={colors.textOnBrand} />
              <Text style={styles.actionText}>Check In</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.actionCard, styles.historyCard]}
              onPress={() => navigation.navigate('History' as never)}
            >
              <Ionicons name="time-outline" size={32} color={colors.primaryDark} />
              <Text style={[styles.actionText, styles.historyText]}>View History</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Today's Status */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Today's Status</Text>
          <View style={styles.statusCard}>
            <View style={styles.statusRow}>
              <Text style={styles.statusLabel}>Check-in:</Text>
              <Text style={styles.statusValue}>Not yet</Text>
            </View>
            <View style={styles.statusRow}>
              <Text style={styles.statusLabel}>Check-out:</Text>
              <Text style={styles.statusValue}>-</Text>
            </View>
            <View style={styles.statusRow}>
              <Text style={styles.statusLabel}>Hours worked:</Text>
              <Text style={styles.statusValue}>0.0 hrs</Text>
            </View>
          </View>
        </View>

        {/* Info Banner */}
        <View style={styles.infoBanner}>
          <Ionicons name="information-circle-outline" size={20} color={colors.primary} />
          <Text style={styles.infoText}>
            Tap "Check In/Out" to record your attendance
          </Text>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    backgroundColor: colors.primaryDark,
    padding: 24,
    paddingTop: 16,
  },
  greeting: {
    fontSize: 16,
    color: colors.textOnBrandMuted,
  },
  name: {
    fontSize: 24,
    fontWeight: 'bold',
    color: colors.textOnBrand,
    marginTop: 4,
  },
  content: {
    flex: 1,
    padding: 16,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 12,
  },
  actionGrid: {
    flexDirection: 'row',
    gap: 12,
  },
  actionCard: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: 12,
    padding: 16,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  checkInCard: {
    backgroundColor: colors.primary,
  },
  /*
   * Secondary action, so it is a surface rather than a second filled tile. It
   * previously wore `colors.warning` (the amber), which is a reserved status
   * colour — "View History" is not a warning.
   */
  historyCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.primarySoftBorder,
  },
  actionText: {
    color: colors.textOnBrand,
    fontSize: 16,
    fontWeight: '600',
    marginTop: 8,
    textAlign: 'center',
  },
  historyText: {
    color: colors.primaryDark,
  },
  statusCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  statusLabel: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  statusValue: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  infoBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: 8,
    padding: 12,
    gap: 8,
  },
  infoText: {
    flex: 1,
    fontSize: 14,
    color: colors.primaryDark,
  },
});

export default HomeScreen;
