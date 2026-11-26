/**
 * Reading view — the sacred reading surface.
 *
 * Renders Scripture verses or Library passages in serif with verse numbers
 * as superscripts. Includes:
 *   - Quiet top header with back navigation (`← Books` / `← Library`) and title
 *   - Android hardware BackHandler support
 *   - Platform-aware bottom action bar (flush docked flex footer on Native,
 *     fixed flush above BottomTabBar on Web — zero gap!)
 *   - Dedicated Highlight Mode bar (color swatches, Note, Remove Highlight, Done)
 *   - Batched, non-blocking cross-references & memoized virtualized rows
 */

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  ActivityIndicator,
  BackHandler,
  FlatList,
  Platform,
  Pressable,
  SectionList,
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
  resolveBibleBookName,
  type Translation,
  type VersePassage,
  type LibraryPassage,
  type LibraryBook,
  type Highlight,
} from '@resonance/core';
import { useDataLayer } from '@resonance/core/data-layer-context';
import {
  BookmarkButton,
  ChapterPicker,
  ChevronLeftIcon,
  HighlightPill,
  HighlightToggleButton,
  NoteModal,
  TranslationSelector,
} from '@resonance/ui';
import { CrossRefInline } from './CrossRefInline';

// ── Types & Helpers ─────────────────────────────────────────────────────────

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

const FONT_SIZE_MAP: Record<string, number> = {
  small: 15,
  medium: 17,
  large: 19,
};

/** Minimum 44px touch target size (Apple HIG / Material). */
const TOUCH_MIN = 44;

const ListSeparator = () => <View style={styles.separator} />;

export type ReadingMode =
  | {
      kind: 'scripture';
      bookName: string;
      chapter: number;
      translation: Translation;
      totalChapters: number;
    }
  | { kind: 'library'; bookId: string };

interface ReadingViewProps {
  mode: ReadingMode;
  onChangeTranslation?: (t: Translation) => void;
  onNavigateChapter?: (bookName: string, chapter: number, verse?: number) => void;
  onBack: () => void;
  /** Optional: scroll to this verse number after load (deep linking). */
  initialVerse?: number;
}

// ── Memoized Verse / Passage Row ────────────────────────────────────────────

interface VerseRowProps {
  passage: VersePassage | LibraryPassage;
  verseRef: string;
  isScripture: boolean;
  fontSizePx: number;
  highlight?: Highlight;
  highlightMode: boolean;
  isRangeStart: boolean;
  isActiveTarget: boolean;
  noteExpanded: boolean;
  crossRefList?: string[];
  onVerseTap: (ref: string) => void;
  onToggleNote: (ref: string) => void;
  onEditNote: (ref: string, highlight: Highlight, quoteText: string) => void;
  onLoadCrossRefs: (refs: string[]) => Promise<Record<string, string[]>>;
  onNavigateCrossRef: (ref: string) => void;
}

const VerseRow = memo(function VerseRow({
  passage,
  verseRef,
  isScripture,
  fontSizePx,
  highlight,
  highlightMode,
  isRangeStart,
  isActiveTarget,
  noteExpanded,
  crossRefList,
  onVerseTap,
  onToggleNote,
  onEditNote,
  onLoadCrossRefs,
  onNavigateCrossRef,
}: VerseRowProps): ReactNode {
  const hasNote = Boolean(highlight?.note_text && highlight.note_text.trim().length > 0);
  const lineHeight = Math.round(fontSizePx * 1.6);

  return (
    <View style={styles.verseBlock}>
      <Pressable
        onPress={() => onVerseTap(verseRef)}
        disabled={!highlightMode}
      >
        <View
          style={[
            styles.verseContent,
            highlight ? { backgroundColor: highlight.color + '33' } : null,
            isRangeStart && styles.verseRangeStart,
            isActiveTarget && !isRangeStart && styles.verseActiveTarget,
            highlightMode && !highlight && !isRangeStart && !isActiveTarget && styles.verseHighlightable,
          ]}
        >
          {isScripture && passage.verse_start != null && (
            <Text selectable={false} style={styles.verseNumber}>
              {passage.verse_start}
              {passage.verse_end != null &&
              passage.verse_end !== passage.verse_start
                ? `–${passage.verse_end}`
                : ''}
            </Text>
          )}
          <Text
            selectable={!highlightMode}
            style={[
              styles.verseText,
              { fontSize: fontSizePx, lineHeight },
              highlightMode && styles.noSelect,
            ]}
          >
            {passage.text}
          </Text>
        </View>
      </Pressable>

      {hasNote && highlight ? (
        <View style={styles.noteChip}>
          <Pressable
            onPress={() => onToggleNote(verseRef)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={noteExpanded ? 'Collapse note' : 'Expand note'}
          >
            <Text style={styles.noteToggle}>
              {noteExpanded ? '▾' : '▸'} note
            </Text>
          </Pressable>

          {noteExpanded ? (
            <Pressable
              onPress={() => onEditNote(verseRef, highlight, passage.text)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="View or edit note"
            >
              <Text style={styles.noteChipText} numberOfLines={6}>
                {highlight.note_text}
              </Text>
              {highlight.note_updated_at ? (
                <Text style={styles.noteChipTimestamp}>
                  {formatNoteDate(highlight.note_updated_at)}
                </Text>
              ) : null}
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {isScripture ? (
        <CrossRefInline
          verseRef={verseRef}
          refs={crossRefList}
          loadRefs={onLoadCrossRefs}
          onNavigate={onNavigateCrossRef}
        />
      ) : null}
    </View>
  );
});

// ── Main Component ──────────────────────────────────────────────────────────

export function ReadingView({
  mode,
  onNavigateChapter,
  onChangeTranslation,
  onBack,
  initialVerse,
}: ReadingViewProps): ReactNode {
  const [passages, setPassages] = useState<(VersePassage | LibraryPassage)[]>([]);
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
  const [activeTarget, setActiveTarget] = useState<string | null>(null);

  // ── Note modal ───────────────────────────────────────────────────────
  const [noteModal, setNoteModal] = useState<{
    highlight: Highlight;
    verseRef: string;
    quoteContext: string | null;
  } | null>(null);

  const [expandedNotes, setExpandedNotes] = useState<Set<string>>(new Set());
  const [chapterPickerOpen, setChapterPickerOpen] = useState(false);
  const [librarySection, setLibrarySection] = useState(0);

  const isScripture = mode.kind === 'scripture';
  const scrollRef = useRef<FlatList<VersePassage | LibraryPassage>>(null);
  const sectionScrollRef = useRef<SectionList<VersePassage | LibraryPassage>>(null);
  const dataLayer = useDataLayer();

  // ── Hardware Back Button (Android) ───────────────────────────────────
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (noteModal !== null) {
        setNoteModal(null);
        return true;
      }
      if (chapterPickerOpen) {
        setChapterPickerOpen(false);
        return true;
      }
      if (highlightMode) {
        setHighlightMode(false);
        setRangeStart(null);
        setActiveTarget(null);
        return true;
      }
      onBack();
      return true;
    });
    return () => sub.remove();
  }, [noteModal, chapterPickerOpen, highlightMode, onBack]);

  // ── Load passages on mount / when mode changes ───────────────────────
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setPassages([]);
    setCrossRefs({});
    setHighlights([]);
    setHighlightMode(false);
    setRangeStart(null);
    setActiveTarget(null);
    setExpandedNotes(new Set());
    setLibrarySection(0);
    if (mode.kind === 'scripture') {
      setLibraryBook(null);
    }

    const loadData = async () => {
      try {
        let resultPassages: (VersePassage | LibraryPassage)[] = [];
        let verseRefs: string[] = [];

        if (mode.kind === 'scripture') {
          resultPassages = await dataLayer.getVerses(
            mode.bookName,
            mode.chapter,
            mode.translation
          );
          // Merge verse chunks with same verse_start into one continuous verse block.
          if (resultPassages.length > 0) {
            const merged = new Map<number, VersePassage>();
            for (const p of resultPassages as VersePassage[]) {
              const key = p.verse_start ?? 0;
              const existing = merged.get(key);
              if (existing) {
                existing.text = existing.text + ' ' + p.text;
                if (
                  p.verse_end != null &&
                  (existing.verse_end == null || p.verse_end > existing.verse_end)
                ) {
                  existing.verse_end = p.verse_end;
                }
              } else {
                merged.set(key, { ...p });
              }
            }
            resultPassages = Array.from(merged.values()).sort(
              (a, b) => (a.verse_start ?? 0) - (b.verse_start ?? 0)
            );
          }
          verseRefs = resultPassages.map((p) =>
            scriptureRef(mode.bookName, mode.chapter, p.verse_start, p.verse_end)
          );
        } else {
          // Load passages and book metadata in parallel
          const [libPassages, book] = await Promise.all([
            dataLayer.getLibraryPassages(mode.bookId),
            dataLayer.getLibraryBook(mode.bookId),
          ]);
          resultPassages = libPassages;
          if (!cancelled) setLibraryBook(book);
        }

        if (cancelled) return;

        // Paint reading text immediately — highlights & cross-refs follow non-blocking.
        setPassages(resultPassages);
        setLoading(false);

        const refsToLoad =
          mode.kind === 'scripture'
            ? verseRefs
            : resultPassages.map((p) => String(p.id));

        if (refsToLoad.length > 0) {
          dataLayer
            .getHighlightsForRefs(refsToLoad)
            .then((hl) => {
              if (!cancelled) setHighlights(hl);
            })
            .catch(() => {});

          // Single batched cross-reference lookup (never N-per-verse!)
          if (mode.kind === 'scripture' && verseRefs.length > 0) {
            dataLayer
              .getCrossReferencesBatch(verseRefs)
              .then((xrefMap) => {
                if (!cancelled) setCrossRefs(xrefMap);
              })
              .catch(() => {});
          }
        }
      } catch (err) {
        console.error('[ReadingView] load failed:', err);
        if (!cancelled) {
          setPassages([]);
          setLoading(false);
        }
      }
    };

    void loadData();
    return () => {
      cancelled = true;
    };
  }, [mode, dataLayer]);

  // ── Record reading event (both Scripture and Library, fire-and-forget) ──
  useEffect(() => {
    if (mode.kind === 'scripture') {
      const ref = `${mode.bookName} ${mode.chapter}`;
      dataLayer
        .recordReadingEvent(mode.bookName, mode.chapter, ref, Date.now())
        .catch(() => {});
    } else if (libraryBook) {
      const ref = libraryBook.title ?? mode.bookId;
      dataLayer
        .recordReadingEvent(mode.bookId, librarySection + 1, ref, Date.now())
        .catch(() => {});
    }
  }, [mode, libraryBook, librarySection, dataLayer]);

  // ── Load saved font size ─────────────────────────────────────────────
  useEffect(() => {
    dataLayer
      .getSettings()
      .then((settings) => {
        if (settings?.fontSize) setFontSize(settings.fontSize);
      })
      .catch(() => {});
  }, [dataLayer]);

  // ── Scroll to initial verse (or top on chapter change) ───────────────
  const scrolledKeyRef = useRef<string | null>(null);
  const modeScrollKey =
    mode.kind === 'scripture'
      ? `s:${mode.bookName}:${mode.chapter}:${initialVerse ?? ''}`
      : `l:${mode.bookId}`;

  useEffect(() => {
    if (loading || !isScripture || passages.length === 0) return;
    if (scrolledKeyRef.current === modeScrollKey) return;
    scrolledKeyRef.current = modeScrollKey;

    if (initialVerse != null) {
      const idx = passages.findIndex((p) => p.verse_start === initialVerse);
      if (idx > 0) {
        setTimeout(() => {
          scrollRef.current?.scrollToIndex({
            index: idx,
            animated: false,
            viewPosition: 0.1,
          });
        }, 80);
        return;
      }
    }
    scrollRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, [loading, isScripture, passages, initialVerse, modeScrollKey]);

  // Scroll Library SectionList back to top when switching sections
  useEffect(() => {
    if (isScripture || loading) return;
    try {
      sectionScrollRef.current?.scrollToLocation({
        sectionIndex: 0,
        itemIndex: 0,
        animated: false,
        viewOffset: 0,
      });
    } catch {
      // ignore if list is empty or not laid out yet
    }
  }, [librarySection, isScripture, loading]);

  // ── Helpers & Memoized Lookups ───────────────────────────────────────

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

  // O(1) highlight map by verse_ref
  const highlightMap = useMemo(() => {
    const map = new Map<string, Highlight>();
    for (const h of highlights) {
      map.set(h.verse_ref, h);
    }
    return map;
  }, [highlights]);

  const indexOfRef = useCallback(
    (ref: string): number => passages.findIndex((p) => verseRefFor(p) === ref),
    [passages, verseRefFor]
  );

  const loadCrossRefsBatch = useCallback(
    (refs: string[]) => dataLayer.getCrossReferencesBatch(refs),
    [dataLayer]
  );

  const handleCrossRefPress = useCallback(
    (ref: string) => {
      if (!onNavigateChapter) return;
      const match = ref.match(/^(.+?)\s+(\d+):(\d+)/);
      if (!match) return;
      const resolvedBook = resolveBibleBookName(match[1].trim()) ?? match[1].trim();
      const chapter = parseInt(match[2], 10);
      const verse = parseInt(match[3], 10);
      if (!resolvedBook || isNaN(chapter)) return;
      onNavigateChapter(resolvedBook, chapter, isNaN(verse) ? undefined : verse);
    },
    [onNavigateChapter]
  );

  // ── Highlighting & Notes ─────────────────────────────────────────────

  const applyRangeHighlight = useCallback(
    async (startRef: string, endRef: string) => {
      const startIdx = indexOfRef(startRef);
      const endIdx = indexOfRef(endRef);
      if (startIdx < 0 || endIdx < 0) return;

      const lo = Math.min(startIdx, endIdx);
      const hi = Math.max(startIdx, endIdx);

      const refsToSave: Array<{ ref: string; text: string; existingNote: string | null }> = [];
      const now = new Date().toISOString();

      setHighlights((prev) => {
        const nextMap = new Map<string, Highlight>();
        for (const h of prev) nextMap.set(h.verse_ref, h);

        for (let i = lo; i <= hi; i++) {
          const r = verseRefFor(passages[i]);
          const verseText = passages[i].text;
          const prevHl = nextMap.get(r);
          refsToSave.push({
            ref: r,
            text: verseText,
            existingNote: prevHl?.note_text ?? null,
          });
          nextMap.set(r, {
            id: prevHl?.id ?? `opt-${Date.now()}-${i}`,
            verse_ref: r,
            color: activeColor,
            start_offset: 0,
            end_offset: verseText.length,
            selected_text: verseText,
            note_text: prevHl?.note_text ?? null,
            note_updated_at: prevHl?.note_updated_at ?? null,
            created_at: prevHl?.created_at ?? now,
            updated_at: now,
          });
        }
        return Array.from(nextMap.values());
      });

      // Persist and replace optimistic opt-* IDs with real persisted Highlight rows
      try {
        const savedRows = await Promise.all(
          refsToSave.map((item) =>
            dataLayer.saveHighlight({
              verseRef: item.ref,
              color: activeColor,
              startOffset: 0,
              endOffset: item.text.length,
              selectedText: item.text,
              noteText: item.existingNote,
            })
          )
        );
        setHighlights((prev) => {
          const nextMap = new Map<string, Highlight>();
          for (const h of prev) nextMap.set(h.verse_ref, h);
          for (const saved of savedRows) {
            if (saved && saved.verse_ref) {
              nextMap.set(saved.verse_ref, saved);
            }
          }
          return Array.from(nextMap.values());
        });
      } catch (err) {
        console.error('[ReadingView] range highlight save failed:', err);
      }
    },
    [passages, activeColor, verseRefFor, indexOfRef, dataLayer]
  );

  const handleVerseTap = useCallback(
    (ref: string) => {
      if (!highlightMode) return;

      if (rangeStart === null) {
        setRangeStart(ref);
        setActiveTarget(ref);
      } else if (rangeStart === ref) {
        void applyRangeHighlight(ref, ref);
        setRangeStart(null);
      } else {
        void applyRangeHighlight(rangeStart, ref);
        setRangeStart(null);
        setActiveTarget(rangeStart);
      }
    },
    [highlightMode, rangeStart, applyRangeHighlight]
  );

  const handleDeleteActiveHighlight = useCallback(async () => {
    if (!activeTarget) return;
    const existing = highlightMap.get(activeTarget);
    if (!existing) return;

    setHighlights((prev) => prev.filter((h) => h.verse_ref !== activeTarget));
    setRangeStart(null);

    if (existing.id && !existing.id.startsWith('opt-')) {
      try {
        await dataLayer.deleteHighlight(existing.id);
      } catch (err) {
        console.error('[ReadingView] delete highlight failed:', err);
      }
    }
  }, [activeTarget, highlightMap, dataLayer]);

  const handleAnnotate = useCallback(() => {
    if (!activeTarget) return;
    const existing = highlightMap.get(activeTarget);
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
  }, [activeTarget, highlightMap, passages, verseRefFor, activeColor]);

  const handleEditNote = useCallback(
    (ref: string, highlight: Highlight, quoteText: string) => {
      setNoteModal({
        highlight,
        verseRef: ref,
        quoteContext: quoteText,
      });
    },
    []
  );

  const handleToggleNote = useCallback((ref: string) => {
    setExpandedNotes((prev) => {
      const next = new Set(prev);
      if (next.has(ref)) next.delete(ref);
      else next.add(ref);
      return next;
    });
  }, []);

  const handleNoteSave = useCallback(
    async (text: string) => {
      if (!noteModal) return;
      const { highlight, verseRef, quoteContext } = noteModal;

      setNoteModal(null);

      if (text.length === 0 && !highlight.note_text) return;

      const hasPersistedId =
        Boolean(highlight.id) &&
        highlight.id !== '' &&
        !highlight.id.startsWith('opt-');

      // Optimistic update
      const now = new Date().toISOString();
      setHighlights((prev) => {
        const exists = prev.some((h) => h.verse_ref === verseRef);
        if (exists) {
          return prev.map((h) =>
            h.verse_ref === verseRef
              ? { ...h, note_text: text || null, note_updated_at: text ? now : null }
              : h
          );
        }
        return prev;
      });

      try {
        if (hasPersistedId) {
          const updated = await dataLayer.updateHighlight(highlight.id, {
            noteText: text || null,
          });
          setHighlights((prev) =>
            prev.map((h) => (h.verse_ref === verseRef ? updated : h))
          );
        } else {
          const passage = passages.find((p) => verseRefFor(p) === verseRef);
          const verseText = passage?.text ?? quoteContext ?? '';
          const created = await dataLayer.saveHighlight({
            verseRef,
            color: highlight.color || activeColor,
            startOffset: 0,
            endOffset: verseText.length,
            selectedText: verseText,
            noteText: text || null,
          });
          setHighlights((prev) => [
            ...prev.filter((h) => h.verse_ref !== verseRef),
            created,
          ]);
        }
        if (text.length > 0) {
          setExpandedNotes((prev) => {
            const next = new Set(prev);
            next.add(verseRef);
            return next;
          });
        }
      } catch (err) {
        console.error('[ReadingView] note save failed:', err);
      }
    },
    [noteModal, dataLayer, activeColor, passages, verseRefFor]
  );

  const handleNoteDelete = useCallback(async () => {
    if (!noteModal) return;
    const { highlight, verseRef } = noteModal;
    setNoteModal(null);

    if (!highlight.id || highlight.id.startsWith('opt-')) return;

    setHighlights((prev) =>
      prev.map((h) =>
        h.verse_ref === verseRef
          ? { ...h, note_text: null, note_updated_at: null }
          : h
      )
    );

    try {
      await dataLayer.updateHighlight(highlight.id, { noteText: null });
    } catch (err) {
      console.error('[ReadingView] note delete failed:', err);
    }
  }, [noteModal, dataLayer]);

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
      (p) =>
        'division' in p &&
        typeof p.division === 'string' &&
        p.division.trim().length > 0
    );

    if (hasDivisions) {
      const sections: { title: string; data: (VersePassage | LibraryPassage)[] }[] = [];
      let currentTitle: string | null = null;
      let currentData: (VersePassage | LibraryPassage)[] = [];

      for (const p of passages) {
        const div: string =
          'division' in p &&
          typeof p.division === 'string' &&
          p.division.trim().length > 0
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

  const safeSectionIdx =
    librarySections.length > 0
      ? Math.min(librarySection, librarySections.length - 1)
      : 0;
  const totalLibrarySections = librarySections.length;
  const canPrevSection = safeSectionIdx > 0;
  const canNextSection = safeSectionIdx < totalLibrarySections - 1;
  const sectionTitles = useMemo(
    () => librarySections.map((s) => s.title),
    [librarySections]
  );

  // ── Title & Bookmarks ────────────────────────────────────────────────

  const headerTitle = useMemo(() => {
    if (mode.kind === 'scripture') {
      return `${mode.bookName} ${mode.chapter}`;
    }
    return libraryBook?.title ?? 'Reading';
  }, [mode, libraryBook]);

  const headerSubtitle = useMemo(() => {
    if (mode.kind === 'scripture') return null;
    return libraryBook?.author ?? null;
  }, [mode, libraryBook]);

  const bookmarkRef = useMemo(() => {
    if (mode.kind === 'scripture') {
      return `${mode.bookName} ${mode.chapter}`;
    }
    return libraryBook?.title ?? mode.bookId;
  }, [mode, libraryBook]);

  const bookmarkLabel = useMemo(() => {
    if (mode.kind === 'scripture') return headerTitle;
    return headerSubtitle ? `${headerTitle} — ${headerSubtitle}` : headerTitle;
  }, [mode, headerTitle, headerSubtitle]);

  useEffect(() => {
    let cancelled = false;
    dataLayer
      .getBookmarks()
      .then((bookmarks) => {
        if (!cancelled) {
          setBookmarked(
            bookmarks.some((bookmark) => bookmark.verse_ref === bookmarkRef)
          );
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [dataLayer, bookmarkRef]);

  const handleToggleBookmark = useCallback(async () => {
    const next = !bookmarked;
    setBookmarked(next);
    try {
      if (next) {
        await dataLayer.saveBookmark(bookmarkRef, bookmarkLabel);
      } else {
        await dataLayer.removeBookmark(bookmarkRef);
      }
    } catch {
      setBookmarked(!next);
    }
  }, [bookmarked, bookmarkRef, bookmarkLabel, dataLayer]);

  // ── Derived Display Values ───────────────────────────────────────────

  const prevChapter = isScripture && mode.chapter > 1 ? mode.chapter - 1 : 0;
  const nextChapter =
    isScripture && mode.chapter < mode.totalChapters ? mode.chapter + 1 : 0;
  const fontSizePx = FONT_SIZE_MAP[fontSize] || 17;
  const activeTargetHighlight = activeTarget ? highlightMap.get(activeTarget) : undefined;

  const highlightHint = rangeStart
    ? 'Tap another verse for a range, or tap again for one verse'
    : activeTarget
      ? 'Verse selected — pick a color, add a note, or remove'
      : 'Tap a verse to highlight, or tap two for a range';

  // ── RenderItem Callbacks ─────────────────────────────────────────────

  const renderPassageItem = useCallback(
    ({ item: passage }: { item: VersePassage | LibraryPassage }) => {
      const ref = verseRefFor(passage);
      return (
        <VerseRow
          passage={passage}
          verseRef={ref}
          isScripture={isScripture}
          fontSizePx={fontSizePx}
          highlight={highlightMap.get(ref)}
          highlightMode={highlightMode}
          isRangeStart={highlightMode && rangeStart === ref}
          isActiveTarget={highlightMode && activeTarget === ref}
          noteExpanded={expandedNotes.has(ref)}
          crossRefList={crossRefs[ref]}
          onVerseTap={handleVerseTap}
          onToggleNote={handleToggleNote}
          onEditNote={handleEditNote}
          onLoadCrossRefs={loadCrossRefsBatch}
          onNavigateCrossRef={handleCrossRefPress}
        />
      );
    },
    [
      verseRefFor,
      isScripture,
      fontSizePx,
      highlightMap,
      highlightMode,
      rangeStart,
      activeTarget,
      expandedNotes,
      crossRefs,
      handleVerseTap,
      handleToggleNote,
      handleEditNote,
      loadCrossRefsBatch,
      handleCrossRefPress,
    ]
  );

  // ── Render ───────────────────────────────────────────────────────────

  return (
    <View style={styles.container}>
      {/* ── Quiet top header: exit button + title ────────────────────── */}
      <View style={styles.topHeader}>
        <Pressable
          onPress={onBack}
          hitSlop={8}
          style={({ pressed }) => [styles.backBtn, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={isScripture ? 'Back to Books' : 'Back to Library'}
        >
          <ChevronLeftIcon size={18} color={colors.accent} />
          <Text style={styles.backBtnText}>
            {isScripture ? 'Books' : 'Library'}
          </Text>
        </Pressable>

        <View style={styles.topTitleWrap}>
          <Text style={styles.topTitle} numberOfLines={1}>
            {headerTitle}
          </Text>
          {headerSubtitle ? (
            <Text style={styles.topSubtitle} numberOfLines={1}>
              {headerSubtitle}
            </Text>
          ) : null}
        </View>

        <View style={styles.topHeaderSpacer} />
      </View>

      {/* ── Reading body ─────────────────────────────────────────────── */}
      {loading ? (
        <View style={[styles.passageList, styles.centerLoading]}>
          <ActivityIndicator color={colors.accentMuted} />
        </View>
      ) : isScripture ? (
        <FlatList
          ref={scrollRef}
          data={passages}
          keyExtractor={(item) => String(item.id)}
          style={styles.passageList}
          contentContainerStyle={[
            listContentContainer,
            Platform.OS === 'web'
              ? styles.passageListContentWeb
              : styles.passageListContentNative,
          ]}
          renderItem={renderPassageItem}
          ItemSeparatorComponent={ListSeparator}
          initialNumToRender={20}
          maxToRenderPerBatch={15}
          windowSize={9}
          onScrollToIndexFailed={(info) => {
            scrollRef.current?.scrollToOffset({
              offset: info.averageItemLength * info.index,
              animated: false,
            });
          }}
        />
      ) : (
        <SectionList
          ref={sectionScrollRef}
          style={styles.passageList}
          sections={[
            librarySections[safeSectionIdx] ?? { title: 'Opening', data: [] },
          ]}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={[
            listContentContainer,
            Platform.OS === 'web'
              ? styles.passageListContentWeb
              : styles.passageListContentNative,
          ]}
          renderSectionHeader={({ section: { title } }) => (
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionHeaderText}>{title}</Text>
            </View>
          )}
          renderItem={renderPassageItem}
          ItemSeparatorComponent={ListSeparator}
          initialNumToRender={16}
          maxToRenderPerBatch={12}
          windowSize={9}
          stickySectionHeadersEnabled={false}
        />
      )}

      {/* ── Bottom action chrome (flush docked on native, fixed above nav on web) ── */}
      <View
        style={[
          styles.bottomChrome,
          Platform.OS === 'web' ? styles.bottomChromeWeb : styles.bottomChromeNative,
        ]}
      >
        {highlightMode ? (
          <>
            <Text style={styles.highlightHint} numberOfLines={1}>
              {highlightHint}
            </Text>
            <View style={styles.highlightRow}>
              <HighlightPill
                active
                activeColor={activeColor}
                onSelectColor={setActiveColor}
                onAnnotate={handleAnnotate}
                hasSelection={activeTarget !== null}
                hasHighlight={Boolean(activeTargetHighlight)}
                onDeleteHighlight={() => void handleDeleteActiveHighlight()}
                onDismiss={handleExitHighlight}
              />
            </View>
          </>
        ) : (
          <View style={styles.bottomNav}>
            {/* Chapter / section navigation */}
            {isScripture ? (
              <View style={styles.chapterNav}>
                {prevChapter > 0 ? (
                  <Pressable
                    onPress={() => onNavigateChapter?.(mode.bookName, prevChapter)}
                    hitSlop={6}
                    accessibilityRole="button"
                    accessibilityLabel="Previous chapter"
                    style={[
                      styles.chapterNavBtn,
                      { minWidth: TOUCH_MIN, minHeight: TOUCH_MIN },
                    ]}
                  >
                    <Text style={styles.chapterNavArrow}>‹</Text>
                    <Text style={styles.chapterNavCh}>Ch</Text>
                  </Pressable>
                ) : (
                  <View style={styles.chapterNavPlaceholder} />
                )}

                <Pressable
                  onPress={() => setChapterPickerOpen(true)}
                  hitSlop={6}
                  accessibilityRole="button"
                  accessibilityLabel="Open chapter picker"
                  style={styles.chapterPosBtn}
                >
                  <Text style={styles.chapterPos}>
                    {mode.chapter} / {mode.totalChapters}
                  </Text>
                </Pressable>

                {nextChapter > 0 ? (
                  <Pressable
                    onPress={() => onNavigateChapter?.(mode.bookName, nextChapter)}
                    hitSlop={6}
                    accessibilityRole="button"
                    accessibilityLabel="Next chapter"
                    style={[
                      styles.chapterNavBtn,
                      { minWidth: TOUCH_MIN, minHeight: TOUCH_MIN },
                    ]}
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
                    onPress={() =>
                      setLibrarySection((prev) => Math.max(0, prev - 1))
                    }
                    hitSlop={6}
                    accessibilityRole="button"
                    accessibilityLabel="Previous section"
                    style={[
                      styles.chapterNavBtn,
                      { minWidth: TOUCH_MIN, minHeight: TOUCH_MIN },
                    ]}
                  >
                    <Text style={styles.chapterNavArrow}>‹</Text>
                  </Pressable>
                ) : (
                  <View style={styles.chapterNavPlaceholder} />
                )}

                <Pressable
                  onPress={() => {
                    if (totalLibrarySections > 1) setChapterPickerOpen(true);
                  }}
                  disabled={totalLibrarySections <= 1}
                  hitSlop={6}
                  accessibilityRole="button"
                  accessibilityLabel="Open section picker"
                  style={styles.chapterPosBtn}
                >
                  <Text style={styles.chapterPos}>
                    {totalLibrarySections > 0
                      ? `${safeSectionIdx + 1} / ${totalLibrarySections}`
                      : '—'}
                  </Text>
                </Pressable>

                {canNextSection ? (
                  <Pressable
                    onPress={() =>
                      setLibrarySection((prev) =>
                        Math.min(totalLibrarySections - 1, prev + 1)
                      )
                    }
                    hitSlop={6}
                    accessibilityRole="button"
                    accessibilityLabel="Next section"
                    style={[
                      styles.chapterNavBtn,
                      { minWidth: TOUCH_MIN, minHeight: TOUCH_MIN },
                    ]}
                  >
                    <Text style={styles.chapterNavArrow}>›</Text>
                  </Pressable>
                ) : (
                  <View style={styles.chapterNavPlaceholder} />
                )}
              </View>
            )}

            {/* Right tools */}
            <View style={styles.toolsRow}>
              {isScripture && onChangeTranslation ? (
                <TranslationSelector
                  value={mode.translation}
                  onChange={onChangeTranslation}
                  placement="bottom"
                />
              ) : null}

              <HighlightToggleButton
                active={false}
                onPress={handleToggleHighlight}
              />

              <BookmarkButton
                bookmarked={bookmarked}
                onPress={handleToggleBookmark}
              />
            </View>
          </View>
        )}
      </View>

      {/* ── Chapter / Section picker modal ───────────────────────────── */}
      {isScripture ? (
        <ChapterPicker
          visible={chapterPickerOpen}
          onClose={() => setChapterPickerOpen(false)}
          totalChapters={mode.totalChapters}
          currentChapter={mode.chapter}
          bookName={mode.bookName}
          onSelect={(ch) => onNavigateChapter?.(mode.bookName, ch)}
        />
      ) : (
        <ChapterPicker
          visible={chapterPickerOpen}
          onClose={() => setChapterPickerOpen(false)}
          totalChapters={totalLibrarySections}
          currentChapter={safeSectionIdx + 1}
          bookName={headerTitle}
          sectionTitles={sectionTitles}
          onSelect={(sec) => setLibrarySection(Math.max(0, sec - 1))}
        />
      )}

      {/* ── Note modal ───────────────────────────────────────────────── */}
      <NoteModal
        visible={noteModal !== null}
        verseRef={noteModal?.verseRef ?? ''}
        quoteContext={noteModal?.quoteContext ?? null}
        initialText={noteModal?.highlight.note_text ?? ''}
        isEdit={Boolean(
          noteModal?.highlight.id &&
            noteModal.highlight.id !== '' &&
            !noteModal.highlight.id.startsWith('opt-')
        )}
        onSave={handleNoteSave}
        onDelete={handleNoteDelete}
        onClose={() => setNoteModal(null)}
      />
    </View>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  pressed: {
    opacity: 0.6,
  },
  // ── Quiet top header ────────────────────────────────────────────────────
  topHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    minHeight: 48,
    backgroundColor: colors.background,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    minHeight: TOUCH_MIN,
    minWidth: 74,
    paddingRight: spacing.sm,
  },
  backBtnText: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 14,
    color: colors.accent,
  },
  topTitleWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
  },
  topTitle: {
    fontFamily: fontFamilies.serifSemibold,
    fontSize: 18,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  topSubtitle: {
    fontFamily: fontFamilies.sans,
    fontSize: 11.5,
    color: colors.textTertiary,
    textAlign: 'center',
  },
  topHeaderSpacer: {
    minWidth: 74,
  },
  // ── Passage list ────────────────────────────────────────────────────────
  centerLoading: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  passageList: {
    flex: 1,
  },
  passageListContentNative: {
    paddingBottom: spacing.xl,
  },
  passageListContentWeb: {
    // Space for the fixed bottom chrome + web bottom tab bar
    paddingBottom: 140,
  },
  separator: {
    height: spacing.sm,
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
    borderLeftWidth: 2,
    borderLeftColor: colors.border,
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
    marginTop: 5,
    marginRight: 6,
    minWidth: 22,
    textAlign: 'right',
  },
  verseText: {
    ...serifText,
    flex: 1,
    color: colors.textPrimary,
  },
  noSelect: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  // ── Bottom chrome ───────────────────────────────────────────────────────
  bottomChrome: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
    paddingTop: 6,
    paddingBottom: 6,
  },
  bottomChromeNative: {
    // Standard flex-docked footer — sits 100% flush above React Navigation tab bar
  },
  bottomChromeWeb: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    position: 'fixed' as any,
    bottom: 60,
    left: 0,
    right: 0,
    zIndex: 240,
  },
  bottomNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
  },
  chapterNav: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  chapterNavBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.sm,
  },
  chapterNavPlaceholder: {
    width: TOUCH_MIN,
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
  chapterPosBtn: {
    minWidth: TOUCH_MIN,
    minHeight: TOUCH_MIN,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.xs,
  },
  chapterPos: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 13,
    color: colors.textSecondary,
  },
  toolsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  highlightHint: {
    fontFamily: fontFamilies.sans,
    fontSize: 11.5,
    color: colors.textTertiary,
    textAlign: 'center',
    paddingHorizontal: spacing.md,
    paddingBottom: 4,
  },
  highlightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  sectionHeader: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    marginBottom: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  sectionHeaderText: {
    fontFamily: fontFamilies.serifSemibold,
    fontSize: 17,
    color: colors.textSecondary,
  },
});
