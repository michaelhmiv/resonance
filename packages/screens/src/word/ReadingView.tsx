/**
 * Reading view — the sacred reading surface.
 *
 * Renders Scripture verses or Library passages in serif with verse numbers
 * as superscripts. Long-press a verse to open the highlight toolbar
 * (3 soft tones + margin note). Cross-references appear as quiet marginal
 * links after verses. Prev/next chapter navigation for Scripture.
 *
 * (design spec §6.3 — highlight, annotate, bookmark, cross-references;
 *  §6.4 — search results; §6.1 — translation selector and chapter nav)
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  colors,
  fontFamilies,
  layout,
  listContentContainer,
  radii,
  serifText,
  spacing,
} from '@resonance/theme';
import {
  type Translation,
  type VersePassage,
  type LibraryPassage,
  type LibraryBook,
  type HighlightMap,
  type AnnotationMap,
} from '@resonance/core';
import { useDataLayer } from '@resonance/core/data-layer-context';
import { HighlightToolbar } from '@resonance/ui';
import { CrossReferenceLinks } from '@resonance/ui';
import { BookmarkButton } from '@resonance/ui';
import { SendToJournalButton } from '@resonance/ui';

// ── Types ───────────────────────────────────────────────────────────────────


function scriptureRef(
  bookName: string,
  chapter: number | null,
  verseStart: number | null,
  verseEnd: number | null
): string {
  const ref = `${bookName} ${chapter ?? ''}:${verseStart ?? ''}`;
  if (verseEnd != null && verseEnd !== verseStart) {
    return `${ref}-${verseEnd}`;
  }
  return ref.trim();
}


export type ReadingMode =
  | { kind: 'scripture'; bookName: string; chapter: number; translation: Translation; totalChapters: number }
  | { kind: 'library'; bookId: string };

interface ReadingViewProps {
  mode: ReadingMode;
  onChangeTranslation?: (t: Translation) => void;
  onNavigateChapter?: (bookName: string, chapter: number) => void;
  onBack: () => void;
}

// ── Component ───────────────────────────────────────────────────────────────

export function ReadingView({
  mode,
  onNavigateChapter,
  onBack,
}: ReadingViewProps): ReactNode {
  const [passages, setPassages] = useState<
    (VersePassage | LibraryPassage)[]
  >([]);
  const [libraryBook, setLibraryBook] = useState<LibraryBook | null>(null);
  const [loading, setLoading] = useState(true);
  const [highlightMap, setHighlightMap] = useState<HighlightMap>({});
  const [annotationMap, setAnnotationMap] = useState<AnnotationMap>({});
  const [crossRefs, setCrossRefs] = useState<Record<string, string[]>>({});
  const [bookmarked, setBookmarked] = useState(false);
  const [fontSize, setFontSize] = useState<string>('medium');

  // Highlight toolbar state
  const [activeVerseRef, setActiveVerseRef] = useState<string | null>(null);
  const [annotationModal, setAnnotationModal] = useState<{
    ref: string;
    text: string;
  } | null>(null);
  const [annotationDraft, setAnnotationDraft] = useState('');

  const isScripture = mode.kind === 'scripture';
  const translation = isScripture ? mode.translation : 'WEB';
  const scrollRef = useRef<FlatList>(null);
  const dataLayer = useDataLayer();

  // ── Load passages on mount / when params change ─────────────────────────
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setPassages([]);
    setCrossRefs({});
    setHighlightMap({});
    setAnnotationMap({});

    const loadData = async () => {
      let resultPassages: (VersePassage | LibraryPassage)[] = [];
      let verseRefs: string[] = [];

      // 1. Load passages
      if (mode.kind === 'scripture') {
        resultPassages = await dataLayer.getVerses(
          mode.bookName,
          mode.chapter,
          mode.translation
        );
        verseRefs = resultPassages
          .map((p) =>
            scriptureRef(mode.bookName, mode.chapter, p.verse_start, p.verse_end)
          );
      } else {
        resultPassages = await dataLayer.getLibraryPassages(mode.bookId);
        const book = await dataLayer.getLibraryBook(mode.bookId);
        if (!cancelled) setLibraryBook(book);
      }

      if (cancelled) return;

      // 2. Show passages immediately — don't wait for highlights/cross-refs
      setPassages(resultPassages);
      setLoading(false);

      // 3. Load highlights and annotations in parallel (non-blocking)
      if (verseRefs.length > 0 && mode.kind === 'scripture') {
        Promise.all([
          dataLayer.getHighlightsForRefs(verseRefs),
          dataLayer.getAnnotationsForRefs(verseRefs, mode.translation),
        ]).then(([hMap, aMap]) => {
          if (!cancelled) {
            setHighlightMap(hMap);
            setAnnotationMap(aMap);
          }
        }).catch(() => {});

        // 4. Load cross-references in background (non-blocking, fire-and-forget)
        // Phase 2 will make these lazy on expand, but preload for now
        const xrefMap: Record<string, string[]> = {};
        Promise.all(
          verseRefs.map(async (ref) => {
            try {
              const refs = await dataLayer.getCrossReferences(ref);
              if (refs.length > 0) xrefMap[ref] = refs;
            } catch { /* skip failed refs */ }
          })
        ).then(() => {
          if (!cancelled) setCrossRefs(xrefMap);
        }).catch(() => {});
      }
    };

    loadData();
    return () => {
      cancelled = true;
    };
  }, [mode, dataLayer]);

  // ── Record reading event (background, fire-and-forget) ─────────────────
  useEffect(() => {
    if (mode.kind !== 'scripture') return;
    const ref = `${mode.bookName} ${mode.chapter}`;
    dataLayer.recordReadingEvent(mode.bookName, mode.chapter, ref, Date.now()).catch(() => {});
  }, [mode, dataLayer]);

  // ── Load saved font size ──────────────────────────────────────────────
  useEffect(() => {
    dataLayer.getSettings().then((settings) => {
      if (settings?.fontSize) setFontSize(settings.fontSize);
    }).catch(() => {});
  }, [dataLayer]);

  // ── Actions ──────────────────────────────────────────────────────────────

  const verseRefFor = useCallback(
    (passage: VersePassage | LibraryPassage): string => {
      if (mode.kind === 'scripture') {
        return scriptureRef(
          mode.bookName,
          mode.chapter,
          passage.verse_start,
          passage.verse_end
        );
      }
      return `${libraryBook?.title ?? 'Library'} ${passage.chapter ?? ''}`;
    },
    [mode, libraryBook]
  );

  const handleCrossRefPress = useCallback(
    (ref: string) => {
      if (!onNavigateChapter) return;
      // Parse "Book Name Chapter:Verse" or "Book Name Chapter:Verse-End"
      // e.g. "Proverbs 8:22-30" → book="Proverbs", chapter=8
      // e.g. "1 Chronicles 16:26" → book="1 Chronicles", chapter=16
      const match = ref.match(/^(.+?)\s+(\d+):/);
      if (!match) return;
      const bookName = match[1].trim();
      const chapter = parseInt(match[2], 10);
      if (!bookName || isNaN(chapter)) return;
      onNavigateChapter(bookName, chapter);
    },
    [onNavigateChapter]
  );

  const handleApplyHighlight = useCallback(
    async (color: string) => {
      if (!activeVerseRef) return;
      await dataLayer.saveHighlight(activeVerseRef, color);
      setHighlightMap((prev) => ({ ...prev, [activeVerseRef]: color }));
    },
    [activeVerseRef, dataLayer]
  );

  const handleClearHighlight = useCallback(async () => {
    if (!activeVerseRef) return;
    await dataLayer.removeHighlight(activeVerseRef);
    setHighlightMap((prev) => {
      const next = { ...prev };
      delete next[activeVerseRef];
      return next;
    });
  }, [activeVerseRef, dataLayer]);

  const handleOpenAnnotation = useCallback(() => {
    if (!activeVerseRef) return;
    const existing = annotationMap[activeVerseRef] ?? '';
    setAnnotationDraft(existing);
    setAnnotationModal({ ref: activeVerseRef, text: existing });
  }, [activeVerseRef, annotationMap]);

  const handleSaveAnnotation = useCallback(async () => {
    if (!annotationModal) return;
    await dataLayer.saveAnnotation(annotationModal.ref, translation, annotationDraft);
    setAnnotationMap((prev) => {
      const next = { ...prev };
      if (annotationDraft.trim().length > 0) {
        next[annotationModal.ref] = annotationDraft;
      } else {
        delete next[annotationModal.ref];
      }
      return next;
    });
    setAnnotationModal(null);
  }, [annotationModal, annotationDraft, translation, dataLayer]);

const fontSizeMap: Record<string, number> = { small: 15, medium: 17, large: 19 };

  // ── Title / header ──────────────────────────────────────────────────────

  const headerTitle = useMemo(() => {
    if (mode.kind === 'scripture') {
      return `${mode.bookName} ${mode.chapter}`;
    }
    return libraryBook?.title ?? 'Reading';
  }, [mode, libraryBook]);

  const bookmarkRef = useMemo(() => {
    if (mode.kind === 'scripture') {
      return `${mode.bookName} ${mode.chapter}`;
    }
    return libraryBook?.title ?? mode.bookId;
  }, [mode, libraryBook]);

  useEffect(() => {
    let cancelled = false;
    dataLayer.getBookmarks().then((bookmarks) => {
      if (!cancelled) {
        setBookmarked(bookmarks.some((bookmark) => bookmark.verse_ref === bookmarkRef));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [dataLayer, bookmarkRef]);

  const handleToggleBookmark = useCallback(async () => {
    if (bookmarked) {
      await dataLayer.removeBookmark(bookmarkRef);
      setBookmarked(false);
    } else {
      await dataLayer.saveBookmark(bookmarkRef, headerTitle);
      setBookmarked(true);
    }
  }, [bookmarked, bookmarkRef, headerTitle, dataLayer]);

  // ── Render ───────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={[styles.container, styles.centerLoading]}>
        <ActivityIndicator color={colors.accentMuted} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* ── Reading header ─────────────────────────────────────────── */}
      <View style={styles.readingHeader}>
        <Pressable
          onPress={onBack}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Back to browse"
        >
          <Text style={styles.backText}>← Browse</Text>
        </Pressable>
        <Text style={styles.headerTitle}>{headerTitle}</Text>
        <View style={styles.headerActions}>
          {isScripture && onNavigateChapter ? (
            <ChapterNavButtons
              mode={mode}
              onNavigate={onNavigateChapter}
            />
          ) : null}
          <BookmarkButton
            bookmarked={bookmarked}
            onPress={handleToggleBookmark}
          />
        </View>
      </View>

      {/* ── Passage list ────────────────────────────────────────────── */}
      <FlatList
        ref={scrollRef}
        data={passages}
        keyExtractor={(item, idx) => `${item.id}-${idx}`}
        contentContainerStyle={listContentContainer}
        renderItem={({ item: passage }) => {
          const ref = verseRefFor(passage);
          const highlight = highlightMap[ref];
          const annotation = annotationMap[ref];
          const xrefs = crossRefs[ref] ?? [];

          return (
            <View style={styles.verseBlock}>
              <Pressable
                onLongPress={() => setActiveVerseRef(ref)}
                delayLongPress={350}
              >
                <View
                  style={[
                    styles.verseContent,
                    highlight ? { backgroundColor: highlight + '33' } : null,
                  ]}
                >
                  {isScripture && passage.verse_start != null && (
                    <Text style={styles.verseNumber}>
                      {passage.verse_start}
                      {passage.verse_end != null &&
                      passage.verse_end !== passage.verse_start
                        ? `–${passage.verse_end}`
                        : ''}
                    </Text>
                  )}
                  <Text style={[styles.verseText, { fontSize: fontSizeMap[fontSize] || 17 }]}>{passage.text}</Text>
                </View>
              </Pressable>

              {annotation ? (
                <View style={styles.annotationWrap}>
                  <Text style={styles.annotationText}>{annotation}</Text>
                </View>
              ) : null}

              {xrefs.length > 0 && (
                <CrossReferenceLinks refs={xrefs} onPress={handleCrossRefPress} />
              )}
              <View style={styles.sendToJournalRow}>
                <SendToJournalButton quote={passage.text} source={ref} />
              </View>
            </View>
          );
        }}
        ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
      />

      {/* ── Highlight toolbar ───────────────────────────────────────── */}
      {activeVerseRef && (
        <View style={styles.toolbarWrap}>
          <HighlightToolbar
            verseRef={activeVerseRef}
            currentColor={highlightMap[activeVerseRef]}
            onApply={handleApplyHighlight}
            onAddNote={handleOpenAnnotation}
            onClear={handleClearHighlight}
            onDismiss={() => setActiveVerseRef(null)}
          />
        </View>
      )}

      {/* ── Annotation modal ─────────────────────────────────────────── */}
      <Modal
        visible={annotationModal !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setAnnotationModal(null)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.annotationOverlay}
        >
          <View style={styles.annotationSheet}>
            <Text style={styles.annotationTitle}>
              {annotationModal?.ref}
            </Text>
            <TextInput
              style={styles.annotationInput}
              value={annotationDraft}
              onChangeText={setAnnotationDraft}
              placeholder="A quiet note…"
              placeholderTextColor={colors.placeholder}
              multiline
              autoFocus
              textAlignVertical="top"
            />
            <View style={styles.annotationButtons}>
              <Pressable
                onPress={() => setAnnotationModal(null)}
                style={styles.cancelBtn}
              >
                <Text style={styles.cancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={handleSaveAnnotation}
                style={styles.saveBtn}
              >
                <Text style={styles.saveText}>Save</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

// ── Chapter navigation buttons ─────────────────────────────────────────────

function ChapterNavButtons({
  mode,
  onNavigate,
}: {
  mode: Extract<ReadingMode, { kind: 'scripture' }>;
  onNavigate: (bookName: string, chapter: number) => void;
}): ReactNode {
  const prevCh = mode.chapter > 1 ? mode.chapter - 1 : 0;
  const nextCh =
    mode.chapter < mode.totalChapters ? mode.chapter + 1 : 0;

  return (
    <View style={styles.chapterNav}>
      {prevCh > 0 ? (
        <Pressable
          onPress={() => onNavigate(mode.bookName, prevCh)}
          hitSlop={4}
          accessibilityRole="button"
          accessibilityLabel="Previous chapter"
        >
          <Text style={styles.chapterNavText}>‹</Text>
        </Pressable>
      ) : (
        <View style={{ width: 20 }} />
      )}
      <Text style={styles.chapterPos}>
        {mode.chapter} / {mode.totalChapters}
      </Text>
      {nextCh > 0 ? (
        <Pressable
          onPress={() => onNavigate(mode.bookName, nextCh)}
          hitSlop={4}
          accessibilityRole="button"
          accessibilityLabel="Next chapter"
        >
          <Text style={styles.chapterNavText}>›</Text>
        </Pressable>
      ) : (
        <View style={{ width: 20 }} />
      )}
    </View>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  centerLoading: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  readingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: layout.screenPaddingX,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  backText: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 14,
    color: colors.accent,
  },
  headerTitle: {
    fontFamily: fontFamilies.serifSemibold,
    fontSize: 18,
    color: colors.textPrimary,
    flex: 1,
    textAlign: 'center',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: spacing.md,
    minWidth: 96,
  },
  chapterNav: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  chapterNavText: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 22,
    color: colors.accent,
  },
  chapterPos: {
    fontFamily: fontFamilies.sans,
    fontSize: 12,
    color: colors.textTertiary,
  },
  verseBlock: {
    paddingHorizontal: 0,
  },
  verseContent: {
    flexDirection: 'row',
    borderRadius: radii.sm,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xs,
  },
  verseNumber: {
    fontFamily: fontFamilies.sans,
    fontSize: 10,
    color: colors.textTertiary,
    marginTop: 4,
    marginRight: 6,
    minWidth: 20,
    textAlign: 'right',
  },
  verseText: {
    ...serifText,
    flex: 1,
    color: colors.textPrimary,
  },
  annotationWrap: {
    marginLeft: 30,
    marginTop: spacing.xs,
    paddingLeft: spacing.md,
    borderLeftWidth: 2,
    borderLeftColor: colors.border,
  },
  annotationText: {
    fontFamily: fontFamilies.serifItalic,
    fontStyle: 'italic',
    fontSize: 14,
    lineHeight: 20,
    color: colors.textSecondary,
  },
  toolbarWrap: {
    position: 'absolute',
    bottom: spacing.lg,
    left: layout.screenPaddingX,
    right: layout.screenPaddingX,
  },
  annotationOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.3)',
    padding: spacing.xl,
  },
  annotationSheet: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: spacing.xl,
    width: '100%',
    maxWidth: 400,
  },
  annotationTitle: {
    fontFamily: fontFamilies.sansSemibold,
    fontSize: 13,
    letterSpacing: 0.4,
    color: colors.textTertiary,
    marginBottom: spacing.sm,
  },
  annotationInput: {
    fontFamily: fontFamilies.serif,
    fontSize: 16,
    lineHeight: 24,
    color: colors.textPrimary,
    minHeight: 80,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radii.sm,
    padding: spacing.md,
    backgroundColor: colors.background,
  },
  annotationButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.md,
    marginTop: spacing.md,
  },
  cancelBtn: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  cancelText: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 15,
    color: colors.textSecondary,
  },
  saveBtn: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.accent,
    borderRadius: radii.sm,
  },
  saveText: {
    fontFamily: fontFamilies.sansSemibold,
    fontSize: 15,
    color: colors.surface,
  },
  sendToJournalRow: {
    marginTop: spacing.xs,
    paddingLeft: spacing.xs,
  },
});
