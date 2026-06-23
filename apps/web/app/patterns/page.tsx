/**
 * Patterns page — gentle reflection on recurring themes (web version).
 *
 * Currently shows a placeholder. When Supabase + models are wired in,
 * this becomes the real patterns surface with clustering, weekly
 * roundups, and "what shifted" narratives.
 */

'use client';

import { type ReactNode } from 'react';
import { StyleSheet, Text, View, ScrollView } from 'react-native-web';

export default function PatternsPage(): ReactNode {
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.emptyText}>
        Patterns will appear as you write.
      </Text>
      <Text style={styles.hint}>
        This is where recurring themes, weekly roundups, and gentle reflections
        will surface — once your journal has entries and the models are connected.
      </Text>

      {/* Calendar placeholder */}
      <View style={styles.calendarPlaceholder}>
        {Array.from({ length: 30 }, (_, i) => (
          <View
            key={i}
            style={[
              styles.calDay,
              i % 7 === 0 && styles.calDayActive,
            ]}
          >
            {i % 7 === 0 && <View style={styles.calDot} />}
          </View>
        ))}
      </View>

      <Text style={styles.sectionLabel}>This Week</Text>
      <View style={styles.card}>
        <Text style={styles.cardText}>No entries yet this week.</Text>
      </View>

      <Text style={styles.sectionLabel}>Recurring Themes</Text>
      <View style={styles.card}>
        <Text style={styles.cardText}>Themes will cluster here as your journal grows.</Text>
      </View>

      <Text style={styles.sectionLabel}>A Quiet Question</Text>
      <View style={styles.card}>
        <Text style={styles.reflectionText}>
          What are you noticing these days?
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { gap: 16, paddingBottom: 40 },
  emptyText: {
    fontFamily: 'Georgia, serif',
    fontStyle: 'italic',
    fontSize: 17,
    color: '#b8b0a4',
    textAlign: 'center',
  },
  hint: {
    fontFamily: 'Inter, sans-serif',
    fontSize: 13,
    color: '#9a9388',
    textAlign: 'center',
    lineHeight: 20,
  },
  calendarPlaceholder: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    paddingVertical: 16,
  },
  calDay: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#e8e5e0',
    backgroundColor: '#ffffff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  calDayActive: {
    borderColor: '#a89880',
    backgroundColor: '#faf9f6',
  },
  calDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#8b7355',
  },
  sectionLabel: {
    fontFamily: 'Inter, sans-serif',
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: '#9a9388',
  },
  card: {
    borderWidth: 1,
    borderColor: '#e8e5e0',
    backgroundColor: '#ffffff',
    borderRadius: 10,
    padding: 16,
  },
  cardText: {
    fontFamily: 'Georgia, serif',
    fontSize: 15,
    lineHeight: 22,
    color: '#9a9388',
  },
  reflectionText: {
    fontFamily: 'Georgia, serif',
    fontStyle: 'italic',
    fontSize: 17,
    lineHeight: 26,
    color: '#3a3530',
  },
});
