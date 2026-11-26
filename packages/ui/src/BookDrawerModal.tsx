/**
 * BookDrawerModal — unified 3-tab Book Notebook & Navigation Drawer.
 *
 * Replaces the flat chapter modal with a proper book reader drawer:
 *   1. Contents   — Collapsible multi-level TOC accordion (Book -> Chapter)
 *                   for Library works (with filter, reading times, and
 *                   highlight counts), OR fast chapter grid for Scripture.
 *   2. Highlights — All highlights & margin notes in this book, filterable
 *                   by highlight color, with 1-tap jump to exact paragraph.
 *   3. Bookmarks  — Bookmarks in this book with 1-tap jump & remove.
 */

import { useMemo, useState, type ReactNode } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  fontFamilies,
  highlightColorMeta,
  radii,
  spacing,
  withAlpha,
  type ReaderThemePalette,
} from '@resonance/theme';
import type { BookChapter, Bookmark, Highlight } from '@resonance/core';
import {
  ChevronDownIcon,
  ChevronRightIcon,
  TrashIcon,
  XIcon,
} from './icons';

export type BookDrawerTab = 'contents' | 'highlights' | 'bookmarks';

export interface BookDrawerModalProps {
  visible: boolean;
  initialTab?: BookDrawerTab;
  theme: ReaderThemePalette;
  bookTitle: string;
  bookAuthor?: string | null;
  isScripture: boolean;
  /** Scripture mode: total chapters + active 1-indexed chapter. */
  totalChapters?: number;
  currentChapterNumber?: number;
  onSelectScriptureChapter?: (chapter: number) => void;
  /** Library mode: structured hierarchical chapters + active 0-indexed chapter. */
  chapters?: BookChapter[];
  currentChapterIndex?: number;
  highlightCountsByChapter?: Record<number, number>;
  onSelectLibraryChapter?: (chapterIndex: number) => void;
  /** Highlights & Bookmarks in this book. */
  highlights: Highlight[];
  bookmarks: Bookmark[];
  onJumpToHighlight: (highlight: Highlight) => void;
  onJumpToBookmark?: (bookmark: Bookmark) => void;
  onRemoveBookmark?: (verseRef: string) => void;
  onClose: () => void;
}

export function BookDrawerModal({
  visible,
  initialTab = 'contents',
  theme,
  bookTitle,
  bookAuthor,
  isScripture,
  totalChapters = 1,
  currentChapterNumber = 1,
  onSelectScriptureChapter,
  chapters = [],
  currentChapterIndex = 0,
  highlightCountsByChapter = {},
  onSelectLibraryChapter,
  highlights,
  bookmarks,
  onJumpToHighlight,
  onJumpToBookmark,
  onRemoveBookmark,
  onClose,
}: BookDrawerModalProps): ReactNode {
  const [tab, setTab] = useState<BookDrawerTab>(initialTab);
  const [tocQuery, setTocQuery] = useState('');
  const [colorFilter, setColorFilter] = useState<string | null>(null);
  const [collapsedParents, setCollapsedParents] = useState<Set<string>>(new Set());

  const toggleParent = (parentId: string) => {
    setCollapsedParents((prev) => {
      const next = new Set(prev);
      if (next.has(parentId)) next.delete(parentId);
      else next.add(parentId);
      return next;
    });
  };

  // Detect which chapters have child chapters (for collapsible accordion)
  const parentIdsWithChildren = useMemo(() => {
    const set = new Set<string>();
    for (const ch of chapters) {
      if (ch.parentId) set.add(ch.parentId);
    }
    return set;
  }, [chapters]);

  const visibleChapters = useMemo(() => {
    const q = tocQuery.trim().toLowerCase();
    if (q.length > 0) {
      return chapters.filter((c) => c.title.toLowerCase().includes(q));
    }
    return chapters.filter((c) => !c.parentId || !collapsedParents.has(c.parentId));
  }, [chapters, tocQuery, collapsedParents]);

  const filteredHighlights = useMemo(() => {
    if (!colorFilter) return highlights;
    return highlights.filter((h) => h.color === colorFilter);
  }, [highlights, colorFilter]);

  const scriptureChapters = useMemo(
    () => Array.from({ length: Math.max(1, totalChapters) }, (_, i) => i + 1),
    [totalChapters]
  );

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={styles.dismissArea} onPress={onClose} accessibilityLabel="Close book drawer" />
        <View
          style={[
            styles.sheet,
            { backgroundColor: theme.surface, borderColor: theme.border },
          ]}
        >
          {/* Header */}
          <View style={[styles.header, { borderBottomColor: theme.border }]}>
            <View style={styles.headerText}>
              <Text style={[styles.title, { color: theme.textPrimary }]} numberOfLines={1}>
                {bookTitle}
              </Text>
              {bookAuthor ? (
                <Text style={[styles.subtitle, { color: theme.textTertiary }]} numberOfLines={1}>
                  {bookAuthor}
                </Text>
              ) : null}
            </View>
            <Pressable
              onPress={onClose}
              hitSlop={10}
              style={styles.closeBtn}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <XIcon size={18} color={theme.textSecondary} />
            </Pressable>
          </View>

          {/* 3-Tab Switcher */}
          <View style={[styles.tabRow, { borderBottomColor: theme.border }]}>
            {(
              [
                { id: 'contents', label: isScripture ? 'Chapters' : `Contents (${chapters.length})` },
                { id: 'highlights', label: `Notes (${highlights.length})` },
                { id: 'bookmarks', label: `Bookmarks (${bookmarks.length})` },
              ] as Array<{ id: BookDrawerTab; label: string }>
            ).map((t) => {
              const active = tab === t.id;
              return (
                <Pressable
                  key={t.id}
                  onPress={() => setTab(t.id)}
                  style={[
                    styles.tabBtn,
                    active && { borderBottomWidth: 2, borderBottomColor: theme.accent },
                  ]}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active }}
                >
                  <Text
                    style={[
                      styles.tabText,
                      { color: active ? theme.accent : theme.textTertiary },
                    ]}
                  >
                    {t.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* Tab 1: Contents */}
          {tab === 'contents' ? (
            isScripture ? (
              <ScrollView contentContainerStyle={styles.chapterGrid}>
                {scriptureChapters.map((ch) => {
                  const isCurrent = ch === currentChapterNumber;
                  return (
                    <Pressable
                      key={ch}
                      onPress={() => {
                        onSelectScriptureChapter?.(ch);
                        onClose();
                      }}
                      style={[
                        styles.chapterChip,
                        {
                          backgroundColor: isCurrent ? theme.accent : theme.background,
                          borderColor: isCurrent ? theme.accent : theme.border,
                        },
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel={`Chapter ${ch}`}
                    >
                      <Text
                        style={[
                          styles.chapterChipText,
                          { color: isCurrent ? theme.surface : theme.textPrimary },
                        ]}
                      >
                        {ch}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            ) : (
              <View style={styles.tabBody}>
                {chapters.length > 8 ? (
                  <View style={[styles.filterWrap, { borderColor: theme.border, backgroundColor: theme.background }]}>
                    <TextInput
                      value={tocQuery}
                      onChangeText={setTocQuery}
                      placeholder="Filter chapters…"
                      placeholderTextColor={theme.textTertiary}
                      style={[styles.filterInput, { color: theme.textPrimary }]}
                    />
                  </View>
                ) : null}
                <ScrollView contentContainerStyle={styles.listContent}>
                  {visibleChapters.map((ch) => {
                    const isCurrent = ch.orderIndex === currentChapterIndex;
                    const hasChildren = parentIdsWithChildren.has(ch.id);
                    const isCollapsed = collapsedParents.has(ch.id);
                    const hlCount = highlightCountsByChapter[ch.orderIndex] ?? 0;

                    return (
                      <View
                        key={ch.id}
                        style={[
                          styles.tocRow,
                          ch.level >= 2 && styles.tocRowIndented,
                          isCurrent && { backgroundColor: withAlpha(theme.accent, 0.14) },
                        ]}
                      >
                        {hasChildren ? (
                          <Pressable
                            onPress={() => toggleParent(ch.id)}
                            hitSlop={8}
                            style={styles.accordionBtn}
                            accessibilityLabel={isCollapsed ? 'Expand section' : 'Collapse section'}
                          >
                            {isCollapsed ? (
                              <ChevronRightIcon size={15} color={theme.textTertiary} />
                            ) : (
                              <ChevronDownIcon size={15} color={theme.textTertiary} />
                            )}
                          </Pressable>
                        ) : (
                          <View style={styles.accordionSpacer} />
                        )}

                        <Pressable
                          onPress={() => {
                            onSelectLibraryChapter?.(ch.orderIndex);
                            onClose();
                          }}
                          style={styles.tocMainBtn}
                          accessibilityRole="button"
                          accessibilityLabel={ch.title}
                        >
                          <Text
                            style={[
                              ch.level <= 1 ? styles.tocTitleMajor : styles.tocTitleSub,
                              { color: isCurrent ? theme.accent : theme.textPrimary },
                            ]}
                            numberOfLines={2}
                          >
                            {ch.title}
                          </Text>
                          <View style={styles.tocMetaRow}>
                            {ch.estimatedMinutes > 0 ? (
                              <Text style={[styles.tocMeta, { color: theme.textTertiary }]}>
                                {ch.estimatedMinutes} min
                              </Text>
                            ) : null}
                            {hlCount > 0 ? (
                              <Text style={[styles.tocHlDot, { color: theme.accent }]}>
                                · {hlCount} {hlCount === 1 ? 'mark' : 'marks'}
                              </Text>
                            ) : null}
                          </View>
                        </Pressable>
                      </View>
                    );
                  })}
                  {visibleChapters.length === 0 ? (
                    <Text style={[styles.emptyText, { color: theme.textTertiary }]}>
                      No matching chapters.
                    </Text>
                  ) : null}
                </ScrollView>
              </View>
            )
          ) : null}

          {/* Tab 2: Highlights & Margin Notes */}
          {tab === 'highlights' ? (
            <View style={styles.tabBody}>
              {highlights.length > 0 ? (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.colorFilterRow}
                >
                  <Pressable
                    onPress={() => setColorFilter(null)}
                    style={[
                      styles.filterChip,
                      {
                        borderColor: !colorFilter ? theme.accent : theme.border,
                        backgroundColor: !colorFilter ? withAlpha(theme.accent, 0.14) : theme.background,
                      },
                    ]}
                  >
                    <Text style={[styles.filterChipText, { color: !colorFilter ? theme.accent : theme.textSecondary }]}>
                      All ({highlights.length})
                    </Text>
                  </Pressable>
                  {highlightColorMeta.map((c) => {
                    const active = colorFilter === c.color;
                    return (
                      <Pressable
                        key={c.color}
                        onPress={() => setColorFilter(active ? null : c.color)}
                        style={[
                          styles.filterChip,
                          {
                            borderColor: active ? c.color : theme.border,
                            backgroundColor: active ? withAlpha(c.color, 0.24) : theme.background,
                          },
                        ]}
                      >
                        <View style={[styles.miniDot, { backgroundColor: c.color }]} />
                        <Text style={[styles.filterChipText, { color: theme.textPrimary }]}>
                          {c.meaning}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              ) : null}

              <ScrollView contentContainerStyle={styles.listContent}>
                {filteredHighlights.map((hl) => (
                  <Pressable
                    key={hl.id}
                    onPress={() => {
                      onJumpToHighlight(hl);
                      onClose();
                    }}
                    style={[
                      styles.noteCard,
                      {
                        borderColor: theme.border,
                        backgroundColor: theme.background,
                        borderLeftColor: hl.color,
                      },
                    ]}
                  >
                    <Text style={[styles.noteCardRef, { color: theme.textTertiary }]}>
                      {hl.verse_ref}
                    </Text>
                    {hl.selected_text ? (
                      <Text
                        style={[styles.noteCardQuote, { color: theme.textPrimary }]}
                        numberOfLines={3}
                      >
                        “{hl.selected_text}”
                      </Text>
                    ) : null}
                    {hl.note_text ? (
                      <Text
                        style={[styles.noteCardNote, { color: theme.textSecondary }]}
                        numberOfLines={4}
                      >
                        {hl.note_text}
                      </Text>
                    ) : null}
                    {hl.tags && hl.tags.length > 0 ? (
                      <View style={styles.tagRow}>
                        {hl.tags.map((t) => (
                          <Text key={t} style={[styles.tagText, { color: theme.accent }]}>
                            #{t}
                          </Text>
                        ))}
                      </View>
                    ) : null}
                  </Pressable>
                ))}
                {filteredHighlights.length === 0 ? (
                  <Text style={[styles.emptyText, { color: theme.textTertiary }]}>
                    Tap any passage while reading to highlight or add a margin note.
                  </Text>
                ) : null}
              </ScrollView>
            </View>
          ) : null}

          {/* Tab 3: Bookmarks */}
          {tab === 'bookmarks' ? (
            <ScrollView contentContainerStyle={styles.listContent}>
              {bookmarks.map((bm) => (
                <View
                  key={bm.id}
                  style={[
                    styles.bookmarkRow,
                    { borderColor: theme.border, backgroundColor: theme.background },
                  ]}
                >
                  <Pressable
                    onPress={() => {
                      onJumpToBookmark?.(bm);
                      onClose();
                    }}
                    style={styles.bookmarkMain}
                  >
                    <Text style={[styles.bookmarkTitle, { color: theme.textPrimary }]} numberOfLines={1}>
                      {bm.label || bm.verse_ref}
                    </Text>
                    <Text style={[styles.bookmarkSub, { color: theme.textTertiary }]}>
                      {bm.verse_ref}
                    </Text>
                  </Pressable>
                  {onRemoveBookmark ? (
                    <Pressable
                      onPress={() => onRemoveBookmark(bm.verse_ref)}
                      hitSlop={8}
                      style={styles.removeBmBtn}
                      accessibilityLabel="Remove bookmark"
                    >
                      <TrashIcon size={15} color={theme.textTertiary} />
                    </Pressable>
                  ) : null}
                </View>
              ))}
              {bookmarks.length === 0 ? (
                <Text style={[styles.emptyText, { color: theme.textTertiary }]}>
                  No bookmarks saved for this book yet.
                </Text>
              ) : null}
            </ScrollView>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(20, 18, 16, 0.45)',
    justifyContent: 'flex-end',
  },
  dismissArea: {
    flex: 1,
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: StyleSheet.hairlineWidth,
    height: '78%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerText: {
    flex: 1,
    paddingRight: spacing.sm,
  },
  title: {
    fontFamily: fontFamilies.serifSemibold,
    fontSize: 19,
  },
  subtitle: {
    fontFamily: fontFamilies.sans,
    fontSize: 12,
    marginTop: 1,
  },
  closeBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabRow: {
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 11,
    alignItems: 'center',
  },
  tabText: {
    fontFamily: fontFamilies.sansSemibold,
    fontSize: 12.5,
  },
  tabBody: {
    flex: 1,
  },
  filterWrap: {
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
  },
  filterInput: {
    fontFamily: fontFamilies.sans,
    fontSize: 14,
    paddingVertical: 8,
  },
  listContent: {
    padding: spacing.md,
    gap: 6,
    paddingBottom: spacing.xxl,
  },
  chapterGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    padding: spacing.md,
    paddingBottom: spacing.xxl,
  },
  chapterChip: {
    width: 48,
    height: 48,
    borderRadius: radii.sm,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chapterChipText: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 14.5,
  },
  tocRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radii.sm,
    paddingVertical: 8,
    paddingRight: spacing.sm,
  },
  tocRowIndented: {
    paddingLeft: spacing.lg,
  },
  accordionBtn: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  accordionSpacer: {
    width: 10,
  },
  tocMainBtn: {
    flex: 1,
    gap: 2,
  },
  tocTitleMajor: {
    fontFamily: fontFamilies.serifSemibold,
    fontSize: 16.5,
  },
  tocTitleSub: {
    fontFamily: fontFamilies.serif,
    fontSize: 15.5,
  },
  tocMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  tocMeta: {
    fontFamily: fontFamilies.sans,
    fontSize: 11,
  },
  tocHlDot: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 11,
  },
  colorFilterRow: {
    flexDirection: 'row',
    gap: spacing.xs + 2,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: 2,
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  filterChipText: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 12,
  },
  miniDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  noteCard: {
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderLeftWidth: 3,
    padding: spacing.md,
    gap: 6,
  },
  noteCardRef: {
    fontFamily: fontFamilies.sansSemibold,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  noteCardQuote: {
    fontFamily: fontFamilies.serif,
    fontSize: 15.5,
    lineHeight: 22,
  },
  noteCardNote: {
    fontFamily: fontFamilies.serifItalic,
    fontStyle: 'italic',
    fontSize: 14.5,
    lineHeight: 20,
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  tagText: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 11.5,
  },
  bookmarkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
    paddingVertical: 11,
  },
  bookmarkMain: {
    flex: 1,
    gap: 2,
  },
  bookmarkTitle: {
    fontFamily: fontFamilies.serifSemibold,
    fontSize: 16,
  },
  bookmarkSub: {
    fontFamily: fontFamilies.sans,
    fontSize: 11.5,
  },
  removeBmBtn: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    fontFamily: fontFamilies.serifItalic,
    fontStyle: 'italic',
    fontSize: 15.5,
    textAlign: 'center',
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
  },
});
