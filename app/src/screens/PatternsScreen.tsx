/**
 * Patterns screen — gentle, humane reflection on recurring themes over time.
 *
 * Currently a placeholder. Phase 5 will add the calendar view, cluster labels,
 * "what shifted" narratives, verses that linger, and the weekly roundup.
 *
 * (design spec §7)
 */

import { Text, View, StyleSheet } from 'react-native';
import type { ReactNode } from 'react';

import { colors, fontFamilies, screenContainer, spacing } from '../theme';

export function PatternsScreen(): ReactNode {
  return (
    <View style={[screenContainer, styles.content]}>
      <Text style={styles.title}>Patterns</Text>
      <Text style={styles.description}>
        Gentle reflection on recurring themes, passages, and voices —
        a quiet calendar of the heart, not a dashboard.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontFamily: fontFamilies.serifSemibold,
    fontSize: 24,
    color: colors.textPrimary,
    marginBottom: spacing.md,
  },
  description: {
    fontFamily: fontFamilies.serif,
    fontSize: 16,
    lineHeight: 24,
    color: colors.textSecondary,
    textAlign: 'center',
    paddingHorizontal: spacing.xl,
  },
});
