/**
 * HighlightContextMenu — popover that appears when the user taps an existing
 * highlight. Shows 4 color swatches (to recolor) + "Add note" / "Edit note"
 * + "Delete". Anchor position is supplied by the parent (the highlight's
 * bounding rect).
 */

import { type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  colors,
  fontFamilies,
  highlightPalette,
  radii,
  spacing,
  withAlpha,
} from '@resonance/theme';
import { NoteIcon, TrashIcon } from './icons';
import type { Highlight } from '@resonance/core';

export interface HighlightContextMenuProps {
  highlight: Highlight | null;
  /** Anchor rect in viewport coords. */
  anchor: { top: number; left: number; width: number; height: number } | null;
  onSelectColor: (color: string) => void;
  onAnnotate: () => void;
  onDelete: () => void;
  onDismiss: () => void;
}

export function HighlightContextMenu({
  highlight,
  anchor,
  onSelectColor,
  onAnnotate,
  onDelete,
  onDismiss,
}: HighlightContextMenuProps): ReactNode | null {
  if (!highlight || !anchor) return null;

  const W = 240;
  const H = 96;
  const M = 8;
  const vw = typeof window !== 'undefined' ? window.innerWidth : 400;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  const preferAbove = anchor.top > H + M + 12;
  const top = preferAbove ? anchor.top - H - M : anchor.top + anchor.height + M;
  const centerX = anchor.left + anchor.width / 2;
  const left = Math.max(M, Math.min(centerX - W / 2, vw - W - M));
  // Clamp to viewport bottom
  const safeTop = Math.min(top, vh - H - M);

  const hasNote = !!(highlight.note_text && highlight.note_text.trim().length > 0);

  return (
    <View
      pointerEvents="box-none"
      style={[styles.outer, { top: safeTop, left, width: W }]}
    >
      <View style={styles.menu}>
        {/* Color row */}
        <View style={styles.row}>
          {highlightPalette.map((tone) => {
            const isActive = highlight.color === tone;
            return (
              <Pressable
                key={tone}
                onPress={() => onSelectColor(tone)}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel={`Recolor ${tone}`}
                style={({ pressed }) => [
                  styles.swatchWrap,
                  pressed && { opacity: 0.6 },
                ]}
              >
                <View
                  style={[
                    styles.swatch,
                    { backgroundColor: withAlpha(tone, 0.55) },
                    isActive && { borderColor: tone, borderWidth: 2 },
                  ]}
                />
              </Pressable>
            );
          })}
        </View>

        {/* Actions row */}
        <View style={styles.actions}>
          <Pressable
            onPress={onAnnotate}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={hasNote ? 'Edit note' : 'Add note'}
            style={({ pressed }) => [styles.action, pressed && { opacity: 0.5 }]}
          >
            <NoteIcon size={14} color={colors.textSecondary} />
            <Text style={styles.actionText}>
              {hasNote ? 'Edit note' : 'Add note'}
            </Text>
          </Pressable>

          <Pressable
            onPress={onDelete}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel="Delete highlight"
            style={({ pressed }) => [styles.action, pressed && { opacity: 0.5 }]}
          >
            <TrashIcon size={14} color={colors.textSecondary} />
            <Text style={styles.actionText}>Delete</Text>
          </Pressable>
        </View>

        {/* Tap anywhere outside is dismissed by ReadingView via a backdrop */}
        <Pressable
          onPress={onDismiss}
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
          style={styles.dismissBtn}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: {
    position: 'fixed' as any,
    zIndex: 360,
  },
  menu: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    marginBottom: spacing.sm,
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
  actions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  action: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: 6,
    borderRadius: radii.sm,
    backgroundColor: colors.background,
  },
  actionText: {
    fontFamily: fontFamilies.sans,
    fontSize: 13,
    color: colors.textPrimary,
  },
  dismissBtn: {
    // invisible backdrop tap-catcher — RN-Web doesn't have a true
    // "click outside to close" primitive; this would be replaced by a
    // fullscreen Pressable at the menu's zIndex level below, drawn by the
    // parent. Kept as a no-op for now.
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
  },
});
