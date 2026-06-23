/**
 * Passage card — a reusable surface for quoting a passage: serif italic body,
 * a quiet source line, and a "Read in Word" action. Used by search results and
 * resonance cards throughout the app.
 *
 * Hairline border, no drop shadow, cream background. Serif-forward.
 *
 * (design spec §6.4: search results as passage cards)
 */

import { type ReactNode } from 'react';
import { Pressable, Text, View, StyleSheet } from 'react-native';

import {
  cardSurface,
  colors,
  fontFamilies,
  layout,
  metadataText,
  radii,
  serifQuote,
  spacing,
} from '../../theme';

export interface PassageCardProps {
  /** The quoted text. */
  text: string;
  /** Human-readable source line, e.g. "Genesis 1:1 (WEB)" or "Augustine — Confessions". */
  source: string;
  /** Navigate to the passage in the Word tab reading surface. */
  onPressRead?: () => void;
  /** Optional secondary annotation / note rendered under the source line. */
  note?: string;
}

export function PassageCard({
  text,
  source,
  onPressRead,
  note,
}: PassageCardProps): ReactNode {
  return (
    <View style={[cardSurface, styles.card, { padding: layout.cardPadding }]}>
      <Text style={styles.quote}>"{text}"</Text>

      <View style={styles.footer}>
        <View style={styles.sourceWrap}>
          <Text style={styles.source}>{source}</Text>
          {note ? <Text style={styles.note}>{note}</Text> : null}
        </View>
        {onPressRead ? (
          <Pressable
            onPress={onPressRead}
            hitSlop={8}
            accessibilityRole="button"
          >
            <Text style={styles.action}>Read in Word</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radii.md,
  },
  quote: {
    ...serifQuote,
    fontStyle: 'italic',
    color: colors.textPrimary,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginTop: spacing.md,
  },
  sourceWrap: {
    flexShrink: 1,
  },
  source: {
    ...metadataText,
    color: colors.textSecondary,
    textTransform: 'none',
  },
  note: {
    fontFamily: fontFamilies.serifItalic,
    fontStyle: 'italic',
    fontSize: 13,
    lineHeight: 18,
    color: colors.textTertiary,
    marginTop: spacing.xs,
  },
  action: {
    fontFamily: fontFamilies.sansSemibold,
    fontSize: 13,
    letterSpacing: 0.3,
    color: colors.accent,
  },
});
