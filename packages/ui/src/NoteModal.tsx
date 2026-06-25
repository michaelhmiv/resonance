/**
 * NoteModal — the modal for creating or editing a note attached to a
 * highlight. Same modal handles both flows: a fresh note is just an empty
 * text field; an existing note is the same field pre-filled.
 *
 * The modal shows a `quote_context` chip at the top — the highlighted phrase
 * the note is about. This anchors the user's memory even after they scroll
 * away or the verse text changes.
 */

import { type ReactNode, useState, useEffect } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  colors,
  fontFamilies,
  radii,
  spacing,
} from '@resonance/theme';
import { CheckIcon, TrashIcon, XIcon } from './icons';

export interface NoteModalProps {
  visible: boolean;
  /** The phrase the user is annotating. Shown as a quote chip. */
  quoteContext: string | null;
  /** The verse ref — "Genesis 5:3". Shown as a small label. */
  verseRef: string;
  /** Initial text in the input. Pass empty for a new note. */
  initialText: string;
  /** True when editing an existing note (shows delete). */
  isEdit: boolean;
  onSave: (text: string) => void;
  onDelete?: () => void;
  onClose: () => void;
}

export function NoteModal({
  visible,
  quoteContext,
  verseRef,
  initialText,
  isEdit,
  onSave,
  onDelete,
  onClose,
}: NoteModalProps): ReactNode {
  const [draft, setDraft] = useState(initialText);

  // Reset draft when modal opens with new initial text
  useEffect(() => {
    if (visible) setDraft(initialText);
  }, [visible, initialText]);

  const handleSave = () => {
    const trimmed = draft.trim();
    onSave(trimmed);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerText}>
              <Text style={styles.eyebrow}>
                {isEdit ? 'Edit note' : 'New note'} · {verseRef}
              </Text>
            </View>
            <Pressable
              onPress={onClose}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Close"
              style={({ pressed }) => [styles.closeBtn, pressed && { opacity: 0.5 }]}
            >
              <XIcon size={18} color={colors.textSecondary} />
            </Pressable>
          </View>

          {/* Quote context chip */}
          {quoteContext ? (
            <View style={styles.quoteWrap}>
              <Text style={styles.quoteText} numberOfLines={3}>
                "{quoteContext}"
              </Text>
            </View>
          ) : null}

          {/* Note input */}
          <TextInput
            autoFocus
            multiline
            value={draft}
            onChangeText={setDraft}
            placeholder="A thought, a question, a prayer…"
            placeholderTextColor={colors.placeholder}
            style={styles.input}
          />

          {/* Footer actions */}
          <View style={styles.footer}>
            {isEdit && onDelete ? (
              <Pressable
                onPress={onDelete}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Delete note"
                style={({ pressed }) => [styles.deleteBtn, pressed && { opacity: 0.5 }]}
              >
                <TrashIcon size={16} color={colors.textSecondary} />
                <Text style={styles.deleteText}>Delete note</Text>
              </Pressable>
            ) : (
              <View />
            )}

            <Pressable
              onPress={handleSave}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Save note"
              style={({ pressed }) => [styles.saveBtn, pressed && { opacity: 0.7 }]}
            >
              <CheckIcon size={16} color="#fff" />
              <Text style={styles.saveText}>Save</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(58, 53, 48, 0.4)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  headerText: { flex: 1 },
  eyebrow: {
    fontFamily: fontFamilies.sans,
    fontSize: 12,
    color: colors.textTertiary,
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
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
    marginBottom: spacing.md,
  },
  quoteText: {
    fontFamily: fontFamilies.serif,
    fontSize: 15,
    color: colors.textSecondary,
    fontStyle: 'italic',
    lineHeight: 22,
  },
  input: {
    fontFamily: fontFamilies.serif,
    fontSize: 16,
    color: colors.textPrimary,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: spacing.md,
    minHeight: 100,
    textAlignVertical: 'top',
    marginBottom: spacing.md,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
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
    color: colors.textSecondary,
  },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.accent,
    borderRadius: radii.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  saveText: {
    fontFamily: fontFamilies.sans,
    fontSize: 14,
    color: '#fff',
    fontWeight: '600',
  },
});
