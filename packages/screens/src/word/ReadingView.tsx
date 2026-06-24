/**
 * Reading view — the sacred reading surface.
 *
 * Renders Scripture verses or Library passages in serif with verse numbers
 * as superscripts. A highlight-mode toggle (floating pill) lets the reader
 * tap pairs of verses to highlight a range, or annotate selected verses.
 * Cross-references appear as quiet marginal links after verses.
 *
 * Bottom chrome is fixed to the viewport so navigation and tools are
 * always accessible regardless of scroll position.
 *
 * (design spec §6.3 — highlight, annotate, bookmark, cross-references;
 *  §6.1 — translation selector and chapter nav)
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
  SectionList,
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
  type AnnotationNote,
  type AnnotationMap,
} from '@resonance/core';
import { useDataLayer } from '@resonance/core/data-layer-context';
import { HighlightPill } from '@resonance/ui';
import { ChapterPicker } from '@resonance/ui';
import { TranslationSelector } from '@resonance/ui';
import { BookmarkButton } from '@resonance/ui';
import { CrossRefInline } from './CrossRefInline';

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
  /** Optional: scroll to this verse number after load (deep linking). */
  initialVerse?: number;
}

// ── Component ───────────────────────────────────────────────────────────────

export function ReadingView({
  mode,
  onNavigateChapter,
  onChangeTranslation,
  onBack,
  initialVerse,
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

  // ── Highlight-mode toggle + range selection ──────────────────────────
  const [highlightMode, setHighlightMode] = useState(false);
  const [activeColor, setActiveColor] = useState<string>(colors.highlightGold);
  const [rangeStart, setRangeStart] = useState<string | null>(null);
  /** The currently "selected" verse for annotation — persists after highlight completes. */
  const [activeTarget, setActiveTarget] = useState<string | null>(null);

  // ── Annotation modal ─────────────────────────────────────────────────
  const [annotationModal, setAnnotationModal] = useState<{
    ref: string;
    noteId?: string;
    text: string;
  } | null>(null);
  const [annotationDraft, setAnnotationDraft] = useState('');

  // Collapsible annotations — hidden by default, tap to reveal
  const [expandedAnnotations, setExpandedAnnotations] = useState<Set<string>>(new Set());

  // Chapter picker
  const [chapterPickerOpen, setChapterPickerOpen] = useState(false);

  // Library section nav
  const [librarySection, setLibrarySection] = useState(0);

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
    setExpandedAnnotations(new Set());
    setHighlightMode(false);
    setRangeStart(null);
    setActiveTarget(null);

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
        // Merge verse chunks: clauses with same verse_start become one continuous block.
        if (resultPassages.length > 0) {
          const merged = new Map<number, VersePassage>();
          for (const p of resultPassages as VersePassage[]) {
            const key = p.verse_start ?? 0;
            const existing = merged.get(key);
            if (existing) {
              existing.text = existing.text + ' ' + p.text;
              if (p.verse_end != null && (existing.verse_end == null || p.verse_end > existing.verse_end)) {
                existing.verse_end = p.verse_end;
              }
            } else {
              merged.set(key, { ...p });
            }
          }
          resultPassages = Array.from(merged.values()).sort((a, b) => (a.verse_start ?? 0) - (b.verse_start ?? 0));
        }
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
      const refsToLoad: string[] = [];
      if (mode.kind === 'scripture') {
        refsToLoad.push(...verseRefs);
      } else {
        refsToLoad.push(...resultPassages.map((p) => String(p.id)));
      }

      if (refsToLoad.length > 0) {
        Promise.all([
          dataLayer.getHighlightsForRefs(refsToLoad),
          dataLayer.getAnnotationsForRefs(refsToLoad, mode.kind === 'scripture' ? mode.translation : 'WEB'),
        ]).then(([hMap, aMap]) => {
          if (!cancelled) {
            setHighlightMap(hMap);
            setAnnotationMap(aMap);
          }
        }).catch(() => {});

        // 4. Load cross-references in background (non-blocking)
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

  // ── Scroll to initial verse on load ──────────────────────────────────
  const scrolledToInitial = useRef(false);
  useEffect(() => {
    if (!loading && initialVerse != null && !scrolledToInitial.current && isScripture) {
      const idx = passages.findIndex((p) => p.verse_start === initialVerse);
      if (idx >= 0) {
        setTimeout(() => {
          scrollRef.current?.scrollToIndex({ index: idx, animated: false, viewPosition: 0.1 });
        }, 100);
      }
      scrolledToInitial.current = true;
    }
  }, [loading, initialVerse, passages, isScripture]);

  // ── Helpers ──────────────────────────────────────────────────────────────

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
      return String(passage.id);
    },
    [mode]
  );

  // Find index of a ref in the passages array
  const indexOfRef = useCallback(
    (ref: string): number => {
      return passages.findIndex((p) => verseRefFor(p) === ref);
    },
    [passages, verseRefFor]
  );

  const handleCrossRefPress = useCallback(
    (ref: string) => {
      if (!onNavigateChapter) return;
      const match = ref.match(/^(.+?)\s+(\d+):/);
      if (!match) return;
      const bookName = match[1].trim();
      const chapter = parseInt(match[2], 10);
      if (!bookName || isNaN(chapter)) return;
      onNavigateChapter(bookName, chapter);
    },
    [onNavigateChapter]
  );

  // ── Range highlight ─────────────────────────────────────────────────────

  const applyRangeHighlight = useCallback(
    async (startRef: string, endRef: string) => {
      const startIdx = indexOfRef(startRef);
      const endIdx = indexOfRef(endRef);
      if (startIdx < 0 || endIdx < 0) return;

      const lo = Math.min(startIdx, endIdx);
      const hi = Math.max(startIdx, endIdx);

      // Optimistic: update all verses in range immediately
      const newMap: HighlightMap = { ...highlightMap };
      const refs: string[] = [];
      for (let i = lo; i <= hi; i++) {
        const r = verseRefFor(passages[i]);
        newMap[r] = activeColor;
        refs.push(r);
      }
      setHighlightMap(newMap);

      // Persist in background
      try {
        await Promise.all(refs.map((r) => dataLayer.saveHighlight(r, activeColor)));
      } catch (err) {
        console.error('[ReadingView] range highlight save failed:', err);
      }
    },
    [passages, highlightMap, activeColor, verseRefFor, indexOfRef, dataLayer]
  );

  const handleVerseTap = useCallback(
    (ref: string) => {
      if (!highlightMode) return;

      if (rangeStart === null) {
        // First tap — set range start + active target
        setRangeStart(ref);
        setActiveTarget(ref);
      } else if (rangeStart === ref) {
        // Same verse tapped again — highlight single verse
        applyRangeHighlight(ref, ref);
        setRangeStart(null);
        // activeTarget stays on this verse so ✏️ works
      } else {
        // Second tap on different verse — complete the range
        applyRangeHighlight(rangeStart, ref);
        setRangeStart(null);
        // Keep activeTarget on the first verse of the range
        setActiveTarget(rangeStart);
      }
    },
    [highlightMode, rangeStart, applyRangeHighlight]
  );

  // ── Annotation ──────────────────────────────────────────────────────────

  const handleAnnotate = useCallback(() => {
    if (!activeTarget) return;
    // Open modal for a NEW note on the active target
    setAnnotationDraft('');
    setAnnotationModal({ ref: activeTarget, text: '' });
  }, [activeTarget]);

  const handleEditNote = useCallback((ref: string, noteId: string, text: string) => {
    setAnnotationDraft(text);
    setAnnotationModal({ ref, noteId, text });
  }, []);

  const handleSaveAnnotation = useCallback(async () => {
    if (!annotationModal) return;
    const { ref, noteId } = annotationModal;
    const text = annotationDraft.trim();
    if (text.length === 0) {
      if (!noteId) return; // Don't save empty new notes
    }

    const isEdit = !!noteId;

    // Optimistic update
    setAnnotationMap((prev) => {
      const next = { ...prev };
      const existing = [...(next[ref] || [])];

      if (isEdit) {
        // Update existing note
        const idx = existing.findIndex((n) => n.id === noteId);
        if (idx >= 0) {
          if (text.length > 0) {
            existing[idx] = { ...existing[idx], text };
          } else {
            existing.splice(idx, 1); // Empty text = delete
          }
        }
      } else {
        // Append new note (optimistic ID)
        existing.push({
          id: 'pending-' + Date.now(),
          text,
          created_at: new Date().toISOString(),
        });
      }

      next[ref] = existing;
      if (existing.length === 0) delete next[ref];
      return next;
    });

    setAnnotationModal(null);
    setExpandedAnnotations((prev) => {
      const next = new Set(prev);
      next.add(ref);
      return next;
    });

    // Persist in background
    try {
      if (isEdit) {
        if (text.length > 0) {
          await dataLayer.updateAnnotation(noteId, text);
        } else {
          await dataLayer.deleteAnnotation(noteId);
        }
      } else {
        await dataLayer.saveAnnotation(ref, translation, text);
      }
    } catch (err) {
      console.error('[ReadingView] saveAnnotation failed:', err);
    }
  }, [annotationModal, annotationDraft, translation, dataLayer]);

  const handleDeleteNote = useCallback(async (ref: string, noteId: string) => {
    // Optimistic removal
    setAnnotationMap((prev) => {
      const next = { ...prev };
      const existing = (next[ref] || []).filter((n) => n.id !== noteId);
      if (existing.length > 0) {
        next[ref] = existing;
      } else {
        delete next[ref];
      }
      return next;
    });

    // Persist in background
    try {
      await dataLayer.deleteAnnotation(noteId);
    } catch (err) {
      console.error('[ReadingView] deleteNote failed:', err);
    }
  }, [dataLayer]);

  // ── Toggle highlight mode ───────────────────────────────────────────────

  const handleToggleHighlight = useCallback(() => {
    setHighlightMode((prev) => !prev);
    setRangeStart(null);
    setActiveTarget(null);
  }, []);

  const handleExitHighlight = useCallback(() => {
    setHighlightMode(false);
    setRangeStart(null);
    setActiveTarget(null);
  }, []);

  // ── Library sections (pseudo-chapters, batches of 25) ──────────────────
  const librarySections = useMemo(() => {
    if (isScripture || passages.length === 0) return [];
    const batchSize = 25;
    const sections: { title: string; data: (VersePassage | LibraryPassage)[] }[] = [];
    for (let i = 0; i < passages.length; i += batchSize) {
      const part = sections.length + 1;
      sections.push({
        title: `Part ${part}`,
        data: passages.slice(i, i + batchSize),
      });
    }
    return sections;
  }, [isScripture, passages]);

  const totalLibrarySections = librarySections.length;
  const canPrevSection = librarySection > 0;
  const canNextSection = librarySection < totalLibrarySections - 1;

  // ── Title / header ──────────────────────────────────────────────────────

  const headerTitle = useMemo(() => {
    if (mode.kind === 'scripture') {
      return `${mode.bookName} ${mode.chapter}`;
    }
    if (libraryBook) {
      const parts = [libraryBook.title ?? 'Reading'];
      if (libraryBook.author) parts.push(libraryBook.author);
      return parts.join(' — ');
    }
    return 'Reading';
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

  // ── Chapter nav state ───────────────────────────────────────────────────

  const prevChapter = isScripture && mode.chapter > 1 ? mode.chapter - 1 : 0;
  const nextChapter = isScripture && mode.chapter < mode.totalChapters ? mode.chapter + 1 : 0;

  const fontSizeMap: Record<string, number> = { small: 15, medium: 17, large: 19 };

  // ── Derive display values ────────────────────────────────────────────────

  const rangeStartLabel = rangeStart ?? undefined;
  /** Minimum 44px touch target size (Apple HIG). */
  const TOUCH_MIN = 44;

  // ── Render ───────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={[styles.container, styles.centerLoading]}>
        <ActivityIndicator color={colors.accentMuted} />
      </View>
    );
  }

  /** Render annotation notes for a verse ref. */
  const renderAnnotations = (ref: string) => {
    const notes = annotationMap[ref];
    if (!notes || notes.length === 0) return null;

    const isExpanded = expandedAnnotations.has(ref);
    const noteCount = notes.length;

    return (
      <View style={styles.annotationWrap}>
        <Pressable
          onPress={() => {
            setExpandedAnnotations((prev) => {
              const next = new Set(prev);
              if (next.has(ref)) next.delete(ref);
              else next.add(ref);
              return next;
            });
          }}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={isExpanded ? 'Collapse notes' : `Expand ${noteCount} note${noteCount > 1 ? 's' : ''}`}
        >
          <Text style={styles.annotationToggle}>
            {isExpanded ? '▾' : '▸'} {noteCount > 1 ? `${noteCount} notes` : 'note'}
          </Text>
        </Pressable>

        {isExpanded ? (
          <View style={styles.notesList}>
            {notes.map((note) => (
              <View key={note.id} style={styles.noteCard}>
                <View style={styles.noteContent}>
                  <Text style={styles.annotationText}>{note.text}</Text>
                  <Text style={styles.noteTimestamp}>
                    {formatNoteDate(note.created_at)}
                  </Text>
                </View>
                <View style={styles.noteActions}>
                  <Pressable
                    onPress={() => handleEditNote(ref, note.id, note.text)}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel="Edit note"
                    style={styles.noteActionBtn}
                  >
                    <Text style={styles.noteActionIcon}>✏️</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => handleDeleteNote(ref, note.id)}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel="Delete note"
                    style={styles.noteActionBtn}
                  >
                    <Text style={styles.noteActionIcon}>✕</Text>
                  </Pressable>
                </View>
              </View>
            ))}
          </View>
        ) : null}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {/* ── Reading header (context only) ─────────────────────────────── */}
      <View style={styles.readingHeader}>
        <Pressable
          onPress={onBack}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Back to browse"
        >
          <Text style={styles.backText}>← Browse</Text>
        </Pressable>

        {isScripture && onChangeTranslation ? (
          <TranslationSelector
            value={mode.translation}
            onChange={onChangeTranslation}
          />
        ) : null}

        <Text style={styles.headerTitle}>{headerTitle}</Text>

        {/* Spacer to balance the row (back + translation on left) */}
        <View style={styles.headerSpacer} />
      </View>

      {/* ── Passage list ────────────────────────────────────────────── */}
      {isScripture ? (
        <FlatList
          ref={scrollRef}
          data={passages}
          keyExtractor={(item, idx) => `${item.id}-${idx}`}
          style={styles.passageList}
          contentContainerStyle={[listContentContainer, styles.passageListContent]}
          renderItem={({ item: passage }) => {
            const ref = verseRefFor(passage);
            const highlight = highlightMap[ref];
            const isActiveTarget = highlightMode && activeTarget === ref;
            const isRangeStart = highlightMode && rangeStart === ref;
            const hasAnnotations = annotationMap[ref] && annotationMap[ref].length > 0;

            return (
              <View style={styles.verseBlock}>
                <Pressable
                  onPress={() => handleVerseTap(ref)}
                  disabled={!highlightMode}
                >
                  <View
                    style={[
                      styles.verseContent,
                      highlight ? { backgroundColor: highlight + '33' } : null,
                      isRangeStart && styles.verseRangeStart,
                      isActiveTarget && !isRangeStart && styles.verseActiveTarget,
                      highlightMode && styles.verseHighlightable,
                    ]}
                  >
                    {isScripture && passage.verse_start != null && (
                      <Text
                        selectable={false}
                        style={styles.verseNumber}
                      >
                        {passage.verse_start}
                        {passage.verse_end != null &&
                        passage.verse_end !== passage.verse_start
                          ? `–${passage.verse_end}`
                          : ''}
                      </Text>
                    )}
                    <Text
                      selectable={false}
                      style={[styles.verseText, { fontSize: fontSizeMap[fontSize] || 17 }]}
                    >
                      {passage.text}
                    </Text>
                  </View>
                </Pressable>

                {renderAnnotations(ref)}

                <CrossRefInline
                  verseRef={ref}
                  cache={crossRefs}
                  loadRefs={async (refs: string[]) => dataLayer.getCrossReferencesBatch(refs)}
                  onNavigate={handleCrossRefPress}
                />
              </View>
            );
          }}
          ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
        />
      ) : (
        <SectionList
          style={styles.passageList}
          sections={[librarySections[librarySection] ?? { title: 'Part 1', data: [] }]}
          keyExtractor={(item, idx) => `${item.id}-${idx}`}
          contentContainerStyle={[listContentContainer, styles.passageListContent]}
          renderSectionHeader={({ section: { title } }) => (
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionHeaderText}>{title}</Text>
            </View>
          )}
          renderItem={({ item: passage }) => {
            const ref = verseRefFor(passage);
            const highlight = highlightMap[ref];
            const isActiveTarget = highlightMode && activeTarget === ref;
            const isRangeStart = highlightMode && rangeStart === ref;

            return (
              <View style={styles.verseBlock}>
                <Pressable
                  onPress={() => handleVerseTap(ref)}
                  disabled={!highlightMode}
                >
                  <View
                    style={[
                      styles.verseContent,
                      highlight ? { backgroundColor: highlight + '33' } : null,
                      isRangeStart && styles.verseRangeStart,
                      isActiveTarget && !isRangeStart && styles.verseActiveTarget,
                      highlightMode && styles.verseHighlightable,
                    ]}
                  >
                    <Text
                      selectable={false}
                      style={[styles.verseText, { fontSize: fontSizeMap[fontSize] || 17 }]}
                    >
                      {passage.text}
                    </Text>
                  </View>
                </Pressable>

                {renderAnnotations(ref)}
              </View>
            );
          }}
          ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
        />
      )}

      {/* ── Bottom chrome: fixed pill + nav bar ───────────────────────── */}
      <View style={styles.bottomChrome}>
        {/* Floating tool pill */}
        <View style={styles.pillContainer}>
          <HighlightPill
            active={highlightMode}
            activeColor={activeColor}
            rangeStartLabel={rangeStartLabel}
            onToggle={handleToggleHighlight}
            onSelectColor={setActiveColor}
            onAnnotate={handleAnnotate}
            onDismiss={handleExitHighlight}
          />
        </View>

        {/* Bottom navigation bar */}
        <View style={styles.bottomNav}>
          {/* Chapter / section navigation */}
          {isScripture ? (
            <View style={styles.chapterNav}>
              {prevChapter > 0 ? (
                <Pressable
                  onPress={() => onNavigateChapter?.(mode.bookName, prevChapter)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Previous chapter"
                  style={[styles.chapterNavBtn, { minWidth: TOUCH_MIN, minHeight: TOUCH_MIN }]}
                >
                  <Text style={styles.chapterNavText}>◀</Text>
                  <Text style={styles.chapterNavLabel}>Ch</Text>
                </Pressable>
              ) : (
                <View style={styles.chapterNavPlaceholder} />
              )}

              <Pressable
                onPress={() => setChapterPickerOpen(true)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Open chapter picker"
                style={{ minWidth: TOUCH_MIN, minHeight: TOUCH_MIN, justifyContent: 'center', alignItems: 'center' }}
              >
                <Text style={styles.chapterPos}>
                  {mode.chapter} / {mode.totalChapters}
                </Text>
              </Pressable>

              {nextChapter > 0 ? (
                <Pressable
                  onPress={() => onNavigateChapter?.(mode.bookName, nextChapter)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Next chapter"
                  style={[styles.chapterNavBtn, { minWidth: TOUCH_MIN, minHeight: TOUCH_MIN }]}
                >
                  <Text style={styles.chapterNavText}>▶</Text>
                  <Text style={styles.chapterNavLabel}>Ch</Text>
                </Pressable>
              ) : (
                <View style={styles.chapterNavPlaceholder} />
              )}
            </View>
          ) : (
            <View style={styles.chapterNav}>
              {canPrevSection ? (
                <Pressable
                  onPress={() => setLibrarySection((prev) => Math.max(0, prev - 1))}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Previous section"
                  style={[styles.chapterNavBtn, { minWidth: TOUCH_MIN, minHeight: TOUCH_MIN }]}
                >
                  <Text style={styles.chapterNavText}>◀</Text>
                </Pressable>
              ) : (
                <View style={styles.chapterNavPlaceholder} />
              )}
              <Text style={styles.chapterPos}>
                {librarySection + 1} / {totalLibrarySections}
              </Text>
              {canNextSection ? (
                <Pressable
                  onPress={() => setLibrarySection((prev) => Math.min(totalLibrarySections - 1, prev + 1))}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Next section"
                  style={[styles.chapterNavBtn, { minWidth: TOUCH_MIN, minHeight: TOUCH_MIN }]}
                >
                  <Text style={styles.chapterNavText}>▶</Text>
                </Pressable>
              ) : (
                <View style={styles.chapterNavPlaceholder} />
              )}
            </View>
          )}

          {/* Bookmark */}
          <BookmarkButton
            bookmarked={bookmarked}
            onPress={handleToggleBookmark}
          />
        </View>
      </View>

      {/* ── Chapter picker modal ────────────────────────────────────── */}
      {isScripture ? (
        <ChapterPicker
          visible={chapterPickerOpen}
          onClose={() => setChapterPickerOpen(false)}
          totalChapters={mode.totalChapters}
          currentChapter={mode.chapter}
          bookName={mode.bookName}
          onSelect={(ch) => onNavigateChapter?.(mode.bookName, ch)}
        />
      ) : null}

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
              {annotationModal?.noteId ? 'Edit note' : 'New note'} — {annotationModal?.ref}
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

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatNoteDate(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
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
    paddingVertical: spacing.sm,
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
  headerSpacer: {
    width: 60,
  },
  passageList: {
    flex: 1,
  },
  passageListContent: {
    paddingBottom: 120, // room for fixed bottom chrome (~100px + breathing room)
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
  verseHighlightable: {
    // Subtle indicator that verses are tappable in highlight mode
  },
  verseRangeStart: {
    borderLeftWidth: 3,
    borderLeftColor: colors.accent,
    borderTopLeftRadius: radii.sm,
    borderBottomLeftRadius: radii.sm,
  },
  verseActiveTarget: {
    borderLeftWidth: 3,
    borderLeftColor: colors.textTertiary,
    borderTopLeftRadius: radii.sm,
    borderBottomLeftRadius: radii.sm,
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
    // Web-only CSS property to prevent native text selection
    // eslint-disable-next-line react-native/no-raw-text
    userSelect: 'none' as any,
  },
  // ── Annotations ────────────────────────────────────────────────────────
  annotationWrap: {
    marginLeft: 30,
    marginTop: spacing.xs,
    paddingLeft: spacing.sm,
    borderLeftWidth: 2,
    borderLeftColor: colors.border,
  },
  notesList: {
    marginTop: spacing.xs,
    gap: spacing.xs,
  },
  noteCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: spacing.xs,
  },
  noteContent: {
    flex: 1,
  },
  annotationText: {
    fontFamily: fontFamilies.serifItalic,
    fontStyle: 'italic',
    fontSize: 14,
    lineHeight: 20,
    color: colors.textSecondary,
  },
  noteTimestamp: {
    fontFamily: fontFamilies.sans,
    fontSize: 10,
    color: colors.textTertiary,
    marginTop: 2,
  },
  noteActions: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginLeft: spacing.sm,
    paddingTop: 2,
  },
  noteActionBtn: {
    width: 32,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: radii.sm,
  },
  noteActionIcon: {
    fontSize: 14,
  },
  annotationToggle: {
    fontFamily: fontFamilies.sans,
    fontSize: 11,
    color: colors.textTertiary,
    letterSpacing: 0.3,
    marginBottom: 2,
  },
  // ── Bottom chrome (fixed to viewport) ──────────────────────────────────
  bottomChrome: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 100,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
    paddingTop: spacing.xs,
    paddingBottom: spacing.sm,
  },
  pillContainer: {
    alignItems: 'flex-end',
    paddingHorizontal: layout.screenPaddingX,
    paddingBottom: spacing.xs,
  },
  bottomNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: layout.screenPaddingX,
    paddingVertical: spacing.sm,
  },
  chapterNav: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  chapterNavBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.xs,
  },
  chapterNavText: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 16,
    color: colors.accent,
  },
  chapterNavLabel: {
    fontFamily: fontFamilies.sans,
    fontSize: 11,
    color: colors.textTertiary,
    letterSpacing: 0.3,
  },
  chapterPos: {
    fontFamily: fontFamilies.sans,
    fontSize: 13,
    color: colors.textSecondary,
  },
  chapterNavPlaceholder: {
    width: 52,
  },
  // ── Modals ──────────────────────────────────────────────────────────
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
  sectionHeader: {
    paddingHorizontal: layout.screenPaddingX,
    paddingVertical: spacing.sm,
    marginTop: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  sectionHeaderText: {
    fontFamily: fontFamilies.sansSemibold,
    fontSize: 13,
    letterSpacing: 0.4,
    color: colors.textTertiary,
    textTransform: 'uppercase',
  },
});
