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
  Platform,
  Pressable,
  StyleSheet,
  Text,
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
  type Highlight,
} from '@resonance/core';
import { useDataLayer } from '@resonance/core/data-layer-context';
import { HighlightPill, HighlightToggleButton } from '@resonance/ui';
import { ChapterPicker } from '@resonance/ui';
import { TranslationSelector } from '@resonance/ui';
import { BookmarkButton } from '@resonance/ui';
import { NoteModal } from '@resonance/ui';
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
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [crossRefs, setCrossRefs] = useState<Record<string, string[]>>({});
  const [bookmarked, setBookmarked] = useState(false);
  const [fontSize, setFontSize] = useState<string>('medium');

  // ── Highlight-mode toggle + range selection ──────────────────────────
  const [highlightMode, setHighlightMode] = useState(false);
  const [activeColor, setActiveColor] = useState<string>(colors.highlightGold);
  const [rangeStart, setRangeStart] = useState<string | null>(null);
  /** The currently "selected" verse for annotation — persists after highlight completes. */
  const [activeTarget, setActiveTarget] = useState<string | null>(null);

  // ── Note modal (replaces old annotation modal) ────────────────────────
  const [noteModal, setNoteModal] = useState<{
    highlight: Highlight;
    verseRef: string;
    quoteContext: string | null;
  } | null>(null);

  // Collapsed notes — hidden by default, tap to reveal
  const [expandedNotes, setExpandedNotes] = useState<Set<string>>(new Set());

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
    setHighlights([]);
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

      // 3. Load highlights (includes notes via note_text on Highlight)
      const refsToLoad: string[] = [];
      if (mode.kind === 'scripture') {
        refsToLoad.push(...verseRefs);
      } else {
        refsToLoad.push(...resultPassages.map((p) => String(p.id)));
      }

      if (refsToLoad.length > 0) {
        dataLayer.getHighlightsForRefs(refsToLoad).then((hl) => {
          if (!cancelled) setHighlights(hl);
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

  // Find a highlight for a given verse ref (whole-verse lookup)
  const highlightForRef = useCallback(
    (ref: string): Highlight | undefined => {
      return highlights.find((h) => h.verse_ref === ref);
    },
    [highlights]
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
      const refs: string[] = [];
      const now = new Date().toISOString();
      const newHighlights = [...highlights];

      for (let i = lo; i <= hi; i++) {
        const r = verseRefFor(passages[i]);
        const verseText = passages[i].text;
        refs.push(r);

        // Remove any existing highlight for this ref
        const existingIdx = newHighlights.findIndex((h) => h.verse_ref === r);
        if (existingIdx >= 0) newHighlights.splice(existingIdx, 1);

        // Add optimistic highlight
        newHighlights.push({
          id: `opt-${Date.now()}-${i}`,
          verse_ref: r,
          color: activeColor,
          start_offset: 0,
          end_offset: verseText.length,
          selected_text: verseText,
          note_text: null,
          note_updated_at: null,
          created_at: now,
          updated_at: now,
        });
      }
      setHighlights(newHighlights);

      // Persist in background
      try {
        await Promise.all(
          refs.map((r) => {
            const passage = passages.find((p) => verseRefFor(p) === r);
            const verseText = passage?.text ?? '';
            return dataLayer.saveHighlight({
              verseRef: r,
              color: activeColor,
              startOffset: 0,
              endOffset: verseText.length,
              selectedText: verseText,
            });
          })
        );
      } catch (err) {
        console.error('[ReadingView] range highlight save failed:', err);
      }
    },
    [passages, highlights, activeColor, verseRefFor, indexOfRef, dataLayer]
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

  // ── Note on highlight ──────────────────────────────────────────────────

  const handleAnnotate = useCallback(() => {
    if (!activeTarget) return;
    const existing = highlightForRef(activeTarget);
    const passage = passages.find((p) => verseRefFor(p) === activeTarget);
    const quoteContext = passage?.text ?? null;

    setNoteModal({
      highlight: existing ?? {
        id: '',
        verse_ref: activeTarget,
        color: activeColor,
        start_offset: null,
        end_offset: null,
        selected_text: null,
        note_text: null,
        note_updated_at: null,
        created_at: '',
        updated_at: '',
      },
      verseRef: activeTarget,
      quoteContext,
    });
  }, [activeTarget, highlightForRef, passages, verseRefFor, activeColor]);

  const handleNoteSave = useCallback(async (text: string) => {
    if (!noteModal) return;
    const { highlight, verseRef, quoteContext } = noteModal;

    setNoteModal(null);

    if (text.length === 0 && !highlight.note_text) return; // nothing to save, nothing to clear

    const isEdit = !!highlight.id && highlight.id !== '';

    // Optimistic update
    setHighlights((prev) =>
      prev.map((h) => {
        if (isEdit && h.id === highlight.id) {
          return { ...h, note_text: text || null, note_updated_at: text ? new Date().toISOString() : null };
        }
        return h;
      })
    );

    // Persist
    try {
      if (isEdit) {
        await dataLayer.updateHighlight(highlight.id, { noteText: text || null });
      } else {
        // No highlight exists yet — create one with a note
        const passage = passages.find((p) => verseRefFor(p) === verseRef);
        const verseText = passage?.text ?? quoteContext ?? '';
        const created = await dataLayer.saveHighlight({
          verseRef,
          color: activeColor,
          startOffset: 0,
          endOffset: verseText.length,
          selectedText: verseText,
          noteText: text || null,
        });
        // Replace the optimistic entry
        setHighlights((prev) => [...prev.filter((h) => h.verse_ref !== verseRef), created]);
      }
    } catch (err) {
      console.error('[ReadingView] note save failed:', err);
    }
  }, [noteModal, dataLayer, activeColor, passages, verseRefFor]);

  const handleNoteDelete = useCallback(async () => {
    if (!noteModal) return;
    const { highlight } = noteModal;
    setNoteModal(null);

    if (!highlight.id) return;

    // Optimistic: clear the note but keep the highlight
    setHighlights((prev) =>
      prev.map((h) =>
        h.id === highlight.id ? { ...h, note_text: null, note_updated_at: null } : h
      )
    );

    try {
      await dataLayer.updateHighlight(highlight.id, { noteText: null });
    } catch (err) {
      console.error('[ReadingView] note delete failed:', err);
    }
  }, [noteModal, dataLayer]);

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

  // ── Library sections (real chapter/division headings when present, else 25-passage parts) ──
  const librarySections = useMemo(() => {
    if (isScripture || passages.length === 0) return [];

    const hasDivisions = passages.some(
      (p) => 'division' in p && typeof p.division === 'string' && p.division.trim().length > 0
    );

    if (hasDivisions) {
      const sections: { title: string; data: (VersePassage | LibraryPassage)[] }[] = [];
      let currentTitle: string | null = null;
      let currentData: (VersePassage | LibraryPassage)[] = [];

      for (const p of passages) {
        const div: string =
          'division' in p && typeof p.division === 'string' && p.division.trim().length > 0
            ? p.division.trim()
            : currentTitle ?? 'Opening';
        if (currentTitle !== null && div !== currentTitle && currentData.length > 0) {
          sections.push({ title: currentTitle, data: currentData });
          currentData = [];
        }
        currentTitle = div;
        currentData.push(p);
      }
      if (currentData.length > 0) {
        sections.push({ title: currentTitle ?? 'Section 1', data: currentData });
      }
      return sections;
    }

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

  /** Render a collapsed note toggle + expanded content for a verse that has an annotated highlight. */
  const renderHighlightNote = (ref: string) => {
    const hl = highlightForRef(ref);
    if (!hl || !hl.note_text || hl.note_text.trim().length === 0) return null;

    const isExpanded = expandedNotes.has(ref);

    return (
      <View style={styles.noteChip}>
        <Pressable
          onPress={() => {
            setExpandedNotes((prev) => {
              const next = new Set(prev);
              if (next.has(ref)) next.delete(ref);
              else next.add(ref);
              return next;
            });
          }}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={isExpanded ? 'Collapse note' : 'Expand note'}
        >
          <Text style={styles.noteToggle}>
            {isExpanded ? '▾' : '▸'} note
          </Text>
        </Pressable>

        {isExpanded ? (
          <Pressable
            onPress={() => {
              const passage = passages.find((p) => verseRefFor(p) === ref);
              setNoteModal({
                highlight: hl,
                verseRef: ref,
                quoteContext: passage?.text ?? null,
              });
            }}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="View or edit note"
          >
            <Text style={styles.noteChipText} numberOfLines={6}>
              {hl.note_text}
            </Text>
            {hl.note_updated_at ? (
              <Text style={styles.noteChipTimestamp}>
                {formatNoteDate(hl.note_updated_at)}
              </Text>
            ) : null}
          </Pressable>
        ) : null}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {/* ── Passage list (no top header — bottom chrome + tab bar handle nav) */}
      {isScripture ? (
        <FlatList
          ref={scrollRef}
          data={passages}
          keyExtractor={(item, idx) => `${item.id}-${idx}`}
          style={styles.passageList}
          contentContainerStyle={[listContentContainer, styles.passageListContent]}
          renderItem={({ item: passage }) => {
            const ref = verseRefFor(passage);
            const hl = highlightForRef(ref);
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
                      hl ? { backgroundColor: hl.color + '33' } : null,
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

                {renderHighlightNote(ref)}

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
            const hl = highlightForRef(ref);
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
                      hl ? { backgroundColor: hl.color + '33' } : null,
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

                {renderHighlightNote(ref)}
              </View>
            );
          }}
          ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
        />
      )}

      {/* ── Bottom chrome: chapter nav + tools, matching top header aesthetic ── */}
      <View style={styles.bottomChrome}>
        <View style={styles.bottomNav}>
          {/* Chapter / section navigation — clean text arrows, no emojis */}
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
                  <Text style={styles.chapterNavArrow}>‹</Text>
                  <Text style={styles.chapterNavCh}>Ch</Text>
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
                  <Text style={styles.chapterNavArrow}>›</Text>
                  <Text style={styles.chapterNavCh}>Ch</Text>
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
                  <Text style={styles.chapterNavArrow}>‹</Text>
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
                  <Text style={styles.chapterNavArrow}>›</Text>
                </Pressable>
              ) : (
                <View style={styles.chapterNavPlaceholder} />
              )}
            </View>
          )}

          {/* Translation selector (was in removed top header) */}
          {isScripture && onChangeTranslation ? (
            <TranslationSelector
              value={mode.translation}
              onChange={onChangeTranslation}
            />
          ) : null}

          {/* Highlighter — toggles inline */}
          {highlightMode ? (
            <View style={styles.highlightInline}>
              <HighlightPill
                active
                activeColor={activeColor}
                onSelectColor={setActiveColor}
                onAnnotate={handleAnnotate}
                onDismiss={handleExitHighlight}
              />
            </View>
          ) : (
            <HighlightToggleButton active={false} onPress={handleToggleHighlight} />
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

      {/* ── Note modal ───────────────────────────────────────────────── */}
      <NoteModal
        visible={noteModal !== null}
        verseRef={noteModal?.verseRef ?? ''}
        quoteContext={noteModal?.quoteContext ?? null}
        initialText={noteModal?.highlight.note_text ?? ''}
        isEdit={!!(noteModal?.highlight.id && noteModal.highlight.id !== '')}
        onSave={handleNoteSave}
        onDelete={handleNoteDelete}
        onClose={() => setNoteModal(null)}
      />
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
  passageList: {
    flex: 1,
  },
  passageListContent: {
    // Room for the fixed bottom chrome (which sits above the mobile tab bar).
    // When highlight mode is on the chrome expands to ~120px; on desktop with
    // no tab bar it's ~60px. 210 covers the worst case.
    paddingBottom: 210,
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
  // ── Highlight notes ─────────────────────────────────────────────────────
  noteChip: {
    marginLeft: 30,
    marginTop: spacing.xs,
    paddingLeft: spacing.sm,
    borderLeftWidth: 2,
    borderLeftColor: colors.accentMuted,
  },
  noteChipText: {
    fontFamily: fontFamilies.serifItalic,
    fontStyle: 'italic',
    fontSize: 14,
    lineHeight: 20,
    color: colors.textSecondary,
  },
  noteToggle: {
    fontFamily: fontFamilies.sans,
    fontSize: 12,
    color: colors.accent,
    marginBottom: spacing.xs,
  },
  noteChipTimestamp: {
    fontFamily: fontFamilies.sans,
    fontSize: 10,
    color: colors.textTertiary,
    marginTop: 2,
  },
  annotationToggle: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 12,
    color: colors.accent,
    marginBottom: spacing.xs,
  },
  // ── Bottom chrome ───────────────────────────────────────────────────────
  bottomChrome: {
    position: 'fixed' as any,
    bottom: 60,
    left: 0,
    right: 0,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
    paddingTop: 4,
    paddingBottom: 8,
    zIndex: 300,
  },
  bottomNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: layout.screenPaddingX,
  },
  chapterNav: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  chapterNavBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.sm,
  },
  chapterNavPlaceholder: {
    width: 48,
  },
  chapterNavArrow: {
    fontFamily: fontFamilies.serif,
    fontSize: 18,
    color: colors.accent,
    lineHeight: 20,
  },
  chapterNavCh: {
    fontFamily: fontFamilies.sans,
    fontSize: 10,
    color: colors.textTertiary,
    marginLeft: 2,
  },
  chapterPos: {
    fontFamily: fontFamilies.sans,
    fontSize: 13,
    color: colors.textSecondary,
  },
  highlightInline: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  sectionHeader: {
    paddingVertical: spacing.sm,
    paddingHorizontal: layout.screenPaddingX,
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  sectionHeaderText: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 13,
    color: colors.textTertiary,
  },
});
