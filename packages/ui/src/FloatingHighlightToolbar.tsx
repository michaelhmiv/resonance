/**
 * FloatingHighlightToolbar — a small bar that appears above (or below) a
 * text selection in the reading view. Shows 4 color swatches + an "Add note"
 * pencil. Web-only (uses getBoundingClientRect from window.getSelection).
 *
 * Mobile gets the same UX via the bottom chrome (HighlightPill's expanded
 * state). This component is the *web* version that follows the selection.
 */

import { type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, highlightPalette, radii, spacing, withAlpha } from '@resonance/theme';
import { EditIcon } from './icons';

export interface FloatingHighlightToolbarProps {
  /** Bounding rect of the current text selection, in viewport coords. */
  selectionRect: { top: number; left: number; width: number; height: number } | null;
  /** Currently selected color (for the active ring). */
  activeColor: string;
  onSelectColor: (color: string) => void;
  onAnnotate: () => void;
  onDismiss: () => void;
}

export function FloatingHighlightToolbar({
  selectionRect,
  activeColor,
  onSelectColor,
  onAnnotate,
  onDismiss,
}: FloatingHighlightToolbarProps): ReactNode | null {
  if (!selectionRect) return null;

  // Position above the selection by default; flip below if too close to top.
  const TOOLBAR_HEIGHT = 48;
  const TOOLBAR_MARGIN = 8;
  const preferAbove = selectionRect.top > TOOLBAR_HEIGHT + TOOLBAR_MARGIN + 12;
  const top = preferAbove
    ? selectionRect.top - TOOLBAR_HEIGHT - TOOLBAR_MARGIN
    : selectionRect.top + selectionRect.height + TOOLBAR_MARGIN;

  // Center horizontally on the selection, but clamp to viewport.
  const TOOLBAR_WIDTH = 240;
  const vw = typeof window !== 'undefined' ? window.innerWidth : 400;
  const centerX = selectionRect.left + selectionRect.width / 2;
  const left = Math.max(
    spacing.sm,
    Math.min(centerX - TOOLBAR_WIDTH / 2, vw - TOOLBAR_WIDTH - spacing.sm),
  );

  return (
    <View
      pointerEvents="box-none"
      style={[styles.wrap, { top, left, width: TOOLBAR_WIDTH }]}
    >
      <View style={styles.bar}>
        {highlightPalette.map((tone) => {
          const isActive = activeColor === tone;
          return (
            <Pressable
              key={tone}
              onPress={() => onSelectColor(tone)}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel={`Highlight ${tone}`}
              style={({ pressed }) => [
                styles.swatchWrap,
                pressed && { opacity: 0.6 },
              ]}
            >
              <View
                style={[
                  styles.swatch,
                  { backgroundColor: withAlpha(tone, 0.55) },
                  isActive && {
                    borderColor: tone,
                    borderWidth: 2,
                  },
                ]}
              />
            </Pressable>
          );
        })}

        <View style={styles.divider} />

        <Pressable
          onPress={onAnnotate}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel="Add note"
          style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.5 }]}
        >
          <EditIcon size={16} color={colors.textSecondary} />
        </Pressable>

        <Pressable
          onPress={onDismiss}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel="Cancel"
          style={({ pressed }) => [styles.cancel, pressed && { opacity: 0.5 }]}
        >
          <Text style={styles.cancelText}>Cancel</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'fixed' as any,  // RN-Web accepts this; ignored on native
    zIndex: 350,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xs,
    gap: 2,
  },
  swatchWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swatch: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  divider: {
    width: 1,
    height: 22,
    backgroundColor: colors.border,
    marginHorizontal: spacing.xs,
  },
  iconBtn: {
    width: 32,
    height: 32,
    borderRadius: radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancel: {
    paddingVertical: 6,
    paddingHorizontal: spacing.sm,
  },
  cancelText: {
    fontSize: 13,
    color: colors.textSecondary,
  },
});
