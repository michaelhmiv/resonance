/**
 * Scripture browser — Book list (66 books, OT/NT) → Chapter grid.
 *
 * Tapping a book reveals its chapter grid; tapping a chapter calls
 * `onOpenChapter`, which the parent renders as a ReadingView.
 *
 * (design spec §6.1: browse by book → chapter → verses)
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  Pressable,
  SectionList,
  Text,
  View,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';

import {
  cardSurface,
  colors,
  fontFamilies,
  layout,
  listContentContainer,
  radii,
  serifText,
  spacing,
} from '@resonance/theme';
import { type BookSummary, type Translation } from '@resonance/core';
import { useDataLayer } from '@resonance/core/data-layer-context';
import { getCachedSync } from '@resonance/core';

interface ScriptureBrowserProps {
  translation: Translation;
  onOpenChapter: (bookName: string, chapter: number) => void;
}

interface ChapterData {
  bookName: string;
  chapters: number[];
}

export function ScriptureBrowser({
  translation,
  onOpenChapter,
}: ScriptureBrowserProps): ReactNode {
  // Lazy initializer reads from cache synchronously. If the user previously
  // visited this tab, the books list paints on the first render — no spinner
  // flash. If the cache is cold, we render null and let the effect fill it in.
  const [books, setBooks] = useState<BookSummary[] | null>(() => {
    return getCachedSync<BookSummary[]>(`/api/bible/books?translation=${translation}`);
  });
  const dataLayer = useDataLayer();
  const [chapterView, setChapterView] = useState<ChapterData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setBooks(null);
    setLoadError(null);
    dataLayer.getBooks(translation).then((nextBooks) => {
      if (!cancelled) setBooks(nextBooks);
    }).catch((err) => {
      if (!cancelled) {
        setLoadError(err instanceof Error ? err.message : 'Unable to load Scripture.');
        setBooks([]);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [dataLayer, translation]);

  const openBook = useCallback(
    async (book: BookSummary) => {
      if (!book.available) return;
      const chapters = await dataLayer.getChapters(book.name, translation);
      setChapterView({ bookName: book.name, chapters });
    },
    [dataLayer, translation]
  );

  // ── Chapter grid view ─────────────────────────────────────────────────
  if (chapterView) {
    return (
      <View style={styles.container}>
        <Pressable
          style={styles.backRow}
          onPress={() => setChapterView(null)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Back to books"
        >
          <Text style={styles.backText}>← Books</Text>
        </Pressable>
        <Text style={styles.bookTitle}>{chapterView.bookName}</Text>

        {chapterView.chapters.length === 0 ? (
          <Text style={styles.emptyText}>No chapters available.</Text>
        ) : (
          <View style={styles.grid}>
            {chapterView.chapters.map((ch) => (
              <Pressable
                key={ch}
                onPress={() => {
                  setChapterView(null);
                  onOpenChapter(chapterView.bookName, ch);
                }}
                style={({ pressed }) => [
                  styles.chapterCell,
                  pressed && styles.chapterCellPressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel={`Chapter ${ch}`}
              >
                <Text style={styles.chapterNum}>{ch}</Text>
              </Pressable>
            ))}
          </View>
        )}
      </View>
    );
  }

  // ── Book list view ─────────────────────────────────────────────────────
  if (books === null) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator color={colors.accentMuted} />
      </View>
    );
  }

  const otBooks = books.filter((b) => b.testament === 'OT');
  const ntBooks = books.filter((b) => b.testament === 'NT');

  if (loadError) {
    return (
      <View style={[styles.container, styles.center]}>
        <Text style={styles.emptyText}>Unable to load Scripture.</Text>
        <Text style={styles.emptyText}>{loadError}</Text>
      </View>
    );
  }

  const sections = [
    { title: 'Old Testament', data: otBooks },
    { title: 'New Testament', data: ntBooks },
  ];

  return (
    <View style={styles.container}>
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.name}
        contentContainerStyle={listContentContainer}
        renderSectionHeader={({ section: { title } }) => (
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{title}</Text>
          </View>
        )}
        renderItem={({ item: book }) => (
          <Pressable
            onPress={() => openBook(book)}
            disabled={!book.available}
            style={({ pressed }) => [
              cardSurface,
              styles.bookRow,
              pressed && styles.bookRowPressed,
              !book.available && styles.bookRowUnavailable,
            ]}
            accessibilityRole="button"
            accessibilityLabel={`${book.name}${book.available ? '' : ' (not installed)'}`}
          >
            <Text style={styles.bookName}>{book.name}</Text>
            {book.available ? (
              <Text style={styles.chevron}>›</Text>
            ) : (
              <Text style={styles.unavailableLabel}>—</Text>
            )}
          </Pressable>
        )}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        stickySectionHeadersEnabled={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  center: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  backRow: {
    paddingHorizontal: layout.screenPaddingX,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  backText: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 14,
    color: colors.accent,
  },
  bookTitle: {
    ...serifText,
    fontFamily: fontFamilies.serifSemibold,
    fontSize: 28,
    color: colors.textPrimary,
    paddingHorizontal: layout.screenPaddingX,
    paddingBottom: spacing.lg,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: layout.screenPaddingX - spacing.sm,
    gap: spacing.sm,
  },
  chapterCell: {
    width: 44,
    height: 44,
    borderRadius: radii.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  chapterCellPressed: {
    backgroundColor: colors.background,
    borderColor: colors.accentMuted,
  },
  chapterNum: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 15,
    color: colors.textPrimary,
  },
  emptyText: {
    ...serifText,
    color: colors.textTertiary,
    paddingHorizontal: layout.screenPaddingX,
  },
  sectionHeader: {
    paddingBottom: spacing.sm,
    paddingTop: spacing.lg,
  },
  sectionTitle: {
    fontFamily: fontFamilies.sansSemibold,
    fontSize: 12,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.textTertiary,
  },
  bookRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md + 2,
    paddingHorizontal: layout.cardPadding,
    borderRadius: radii.sm,
  },
  bookRowPressed: {
    backgroundColor: colors.background,
  },
  bookRowUnavailable: {
    opacity: 0.4,
  },
  bookName: {
    ...serifText,
    fontSize: 17,
    color: colors.textPrimary,
  },
  chevron: {
    fontFamily: fontFamilies.sans,
    fontSize: 20,
    color: colors.textTertiary,
  },
  unavailableLabel: {
    fontFamily: fontFamilies.sans,
    fontSize: 14,
    color: colors.textTertiary,
  },
  separator: {
    height: 1,
    backgroundColor: colors.border,
    marginHorizontal: layout.cardPadding,
    opacity: 0.5,
  },
});
