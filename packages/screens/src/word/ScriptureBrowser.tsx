/**
 * Scripture browser — Book list (66 books, OT/NT) → scrollable Chapter grid.
 *
 * Tapping a book reveals its scrollable chapter grid; tapping a chapter calls
 * `onOpenChapter`, which the parent renders as a ReadingView.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Platform,
  Pressable,
  ScrollView,
  SectionList,
  StyleSheet,
  Text,
  View,
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
import {
  bibleBookId,
  getCachedSync,
  type BookSummary,
  type Translation,
} from '@resonance/core';
import { useDataLayer } from '@resonance/core/data-layer-context';
import { ChevronLeftIcon } from '@resonance/ui';

interface ScriptureBrowserProps {
  translation: Translation;
  onOpenChapter: (bookName: string, chapter: number, totalChapters?: number) => void;
  /** Optional header element rendered above the book list (e.g. Continue Reading). */
  ListHeaderComponent?: ReactElement | null;
}

interface ChapterData {
  bookName: string;
  chapters: number[];
}

interface CachedWebBooksResponse {
  books?: Array<{
    name: string;
    testament: 'OT' | 'NT';
    order: number;
    chapterCount: number;
  }>;
}

type TestamentFilter = 'ALL' | 'OT' | 'NT';

const BookSeparator = () => <View style={styles.separator} />;

function readCachedBooks(translation: Translation): BookSummary[] | null {
  const raw = getCachedSync<CachedWebBooksResponse | BookSummary[]>(
    `/api/bible/books?translation=${translation.toLowerCase()}`
  );
  if (!raw) return null;
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw.books)) {
    return raw.books.map((b) => ({
      name: b.name,
      testament: b.testament,
      order: b.order,
      available: b.chapterCount > 0,
      bookId: bibleBookId(b.name, translation),
    }));
  }
  return null;
}

export function ScriptureBrowser({
  translation,
  onOpenChapter,
  ListHeaderComponent,
}: ScriptureBrowserProps): ReactNode {
  const [books, setBooks] = useState<BookSummary[] | null>(() =>
    readCachedBooks(translation)
  );
  const dataLayer = useDataLayer();
  const [testamentFilter, setTestamentFilter] = useState<TestamentFilter>('ALL');
  const [chapterView, setChapterView] = useState<ChapterData | null>(null);
  const [openingBook, setOpeningBook] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Reset chapter grid if translation changes
  useEffect(() => {
    setChapterView(null);
  }, [translation]);

  // Android hardware back exits chapter grid back to books list
  useEffect(() => {
    if (Platform.OS === 'web' || !chapterView) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setChapterView(null);
      return true;
    });
    return () => sub.remove();
  }, [chapterView]);

  useEffect(() => {
    let cancelled = false;
    const cached = readCachedBooks(translation);
    if (cached) {
      setBooks(cached);
    }
    setLoadError(null);
    dataLayer
      .getBooks(translation)
      .then((nextBooks) => {
        if (!cancelled) setBooks(nextBooks);
      })
      .catch((err) => {
        if (!cancelled) {
          setLoadError(
            err instanceof Error ? err.message : 'Unable to load Scripture.'
          );
          setBooks((prev) => prev ?? []);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [dataLayer, translation]);

  const openBook = useCallback(
    async (book: BookSummary) => {
      if (!book.available || openingBook) return;
      setOpeningBook(book.name);
      try {
        const chapters = await dataLayer.getChapters(book.name, translation);
        setChapterView({ bookName: book.name, chapters });
      } catch (err) {
        setLoadError(
          err instanceof Error ? err.message : `Unable to open ${book.name}.`
        );
      } finally {
        setOpeningBook(null);
      }
    },
    [dataLayer, translation, openingBook]
  );

  const sections = useMemo(() => {
    if (!books) return [];
    const otBooks = books.filter((b) => b.testament === 'OT');
    const ntBooks = books.filter((b) => b.testament === 'NT');
    if (testamentFilter === 'OT') {
      return [{ title: 'Old Testament', data: otBooks }];
    }
    if (testamentFilter === 'NT') {
      return [{ title: 'New Testament', data: ntBooks }];
    }
    return [
      { title: 'Old Testament', data: otBooks },
      { title: 'New Testament', data: ntBooks },
    ];
  }, [books, testamentFilter]);

  // ── Scrollable chapter grid view ───────────────────────────────────────
  if (chapterView) {
    return (
      <View style={styles.container}>
        <View style={styles.chapterHeader}>
          <Pressable
            style={({ pressed }) => [styles.backRow, pressed && styles.pressed]}
            onPress={() => setChapterView(null)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Back to books"
          >
            <ChevronLeftIcon size={18} color={colors.accent} />
            <Text style={styles.backText}>Books</Text>
          </Pressable>
          <Text style={styles.bookTitle}>{chapterView.bookName}</Text>
          <Text style={styles.chapterCountSubtitle}>
            {chapterView.chapters.length}{' '}
            {chapterView.chapters.length === 1 ? 'chapter' : 'chapters'}
          </Text>
        </View>

        {chapterView.chapters.length === 0 ? (
          <Text style={styles.emptyText}>No chapters available.</Text>
        ) : (
          <ScrollView
            style={styles.gridScroll}
            contentContainerStyle={styles.grid}
            showsVerticalScrollIndicator={false}
          >
            {chapterView.chapters.map((ch) => (
              <Pressable
                key={ch}
                onPress={() => {
                  const total = chapterView.chapters.length;
                  const name = chapterView.bookName;
                  setChapterView(null);
                  onOpenChapter(name, ch, total);
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
          </ScrollView>
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

  if (loadError && books.length === 0) {
    return (
      <View style={[styles.container, styles.center]}>
        <Text style={styles.emptyText}>Unable to load Scripture.</Text>
        <Text style={styles.emptyText}>{loadError}</Text>
      </View>
    );
  }

  const listHeader = (
    <View style={styles.listHeaderWrap}>
      {ListHeaderComponent ?? null}
      <View style={styles.filterRow}>
        {(
          [
            { key: 'ALL', label: 'All (66)' },
            { key: 'OT', label: 'Old Testament' },
            { key: 'NT', label: 'New Testament' },
          ] as const
        ).map((tab) => {
          const active = testamentFilter === tab.key;
          return (
            <Pressable
              key={tab.key}
              onPress={() => setTestamentFilter(tab.key)}
              style={[styles.filterPill, active && styles.filterPillActive]}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
            >
              <Text
                style={[
                  styles.filterPillText,
                  active && styles.filterPillTextActive,
                ]}
              >
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.name}
        ListHeaderComponent={listHeader}
        contentContainerStyle={[listContentContainer, styles.listContent]}
        renderSectionHeader={({ section: { title } }) => (
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{title}</Text>
          </View>
        )}
        renderItem={({ item: book }) => {
          const isOpening = openingBook === book.name;
          return (
            <Pressable
              onPress={() => void openBook(book)}
              disabled={!book.available || Boolean(openingBook)}
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
              {isOpening ? (
                <ActivityIndicator size="small" color={colors.accent} />
              ) : book.available ? (
                <Text style={styles.chevron}>›</Text>
              ) : (
                <Text style={styles.unavailableLabel}>—</Text>
              )}
            </Pressable>
          );
        }}
        ItemSeparatorComponent={BookSeparator}
        stickySectionHeadersEnabled={false}
        initialNumToRender={24}
        maxToRenderPerBatch={20}
        windowSize={9}
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
  pressed: {
    opacity: 0.6,
  },
  listContent: {
    paddingTop: spacing.md,
    paddingBottom: spacing.xxl,
  },
  listHeaderWrap: {
    gap: spacing.md,
    marginBottom: spacing.xs,
  },
  filterRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  filterPill: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  filterPillActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  filterPillText: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 12.5,
    color: colors.textSecondary,
  },
  filterPillTextActive: {
    color: colors.surface,
  },
  chapterHeader: {
    paddingHorizontal: layout.screenPaddingX,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    alignSelf: 'flex-start',
    minHeight: 36,
    marginBottom: spacing.xs,
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
    lineHeight: 34,
    color: colors.textPrimary,
  },
  chapterCountSubtitle: {
    fontFamily: fontFamilies.sans,
    fontSize: 12.5,
    color: colors.textTertiary,
    marginTop: 2,
  },
  gridScroll: {
    flex: 1,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: layout.screenPaddingX,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl * 2,
    gap: spacing.sm,
  },
  chapterCell: {
    width: 48,
    height: 48,
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
    paddingTop: spacing.lg,
  },
  sectionHeader: {
    paddingBottom: spacing.sm,
    paddingTop: spacing.md,
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
