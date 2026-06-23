/**
 * Word screen — dedicated reading surface for Scripture and Library texts.
 *
 * Currently a placeholder. Phase 2 will add the Scripture browser, Library
 * browser, reading view with highlights/annotations/bookmarks, and search.
 *
 * (design spec §6)
 */

import { Text, View, StyleSheet } from 'react-native';
import type { ReactNode } from 'react';

import { colors, fontFamilies, screenContainer, spacing } from '../theme';

export function WordScreen(): ReactNode {
  return (
    <View style={[screenContainer, styles.content]}>
      <Text style={styles.title}>Word</Text>
      <Text style={styles.description}>
        A dedicated reading space for Scripture and the voices of the Church.
        Browse, search, highlight, and annotate.
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
