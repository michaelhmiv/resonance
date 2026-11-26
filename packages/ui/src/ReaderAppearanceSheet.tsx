/**
 * ReaderAppearanceSheet — in-reader `Aa` typography bottom sheet.
 *
 * Lets readers tune typeface, font size (14–28px), line spacing, margins,
 * alignment, and Scripture Flow vs. Study mode without leaving the page.
 */

import { type ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  fontFamilies,
  radii,
  spacing,
  type ReaderThemePalette,
} from '@resonance/theme';
import type {
  ReaderAlignId,
  ReaderFontId,
  ReaderMarginId,
  ReaderPreferences,
  ScriptureDisplayMode,
} from '@resonance/core';
import { XIcon } from './icons';

export interface ReaderAppearanceSheetProps {
  visible: boolean;
  prefs: ReaderPreferences;
  theme: ReaderThemePalette;
  isScripture: boolean;
  onChange: (patch: Partial<ReaderPreferences>) => void;
  onClose: () => void;
}

const FONT_OPTIONS: Array<{ id: ReaderFontId; label: string; sampleFamily: string }> = [
  { id: 'garamond', label: 'Garamond', sampleFamily: fontFamilies.serif },
  { id: 'serif', label: 'Book Serif', sampleFamily: 'Georgia' },
  { id: 'sans', label: 'Clean Sans', sampleFamily: fontFamilies.sans },
];

const LINE_HEIGHT_OPTIONS: Array<{ label: string; value: number }> = [
  { label: 'Compact', value: 1.45 },
  { label: 'Book', value: 1.65 },
  { label: 'Airy', value: 1.88 },
];

const MARGIN_OPTIONS: Array<{ id: ReaderMarginId; label: string }> = [
  { id: 'compact', label: 'Wide Text' },
  { id: 'book', label: 'Book' },
  { id: 'wide', label: 'Generous' },
];

export function ReaderAppearanceSheet({
  visible,
  prefs,
  theme,
  isScripture,
  onChange,
  onClose,
}: ReaderAppearanceSheetProps): ReactNode {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={styles.dismissArea} onPress={onClose} accessibilityLabel="Close typography settings" />
        <View
          style={[
            styles.sheet,
            { backgroundColor: theme.surface, borderColor: theme.border },
          ]}
        >
          {/* Header */}
          <View style={[styles.header, { borderBottomColor: theme.border }]}>
            <Text style={[styles.title, { color: theme.textPrimary }]}>
              Reading Typography
            </Text>
            <Pressable onPress={onClose} hitSlop={10} style={styles.closeBtn} accessibilityRole="button" accessibilityLabel="Close">
              <XIcon size={18} color={theme.textSecondary} />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
            {/* Font Size Stepper */}
            <View style={styles.section}>
              <View style={styles.labelRow}>
                <Text style={[styles.label, { color: theme.textTertiary }]}>Text Size</Text>
                <Text style={[styles.valueHint, { color: theme.textSecondary }]}>
                  {prefs.fontSize}px
                </Text>
              </View>
              <View style={[styles.stepperRow, { borderColor: theme.border, backgroundColor: theme.background }]}>
                <Pressable
                  onPress={() => onChange({ fontSize: Math.max(14, prefs.fontSize - 1) })}
                  disabled={prefs.fontSize <= 14}
                  style={[styles.stepBtn, prefs.fontSize <= 14 && styles.disabled]}
                  accessibilityRole="button"
                  accessibilityLabel="Decrease text size"
                >
                  <Text style={[styles.stepSmallA, { color: theme.textPrimary }]}>A−</Text>
                </Pressable>
                <View style={[styles.stepDivider, { backgroundColor: theme.border }]} />
                <Pressable
                  onPress={() => onChange({ fontSize: 18 })}
                  style={styles.stepReset}
                  accessibilityRole="button"
                  accessibilityLabel="Reset text size"
                >
                  <Text style={[styles.stepResetText, { color: theme.textSecondary }]}>
                    Default
                  </Text>
                </Pressable>
                <View style={[styles.stepDivider, { backgroundColor: theme.border }]} />
                <Pressable
                  onPress={() => onChange({ fontSize: Math.min(28, prefs.fontSize + 1) })}
                  disabled={prefs.fontSize >= 28}
                  style={[styles.stepBtn, prefs.fontSize >= 28 && styles.disabled]}
                  accessibilityRole="button"
                  accessibilityLabel="Increase text size"
                >
                  <Text style={[styles.stepLargeA, { color: theme.textPrimary }]}>A+</Text>
                </Pressable>
              </View>
            </View>

            {/* Typeface */}
            <View style={styles.section}>
              <Text style={[styles.label, { color: theme.textTertiary }]}>Typeface</Text>
              <View style={styles.pillRow}>
                {FONT_OPTIONS.map((opt) => {
                  const active = prefs.fontFamily === opt.id;
                  return (
                    <Pressable
                      key={opt.id}
                      onPress={() => onChange({ fontFamily: opt.id })}
                      style={[
                        styles.pill,
                        {
                          backgroundColor: active ? theme.accent : theme.background,
                          borderColor: active ? theme.accent : theme.border,
                        },
                      ]}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                    >
                      <Text
                        style={[
                          styles.pillText,
                          {
                            fontFamily: opt.sampleFamily,
                            color: active ? theme.surface : theme.textPrimary,
                          },
                        ]}
                      >
                        {opt.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {/* Line Spacing */}
            <View style={styles.section}>
              <Text style={[styles.label, { color: theme.textTertiary }]}>Line Spacing</Text>
              <View style={styles.pillRow}>
                {LINE_HEIGHT_OPTIONS.map((opt) => {
                  const active = Math.abs(prefs.lineHeightMultiplier - opt.value) < 0.08;
                  return (
                    <Pressable
                      key={opt.label}
                      onPress={() => onChange({ lineHeightMultiplier: opt.value })}
                      style={[
                        styles.pill,
                        {
                          backgroundColor: active ? theme.accent : theme.background,
                          borderColor: active ? theme.accent : theme.border,
                        },
                      ]}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                    >
                      <Text
                        style={[
                          styles.pillText,
                          { color: active ? theme.surface : theme.textPrimary },
                        ]}
                      >
                        {opt.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {/* Margins & Alignment */}
            <View style={styles.section}>
              <Text style={[styles.label, { color: theme.textTertiary }]}>Margins</Text>
              <View style={styles.pillRow}>
                {MARGIN_OPTIONS.map((opt) => {
                  const active = prefs.margin === opt.id;
                  return (
                    <Pressable
                      key={opt.id}
                      onPress={() => onChange({ margin: opt.id })}
                      style={[
                        styles.pill,
                        {
                          backgroundColor: active ? theme.accent : theme.background,
                          borderColor: active ? theme.accent : theme.border,
                        },
                      ]}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                    >
                      <Text
                        style={[
                          styles.pillText,
                          { color: active ? theme.surface : theme.textPrimary },
                        ]}
                      >
                        {opt.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <View style={styles.section}>
              <Text style={[styles.label, { color: theme.textTertiary }]}>Alignment</Text>
              <View style={styles.pillRow}>
                {(['left', 'justify'] as ReaderAlignId[]).map((align) => {
                  const active = prefs.align === align;
                  return (
                    <Pressable
                      key={align}
                      onPress={() => onChange({ align })}
                      style={[
                        styles.pill,
                        {
                          backgroundColor: active ? theme.accent : theme.background,
                          borderColor: active ? theme.accent : theme.border,
                        },
                      ]}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                    >
                      <Text
                        style={[
                          styles.pillText,
                          { color: active ? theme.surface : theme.textPrimary },
                        ]}
                      >
                        {align === 'left' ? 'Ragged Right' : 'Justified'}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {/* Scripture Flow vs Study Mode */}
            {isScripture ? (
              <View style={styles.section}>
                <Text style={[styles.label, { color: theme.textTertiary }]}>Scripture Layout</Text>
                <View style={styles.pillRow}>
                  {(
                    [
                      { id: 'flow', label: 'Reader Flow' },
                      { id: 'study', label: 'Verse by Verse' },
                    ] as Array<{ id: ScriptureDisplayMode; label: string }>
                  ).map((opt) => {
                    const active = prefs.scriptureMode === opt.id;
                    return (
                      <Pressable
                        key={opt.id}
                        onPress={() => onChange({ scriptureMode: opt.id })}
                        style={[
                          styles.pill,
                          {
                            backgroundColor: active ? theme.accent : theme.background,
                            borderColor: active ? theme.accent : theme.border,
                          },
                        ]}
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
                      >
                        <Text
                          style={[
                            styles.pillText,
                            { color: active ? theme.surface : theme.textPrimary },
                          ]}
                        >
                          {opt.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(20, 18, 16, 0.42)',
    justifyContent: 'flex-end',
  },
  dismissArea: {
    flex: 1,
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: StyleSheet.hairlineWidth,
    maxHeight: '78%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: {
    fontFamily: fontFamilies.serifSemibold,
    fontSize: 19,
  },
  closeBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    padding: spacing.lg,
    gap: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  section: {
    gap: spacing.xs + 2,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  label: {
    fontFamily: fontFamilies.sansSemibold,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.7,
  },
  valueHint: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 12,
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  stepBtn: {
    flex: 1,
    paddingVertical: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepReset: {
    paddingHorizontal: spacing.md,
    paddingVertical: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepDivider: {
    width: StyleSheet.hairlineWidth,
    height: 22,
  },
  stepSmallA: {
    fontFamily: fontFamilies.serifSemibold,
    fontSize: 15,
  },
  stepLargeA: {
    fontFamily: fontFamilies.serifSemibold,
    fontSize: 20,
  },
  stepResetText: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 12,
  },
  pillRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  pill: {
    flex: 1,
    paddingVertical: 9,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.sm,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillText: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 13,
  },
  disabled: {
    opacity: 0.35,
  },
});
