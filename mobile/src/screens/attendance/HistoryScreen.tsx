import React from 'react';
import { View, Text, StyleSheet, FlatList } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/theme';

const HistoryScreen: React.FC = () => {
  // Mock data for UI demonstration
  const mockHistory = [
    {
      id: '1',
      date: '2026-09-11',
      checkIn: '09:00 AM',
      checkOut: '05:00 PM',
      hours: '8.0',
      status: 'verified',
    },
    {
      id: '2',
      date: '2026-09-10',
      checkIn: '08:55 AM',
      checkOut: '05:10 PM',
      hours: '8.25',
      status: 'verified',
    },
    {
      id: '3',
      date: '2026-09-09',
      checkIn: '09:05 AM',
      checkOut: '05:00 PM',
      hours: '7.92',
      status: 'verified',
    },
  ];

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'verified':
        return colors.success;
      case 'pending':
        return colors.warning;
      case 'flagged':
        return colors.danger;
      default:
        return colors.textSecondary;
    }
  };

  const renderHistoryItem = ({ item }: { item: typeof mockHistory[0] }) => (
    <View style={styles.historyCard}>
      <View style={styles.historyHeader}>
        <Text style={styles.historyDate}>{item.date}</Text>
        <View style={[styles.statusBadge, { backgroundColor: getStatusColor(item.status) }]}>
          <Text style={styles.statusText}>{item.status}</Text>
        </View>
      </View>
      
      <View style={styles.historyDetails}>
        <View style={styles.timeRow}>
          <Ionicons name="log-in-outline" size={16} color={colors.textSecondary} />
          <Text style={styles.timeLabel}>Check-in:</Text>
          <Text style={styles.timeValue}>{item.checkIn}</Text>
        </View>
        
        <View style={styles.timeRow}>
          <Ionicons name="log-out-outline" size={16} color={colors.textSecondary} />
          <Text style={styles.timeLabel}>Check-out:</Text>
          <Text style={styles.timeValue}>{item.checkOut}</Text>
        </View>
        
        <View style={styles.hoursRow}>
          <Ionicons name="time-outline" size={16} color={colors.primary} />
          <Text style={styles.hoursLabel}>Hours worked:</Text>
          <Text style={styles.hoursValue}>{item.hours} hrs</Text>
        </View>
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      <View style={styles.summary}>
        <Text style={styles.summaryTitle}>This Week</Text>
        <Text style={styles.summaryValue}>24.17 hours</Text>
        <Text style={styles.summarySubtext}>3 days</Text>
      </View>

      <View style={styles.listContainer}>
        <Text style={styles.listTitle}>Recent Activity</Text>
        <FlatList
          data={mockHistory}
          renderItem={renderHistoryItem}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        />
      </View>

      <View style={styles.infoBox}>
        <Ionicons name="information-circle-outline" size={20} color={colors.primary} />
        <Text style={styles.infoText}>
          Attendance data will sync from backend in Phase 6
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  summary: {
    // brand800, matching the screen headers on Home, Profile and the tab bar.
    backgroundColor: colors.primaryDark,
    padding: 24,
    alignItems: 'center',
  },
  summaryTitle: {
    fontSize: 14,
    color: colors.primarySoft,
    marginBottom: 4,
  },
  summaryValue: {
    fontSize: 32,
    fontWeight: 'bold',
    color: colors.textOnBrand,
  },
  summarySubtext: {
    fontSize: 14,
    color: colors.primarySoft,
    marginTop: 4,
  },
  listContainer: {
    flex: 1,
    padding: 16,
  },
  listTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 12,
  },
  listContent: {
    paddingBottom: 16,
  },
  historyCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  historyHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.background,
  },
  historyDate: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textOnBrand,
    textTransform: 'capitalize',
  },
  historyDetails: {
    gap: 8,
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  timeLabel: {
    fontSize: 14,
    color: colors.textSecondary,
    flex: 1,
  },
  timeValue: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  hoursRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: colors.background,
  },
  hoursLabel: {
    fontSize: 14,
    color: colors.primary,
    fontWeight: '500',
    flex: 1,
  },
  hoursValue: {
    fontSize: 14,
    fontWeight: 'bold',
    color: colors.primary,
  },
  infoBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    padding: 12,
    margin: 16,
    borderRadius: 8,
    gap: 8,
  },
  infoText: {
    flex: 1,
    fontSize: 12,
    color: colors.primaryDark,
  },
});

export default HistoryScreen;
