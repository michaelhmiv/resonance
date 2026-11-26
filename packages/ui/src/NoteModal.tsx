/**
 * NoteModal — rich margin-note & annotation composer attached to a highlight.
 *
 * Supports:
 *   - Highlighted phrase quote chip
 *   - Color selector (Gold / Sage / Rose / Slate)
 *   - Tag chips + quick-add tags (`#prayer`, `#insight`, `#question`, `#theology`, `#practice`)
 *   - Subtle Resonance indexing cue ("Indexed into Resonance memory")
 */

import { type ReactNode, useState, useEffect } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  colors,
  fontFamilies,
  highlightColorMeta,
  radii,
  readerPalette,
  spacing,
  withAlpha,
  type ReaderThemePalette,
} from '@resonance/theme';
import { CheckIcon, SparklesIcon, TagIcon, TrashIcon, XIcon } from './icons';

const SUGGESTED_TAGS = ['insight', 'prayer', 'practice', 'question', 'theology'];

export interface NoteModalProps {
  visible: boolean;
  /** The phrase the user is annotating. Shown as a quote chip. */
  quoteContext: string | null;
  /** The verse or book ref — "Genesis 5:3" or "Confessions · Book I". */
  verseRef: string;
  /** Initial text in the input. Pass empty for a new note. */
  initialText: string;
  /** Optional initial tags. */
  initialTags?: string[];
  /** Optional initial highlight color. */
  initialColor?: string;
  /** Optional reader palette override. */
  theme?: ReaderThemePalette;
  /** True when editing an existing note (shows delete). */
  isEdit: boolean;
  onSave: (text: string, meta?: { tags: string[]; color: string }) => void;
  onDelete?: () => void;
  onClose: () => void;
}

export function NoteModal({
  visible,
  quoteContext,
  verseRef,
  initialText,
  initialTags = [],
  initialColor = colors.highlightGold,
  theme = readerPalette,
  isEdit,
  onSave,
  onDelete,
  onClose,
}: NoteModalProps): ReactNode {
  const [draft, setDraft] = useState(initialText);
  const [tags, setTags] = useState<string[]>(initialTags);
  const [tagInput, setTagInput] = useState('');
  const [color, setColor] = useState<string>(initialColor);

  useEffect(() => {
    if (visible) {
      setDraft(initialText);
      setTags(initialTags);
      setTagInput('');
      setColor(initialColor || colors.highlightGold);
    }
  }, [visible, initialText, initialTags, initialColor]);

  const toggleTag = (tag: string) => {
    const clean = tag.trim().toLowerCase().replace(/^#/, '');
    if (!clean) return;
    setTags((prev) =>
      prev.includes(clean) ? prev.filter((t) => t !== clean) : [...prev, clean]
    );
  };

  const commitTagInput = () => {
    const parts = tagInput
      .split(/[,\s]+/)
      .map((t) => t.trim().toLowerCase().replace(/^#/, ''))
      .filter(Boolean);
    if (parts.length > 0) {
      setTags((prev) => Array.from(new Set([...prev, ...parts])));
      setTagInput('');
    }
  };

  const handleSave = () => {
    let finalTags = [...tags];
    if (tagInput.trim().length > 0) {
      const extra = tagInput
        .split(/[,\s]+/)
        .map((t) => t.trim().toLowerCase().replace(/^#/, ''))
        .filter(Boolean);
      finalTags = Array.from(new Set([...finalTags, ...extra]));
    }
    onSave(draft.trim(), { tags: finalTags, color });
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.backdrop}
      >
        <Pressable
          style={styles.dismissArea}
          onPress={onClose}
          accessibilityLabel="Close note modal"
        />
        <View style={[styles.sheet, { backgroundColor: theme.background, borderTopColor: theme.border }]}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerText}>
              <Text style={[styles.eyebrow, { color: theme.textTertiary }]} numberOfLines={1}>
                {isEdit ? 'Edit Margin Note' : 'New Margin Note'} · {verseRef}
              </Text>
            </View>
            <Pressable
              onPress={onClose}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Close"
              style={({ pressed }) => [styles.closeBtn, pressed && { opacity: 0.5 }]}
            >
              <XIcon size={18} color={theme.textSecondary} />
            </Pressable>
          </View>

          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {/* Quote context chip */}
            {quoteContext ? (
              <View
                style={[
                  styles.quoteWrap,
                  {
                    backgroundColor: theme.surface,
                    borderColor: theme.border,
                    borderLeftColor: color,
                  },
                ]}
              >
                <Text style={[styles.quoteText, { color: theme.textSecondary }]} numberOfLines={3}>
                  “{quoteContext}”
                </Text>
              </View>
            ) : null}

            {/* Highlight color selector */}
            <View style={styles.colorRow}>
              {highlightColorMeta.map((c) => {
                const active = color === c.color;
                return (
                  <Pressable
                    key={c.color}
                    onPress={() => setColor(c.color)}
                    style={[
                      styles.colorPill,
                      {
                        borderColor: active ? c.color : theme.border,
                        backgroundColor: active ? withAlpha(c.color, 0.22) : theme.surface,
                      },
                    ]}
                  >
                    <View style={[styles.colorDot, { backgroundColor: c.color }]} />
                    <Text style={[styles.colorLabel, { color: theme.textPrimary }]}>
                      {c.meaning}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {/* Note input */}
            <TextInput
              autoFocus
              multiline
              value={draft}
              onChangeText={setDraft}
              placeholder="A thought, a question, a prayer…"
              placeholderTextColor={theme.textTertiary}
              style={[
                styles.input,
                {
                  color: theme.textPrimary,
                  backgroundColor: theme.surface,
                  borderColor: theme.border,
                },
              ]}
            />

            {/* Tags section */}
            <View style={styles.tagsSection}>
              <View style={styles.tagsHeader}>
                <TagIcon size={13} color={theme.textTertiary} />
                <TextInput
                  value={tagInput}
                  onChangeText={setTagInput}
                  onSubmitEditing={commitTagInput}
                  placeholder="Add tags (e.g. humility, grace)…"
                  placeholderTextColor={theme.textTertiary}
                  returnKeyType="done"
                  style={[styles.tagInput, { color: theme.textPrimary }]}
                />
              </View>
              <View style={styles.tagPillsWrap}>
                {Array.from(new Set([...tags, ...SUGGESTED_TAGS])).map((t) => {
                  const selected = tags.includes(t);
                  return (
                    <Pressable
                      key={t}
                      onPress={() => toggleTag(t)}
                      style={[
                        styles.tagPill,
                        {
                          borderColor: selected ? theme.accent : theme.border,
                          backgroundColor: selected ? withAlpha(theme.accent, 0.16) : theme.surface,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.tagPillText,
                          { color: selected ? theme.accent : theme.textSecondary },
                        ]}
                      >
                        #{t}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {/* Resonance indexing cue */}
            <View style={styles.embedHintRow}>
              <SparklesIcon size={12} color={theme.accentMuted} />
              <Text style={[styles.embedHintText, { color: theme.textTertiary }]}>
                Your highlight & note are embedded on-device to enrich future Resonance echoes.
              </Text>
            </View>
          </ScrollView>

          {/* Footer actions */}
          <View style={[styles.footer, { borderTopColor: theme.border }]}>
            {isEdit && onDelete ? (
              <Pressable
                onPress={onDelete}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Delete note"
                style={({ pressed }) => [styles.deleteBtn, pressed && { opacity: 0.5 }]}
              >
                <TrashIcon size={16} color={theme.textSecondary} />
                <Text style={[styles.deleteText, { color: theme.textSecondary }]}>Delete note</Text>
              </Pressable>
            ) : (
              <View />
            )}

            <Pressable
              onPress={handleSave}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Save note"
              style={({ pressed }) => [
                styles.saveBtn,
                { backgroundColor: theme.accent },
                pressed && { opacity: 0.7 },
              ]}
            >
              <CheckIcon size={16} color="#fff" />
              <Text style={styles.saveText}>Save</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(20, 18, 16, 0.46)',
    justifyContent: 'flex-end',
  },
  dismissArea: {
    flex: 1,
  },
  sheet: {
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
    maxHeight: '85%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  headerText: { flex: 1 },
  eyebrow: {
    fontFamily: fontFamilies.sansSemibold,
    fontSize: 11.5,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quoteWrap: {
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderLeftWidth: 3,
    padding: spacing.sm + 2,
    marginBottom: spacing.sm + 2,
  },
  quoteText: {
    fontFamily: fontFamilies.serifItalic,
    fontSize: 15,
    fontStyle: 'italic',
    lineHeight: 22,
  },
  colorRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs + 2,
    marginBottom: spacing.sm + 2,
  },
  colorPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  colorDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  colorLabel: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 11.5,
  },
  input: {
    fontFamily: fontFamilies.serif,
    fontSize: 16.5,
    lineHeight: 24,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.md,
    padding: spacing.md,
    minHeight: 110,
    textAlignVertical: 'top',
    marginBottom: spacing.sm + 2,
  },
  tagsSection: {
    gap: spacing.xs + 2,
    marginBottom: spacing.sm,
  },
  tagsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  tagInput: {
    flex: 1,
    fontFamily: fontFamilies.sans,
    fontSize: 13.5,
    paddingVertical: 4,
  },
  tagPillsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  tagPill: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  tagPillText: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 11.5,
  },
  embedHintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: spacing.md,
  },
  embedHintText: {
    flex: 1,
    fontFamily: fontFamilies.sans,
    fontSize: 11,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  deleteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  deleteText: {
    fontFamily: fontFamilies.sans,
    fontSize: 14,
  },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderRadius: radii.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md + 2,
  },
  saveText: {
    fontFamily: fontFamilies.sansSemibold,
    fontSize: 14,
    color: '#fff',
  },
});
