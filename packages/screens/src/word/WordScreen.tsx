/**
 * Word screen — dedicated reading surface for Scripture and Library texts.
 *
 * Entry point for the Word tab: shows a Scripture/Library toggle in the
 * header, a search icon, and renders either the Scripture browser,
 * Library browser, reading view, or search screen depending on state.
 *
 * Supports deep-linking via initialBook/initialChapter/initialVerse
 * and a "Continue Reading" card for Phase 7.
 *
 * (design spec §6: Word tab — browse, search, highlight, annotate, bookmark)
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SearchIcon, SettingsIcon } from '@resonance/ui';

import { colors, fontFamilies, radii, screenContainer, spacing } from '@resonance/theme';
import { type LibraryBook, type Translation, getCachedSync } from '@resonance/core';
import { useDataLayer } from '@resonance/core/data-layer-context';
import { ScriptureBrowser } from './ScriptureBrowser';
import { LibraryBrowser } from './LibraryBrowser';
import { ReadingView, type ReadingMode } from './ReadingView';
import { SearchScreen } from './SearchScreen';
import { TranslationSelector } from '@resonance/ui';

type ScreenView =
  | { name: 'browse' }
  | { name: 'reading'; mode: ReadingMode }
  | { name: 'search' };

interface WordScreenProps {
  onOpenSettings?: () => void;
  /** Optional mobile callback to browse & download optional Church Library books/collections. */
  onOpenCatalog?: () => void;
  /** Optional mobile callback to open Personal Library device-folder import flow. */
  onOpenImport?: () => void;
  /** Optional mobile callback to edit metadata on a personal imported book. */
  onEditBookMetadata?: (book: LibraryBook) => void;
  /** Optional revision counter to refresh the Library browser after imports/edits. */
  libraryRevision?: number;
  /** Deep-link: auto-open this book on mount */
  initialBook?: string;
  /** Deep-link: chapter number */
  initialChapter?: number;
  /** Deep-link: scroll to this verse */
  initialVerse?: number;
}

export function WordScreen({
  onOpenSettings,
  onOpenCatalog,
  onOpenImport,
  onEditBookMetadata,
  libraryRevision = 0,
  initialBook,
  initialChapter,
  initialVerse,
}: WordScreenProps): ReactNode {
  const [surface, setSurface] = useState<'scripture' | 'library'>('scripture');
  // Translation is read from cache synchronously so the first render of the
  // ScriptureBrowser uses the right translation immediately (no flash of WEB
  // then switching to KJV).
  const [translation, setTranslation] = useState<Translation>(() => {
    const cached = getCachedSync<{ translation?: string }>('/api/settings');
    const saved = cached?.translation;
    if (saved === 'kjv' || saved === 'web') return saved.toUpperCase() as Translation;
    return 'WEB';
  });
  const [view, setView] = useState<ScreenView>({ name: 'browse' });
  const [totalChapters, setTotalChapters] = useState(1);
  const [lastReadPosition, setLastReadPosition] = useState<{ bookId: string; chapter: number; verseRef: string } | null>(() => {
    // No cache for lastReadPosition — it's tiny and rarely shared.
    return null;
  });
  const dataLayer = useDataLayer();
  const deepLinkApplied = useRef(false);

  // Load saved translation preference on mount (refreshes cache if stale)
  useEffect(() => {
    dataLayer.getSettings().then((settings) => {
      const savedTranslation = settings?.translation;
      if (savedTranslation === 'kjv' || savedTranslation === 'web') {
        setTranslation(savedTranslation.toUpperCase() as Translation);
      }
    }).catch(() => {});
  }, [dataLayer]);

  // Fetch last read position for "Continue Reading" card
  useEffect(() => {
    dataLayer.getLastReadPosition?.().then((pos) => {
      if (pos) setLastReadPosition(pos);
    }).catch(() => {});
  }, [dataLayer]);

  // Apply deep-link on mount
  useEffect(() => {
    if (deepLinkApplied.current) return;
    if (!initialBook || initialChapter == null) return;
    deepLinkApplied.current = true;

    // Determine if it's scripture or library from the book id
    const bookId = initialBook;
    if (bookId.startsWith('voice_') || bookId.startsWith('author_')) {
      setSurface('library');
      setView({
        name: 'reading',
        mode: { kind: 'library', bookId },
      });
    } else {
      // Scripture: parse book name from ID (e.g. "web_Matthew" → "Matthew")
      const bookName = bookId.replace(/^(web|kjv)_/, '').replace(/_/g, ' ');
      setSurface('scripture');
      dataLayer.getChapters(bookName, translation).then((chapters) => {
        setTotalChapters(chapters.length || 1);
        setView({
          name: 'reading',
          mode: {
            kind: 'scripture',
            bookName,
            chapter: initialChapter,
            translation,
            totalChapters: chapters.length || 1,
          },
        });
      }).catch(() => {
        setView({
          name: 'reading',
          mode: {
            kind: 'scripture',
            bookName,
            chapter: initialChapter,
            translation,
            totalChapters: 99,
          },
        });
      });
    }
  }, [initialBook, initialChapter, translation, dataLayer]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const openScriptureChapter = useCallback(
    async (bookName: string, chapter: number) => {
      const chapters = await dataLayer.getChapters(bookName, translation);
      setTotalChapters(chapters.length || 1);
      setView({
        name: 'reading',
        mode: {
          kind: 'scripture',
          bookName,
          chapter,
          translation,
          totalChapters: chapters.length || 1,
        },
      });
    },
    [dataLayer, translation]
  );

  const openLibraryBook = useCallback((bookId: string) => {
    setView({
      name: 'reading',
      mode: { kind: 'library', bookId },
    });
  }, []);

  const navigateChapter = useCallback(
    async (bookName: string, chapter: number) => {
      const chapters = await dataLayer.getChapters(bookName, translation);
      setTotalChapters(chapters.length || 1);
      setView({
        name: 'reading',
        mode: {
          kind: 'scripture',
          bookName,
          chapter,
          translation,
          totalChapters: chapters.length || 1,
        },
      });
    },
    [dataLayer, translation]
  );

  const handleChangeTranslation = useCallback(
    (nextTranslation: Translation) => {
      setTranslation(nextTranslation);
      if (view.name === 'reading' && view.mode.kind === 'scripture') {
        const { bookName, chapter } = view.mode;
        dataLayer.getChapters(bookName, nextTranslation).then((chapters) => {
          setTotalChapters(chapters.length || 1);
          setView({
            name: 'reading',
            mode: {
              kind: 'scripture',
              bookName,
              chapter,
              translation: nextTranslation,
              totalChapters: chapters.length || 1,
            },
          });
        }).catch(() => {});
      }
    },
    [view, dataLayer]
  );

  // ── Render ────────────────────────────────────────────────────────────────

  // Search screen renders over everything.
  if (view.name === 'search') {
    return (
      <SearchScreen
        onCancel={() => setView({ name: 'browse' })}
        onOpenScripture={openScriptureChapter}
        onOpenLibrary={openLibraryBook}
      />
    );
  }

  // Reading view.
  if (view.name === 'reading') {
    return (
      <ReadingView
        mode={view.mode}
        onNavigateChapter={navigateChapter}
        onChangeTranslation={handleChangeTranslation}
        onBack={() => {
          deepLinkApplied.current = false;
          setView({ name: 'browse' });
        }}
        initialVerse={initialVerse}
      />
    );
  }

  // Browse view with Scripture/Library toggle.
  return (
    <View style={screenContainer}>
      <View style={styles.subHeader}>
        {/* eslint-disable-next-line react-native-a11y */}
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
          {surface === 'scripture' && (
            <TranslationSelector value={translation} onChange={setTranslation} />
          )}
          <Pressable
            onPress={() => setView({ name: 'search' })}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Search"
          >
            <SearchIcon size={20} color={colors.textSecondary} />
          </Pressable>
          {onOpenSettings ? (
            <Pressable
              onPress={onOpenSettings}
              hitSlop={10}
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
          onOpenChapter={openScriptureChapter}
        />
      ) : (
        <LibraryBrowser
          onOpenBook={openLibraryBook}
          onOpenCatalog={onOpenCatalog}
          onOpenImport={onOpenImport}
          onEditBookMetadata={onEditBookMetadata}
          libraryRevision={libraryRevision}
        />
      )}

      {/* Continue Reading card */}
      {lastReadPosition && !deepLinkApplied.current && (
        <View style={styles.continueCard}>
          <Pressable
            onPress={() => {
              const pos = lastReadPosition;
              if (
                pos.bookId.startsWith('voice_') ||
                pos.bookId.startsWith('author_') ||
                pos.bookId.startsWith('personal_')
              ) {
                setSurface('library');
                setView({ name: 'reading', mode: { kind: 'library', bookId: pos.bookId } });
              } else {
                const bookName = pos.bookId.replace(/^(web|kjv)_/, '').replace(/_/g, ' ');
                setSurface('scripture');
                dataLayer.getChapters(bookName, translation).then((chapters) => {
                  setTotalChapters(chapters.length || 1);
                  setView({
                    name: 'reading',
                    mode: { kind: 'scripture', bookName, chapter: pos.chapter, translation, totalChapters: chapters.length || 1 },
                  });
                }).catch(() => {});
              }
            }}
            style={styles.continueCardInner}
          >
            <Text style={styles.continueLabel}>Continue Reading</Text>
            <Text style={styles.continueRef}>{lastReadPosition.verseRef}</Text>
            <Text style={styles.continueAction}>Tap to resume →</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  subHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  toggle: {
    flexDirection: 'row',
    gap: 0,
  },
  toggleItem: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  toggleItemActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  toggleText: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 14,
    color: colors.textSecondary,
  },
  toggleTextActive: {
    color: colors.surface,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    marginRight: spacing.md,
  },
  continueCard: {
    position: 'absolute',
    bottom: spacing.lg,
    left: spacing.lg,
    right: spacing.lg,
  },
  continueCardInner: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  continueLabel: {
    fontFamily: fontFamilies.sansSemibold,
    fontSize: 12,
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
    marginTop: spacing.xs,
  },
});
