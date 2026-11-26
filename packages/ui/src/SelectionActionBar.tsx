/**
 * SelectionActionBar — zero-mode phrase highlighting & study action bar.
 *
 * Appears directly when the reader taps/long-presses any verse or paragraph:
 *   - Native word/sentence-snapping boundary steppers (`◀` / `▶`, Sentence, Full)
 *   - 4 curated highlight colors with subtle semantic labels + Fill/Underline toggle
 *   - Instant actions: Note, Echoes ✦, Journal, Copy Citation, Remove Highlight
 */

import { type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  fontFamilies,
  highlightColorMeta,
  radii,
  spacing,
  type ReaderThemePalette,
} from '@resonance/theme';
import type { HighlightStyle } from '@resonance/core';
import {
  CopyIcon,
  JournalIcon,
  NoteIcon,
  SparklesIcon,
  TrashIcon,
  XIcon,
} from './icons';

export interface SelectionActionBarProps {
  theme: ReaderThemePalette;
  selectedPreview: string;
  activeColor: string;
  activeStyle: HighlightStyle;
  hasExistingHighlight: boolean;
  canAdjustPhrase: boolean;
  onSelectColor: (color: string) => void;
  onToggleStyle: () => void;
  onStepStartLeft: () => void;
  onStepStartRight: () => void;
  onStepEndLeft: () => void;
  onStepEndRight: () => void;
  onSelectSentence: () => void;
  onSelectFull: () => void;
  onAnnotate: () => void;
  onEchoes: () => void;
  onSendToJournal: () => void;
  onCopyCitation: () => void;
  onDeleteHighlight?: () => void;
  onDismiss: () => void;
  copiedFeedback?: boolean;
  journalSentFeedback?: boolean;
}

export function SelectionActionBar({
  theme,
  selectedPreview,
  activeColor,
  activeStyle,
  hasExistingHighlight,
  canAdjustPhrase,
  onSelectColor,
  onToggleStyle,
  onStepStartLeft,
  onStepStartRight,
  onStepEndLeft,
  onStepEndRight,
  onSelectSentence,
  onSelectFull,
  onAnnotate,
  onEchoes,
  onSendToJournal,
  onCopyCitation,
  onDeleteHighlight,
  onDismiss,
  copiedFeedback = false,
  journalSentFeedback = false,
}: SelectionActionBarProps): ReactNode {
  return (
    <View
      style={[
        styles.container,
        { backgroundColor: theme.surface, borderTopColor: theme.border },
      ]}
    >
      {/* Top strip: selected snippet preview + dismiss */}
      <View style={styles.previewRow}>
        <Text
          style={[styles.previewText, { color: theme.textSecondary }]}
          numberOfLines={1}
        >
          “{selectedPreview.trim()}”
        </Text>
        <Pressable
          onPress={onDismiss}
          hitSlop={10}
          style={styles.dismissBtn}
          accessibilityRole="button"
          accessibilityLabel="Clear selection"
        >
          <XIcon size={16} color={theme.textTertiary} />
        </Pressable>
      </View>

      {/* Native phrase range adjustment handles (word/sentence snapping) */}
      {canAdjustPhrase ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.rangeRow}
        >
          <Text style={[styles.rangeLabel, { color: theme.textTertiary }]}>Start</Text>
          <Pressable
            onPress={onStepStartLeft}
            style={[styles.rangeChip, { borderColor: theme.border, backgroundColor: theme.background }]}
            accessibilityLabel="Expand selection start left"
          >
            <Text style={[styles.rangeChipText, { color: theme.textPrimary }]}>◀</Text>
          </Pressable>
          <Pressable
            onPress={onStepStartRight}
            style={[styles.rangeChip, { borderColor: theme.border, backgroundColor: theme.background }]}
            accessibilityLabel="Shrink selection start right"
          >
            <Text style={[styles.rangeChipText, { color: theme.textPrimary }]}>▶</Text>
          </Pressable>

          <View style={[styles.rangeDivider, { backgroundColor: theme.border }]} />

          <Text style={[styles.rangeLabel, { color: theme.textTertiary }]}>End</Text>
          <Pressable
            onPress={onStepEndLeft}
            style={[styles.rangeChip, { borderColor: theme.border, backgroundColor: theme.background }]}
            accessibilityLabel="Shrink selection end left"
          >
            <Text style={[styles.rangeChipText, { color: theme.textPrimary }]}>◀</Text>
          </Pressable>
          <Pressable
            onPress={onStepEndRight}
            style={[styles.rangeChip, { borderColor: theme.border, backgroundColor: theme.background }]}
            accessibilityLabel="Expand selection end right"
          >
            <Text style={[styles.rangeChipText, { color: theme.textPrimary }]}>▶</Text>
          </Pressable>

          <View style={[styles.rangeDivider, { backgroundColor: theme.border }]} />

          <Pressable
            onPress={onSelectSentence}
            style={[styles.rangePreset, { borderColor: theme.border, backgroundColor: theme.background }]}
          >
            <Text style={[styles.rangePresetText, { color: theme.textSecondary }]}>Sentence</Text>
          </Pressable>
          <Pressable
            onPress={onSelectFull}
            style={[styles.rangePreset, { borderColor: theme.border, backgroundColor: theme.background }]}
          >
            <Text style={[styles.rangePresetText, { color: theme.textSecondary }]}>Full</Text>
          </Pressable>
        </ScrollView>
      ) : null}

      {/* Color swatches + Fill/Underline toggle */}
      <View style={styles.colorRow}>
        <View style={styles.swatchesGroup}>
          {highlightColorMeta.map((item) => {
            const isActive = activeColor === item.color;
            return (
              <Pressable
                key={item.color}
                onPress={() => onSelectColor(item.color)}
                style={styles.swatchItem}
                accessibilityRole="button"
                accessibilityLabel={`Highlight ${item.name} (${item.meaning})`}
              >
                <View
                  style={[
                    styles.swatchCircle,
                    { backgroundColor: item.color },
                    isActive && { borderWidth: 2, borderColor: theme.textPrimary },
                  ]}
                />
                <Text
                  style={[
                    styles.swatchLabel,
                    { color: isActive ? theme.textPrimary : theme.textTertiary },
                  ]}
                >
                  {item.meaning}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Pressable
          onPress={onToggleStyle}
          style={[
            styles.styleToggle,
            {
              borderColor: theme.border,
              backgroundColor: theme.background,
            },
          ]}
          accessibilityRole="button"
          accessibilityLabel={`Switch highlight style (currently ${activeStyle})`}
        >
          <Text
            style={[
              styles.styleToggleText,
              {
                color: theme.textPrimary,
                textDecorationLine: activeStyle === 'underline' ? 'underline' : 'none',
              },
            ]}
          >
            {activeStyle === 'underline' ? 'U' : 'Fill'}
          </Text>
        </Pressable>
      </View>

      {/* Study Actions Row */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.actionsRow}
      >
        <Pressable
          onPress={onAnnotate}
          style={[styles.actionBtn, { borderColor: theme.border, backgroundColor: theme.background }]}
          accessibilityRole="button"
          accessibilityLabel="Add or edit margin note"
        >
          <NoteIcon size={15} color={theme.accent} />
          <Text style={[styles.actionText, { color: theme.textPrimary }]}>Note</Text>
        </Pressable>

        <Pressable
          onPress={onEchoes}
          style={[styles.actionBtn, { borderColor: theme.accent, backgroundColor: theme.background }]}
          accessibilityRole="button"
          accessibilityLabel="Find resonant passages and journal echoes"
        >
          <SparklesIcon size={15} color={theme.accent} />
          <Text style={[styles.actionText, { color: theme.accent }]}>Echoes</Text>
        </Pressable>

        <Pressable
          onPress={onSendToJournal}
          style={[styles.actionBtn, { borderColor: theme.border, backgroundColor: theme.background }]}
          accessibilityRole="button"
          accessibilityLabel="Send passage to Journal"
        >
          <JournalIcon size={15} color={theme.textSecondary} />
          <Text style={[styles.actionText, { color: theme.textPrimary }]}>
            {journalSentFeedback ? 'Sent ✓' : 'Journal'}
          </Text>
        </Pressable>

        <Pressable
          onPress={onCopyCitation}
          style={[styles.actionBtn, { borderColor: theme.border, backgroundColor: theme.background }]}
          accessibilityRole="button"
          accessibilityLabel="Copy quote with citation"
        >
          <CopyIcon size={15} color={theme.textSecondary} />
          <Text style={[styles.actionText, { color: theme.textPrimary }]}>
            {copiedFeedback ? 'Copied ✓' : 'Cite'}
          </Text>
        </Pressable>

        {hasExistingHighlight && onDeleteHighlight ? (
          <Pressable
            onPress={onDeleteHighlight}
            style={[styles.actionBtn, { borderColor: theme.border, backgroundColor: theme.background }]}
            accessibilityRole="button"
            accessibilityLabel="Remove highlight"
          >
            <TrashIcon size={15} color={theme.textSecondary} />
            <Text style={[styles.actionText, { color: theme.textSecondary }]}>Remove</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xs + 2,
    paddingBottom: spacing.sm,
    gap: 8,
  },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  previewText: {
    flex: 1,
    fontFamily: fontFamilies.serifItalic,
    fontStyle: 'italic',
    fontSize: 13.5,
  },
  dismissBtn: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rangeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  rangeLabel: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 10.5,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  rangeChip: {
    width: 28,
    height: 26,
    borderRadius: radii.sm,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rangeChipText: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 11,
  },
  rangeDivider: {
    width: StyleSheet.hairlineWidth,
    height: 16,
    marginHorizontal: 3,
  },
  rangePreset: {
    paddingHorizontal: 9,
    height: 26,
    borderRadius: radii.sm,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rangePresetText: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 11.5,
  },
  colorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  swatchesGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  swatchItem: {
    alignItems: 'center',
    gap: 2,
  },
  swatchCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
  },
  swatchLabel: {
    fontFamily: fontFamilies.sans,
    fontSize: 9.5,
  },
  styleToggle: {
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: radii.sm,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  styleToggleText: {
    fontFamily: fontFamilies.sansSemibold,
    fontSize: 12,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  actionText: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 12.5,
  },
});
