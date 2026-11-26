/**
 * Word screen — dedicated reading surface for Scripture and Library texts.
 *
 * Entry point for the Word tab: shows a Scripture/Library toggle in the
 * header, a search icon, and renders either the Scripture browser,
 * Library browser, reading view, or search screen depending on state.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SearchIcon, SettingsIcon, TranslationSelector, XIcon } from '@resonance/ui';

import { colors, fontFamilies, layout, radii, screenContainer, spacing } from '@resonance/theme';
import {
  getCachedSync,
  resolveBibleBookName,
  type LibraryBook,
  type Translation,
} from '@resonance/core';
import { useDataLayer } from '@resonance/core/data-layer-context';
import { ScriptureBrowser } from './ScriptureBrowser';
import { LibraryBrowser } from './LibraryBrowser';
import { ReadingView, type ReadingMode } from './ReadingView';
import { SearchScreen } from './SearchScreen';

type ScreenView =
  | { name: 'browse' }
  | { name: 'reading'; mode: ReadingMode; targetVerse?: number }
  | { name: 'search' };

export interface WordBackgroundStatus {
  label: string;
  detail?: string;
  progressPct?: number;
  onPress: () => void;
}

interface WordScreenProps {
  onOpenSettings?: () => void;
  /** Hide Settings gear in subHeader when the platform top header already renders it. */
  hideSettingsInSubHeader?: boolean;
  /** Optional mobile callback to browse & download optional Church Library books/collections. */
  onOpenCatalog?: () => void;
  /** Optional mobile callback to open Personal Library device-folder import flow. */
  onOpenImport?: () => void;
  /** Optional mobile callback to edit metadata on a personal imported book. */
  onEditBookMetadata?: (book: LibraryBook) => void;
  /** Optional revision counter to refresh the Library browser after imports/edits. */
  libraryRevision?: number;
  /** Incrementing signal (e.g. tapping the active Word tab) returns to the browse list. */
  resetSignal?: number;
  /** Optional live background sync/download/embedding banner (Mobile). */
  backgroundStatus?: WordBackgroundStatus | null;
  /** Deep-link: auto-open this book on mount or when changed */
  initialBook?: string;
  /** Deep-link: chapter number */
  initialChapter?: number;
  /** Deep-link: scroll to this verse */
  initialVerse?: number;
}

export function WordScreen({
  onOpenSettings,
  hideSettingsInSubHeader = false,
  onOpenCatalog,
  onOpenImport,
  onEditBookMetadata,
  libraryRevision = 0,
  resetSignal = 0,
  backgroundStatus = null,
  initialBook,
  initialChapter,
  initialVerse,
}: WordScreenProps): ReactNode {
  const [surface, setSurface] = useState<'scripture' | 'library'>('scripture');
  const [translation, setTranslation] = useState<Translation>(() => {
    const cached = getCachedSync<{ translation?: string }>('/api/settings');
    const saved = cached?.translation?.toLowerCase();
    if (saved === 'kjv' || saved === 'web') {
      return saved.toUpperCase() as Translation;
    }
    return 'WEB';
  });
  const [view, setView] = useState<ScreenView>({ name: 'browse' });
  const [lastReadPosition, setLastReadPosition] = useState<{
    bookId: string;
    chapter: number;
    verseRef: string;
  } | null>(null);
  const [continueDismissed, setContinueDismissed] = useState(false);

  const dataLayer = useDataLayer();
  const chapterCountCacheRef = useRef<Map<string, number>>(new Map());
  const appliedDeepLinkKeyRef = useRef<string | null>(null);
  const prevResetSignalRef = useRef(resetSignal);

  // Return to browse when user taps the active Word tab
  useEffect(() => {
    if (resetSignal !== prevResetSignalRef.current) {
      prevResetSignalRef.current = resetSignal;
      setView({ name: 'browse' });
    }
  }, [resetSignal]);

  // Load saved translation preference on mount
  useEffect(() => {
    dataLayer
      .getSettings()
      .then((settings) => {
        const saved = settings?.translation?.toLowerCase();
        if (saved === 'kjv' || saved === 'web') {
          setTranslation(saved.toUpperCase() as Translation);
        }
      })
      .catch(() => {});
  }, [dataLayer]);

  const refreshLastReadPosition = useCallback(() => {
    dataLayer
      .getLastReadPosition?.()
      .then((pos) => {
        if (pos) setLastReadPosition(pos);
      })
      .catch(() => {});
  }, [dataLayer]);

  useEffect(() => {
    refreshLastReadPosition();
  }, [refreshLastReadPosition]);

  // Helper: fetch and cache chapter count for a book+translation
  const resolveTotalChapters = useCallback(
    async (bookName: string, tr: Translation, knownTotal?: number): Promise<number> => {
      const key = `${tr}:${bookName}`;
      if (knownTotal && knownTotal > 0) {
        chapterCountCacheRef.current.set(key, knownTotal);
        return knownTotal;
      }
      const cached = chapterCountCacheRef.current.get(key);
      if (cached && cached > 0) return cached;
      try {
        const chapters = await dataLayer.getChapters(bookName, tr);
        const count = chapters.length || 1;
        chapterCountCacheRef.current.set(key, count);
        return count;
      } catch {
        return 1;
      }
    },
    [dataLayer]
  );

  // Apply deep-link on mount or whenever deep-link props change
  useEffect(() => {
    if (!initialBook) return;
    const key = `${initialBook}|${initialChapter ?? ''}|${initialVerse ?? ''}`;
    if (appliedDeepLinkKeyRef.current === key) return;
    appliedDeepLinkKeyRef.current = key;

    const canonicalBibleBook = resolveBibleBookName(initialBook);
    if (canonicalBibleBook) {
      const chapter = initialChapter != null && initialChapter > 0 ? initialChapter : 1;
      setSurface('scripture');
      void resolveTotalChapters(canonicalBibleBook, translation).then((total) => {
        setView({
          name: 'reading',
          mode: {
            kind: 'scripture',
            bookName: canonicalBibleBook,
            chapter,
            translation,
            totalChapters: total,
          },
          targetVerse: initialVerse,
        });
      });
    } else {
      // Any non-Bible book ID (slugs like "augustine-confessions", "personal_...", "voice_...")
      setSurface('library');
      setView({
        name: 'reading',
        mode: { kind: 'library', bookId: initialBook },
      });
    }
  }, [initialBook, initialChapter, initialVerse, translation, resolveTotalChapters]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const persistTranslation = useCallback(
    (nextTranslation: Translation) => {
      setTranslation(nextTranslation);
      void dataLayer
        .setSetting?.('translation', nextTranslation.toLowerCase())
        ?.catch(() => {});
    },
    [dataLayer]
  );

  const openScriptureChapter = useCallback(
    async (
      bookName: string,
      chapter: number,
      totalOrVerse?: number,
      explicitVerse?: number
    ) => {
      const canonical = resolveBibleBookName(bookName) ?? bookName;
      const total = await resolveTotalChapters(canonical, translation, totalOrVerse);
      setSurface('scripture');
      setView({
        name: 'reading',
        mode: {
          kind: 'scripture',
          bookName: canonical,
          chapter,
          translation,
          totalChapters: total,
        },
        targetVerse: explicitVerse,
      });
    },
    [translation, resolveTotalChapters]
  );

  const openScriptureFromBrowser = useCallback(
    (bookName: string, chapter: number, totalChapters?: number) => {
      void openScriptureChapter(bookName, chapter, totalChapters, undefined);
    },
    [openScriptureChapter]
  );

  const openScriptureFromSearch = useCallback(
    (bookName: string, chapter: number, verse?: number) => {
      void openScriptureChapter(bookName, chapter, undefined, verse);
    },
    [openScriptureChapter]
  );

  const openLibraryBook = useCallback((bookId: string) => {
    setSurface('library');
    setView({
      name: 'reading',
      mode: { kind: 'library', bookId },
    });
  }, []);

  const navigateChapter = useCallback(
    async (bookName: string, chapter: number, verse?: number) => {
      const canonical = resolveBibleBookName(bookName) ?? bookName;
      // Reuse known totalChapters immediately when staying in the same book!
      const existingTotal =
        view.name === 'reading' &&
        view.mode.kind === 'scripture' &&
        view.mode.bookName === canonical &&
        view.mode.translation === translation
          ? view.mode.totalChapters
          : undefined;

      const total = await resolveTotalChapters(canonical, translation, existingTotal);
      setView({
        name: 'reading',
        mode: {
          kind: 'scripture',
          bookName: canonical,
          chapter,
          translation,
          totalChapters: total,
        },
        targetVerse: verse,
      });
    },
    [view, translation, resolveTotalChapters]
  );

  const handleChangeTranslation = useCallback(
    (nextTranslation: Translation) => {
      persistTranslation(nextTranslation);
      if (view.name === 'reading' && view.mode.kind === 'scripture') {
        const { bookName, chapter } = view.mode;
        void resolveTotalChapters(bookName, nextTranslation).then((total) => {
          setView({
            name: 'reading',
            mode: {
              kind: 'scripture',
              bookName,
              chapter,
              translation: nextTranslation,
              totalChapters: total,
            },
          });
        });
      }
    },
    [view, persistTranslation, resolveTotalChapters]
  );

  const handleExitReading = useCallback(() => {
    setView({ name: 'browse' });
    setContinueDismissed(false);
    refreshLastReadPosition();
  }, [refreshLastReadPosition]);

  const handleResumeReading = useCallback(() => {
    if (!lastReadPosition) return;
    const pos = lastReadPosition;
    const canonicalBibleBook = resolveBibleBookName(pos.bookId);
    if (canonicalBibleBook) {
      void openScriptureChapter(canonicalBibleBook, pos.chapter || 1);
    } else {
      openLibraryBook(pos.bookId);
    }
  }, [lastReadPosition, openScriptureChapter, openLibraryBook]);

  // ── Render ────────────────────────────────────────────────────────────────

  if (view.name === 'search') {
    return (
      <SearchScreen
        onCancel={() => setView({ name: 'browse' })}
        onOpenScripture={openScriptureFromSearch}
        onOpenLibrary={openLibraryBook}
      />
    );
  }

  if (view.name === 'reading') {
    return (
      <ReadingView
        mode={view.mode}
        onNavigateChapter={navigateChapter}
        onChangeTranslation={handleChangeTranslation}
        onBack={handleExitReading}
        initialVerse={view.targetVerse}
      />
    );
  }

  // Inline top header card for Continue Reading (never floats over bottom books!)
  const continueReadingBanner =
    lastReadPosition && !continueDismissed ? (
      <View style={styles.continueCard}>
        <Pressable
          onPress={handleResumeReading}
          style={({ pressed }) => [
            styles.continueCardMain,
            pressed && styles.pressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel={`Continue reading ${lastReadPosition.verseRef}`}
        >
          <View style={styles.continueTextCol}>
            <Text style={styles.continueLabel}>Continue Reading</Text>
            <Text style={styles.continueRef} numberOfLines={1}>
              {lastReadPosition.verseRef}
            </Text>
          </View>
          <Text style={styles.continueAction}>Resume →</Text>
        </Pressable>
        <Pressable
          onPress={() => setContinueDismissed(true)}
          hitSlop={8}
          style={styles.continueDismissBtn}
          accessibilityRole="button"
          accessibilityLabel="Dismiss continue reading"
        >
          <XIcon size={14} color={colors.textTertiary} />
        </Pressable>
      </View>
    ) : null;

  const browseListHeader =
    backgroundStatus || continueReadingBanner ? (
      <View style={styles.browseHeaderStack}>
        {backgroundStatus ? (
          <Pressable
            onPress={backgroundStatus.onPress}
            style={({ pressed }) => [
              styles.bgStatusCard,
              pressed && styles.pressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel={backgroundStatus.label}
          >
            <View style={styles.bgStatusRow}>
              <View style={styles.continueTextCol}>
                <Text style={styles.bgStatusLabel} numberOfLines={1}>
                  {backgroundStatus.label}
                </Text>
                {backgroundStatus.detail ? (
                  <Text style={styles.bgStatusDetail} numberOfLines={1}>
                    {backgroundStatus.detail}
                  </Text>
                ) : null}
              </View>
              {typeof backgroundStatus.progressPct === 'number' ? (
                <Text style={styles.bgStatusPct}>
                  {backgroundStatus.progressPct}%
                </Text>
              ) : null}
            </View>
            {typeof backgroundStatus.progressPct === 'number' ? (
              <View style={styles.bgProgressTrack}>
                <View
                  style={[
                    styles.bgProgressFill,
                    {
                      width: `${Math.max(4, Math.min(100, backgroundStatus.progressPct))}%`,
                    },
                  ]}
                />
              </View>
            ) : null}
          </Pressable>
        ) : null}
        {continueReadingBanner}
      </View>
    ) : null;

  return (
    <View style={screenContainer}>
      <View style={styles.subHeader}>
        <View style={styles.toggle}>
          {(['scripture', 'library'] as const).map((s) => {
            const active = surface === s;
            const label = s === 'scripture' ? 'Scripture' : 'Library';
            return (
              <Pressable
                key={s}
                onPress={() => setSurface(s)}
                style={[styles.toggleItem, active && styles.toggleItemActive]}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
              >
                <Text
                  style={[
                    styles.toggleText,
                    active && styles.toggleTextActive,
                  ]}
                >
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.headerRight}>
          {surface === 'scripture' ? (
            <TranslationSelector
              value={translation}
              onChange={persistTranslation}
              placement="top"
            />
          ) : null}
          <Pressable
            onPress={() => setView({ name: 'search' })}
            hitSlop={8}
            style={styles.iconBtn}
            accessibilityRole="button"
            accessibilityLabel="Search"
          >
            <SearchIcon size={20} color={colors.textSecondary} />
          </Pressable>
          {onOpenSettings && !hideSettingsInSubHeader ? (
            <Pressable
              onPress={onOpenSettings}
              hitSlop={8}
              style={styles.iconBtn}
              accessibilityRole="button"
              accessibilityLabel="Settings"
            >
              <SettingsIcon size={20} color={colors.textSecondary} />
            </Pressable>
          ) : null}
        </View>
      </View>

      {surface === 'scripture' ? (
        <ScriptureBrowser
          translation={translation}
          onOpenChapter={openScriptureFromBrowser}
          ListHeaderComponent={browseListHeader}
        />
      ) : (
        <LibraryBrowser
          onOpenBook={openLibraryBook}
          onOpenCatalog={onOpenCatalog}
          onOpenImport={onOpenImport}
          onEditBookMetadata={onEditBookMetadata}
          libraryRevision={libraryRevision}
          ListHeaderComponent={browseListHeader}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  pressed: {
    opacity: 0.65,
  },
  subHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: layout.screenPaddingX,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.background,
  },
  toggle: {
    flexDirection: 'row',
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: 2,
  },
  toggleItem: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: radii.sm,
  },
  toggleItemActive: {
    backgroundColor: colors.accent,
  },
  toggleText: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 13.5,
    color: colors.textSecondary,
  },
  toggleTextActive: {
    color: colors.surface,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  iconBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.sm,
  },
  browseHeaderStack: {
    gap: spacing.sm,
  },
  continueCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingLeft: spacing.md,
    paddingRight: spacing.xs,
    paddingVertical: spacing.sm,
  },
  continueCardMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  continueTextCol: {
    flex: 1,
    gap: 1,
  },
  continueLabel: {
    fontFamily: fontFamilies.sansSemibold,
    fontSize: 11,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: colors.textTertiary,
  },
  continueRef: {
    fontFamily: fontFamilies.serifSemibold,
    fontSize: 16,
    color: colors.textPrimary,
  },
  continueAction: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 13,
    color: colors.accent,
  },
  continueDismissBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 2,
  },
  bgStatusCard: {
    backgroundColor: '#f6f1e7',
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.accentMuted,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: 6,
  },
  bgStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  bgStatusLabel: {
    fontFamily: fontFamilies.sansSemibold,
    fontSize: 13,
    color: colors.textPrimary,
  },
  bgStatusDetail: {
    fontFamily: fontFamilies.sans,
    fontSize: 12,
    color: colors.textSecondary,
  },
  bgStatusPct: {
    fontFamily: fontFamilies.sansSemibold,
    fontSize: 12.5,
    color: colors.accent,
  },
  bgProgressTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    overflow: 'hidden',
  },
  bgProgressFill: {
    height: '100%',
    backgroundColor: colors.accent,
  },
});
