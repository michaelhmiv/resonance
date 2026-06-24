/**
 * HighlightPill — floating tool pill for the Word tab reading surface.
 *
 * Two states:
 *   collapsed — subtle highlighter pen icon, tap to enter highlight mode
 *   expanded  — 3 color swatches + annotate + dismiss, anchored above
 *               the bottom nav bar at thumb level
 *
 * (design spec §6.3 — highlight, annotate via toggle-mode pill)
 */

import { type ReactNode } from 'react';
import { Pressable, Text, View, StyleSheet } from 'react-native';
import { HighlighterPenIcon, EditIcon, XIcon } from './icons';
import { colors, fontFamilies, highlightPalette, radii, spacing } from '@resonance/theme';

interface HighlightPillProps {
  /** Whether highlight mode is active. */
  active: boolean;
  /** Currently selected highlight color. */
  activeColor: string;
  /** Which verse is the range-start (if any). */
  rangeStartLabel?: string;
  /** Toggle highlight mode on/off. */
  onToggle: () => void;
  /** Select a highlight color. */
  onSelectColor: (color: string) => void;
  /** Open annotation modal for the targeted verse. */
  onAnnotate: () => void;
  /** Exit highlight mode entirely. */
  onDismiss: () => void;
}

export function HighlightPill({
  active,
  activeColor,
  rangeStartLabel,
  onToggle,
  onSelectColor,
  onAnnotate,
  onDismiss,
}: HighlightPillProps): ReactNode {
  if (!active) {
    // ── Collapsed ──────────────────────────────────────────────────────
    return (
      <Pressable
        onPress={onToggle}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel="Enter highlight mode"
        style={styles.pillCollapsed}
      >
        <HighlighterPenIcon size={20} color={colors.textTertiary} />
      </Pressable>
    );
  }

  // ── Expanded ─────────────────────────────────────────────────────────
  return (
    <View style={styles.pillExpanded}>
      {highlightPalette.map((tone) => {
        const isActive = activeColor === tone;
        return (
          <Pressable
            key={tone}
            onPress={() => onSelectColor(tone)}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={`Highlight color ${tone}`}
          >
            <View
              style={[
                styles.swatch,
                { backgroundColor: tone },
                isActive && styles.swatchActive,
              ]}
            />
          </Pressable>
        );
      })}

      <View style={styles.divider} />

      <Pressable
        onPress={onAnnotate}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Add annotation"
        style={styles.pillAction}
      >
        <EditIcon size={18} color={colors.textSecondary} />
      </Pressable>

      <Pressable
        onPress={onDismiss}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Exit highlight mode"
        style={styles.pillAction}
      >
        <XIcon size={16} color={colors.textTertiary} />
      </Pressable>

      {rangeStartLabel ? (
        <Text style={styles.rangeLabel} numberOfLines={1}>
          {rangeStartLabel} →
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  pillCollapsed: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pillExpanded: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  swatch: {
    width: 24,
    height: 24,
    borderRadius: 12,
  },
  swatchActive: {
    borderWidth: 2,
    borderColor: colors.accent,
  },
  divider: {
    width: StyleSheet.hairlineWidth,
    height: 20,
    backgroundColor: colors.border,
    marginHorizontal: spacing.xs,
  },
  pillAction: {
    paddingHorizontal: 2,
    paddingVertical: 2,
  },
  rangeLabel: {
    fontFamily: fontFamilies.sans,
    fontSize: 11,
    color: colors.textTertiary,
    letterSpacing: 0.2,
    marginLeft: spacing.xs,
  },
});
