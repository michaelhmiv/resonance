/**
 * Cross-reference links — understated marginal links rendered after a verse.
 *
 * These are deliberately quiet: small accent-toned text links, not a side
 * panel or expanded commentary. Tapping a link opens the target passage in the
 * reading surface.
 *
 * (design spec §6.3: cross-references as understated marginal links)
 */

import { type ReactNode } from 'react';
import { Pressable, Text, View, StyleSheet } from 'react-native';

import { colors, fontFamilies, spacing } from '@resonance/theme';

interface CrossReferenceLinksProps {
  /** Target references (e.g. "John 3:16"). */
  refs: string[];
  /** Open a reference in the reading surface. */
  onPress?: (ref: string) => void;
}

export function CrossReferenceLinks({
  refs,
  onPress,
}: CrossReferenceLinksProps): ReactNode {
  if (refs.length === 0) return null;
  return (
    <View style={styles.wrap}>
      {refs.map((ref) => (
        <Pressable
          key={ref}
          onPress={() => onPress?.(ref)}
          hitSlop={6}
          disabled={!onPress}
          accessibilityRole="link"
        >
          <Text style={styles.link}>↳ {ref}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.xs,
    paddingLeft: spacing.xs,
  },
  link: {
    fontFamily: fontFamilies.sans,
    fontSize: 12,
    color: colors.accentMuted,
    letterSpacing: 0.2,
  },
});
