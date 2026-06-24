/**
 * ChapterPicker — a modal grid overlay for navigating to any chapter.
 *
 * Shows all chapters for the current book in a grid. Highlights the
 * current chapter. Tap to navigate. Closes on selection or backdrop tap.
 * For library mode, shows section navigation instead.
 *
 * (design spec §6.1: chapter navigation)
 */

import { type ReactNode } from 'react';
import { Modal, Pressable, Text, View, StyleSheet, ScrollView } from 'react-native';
import { colors, fontFamilies, radii, spacing } from '@resonance/theme';

interface ChapterPickerProps {
  visible: boolean;
  onClose: () => void;
  totalChapters: number;
  currentChapter: number;
  onSelect: (chapter: number) => void;
  bookName?: string;
}

export function ChapterPicker({
  visible,
  onClose,
  totalChapters,
  currentChapter,
  onSelect,
  bookName,
}: ChapterPickerProps): ReactNode {
  const chapters = Array.from({ length: totalChapters }, (_, i) => i + 1);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <View />
      </Pressable>
      <View style={styles.sheet}>
        <View style={styles.header}>
          <Text style={styles.title}>
            {bookName ? `${bookName}` : 'Chapters'}
          </Text>
          <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="Close">
            <Text style={styles.closeText}>✕</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.grid}>
          {chapters.map((ch) => {
            const isCurrent = ch === currentChapter;
            return (
              <Pressable
                key={ch}
                onPress={() => {
                  onSelect(ch);
                  onClose();
                }}
                style={[
                  styles.chip,
                  isCurrent && styles.chipActive,
                ]}
                accessibilityRole="button"
                accessibilityLabel={`Chapter ${ch}`}
                accessibilityState={{ selected: isCurrent }}
              >
                <Text
                  style={[
                    styles.chipText,
                    isCurrent && styles.chipTextActive,
                  ]}
                >
                  {ch}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  sheet: {
    position: 'absolute',
    top: 80,
    left: spacing.lg,
    right: spacing.lg,
    maxHeight: '70%',
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingBottom: spacing.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  title: {
    fontFamily: fontFamilies.sansSemibold,
    fontSize: 15,
    color: colors.textPrimary,
  },
  closeText: {
    fontFamily: fontFamilies.sans,
    fontSize: 18,
    color: colors.textSecondary,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    padding: spacing.md,
  },
  chip: {
    width: 44,
    height: 44,
    borderRadius: radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  chipActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  chipText: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 14,
    color: colors.textPrimary,
  },
  chipTextActive: {
    color: colors.surface,
    fontFamily: fontFamilies.sansSemibold,
  },
});
