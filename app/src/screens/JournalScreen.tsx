/**
 * Journal screen — the primary writing surface.
 *
 * Currently a placeholder: shows "Whatever is real." in serif italic on the
 * cream background, centered.  The continuous document editor (Phase 3) will
 * replace this with a FlashList of typed segments.
 *
 * (design spec §5.1, §5.10)
 */

import { Text, View, StyleSheet } from 'react-native';
import type { ReactNode } from 'react';

import { colors, fontFamilies, screenContainer, spacing } from '../theme';

export function JournalScreen(): ReactNode {
  return (
    <View style={[screenContainer, styles.content]}>
      <Text style={styles.placeholder}>
        Whatever is real.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  placeholder: {
    fontFamily: fontFamilies.serifItalic,
    fontSize: 20,
    fontStyle: 'italic',
    color: colors.placeholder,
    textAlign: 'center',
    paddingHorizontal: spacing.xl,
  },
});
