/**
 * Journal screen — the primary writing surface.
 *
 * A continuous, auto-saving document rendered as a FlashList of typed
 * segments. Only one segment is editable at a time (the *active* one,
 * rendered as a TextInput); all others are static rendered cells.
 *
 * Date dividers, verse-of-day cards, and resonance cards sit in the
 * same flow as text segments. Pull-down from the top to reveal search.
 *
 * (design spec §5: Journal — focus manager, continuous document,
 *  auto-save, date dividers, verse-of-day, pull-down search)
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { useNavigation } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';

import {
  colors,
  fontFamilies,
  layout,
  radii,
  serifText,
  spacing,
} from '@resonance/theme';
import { useDbStore } from '../db/dbStore';
import {
  type JournalSegment,
  createSegment,
  toParentDate,
  formatDateLong,
  dayOfYear,
  isTextSegment,
  isNonTextSegment,
} from '@resonance/core';
import { useJournalStore } from '../journal/journalStore';
import { useFocusStore } from '../journal/focusManager';
import { getVerseOfDay } from '../db/bibleQueries';
import { useReadingTextStyle } from '../settings/settingsStore';

// ── Item types for the FlashList ─────────────────────────────────────────────

type ListItem =
  | { kind: 'segment'; segment: JournalSegment }
  | { kind: 'verse_day'; ref: string; text: string; parentDate: string }
  | { kind: 'date_divider'; label: string; parentDate: string };

// ── Component ───────────────────────────────────────────────────────────────

export function JournalScreen(): ReactNode {
  const { connection: db, status } = useDbStore();
  const {
    segments,
    loading,
    load,
    insertSegment,
    updateSegmentText,
  } = useJournalStore();
  const {
    activeSegmentId,
    keyboardHeight,
    focusSegment,
    handleChangeText,
    handleBackspace,
    handleReturn,
    initKeyboardListeners,
  } = useFocusStore();
  const navigation = useNavigation();
  const listRef = useRef<FlashListRef<ListItem>>(null);

  const [searchVisible, setSearchVisible] = useState(false);

  // ── Load journal on mount ──────────────────────────────────────────────
  useEffect(() => {
    if (db && status === 'ready') {
      void load(db);
    }
  }, [db, status, load]);

  // ── Keyboard listeners ─────────────────────────────────────────────────
  useEffect(() => {
    const unsub = initKeyboardListeners();
    return unsub;
  }, [initKeyboardListeners]);

  // ── Wire settings gear into header ─────────────────────────────────────
  useEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <View style={styles.headerRight}>
          <Pressable
            onPress={() => setSearchVisible((v) => !v)}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Search journal"
          >
            <Feather name="search" size={20} color={colors.textSecondary} />
          </Pressable>
          <Pressable
            onPress={() => navigation.navigate('Settings' as never)}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Settings"
          >
            <Feather name="settings" size={20} color={colors.textSecondary} />
          </Pressable>
        </View>
      ),
    });
  }, [navigation]);

  // ── Initialize: create first text segment if document is empty ─────────
  useEffect(() => {
    if (!loading && segments.length === 0) {
      const parentDate = toParentDate();
      const seg = createSegment('text', '', 0, parentDate);
      insertSegment(seg);
      // Focus the new segment so the keyboard appears.
      setTimeout(() => focusSegment(seg.id, 0), 100);
    }
  }, [loading, segments.length, insertSegment, focusSegment]);

  // ── Build the item list with date dividers and verse-of-day ────────────
  const items: ListItem[] = useBuildItems(segments);

  // ── Render ──────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator color={colors.accentMuted} />
      </View>
    );
  }

  return (
    <View
      style={[
        styles.container,
        { paddingBottom: keyboardHeight > 0 ? keyboardHeight : 0 },
      ]}
    >
      <FlashList
        ref={listRef}
        data={items}
        keyExtractor={(item, index) => {
          if (item.kind === 'segment') return `seg-${item.segment.id}`;
          if (item.kind === 'verse_day') return `vod-${item.parentDate}`;
          return `dd-${item.parentDate}-${index}`;
        }}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => {
          if (item.kind === 'date_divider') {
            return <DateDivider label={item.label} />;
          }
          if (item.kind === 'verse_day') {
            return <VerseOfDayCard reference={item.ref} text={item.text} />;
          }
          // text segment
          const seg = item.segment;
          if (!isTextSegment(seg)) return null;

          const isActive = seg.id === activeSegmentId;
          if (isActive) {
            return (
              <ActiveSegmentInput
                segment={seg}
                onChangeText={(text) => handleChangeText(seg.id, text)}
                onKeyPress={(e) => {
                  // Backspace at position 0 → merge request.
                  // (The TextInput's own onChange handles regular deletion.)
                  if (
                    e.nativeEvent.key === 'Backspace' &&
                    useFocusStore.getState().getCursorPosition() === 0
                  ) {
                    handleBackspace(
                      seg.id,
                      useFocusStore.getState().getCursorPosition()
                    );
                  }
                  if (e.nativeEvent.key === 'Enter') {
                    handleReturn(
                      seg.id,
                      useFocusStore.getState().getCursorPosition()
                    );
                  }
                }}
                onFocus={() => focusSegment(seg.id, undefined)}
              />
            );
          }

          // Static (non-active) text segment.
          return (
            <Pressable
              onPress={() => focusSegment(seg.id, (seg.text ?? '').length)}
              onLongPress={() => focusSegment(seg.id, 0)}
              delayLongPress={200}
            >
              <StaticSegmentText text={seg.text ?? ''} />
            </Pressable>
          );
        }}
        ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
      />

      {/* ── Empty state placeholder ────────────────────────────────── */}
      {segments.length === 0 && (
        <View style={styles.emptyOverlay} pointerEvents="none">
          <Text style={styles.emptyText}>Whatever is real.</Text>
        </View>
      )}
    </View>
  );
}

// ── Build items with date dividers and verse-of-day ────────────────────────

function useBuildItems(segments: JournalSegment[]): ListItem[] {
  return (() => {
    const items: ListItem[] = [];
    let lastParentDate: string | null = null;

    for (const seg of segments) {
      const segDate = seg.parent_date;

      // Insert date divider when the day changes.
      if (segDate && segDate !== lastParentDate) {
        items.push({
          kind: 'date_divider',
          label: formatDateLabel(segDate),
          parentDate: segDate,
        });
        lastParentDate = segDate;
      }
      items.push({ kind: 'segment', segment: seg });
    }

    return items;
  })();
}

function formatDateLabel(parentDate: string): string {
  const [y, m, d] = parentDate.split('-').map(Number);
  const date = new Date(y, (m ?? 1) - 1, d ?? 1);
  return formatDateLong(date);
}

// ── Active segment input ───────────────────────────────────────────────────

interface ActiveSegmentInputProps {
  segment: JournalSegment;
  onChangeText: (text: string) => void;
  onKeyPress: (e: { nativeEvent: { key: string } }) => void;
  onFocus: () => void;
}

function ActiveSegmentInput({
  segment,
  onChangeText,
  onKeyPress,
  onFocus,
}: ActiveSegmentInputProps): ReactNode {
  const inputRef = useRef<TextInput>(null);
  const readingStyle = useReadingTextStyle();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <TextInput
      ref={inputRef}
      style={[
        styles.activeInput,
        { fontSize: readingStyle.fontSize, lineHeight: readingStyle.lineHeight },
      ]}
      value={segment.text ?? ''}
      onChangeText={onChangeText}
      onKeyPress={onKeyPress as never}
      onFocus={onFocus}
      multiline
      placeholder="…"
      placeholderTextColor={colors.placeholder}
      autoCapitalize="sentences"
      autoCorrect
      scrollEnabled={false}
    />
  );
}

// ── Static segment text ─────────────────────────────────────────────────────

function StaticSegmentText({ text }: { text: string }): ReactNode {
  const readingStyle = useReadingTextStyle();
  if (text.length === 0) return <View style={{ height: 1 }} />;
  return (
    <Text
      style={[
        styles.staticText,
        { fontSize: readingStyle.fontSize, lineHeight: readingStyle.lineHeight },
      ]}
    >
      {text}
    </Text>
  );
}

// ── Date divider ────────────────────────────────────────────────────────────

function DateDivider({ label }: { label: string }): ReactNode {
  return (
    <View style={styles.dateDivider}>
      <View style={styles.dateDividerLine} />
      <Text style={styles.dateDividerText}>{label}</Text>
      <View style={styles.dateDividerLine} />
    </View>
  );
}

// ── Verse of day card ───────────────────────────────────────────────────────

function VerseOfDayCard({
  reference,
  text,
}: {
  reference: string;
  text: string;
}): ReactNode {
  return (
    <View style={styles.verseDayCard}>
      {text ? (
        <>
          <Text style={styles.verseDayText}>"{text}"</Text>
          <Text style={styles.verseDayRef}>{reference}</Text>
        </>
      ) : (
        <Text style={styles.verseDayRef}>{reference}</Text>
      )}
    </View>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  center: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  listContent: {
    paddingHorizontal: layout.screenPaddingX,
    paddingVertical: spacing.lg,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    marginRight: spacing.md,
  },
  activeInput: {
    ...serifText,
    fontSize: 18,
    lineHeight: 28,
    color: colors.textPrimary,
    padding: 0,
    minHeight: 28,
    includeFontPadding: false,
  },
  staticText: {
    ...serifText,
    fontSize: 18,
    lineHeight: 28,
    color: colors.textPrimary,
  },
  dateDivider: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.lg,
    gap: spacing.md,
  },
  dateDividerLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
  },
  dateDividerText: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 12,
    letterSpacing: 0.4,
    color: colors.textTertiary,
  },
  verseDayCard: {
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing.lg,
    marginVertical: spacing.md,
    gap: spacing.xs,
  },
  verseDayText: {
    fontFamily: fontFamilies.serifItalic,
    fontStyle: 'italic',
    fontSize: 16,
    lineHeight: 24,
    color: colors.textPrimary,
  },
  verseDayRef: {
    fontFamily: fontFamilies.sans,
    fontSize: 12,
    letterSpacing: 0.3,
    color: colors.textTertiary,
    textAlign: 'right',
  },
  emptyOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    fontFamily: fontFamilies.serifItalic,
    fontStyle: 'italic',
    fontSize: 20,
    color: colors.placeholder,
    textAlign: 'center',
  },
});
