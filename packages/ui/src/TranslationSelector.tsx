/**
 * Translation selector — a compact popover for switching Bible translation.
 *
 * Renders the current translation with a chevron; tapping opens a small modal
 * popover listing the available translations (WEB default, KJV). Used in the
 * Word tab header so the user can switch translation without leaving the
 * reading surface.
 *
 * (design spec §6.1: WEB default, KJV)
 */

import { useState, type ReactNode } from 'react';
import { Modal, Pressable, Text, View, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';

import { colors, fontFamilies, radii, spacing } from '@resonance/theme';
import { TRANSLATIONS } from '@resonance/core';
import type { Translation } from '@resonance/core';

interface TranslationSelectorProps {
  value: Translation;
  onChange: (next: Translation) => void;
  /** Optional accent color for the label; defaults to the muted accent. */
  tint?: string;
}

export function TranslationSelector({
  value,
  onChange,
  tint = colors.accent,
}: TranslationSelectorProps): ReactNode {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        hitSlop={8}
        style={styles.trigger}
        accessibilityRole="button"
        accessibilityLabel={`Translation: ${value}. Tap to change.`}
      >
        <Text style={[styles.label, { color: tint }]}>{value}</Text>
        <Feather name="chevron-down" size={14} color={tint} />
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <Pressable
          style={styles.backdrop}
          onPress={() => setOpen(false)}
          accessibilityLabel="Close translation selector"
        />
        <View style={styles.sheet}>
          <Text style={styles.title}>Translation</Text>
          {TRANSLATIONS.map((t) => {
            const selected = t === value;
            return (
              <Pressable
                key={t}
                onPress={() => {
                  onChange(t);
                  setOpen(false);
                }}
                style={({ pressed }) => [
                  styles.option,
                  pressed && styles.optionPressed,
                ]}
                accessibilityRole="button"
                accessibilityState={{ selected }}
              >
                <Text
                  style={[
                    styles.optionText,
                    selected && styles.optionTextSelected,
                  ]}
                >
                  {t}
                </Text>
                {selected ? (
                  <Feather name="check" size={16} color={colors.accent} />
                ) : null}
              </Pressable>
            );
          })}
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingVertical: 2,
  },
  label: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 14,
    letterSpacing: 0.3,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  sheet: {
    position: 'absolute',
    top: 96,
    right: spacing.lg,
    width: 168,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingVertical: spacing.sm,
  },
  title: {
    fontFamily: fontFamilies.sansSemibold,
    fontSize: 11,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.textTertiary,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xs,
    paddingBottom: spacing.sm,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  optionPressed: {
    backgroundColor: colors.background,
  },
  optionText: {
    fontFamily: fontFamilies.sans,
    fontSize: 15,
    color: colors.textPrimary,
  },
  optionTextSelected: {
    fontFamily: fontFamilies.sansSemibold,
    color: colors.accent,
  },
});
