/**
 * HighlightPill — inline highlighter control for the reading view's
 * bottom nav row.
 *
 * Two visual states, both inline (no floating bar):
 *   collapsed — single 44px square button with the highlighter pen icon
 *   expanded  — color swatches + annotate + dismiss, in the same row
 *
 * The parent owns the row's flexbox; this component only renders its own
 * content. That keeps the chrome at a single fixed height when collapsed
 * and grows the row in place when expanded.
 *
 * (design spec §6.3 — highlight, annotate via inline row expansion)
 */

import { type ReactNode } from 'react';
import { Pressable, View, StyleSheet } from 'react-native';
import { HighlighterPenIcon, NoteIcon, TrashIcon, XIcon } from './icons';
import { colors, highlightPalette, radii, spacing } from '@resonance/theme';

interface HighlightPillProps {
  /** Whether highlight mode is active. */
  active: boolean;
  /** Currently selected highlight color. */
  activeColor: string;
  /** Select a highlight color. */
  onSelectColor: (color: string) => void;
  /** Open annotation modal for the targeted verse. */
  onAnnotate: () => void;
  /** Whether a verse is currently targeted for note/removal actions. */
  hasSelection?: boolean;
  /** Whether the targeted verse currently has a highlight that can be removed. */
  hasHighlight?: boolean;
  /** Remove highlight from the targeted verse. */
  onDeleteHighlight?: () => void;
  /** Exit highlight mode entirely. */
  onDismiss: () => void;
}

export function HighlightPill({
  active,
  activeColor,
  onSelectColor,
  onAnnotate,
  hasSelection = true,
  hasHighlight = false,
  onDeleteHighlight,
  onDismiss,
}: HighlightPillProps): ReactNode {
  if (!active) {
    // ── Collapsed — single 44px square button ──────────────────────
    return (
      <Pressable
        onPress={onAnnotate /* placeholder, parent intercepts via onToggle prop in ReadingView */}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Enter highlight mode"
        style={({ pressed }) => [
          styles.collapsed,
          pressed && styles.pressed,
        ]}
      >
        <HighlighterPenIcon size={20} color={colors.textSecondary} />
      </Pressable>
    );
  }

  // ── Expanded — swatches + annotate + optional remove + dismiss inline ──
  return (
    <View style={styles.expanded}>
      {highlightPalette.map((tone) => {
        const isActive = activeColor === tone;
        return (
          <Pressable
            key={tone}
            onPress={() => onSelectColor(tone)}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={`Highlight color ${tone}`}
            style={({ pressed }) => [
              styles.swatchWrap,
              pressed && styles.pressed,
            ]}
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
        disabled={!hasSelection}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={hasSelection ? 'Add or edit note' : 'Select a verse first to add a note'}
        accessibilityState={{ disabled: !hasSelection }}
        style={({ pressed }) => [
          styles.iconBtn,
          !hasSelection && styles.disabledBtn,
          pressed && hasSelection && styles.pressed,
        ]}
      >
        <NoteIcon
          size={18}
          color={hasSelection ? colors.accent : colors.textTertiary}
        />
      </Pressable>

      {hasHighlight && onDeleteHighlight ? (
        <Pressable
          onPress={onDeleteHighlight}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel="Remove highlight"
          style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]}
        >
          <TrashIcon size={17} color={colors.textSecondary} />
        </Pressable>
      ) : null}

      <Pressable
        onPress={onDismiss}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel="Exit highlight mode"
        style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]}
      >
        <XIcon size={16} color={colors.textTertiary} />
      </Pressable>
    </View>
  );
}

/**
 * Standalone toggle button (collapsed state only) — for the parent that
 * wants to render the toggle in a flexbox row alongside other controls.
 * The full HighlightPill still renders the expanded state inline.
 */
export function HighlightToggleButton({
  onPress,
  active,
}: {
  onPress: () => void;
  active: boolean;
}): ReactNode {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={active ? 'Exit highlight mode' : 'Enter highlight mode'}
      style={({ pressed }) => [
        styles.collapsed,
        active && styles.collapsedActive,
        pressed && styles.pressed,
      ]}
    >
      <HighlighterPenIcon
        size={20}
        color={active ? colors.accent : colors.textSecondary}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  collapsed: {
    width: 44,
    height: 44,
    borderRadius: radii.sm,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  collapsedActive: {
    borderColor: colors.accent,
    backgroundColor: colors.background,
  },
  pressed: {
    opacity: 0.6,
  },
  expanded: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  swatchWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  swatch: {
    width: 22,
    height: 22,
    borderRadius: 11,
  },
  swatchActive: {
    borderWidth: 2,
    borderColor: colors.accent,
  },
  divider: {
    width: StyleSheet.hairlineWidth,
    height: 22,
    backgroundColor: colors.border,
    marginHorizontal: spacing.xs,
  },
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: radii.sm,
    justifyContent: 'center',
    alignItems: 'center',
  },
  disabledBtn: {
    opacity: 0.35,
  },
});
