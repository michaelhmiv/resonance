/**
 * Highlight toolbar — a floating palette that appears when the reader selects a
 * verse (via long-press) and offers the three curated soft tones.
 *
 * In React Native the genuinely free-form text-selection APIs on `<Text>` are
 * limited, so the reading surface drives selection by long-pressing a verse;
 * that verse ref is handed here and the user picks a tone (or a margin note).
 * Highlights are shared across translations (keyed by verse_ref only).
 *
 * (design spec §6.3: 3 soft tones — highlightGold/Sage/Rose)
 */

import { type ReactNode } from 'react';
import { Pressable, Text, View, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';

import { colors, fontFamilies, radii, spacing } from '@resonance/theme';
import { highlightPalette } from '@resonance/theme';

interface HighlightToolbarProps {
  /** The verse reference being acted on, shown for context. */
  verseRef: string;
  /** Apply a highlight color to the current selection. */
  onApply: (color: string) => void;
  /** Open a margin-note editor for the current selection. */
  onAddNote: () => void;
  /** Remove any existing highlight for the current selection. */
  onClear: () => void;
  /** Dismiss the toolbar without changing anything. */
  onDismiss: () => void;
  /** Currently applied color for the selection, if any (for the active state). */
  currentColor?: string;
}

export function HighlightToolbar({
  verseRef,
  onApply,
  onAddNote,
  onClear,
  onDismiss,
  currentColor,
}: HighlightToolbarProps): ReactNode {
  return (
    <View style={styles.bar}>
      <Text style={styles.ref} numberOfLines={1}>
        {verseRef}
      </Text>

      <View style={styles.swatches}>
        {highlightPalette.map((tone) => {
          const active = currentColor === tone;
          return (
            <Pressable
              key={tone}
              onPress={() => onApply(tone)}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel="Highlight"
            >
              <View
                style={[
                  styles.swatch,
                  { backgroundColor: tone },
                  active && styles.swatchActive,
                ]}
              />
            </Pressable>
          );
        })}

        <Pressable
          onPress={onClear}
          hitSlop={6}
          style={styles.action}
          accessibilityRole="button"
          accessibilityLabel="Remove highlight"
        >
          <Feather name="trash-2" size={16} color={colors.textSecondary} />
        </Pressable>

        <Pressable
          onPress={onAddNote}
          hitSlop={6}
          style={styles.action}
          accessibilityRole="button"
          accessibilityLabel="Add margin note"
        >
          <Feather name="edit-3" size={16} color={colors.textSecondary} />
        </Pressable>
      </View>

      <Pressable
        onPress={onDismiss}
        hitSlop={8}
        style={styles.dismiss}
        accessibilityRole="button"
        accessibilityLabel="Close"
      >
        <Feather name="x" size={16} color={colors.textTertiary} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingRight: spacing.sm,
    paddingLeft: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  ref: {
    flexShrink: 1,
    fontFamily: fontFamilies.sansMedium,
    fontSize: 12,
    color: colors.textTertiary,
    letterSpacing: 0.2,
  },
  swatches: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  swatch: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  swatchActive: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderColor: colors.accent,
    borderWidth: 1.5,
  },
  action: {
    paddingHorizontal: 2,
    paddingVertical: 2,
  },
  dismiss: {
    paddingLeft: spacing.xs,
  },
});
