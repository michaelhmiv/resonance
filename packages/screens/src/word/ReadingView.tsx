/**
 * ReadingView v2 — Resonance's book-grade contemplative reading surface.
 *
 * Capabilities:
 *   - In-reader `Aa` typography sheet (typeface, 14–28px size, line spacing,
 *     margins, alignment) on Resonance's signature warm cream paper
 *   - Rich block formatting (chapter headings, paragraphs, blockquotes, poetry,
 *     epigraphs, lists, ornamental dividers, inline tappable Scripture refs)
 *   - Scripture Reader Flow vs. Verse-by-Verse Study mode
 *   - Continuous vertical scroll with hierarchical TOC accordion drawer
 *     (Contents · Notes · Bookmarks) and exact per-book position resume
 *   - In-Book Find bar (Exact keyword + Semantic concept search) with chapter
 *     grouping and match highlighting
 *   - Zero-mode phrase highlighting (word/sentence snapping handles, 4 semantic
 *     colors, Fill/Underline styles, W3C durable anchors, collapsible margin notes
 *     with #tags) automatically embedded into Resonance vectors
 *   - Bidirectional `Echoes ✦` sheet showing resonant Journal entries, Highlights,
 *     Scripture, and Library Voices right from the page you're reading
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
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ViewToken,
} from 'react-native';

import {
  colors,
  fontFamilies,
  radii,
  readerPalette,
  spacing,
  withAlpha,
  type ReaderThemePalette,
} from '@resonance/theme';
import {
  DEFAULT_READER_PREFERENCES,
  buildScriptureBlocks,
  extractQuoteAffixes,
  formatPassageCitation,
  getSentenceRange,
  parseReaderPreferences,
  reconstructBookDocument,
  resolveBibleBookName,
  searchBlocksKeyword,
  serializeReaderPreferences,
  stepRangeByWord,
  type BookChapter,
  type Bookmark,
  type Highlight,
  type HighlightStyle,
  type InBookSearchHit,
  type LibraryBook,
  type LibraryPassage,
  type ReaderPreferences,
  type ReadingBlock,
  type ResonanceCard,
  type ResonanceResult,
  type TextRange,
  type Translation,
  type VersePassage,
} from '@resonance/core';
import { useDataLayer } from '@resonance/core/data-layer-context';
import {
  BookDrawerModal,
  BookmarkButton,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronUpIcon,
  ListIcon,
  NoteModal,
  PassageEchoesSheet,
  ReaderAppearanceSheet,
  RichBlockText,
  SearchIcon,
  SelectionActionBar,
  SparklesIcon,
  TranslationSelector,
  TypeIcon,
  XIcon,
  type BookDrawerTab,
} from '@resonance/ui';
import { CrossRefInline } from './CrossRefInline';

// ── Types & Helpers ─────────────────────────────────────────────────────────

const READER_PREFS_SETTING_KEY = 'reader_prefs_v2';
const TOUCH_MIN = 40;

function formatNoteDate(iso: string): string {
  try {
    const d = new Date(iso);
    const diff = Date.now() - d.getTime();
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

function resolveFontFamily(pref: ReaderPreferences['fontFamily']): string {
  if (pref === 'sans') return fontFamilies.sans;
  if (pref === 'serif') return Platform.OS === 'ios' ? 'Georgia' : 'serif';
  return fontFamilies.serif;
}

function resolveHorizontalPadding(margin: ReaderPreferences['margin']): number {
  if (margin === 'compact') return 14;
  if (margin === 'wide') return 30;
  return 22;
}

async function copyOrShareText(text: string): Promise<void> {
  if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // fall through
    }
  }
  try {
    await Share.share({ message: text });
  } catch {
    // dismissed
  }
}

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
  /** Optional: jump to another Library book (e.g. from Echoes sheet). */
  onOpenLibraryBook?: (bookId: string, passageId?: number) => void;
  onBack: () => void;
  /** Optional: scroll to this verse number after load (Scripture deep linking). */
  initialVerse?: number;
  /** Optional: scroll to this passage ID after load (Library deep linking). */
  initialPassageId?: number;
}

interface ActiveSelectionState {
  block: ReadingBlock;
  range: TextRange;
  existingHighlight: Highlight | null;
}

// ── Memoized Rich Reading Block Row ─────────────────────────────────────────

interface BlockRowProps {
  block: ReadingBlock;
  isScripture: boolean;
  scriptureFlow: boolean;
  prefs: ReaderPreferences;
  theme: ReaderThemePalette;
  highlights: Highlight[];
  activeSelectionRange: TextRange | null;
  searchQuery: string;
  isActiveSearchHit: boolean;
  expandedNoteIds: Set<string>;
  crossRefList?: string[];
  onSelectBlock: (block: ReadingBlock) => void;
  onPressHighlight: (block: ReadingBlock, highlight: Highlight) => void;
  onToggleNote: (highlightId: string) => void;
  onEditNote: (block: ReadingBlock, highlight: Highlight) => void;
  onLoadCrossRefs: (refs: string[]) => Promise<Record<string, string[]>>;
  onNavigateScriptureRef: (ref: string) => void;
}

const ReadingBlockRow = memo(function ReadingBlockRow({
  block,
  isScripture,
  scriptureFlow,
  prefs,
  theme,
  highlights,
  activeSelectionRange,
  searchQuery,
  isActiveSearchHit,
  expandedNoteIds,
  crossRefList,
  onSelectBlock,
  onPressHighlight,
  onToggleNote,
  onEditNote,
  onLoadCrossRefs,
  onNavigateScriptureRef,
}: BlockRowProps): ReactNode {
  const fontFamily = resolveFontFamily(prefs.fontFamily);
  const lineHeight = Math.round(prefs.fontSize * prefs.lineHeightMultiplier);
  const textAlign = prefs.align === 'justify' ? 'justify' : 'left';

  // Ornamental divider
  if (block.kind === 'divider') {
    return (
      <View style={styles.dividerBlock}>
        <Text style={[styles.dividerGlyph, { color: theme.accentMuted }]}>❦</Text>
      </View>
    );
  }

  // Book / Chapter Headings
  if (block.kind === 'h1' || block.kind === 'h2' || block.kind === 'h3' || block.kind === 'title') {
    const isMajor = block.kind === 'h1' || block.kind === 'title';
    return (
      <View
        style={[
          styles.headingBlock,
          isMajor && styles.headingBlockMajor,
          { borderBottomColor: theme.border },
        ]}
      >
        {isMajor ? (
          <View style={[styles.headingRule, { backgroundColor: theme.accentMuted }]} />
        ) : null}
        <Text
          style={[
            isMajor ? styles.h1Text : styles.h2Text,
            { color: theme.textPrimary },
          ]}
        >
          {block.text}
        </Text>
      </View>
    );
  }

  const annotatedHighlights = highlights.filter(
    (h) => h.note_text && h.note_text.trim().length > 0
  );

  const isSelectedBlock = activeSelectionRange !== null;

  const baseTextStyle = [
    {
      fontFamily:
        block.kind === 'blockquote' || block.kind === 'epigraph'
          ? fontFamilies.serifItalic
          : fontFamily,
      fontStyle:
        block.kind === 'blockquote' || block.kind === 'epigraph'
          ? ('italic' as const)
          : ('normal' as const),
      fontSize:
        block.kind === 'epigraph'
          ? Math.max(14, prefs.fontSize - 1)
          : prefs.fontSize,
      lineHeight,
      color:
        block.kind === 'blockquote' || block.kind === 'epigraph'
          ? theme.textSecondary
          : theme.textPrimary,
      textAlign: block.kind === 'epigraph' ? ('center' as const) : textAlign,
    },
  ];

  const verseLabel =
    isScripture && block.verseStart != null
      ? `${block.verseStart}${
          block.verseEnd != null && block.verseEnd !== block.verseStart
            ? `–${block.verseEnd}`
            : ''
        }`
      : null;

  const leadingVerseInline =
    isScripture && scriptureFlow && verseLabel ? (
      <Text
        style={{
          fontFamily: fontFamilies.sansSemibold,
          fontSize: Math.max(10, Math.round(prefs.fontSize * 0.58)),
          color: theme.accentMuted,
        }}
      >
        {`${verseLabel} `}
      </Text>
    ) : null;

  return (
    <View
      style={[
        styles.blockOuter,
        isScripture && scriptureFlow && styles.blockOuterFlow,
      ]}
    >
      <Pressable
        onPress={() => onSelectBlock(block)}
        onLongPress={() => onSelectBlock(block)}
        delayLongPress={220}
        style={[
          styles.blockInner,
          block.kind === 'blockquote' && [
            styles.blockquoteWrap,
            { borderLeftColor: theme.quoteBar },
          ],
          block.kind === 'poetry' && styles.poetryWrap,
          block.kind === 'epigraph' && styles.epigraphWrap,
          block.kind === 'list_item' && styles.listItemWrap,
          isSelectedBlock && {
            backgroundColor: withAlpha(theme.accent, 0.08),
            borderRadius: radii.sm,
          },
        ]}
      >
        {isScripture && !scriptureFlow && verseLabel ? (
          <Text
            selectable={false}
            style={[styles.verseMarginNum, { color: theme.textTertiary }]}
          >
            {verseLabel}
          </Text>
        ) : null}

        {block.kind === 'list_item' ? (
          <Text style={[styles.listBullet, { color: theme.accentMuted }]}>•</Text>
        ) : null}

        <View style={styles.blockTextCol}>
          <RichBlockText
            text={block.text}
            spans={block.spans}
            highlights={highlights}
            activeSelection={activeSelectionRange}
            searchQuery={searchQuery}
            isActiveSearchHit={isActiveSearchHit}
            theme={theme}
            baseTextStyle={baseTextStyle}
            leadingInline={leadingVerseInline}
            onPressHighlight={(hl) => onPressHighlight(block, hl)}
            onPressScriptureRef={onNavigateScriptureRef}
          />
        </View>
      </Pressable>

      {/* Collapsible Margin Note Accordions */}
      {annotatedHighlights.map((hl) => {
        const expanded = expandedNoteIds.has(hl.id);
        return (
          <View
            key={hl.id}
            style={[
              styles.noteAccordion,
              {
                borderLeftColor: hl.color,
                backgroundColor: withAlpha(hl.color, 0.09),
              },
            ]}
          >
            <Pressable
              onPress={() => onToggleNote(hl.id)}
              hitSlop={8}
              style={styles.noteAccordionHeader}
              accessibilityRole="button"
              accessibilityLabel={expanded ? 'Collapse margin note' : 'Expand margin note'}
            >
              <Text style={[styles.noteAccordionToggle, { color: theme.accent }]}>
                {expanded ? '▾ Margin note' : '▸ Margin note'}
              </Text>
              {hl.tags && hl.tags.length > 0 ? (
                <Text
                  style={[styles.noteAccordionTags, { color: theme.textTertiary }]}
                  numberOfLines={1}
                >
                  {hl.tags.map((t) => `#${t}`).join(' ')}
                </Text>
              ) : null}
            </Pressable>

            {expanded ? (
              <Pressable
                onPress={() => onEditNote(block, hl)}
                style={styles.noteAccordionBody}
                accessibilityRole="button"
                accessibilityLabel="Edit margin note"
              >
                <Text
                  style={[styles.noteAccordionText, { color: theme.textSecondary }]}
                >
                  {hl.note_text}
                </Text>
                {hl.note_updated_at ? (
                  <Text style={[styles.noteTimestamp, { color: theme.textTertiary }]}>
                    {formatNoteDate(hl.note_updated_at)} · Tap to edit
                  </Text>
                ) : null}
              </Pressable>
            ) : null}
          </View>
        );
      })}

      {/* Scripture Lazy Cross-References (in Study mode) */}
      {isScripture && !scriptureFlow ? (
        <CrossRefInline
          verseRef={block.anchorRef}
          refs={crossRefList}
          loadRefs={onLoadCrossRefs}
          onNavigate={onNavigateScriptureRef}
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
  onOpenLibraryBook,
  onBack,
  initialVerse,
  initialPassageId,
}: ReadingViewProps): ReactNode {
  const dataLayer = useDataLayer();
  const isScripture = mode.kind === 'scripture';

  // Document state
  const [blocks, setBlocks] = useState<ReadingBlock[]>([]);
  const [chapters, setChapters] = useState<BookChapter[]>([]);
  const [totalWords, setTotalWords] = useState(0);
  const [libraryBook, setLibraryBook] = useState<LibraryBook | null>(null);
  const [loading, setLoading] = useState(true);

  // Reading preferences (single signature warm cream paper palette)
  const [prefs, setPrefs] = useState<ReaderPreferences>(DEFAULT_READER_PREFERENCES);
  const theme: ReaderThemePalette = readerPalette;

  // Annotations, cross-refs, bookmarks
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [crossRefs, setCrossRefs] = useState<Record<string, string[]>>({});
  const [expandedNoteIds, setExpandedNoteIds] = useState<Set<string>>(new Set());

  // Zero-mode phrase selection & study actions
  const [selection, setSelection] = useState<ActiveSelectionState | null>(null);
  const [activeColor, setActiveColor] = useState<string>(colors.highlightGold);
  const [activeStyle, setActiveStyle] = useState<HighlightStyle>('fill');
  const [copiedFeedback, setCopiedFeedback] = useState(false);
  const [journalSentFeedback, setJournalSentFeedback] = useState(false);

  // Modals & Drawers
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [drawerState, setDrawerState] = useState<{ open: boolean; tab: BookDrawerTab }>({
    open: false,
    tab: 'contents',
  });
  const [noteModal, setNoteModal] = useState<{
    block: ReadingBlock;
    highlight: Highlight | null;
    range: TextRange;
    quoteContext: string;
  } | null>(null);
  const [echoesState, setEchoesState] = useState<{
    visible: boolean;
    sourceLabel: string;
    excerpt: string;
    loading: boolean;
    result: ResonanceResult | null;
  }>({
    visible: false,
    sourceLabel: '',
    excerpt: '',
    loading: false,
    result: null,
  });

  // In-Book Find Bar
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [findMode, setFindMode] = useState<'keyword' | 'semantic'>('keyword');
  const [findHits, setFindHits] = useState<InBookSearchHit[]>([]);
  const [findLoading, setFindLoading] = useState(false);
  const [activeHitIdx, setActiveHitIdx] = useState(0);
  const [findResultsExpanded, setFindResultsExpanded] = useState(false);

  // Focus mode (immersive reading) + live chapter/progress tracking
  const [immersive, setImmersive] = useState(false);
  const [currentChapterIdx, setCurrentChapterIdx] = useState(0);
  const [currentBlockIdx, setCurrentBlockIdx] = useState(0);

  const listRef = useRef<FlatList<ReadingBlock>>(null);
  const progressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restoredKeyRef = useRef<string | null>(null);

  const bookId = mode.kind === 'scripture' ? mode.bookName : mode.bookId;

  // ── Load persisted Reader preferences ──────────────────────────────────
  useEffect(() => {
    dataLayer
      .getSettings()
      .then((settings) => {
        setPrefs(
          parseReaderPreferences(
            settings?.[READER_PREFS_SETTING_KEY],
            settings?.fontSize
          )
        );
      })
      .catch(() => {});
  }, [dataLayer]);

  const updatePrefs = useCallback(
    (patch: Partial<ReaderPreferences>) => {
      setPrefs((prev) => {
        const next = { ...prev, ...patch };
        void dataLayer
          .setSetting?.(READER_PREFS_SETTING_KEY, serializeReaderPreferences(next))
          ?.catch(() => {});
        return next;
      });
    },
    [dataLayer]
  );

  // ── Android Hardware BackHandler ───────────────────────────────────────
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (noteModal) {
        setNoteModal(null);
        return true;
      }
      if (echoesState.visible) {
        setEchoesState((prev) => ({ ...prev, visible: false }));
        return true;
      }
      if (appearanceOpen) {
        setAppearanceOpen(false);
        return true;
      }
      if (drawerState.open) {
        setDrawerState((prev) => ({ ...prev, open: false }));
        return true;
      }
      if (findOpen) {
        setFindOpen(false);
        setFindQuery('');
        setFindHits([]);
        return true;
      }
      if (selection) {
        setSelection(null);
        return true;
      }
      if (immersive) {
        setImmersive(false);
        return true;
      }
      onBack();
      return true;
    });
    return () => sub.remove();
  }, [
    noteModal,
    echoesState.visible,
    appearanceOpen,
    drawerState.open,
    findOpen,
    selection,
    immersive,
    onBack,
  ]);

  // ── Load Book / Chapter Document ───────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setBlocks([]);
    setChapters([]);
    setHighlights([]);
    setCrossRefs({});
    setSelection(null);
    setFindOpen(false);
    setFindQuery('');
    setFindHits([]);
    setCurrentChapterIdx(0);
    setCurrentBlockIdx(0);
    if (mode.kind === 'scripture') {
      setLibraryBook(null);
    }

    const loadData = async () => {
      try {
        let nextBlocks: ReadingBlock[] = [];
        let nextChapters: BookChapter[] = [];
        let nextWords = 0;

        if (mode.kind === 'scripture') {
          const rawVerses = await dataLayer.getVerses(
            mode.bookName,
            mode.chapter,
            mode.translation
          );
          const merged = new Map<number, VersePassage>();
          for (const p of rawVerses) {
            const key = p.verse_start ?? 0;
            const existing = merged.get(key);
            if (existing) {
              existing.text = `${existing.text} ${p.text}`;
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
          const sortedVerses = Array.from(merged.values()).sort(
            (a, b) => (a.verse_start ?? 0) - (b.verse_start ?? 0)
          );
          nextBlocks = buildScriptureBlocks(mode.bookName, mode.chapter, sortedVerses);
          nextWords = sortedVerses.reduce(
            (acc, v) => acc + v.text.trim().split(/\s+/).length,
            0
          );
        } else {
          const [libPassages, book] = await Promise.all([
            dataLayer.getLibraryPassages(mode.bookId),
            dataLayer.getLibraryBook(mode.bookId),
          ]);
          if (!cancelled) setLibraryBook(book);
          const reconstructed = reconstructBookDocument(
            mode.bookId,
            libPassages,
            book?.title ?? 'Opening'
          );
          nextBlocks = reconstructed.blocks;
          nextChapters = reconstructed.chapters;
          nextWords = reconstructed.totalWords;
        }

        if (cancelled) return;
        setBlocks(nextBlocks);
        setChapters(nextChapters);
        setTotalWords(nextWords);
        setLoading(false);

        // Non-blocking: load highlights (both new anchorRef and legacy passage.id), bookmarks, cross-refs
        const refSet = new Set<string>();
        for (const blk of nextBlocks) {
          if (blk.anchorRef) refSet.add(blk.anchorRef);
          if (blk.legacyRef) refSet.add(blk.legacyRef);
        }
        const refsToLoad = Array.from(refSet);

        const hlPromise = dataLayer.getBookHighlights
          ? Promise.all([
              dataLayer.getHighlightsForRefs(refsToLoad),
              dataLayer.getBookHighlights(bookId),
            ]).then(([byRef, byBook]) => {
              const dedup = new Map<string, Highlight>();
              for (const h of byBook) dedup.set(h.id, h);
              for (const h of byRef) dedup.set(h.id, h);
              return Array.from(dedup.values());
            })
          : dataLayer.getHighlightsForRefs(refsToLoad);

        hlPromise
          .then((hl) => {
            if (!cancelled) setHighlights(hl);
          })
          .catch(() => {});

        dataLayer
          .getBookmarks()
          .then((bms) => {
            if (!cancelled) setBookmarks(bms);
          })
          .catch(() => {});

        if (mode.kind === 'scripture' && refsToLoad.length > 0) {
          dataLayer
            .getCrossReferencesBatch(refsToLoad)
            .then((xrefMap) => {
              if (!cancelled) setCrossRefs(xrefMap);
            })
            .catch(() => {});
        }
      } catch (err) {
        console.error('[ReadingView] load failed:', err);
        if (!cancelled) {
          setBlocks([]);
          setLoading(false);
        }
      }
    };

    void loadData();
    return () => {
      cancelled = true;
    };
  }, [mode, bookId, dataLayer]);

  // ── Restore Exact Position or Deep-Link Scroll ─────────────────────────
  const restoreKey =
    mode.kind === 'scripture'
      ? `s:${mode.bookName}:${mode.chapter}:${initialVerse ?? ''}`
      : `l:${mode.bookId}:${initialPassageId ?? ''}`;

  useEffect(() => {
    if (loading || blocks.length === 0) return;
    if (restoredKeyRef.current === restoreKey) return;
    restoredKeyRef.current = restoreKey;

    const scrollToBlock = (idx: number) => {
      if (idx <= 0 || idx >= blocks.length) return;
      setCurrentBlockIdx(idx);
      setCurrentChapterIdx(blocks[idx]?.chapterIndex ?? 0);
      setTimeout(() => {
        listRef.current?.scrollToIndex({
          index: idx,
          animated: false,
          viewPosition: 0.08,
        });
      }, 90);
    };

    if (isScripture && initialVerse != null) {
      const idx = blocks.findIndex((b) => b.verseStart === initialVerse);
      if (idx >= 0) {
        scrollToBlock(idx);
        return;
      }
    }

    if (!isScripture && initialPassageId != null) {
      const idx = blocks.findIndex((b) => b.passageId === initialPassageId);
      if (idx >= 0) {
        scrollToBlock(idx);
        return;
      }
    }

    // Resume saved exact reading progress for Library books
    if (!isScripture && dataLayer.getReadingProgress) {
      void dataLayer
        .getReadingProgress(bookId)
        .then((prog) => {
          if (!prog) return;
          if (prog.blockIndex > 0 && prog.blockIndex < blocks.length) {
            scrollToBlock(prog.blockIndex);
          } else if (prog.passageId != null) {
            const idx = blocks.findIndex((b) => b.passageId === prog.passageId);
            if (idx > 0) scrollToBlock(idx);
          }
        })
        .catch(() => {});
    } else {
      listRef.current?.scrollToOffset({ offset: 0, animated: false });
    }
  }, [loading, blocks, isScripture, initialVerse, initialPassageId, restoreKey, bookId, dataLayer]);

  // ── Record reading event ───────────────────────────────────────────────
  useEffect(() => {
    if (mode.kind === 'scripture') {
      const ref = `${mode.bookName} ${mode.chapter}`;
      dataLayer
        .recordReadingEvent(mode.bookName, mode.chapter, ref, Date.now())
        .catch(() => {});
    } else if (libraryBook) {
      const ref = libraryBook.title ?? mode.bookId;
      dataLayer
        .recordReadingEvent(mode.bookId, currentChapterIdx + 1, ref, Date.now())
        .catch(() => {});
    }
  }, [mode, libraryBook, currentChapterIdx, dataLayer]);

  // ── Debounced Exact Position Save via onViewableItemsChanged ───────────
  const blocksRef = useRef<ReadingBlock[]>([]);
  blocksRef.current = blocks;
  const chaptersRef = useRef<BookChapter[]>([]);
  chaptersRef.current = chapters;

  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 25 }).current;

  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      if (!viewableItems || viewableItems.length === 0) return;
      const first = viewableItems[0]?.item as ReadingBlock | undefined;
      if (!first) return;

      setCurrentBlockIdx(first.blockIndex);
      setCurrentChapterIdx(first.chapterIndex);

      if (progressTimerRef.current) clearTimeout(progressTimerRef.current);
      progressTimerRef.current = setTimeout(() => {
        const total = Math.max(1, blocksRef.current.length);
        const pct = Math.min(1, Math.max(0, first.blockIndex / total));
        const ch = chaptersRef.current[first.chapterIndex];
        void dataLayer
          .saveReadingProgress?.({
            bookId: first.bookId,
            chapterId: ch?.id ?? first.chapterId,
            chapterIndex: first.chapterIndex,
            blockIndex: first.blockIndex,
            passageId: first.passageId ?? null,
            verseNumber: first.verseStart ?? null,
            scrollPct: pct,
            updatedAt: Date.now(),
          })
          ?.catch(() => {});
      }, 650);
    }
  ).current;

  useEffect(() => {
    return () => {
      if (progressTimerRef.current) clearTimeout(progressTimerRef.current);
    };
  }, []);

  // ── Memoized Highlight Lookups (Supports Multiple Highlights per Block) ─
  const highlightsByRef = useMemo(() => {
    const map = new Map<string, Highlight[]>();
    for (const h of highlights) {
      const list = map.get(h.verse_ref) ?? [];
      list.push(h);
      map.set(h.verse_ref, list);
    }
    return map;
  }, [highlights]);

  const highlightCountsByChapter = useMemo(() => {
    const counts: Record<number, number> = {};
    if (isScripture) return counts;
    const blockByRef = new Map<string, ReadingBlock>();
    for (const b of blocks) {
      blockByRef.set(b.anchorRef, b);
      if (b.legacyRef) blockByRef.set(b.legacyRef, b);
    }
    for (const h of highlights) {
      const blk = blockByRef.get(h.verse_ref);
      if (blk) {
        counts[blk.chapterIndex] = (counts[blk.chapterIndex] ?? 0) + 1;
      }
    }
    return counts;
  }, [blocks, highlights, isScripture]);

  // ── Bookmarks ──────────────────────────────────────────────────────────
  const headerTitle = useMemo(() => {
    if (mode.kind === 'scripture') return `${mode.bookName} ${mode.chapter}`;
    return libraryBook?.title ?? 'Reading';
  }, [mode, libraryBook]);

  const headerSubtitle = useMemo(() => {
    if (mode.kind === 'scripture') return null;
    const activeCh = chapters[currentChapterIdx];
    if (activeCh && activeCh.title !== headerTitle) return activeCh.title;
    return libraryBook?.author ?? null;
  }, [mode, libraryBook, chapters, currentChapterIdx, headerTitle]);

  const bookmarkRef = useMemo(() => {
    if (mode.kind === 'scripture') return `${mode.bookName} ${mode.chapter}`;
    const curBlk = blocks[currentBlockIdx];
    if (curBlk && curBlk.passageId != null) return `${mode.bookId}#p${curBlk.passageId}`;
    return libraryBook?.title ?? mode.bookId;
  }, [mode, libraryBook, blocks, currentBlockIdx]);

  const bookmarkLabel = useMemo(() => {
    if (mode.kind === 'scripture') return headerTitle;
    const chTitle = chapters[currentChapterIdx]?.title;
    return chTitle ? `${headerTitle} — ${chTitle}` : headerTitle;
  }, [mode, headerTitle, chapters, currentChapterIdx]);

  const isBookmarked = useMemo(
    () => bookmarks.some((b) => b.verse_ref === bookmarkRef),
    [bookmarks, bookmarkRef]
  );

  const bookBookmarks = useMemo(() => {
    return bookmarks.filter((b) => {
      if (mode.kind === 'scripture') {
        return b.verse_ref.startsWith(`${mode.bookName} `);
      }
      return (
        b.verse_ref.startsWith(`${mode.bookId}#`) ||
        b.verse_ref === mode.bookId ||
        (libraryBook?.title && b.verse_ref === libraryBook.title)
      );
    });
  }, [bookmarks, mode, libraryBook]);

  const handleToggleBookmark = useCallback(async () => {
    if (isBookmarked) {
      setBookmarks((prev) => prev.filter((b) => b.verse_ref !== bookmarkRef));
      try {
        await dataLayer.removeBookmark(bookmarkRef);
      } catch {
        // ignore
      }
    } else {
      const optimistic: Bookmark = {
        id: `bm-${Date.now()}`,
        verse_ref: bookmarkRef,
        label: bookmarkLabel,
        created_at: Date.now(),
      };
      setBookmarks((prev) => [optimistic, ...prev]);
      try {
        await dataLayer.saveBookmark(bookmarkRef, bookmarkLabel);
      } catch {
        setBookmarks((prev) => prev.filter((b) => b.id !== optimistic.id));
      }
    }
  }, [isBookmarked, bookmarkRef, bookmarkLabel, dataLayer]);

  const handleRemoveBookmark = useCallback(
    async (verseRef: string) => {
      setBookmarks((prev) => prev.filter((b) => b.verse_ref !== verseRef));
      try {
        await dataLayer.removeBookmark(verseRef);
      } catch {
        // ignore
      }
    },
    [dataLayer]
  );

  // ── Navigation Helpers ─────────────────────────────────────────────────
  const jumpToBlockIndex = useCallback(
    (idx: number) => {
      if (idx < 0 || idx >= blocks.length) return;
      setCurrentBlockIdx(idx);
      setCurrentChapterIdx(blocks[idx]?.chapterIndex ?? 0);
      listRef.current?.scrollToIndex({
        index: idx,
        animated: true,
        viewPosition: 0.1,
      });
    },
    [blocks]
  );

  const jumpToLibraryChapter = useCallback(
    (chIdx: number) => {
      const ch = chapters[chIdx];
      if (!ch) return;
      jumpToBlockIndex(ch.startBlockIndex);
    },
    [chapters, jumpToBlockIndex]
  );

  const handleNavigateScriptureRef = useCallback(
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

  const handleJumpToHighlight = useCallback(
    (hl: Highlight) => {
      if (isScripture) {
        const refMatch = /^(.+?)\s+(\d+):(\d+)/.exec(hl.verse_ref);
        if (refMatch) {
          const ch = parseInt(refMatch[2], 10);
          const v = parseInt(refMatch[3], 10);
          if (mode.kind === 'scripture' && ch === mode.chapter) {
            const idx = blocks.findIndex((b) => b.verseStart === v);
            if (idx >= 0) jumpToBlockIndex(idx);
          } else {
            handleNavigateScriptureRef(hl.verse_ref);
          }
          return;
        }
      }
      const idx = blocks.findIndex(
        (b) => b.anchorRef === hl.verse_ref || b.legacyRef === hl.verse_ref
      );
      if (idx >= 0) {
        jumpToBlockIndex(idx);
      }
    },
    [isScripture, mode, blocks, jumpToBlockIndex, handleNavigateScriptureRef]
  );

  const handleJumpToBookmark = useCallback(
    (bm: Bookmark) => {
      if (isScripture) {
        const m = /^(.+?)\s+(\d+)/.exec(bm.verse_ref);
        if (m) {
          const ch = parseInt(m[2], 10);
          if (!isNaN(ch)) onNavigateChapter?.(m[1].trim(), ch);
        }
        return;
      }
      const pMatch = /#p(\d+)$/.exec(bm.verse_ref);
      if (pMatch) {
        const pid = parseInt(pMatch[1], 10);
        const idx = blocks.findIndex((b) => b.passageId === pid);
        if (idx >= 0) jumpToBlockIndex(idx);
      }
    },
    [isScripture, onNavigateChapter, blocks, jumpToBlockIndex]
  );

  // ── In-Book Search (Keyword + Semantic) ────────────────────────────────
  const runInBookSearch = useCallback(
    async (q: string, searchMode: 'keyword' | 'semantic') => {
      const trimmed = q.trim();
      if (trimmed.length < 2) {
        setFindHits([]);
        setActiveHitIdx(0);
        setFindLoading(false);
        return;
      }
      setFindLoading(true);
      try {
        let results: InBookSearchHit[] = [];
        if (searchMode === 'semantic' && !isScripture && dataLayer.searchInBook) {
          results = await dataLayer.searchInBook(bookId, trimmed, 'semantic');
        } else {
          results = searchBlocksKeyword(blocks, chapters, trimmed);
        }
        setFindHits(results);
        setActiveHitIdx(0);
        if (results.length > 0) {
          jumpToBlockIndex(results[0].blockIndex);
        }
      } catch {
        setFindHits([]);
      } finally {
        setFindLoading(false);
      }
    },
    [blocks, chapters, isScripture, bookId, dataLayer, jumpToBlockIndex]
  );

  useEffect(() => {
    if (!findOpen) return;
    if (findQuery.trim().length < 2) {
      setFindHits([]);
      return;
    }
    const timer = setTimeout(() => {
      void runInBookSearch(findQuery, findMode);
    }, 240);
    return () => clearTimeout(timer);
  }, [findOpen, findQuery, findMode, runInBookSearch]);

  const stepSearchHit = useCallback(
    (delta: number) => {
      if (findHits.length === 0) return;
      const next = (activeHitIdx + delta + findHits.length) % findHits.length;
      setActiveHitIdx(next);
      jumpToBlockIndex(findHits[next].blockIndex);
    },
    [findHits, activeHitIdx, jumpToBlockIndex]
  );

  // ── Zero-Mode Phrase Selection & Highlighting ──────────────────────────
  const sourceLabelForBlock = useCallback(
    (blk: ReadingBlock): string => {
      if (isScripture) return blk.anchorRef;
      const ch = chapters[blk.chapterIndex]?.title;
      const parts = [libraryBook?.author, libraryBook?.title ?? bookId, ch].filter(Boolean);
      return parts.join(' · ');
    },
    [isScripture, chapters, libraryBook, bookId]
  );

  const handleSelectBlock = useCallback(
    (blk: ReadingBlock) => {
      // If clicking the exact same already-selected block, toggle off selection & focus mode cleanly
      if (selection && selection.block.id === blk.id) {
        setSelection(null);
        return;
      }
      // Snap initial selection cleanly: full verse for Scripture, opening sentence for long prose
      const range =
        isScripture || blk.text.length <= 160
          ? { start: 0, end: blk.text.length }
          : getSentenceRange(blk.text, 0);

      const blockHls = [
        ...(highlightsByRef.get(blk.anchorRef) ?? []),
        ...(blk.legacyRef ? highlightsByRef.get(blk.legacyRef) ?? [] : []),
      ];
      const existing = blockHls[0] ?? null;

      setCopiedFeedback(false);
      setJournalSentFeedback(false);
      if (existing) {
        setActiveColor(existing.color);
        setActiveStyle(existing.style ?? 'fill');
      }
      setSelection({
        block: blk,
        range:
          existing && existing.start_offset != null && existing.end_offset != null
            ? {
                start: Math.max(0, existing.start_offset),
                end: Math.min(blk.text.length, existing.end_offset),
              }
            : range,
        existingHighlight: existing,
      });
    },
    [selection, isScripture, highlightsByRef]
  );

  const handlePressHighlight = useCallback((blk: ReadingBlock, hl: Highlight) => {
    setCopiedFeedback(false);
    setJournalSentFeedback(false);
    setActiveColor(hl.color);
    setActiveStyle(hl.style ?? 'fill');
    setSelection({
      block: blk,
      range: {
        start: hl.start_offset ?? 0,
        end: hl.end_offset ?? blk.text.length,
      },
      existingHighlight: hl,
    });
  }, []);

  const commitHighlight = useCallback(
    async (color: string, style: HighlightStyle) => {
      if (!selection) return;
      const { block, range, existingHighlight } = selection;
      const { selectedText, quotePrefix, quoteSuffix } = extractQuoteAffixes(
        block.text,
        range.start,
        range.end
      );
      if (!selectedText.trim()) return;

      const sourceLabel = sourceLabelForBlock(block);
      const nowIso = new Date().toISOString();

      if (existingHighlight && !existingHighlight.id.startsWith('opt-')) {
        // Update existing highlight color / style / range
        const optimistic: Highlight = {
          ...existingHighlight,
          color,
          style,
          start_offset: range.start,
          end_offset: range.end,
          selected_text: selectedText,
          quote_prefix: quotePrefix,
          quote_suffix: quoteSuffix,
          updated_at: nowIso,
        };
        setHighlights((prev) =>
          prev.map((h) => (h.id === existingHighlight.id ? optimistic : h))
        );
        setSelection({ ...selection, existingHighlight: optimistic });
        try {
          const updated = await dataLayer.updateHighlight(existingHighlight.id, {
            color,
            style,
            startOffset: range.start,
            endOffset: range.end,
            selectedText,
            quotePrefix,
            quoteSuffix,
            contextText: block.text,
            sourceLabel,
          });
          setHighlights((prev) =>
            prev.map((h) => (h.id === existingHighlight.id ? updated : h))
          );
          setSelection((cur) =>
            cur && cur.block.id === block.id
              ? { ...cur, existingHighlight: updated }
              : cur
          );
        } catch (err) {
          console.error('[ReadingView] highlight update failed:', err);
        }
        return;
      }

      // Create new phrase highlight
      const optId = `opt-${Date.now()}`;
      const optimistic: Highlight = {
        id: optId,
        verse_ref: block.anchorRef,
        color,
        style,
        start_offset: range.start,
        end_offset: range.end,
        selected_text: selectedText,
        quote_prefix: quotePrefix,
        quote_suffix: quoteSuffix,
        book_id: bookId,
        chapter_id: block.chapterId,
        tags: [],
        note_text: null,
        note_updated_at: null,
        created_at: nowIso,
        updated_at: nowIso,
      };
      setHighlights((prev) => [...prev, optimistic]);
      setSelection({ ...selection, existingHighlight: optimistic });

      try {
        const saved = await dataLayer.saveHighlight({
          verseRef: block.anchorRef,
          color,
          style,
          startOffset: range.start,
          endOffset: range.end,
          selectedText,
          bookId,
          chapterId: block.chapterId,
          quotePrefix,
          quoteSuffix,
          contextText: block.text,
          sourceLabel,
        });
        setHighlights((prev) => prev.map((h) => (h.id === optId ? saved : h)));
        setSelection((cur) =>
          cur && cur.block.id === block.id ? { ...cur, existingHighlight: saved } : cur
        );
      } catch (err) {
        console.error('[ReadingView] highlight save failed:', err);
      }
    },
    [selection, bookId, sourceLabelForBlock, dataLayer]
  );

  const handleSelectColor = useCallback(
    (color: string) => {
      setActiveColor(color);
      void commitHighlight(color, activeStyle);
    },
    [activeStyle, commitHighlight]
  );

  const handleToggleStyle = useCallback(() => {
    const next: HighlightStyle = activeStyle === 'fill' ? 'underline' : 'fill';
    setActiveStyle(next);
    if (selection?.existingHighlight) {
      void commitHighlight(activeColor, next);
    }
  }, [activeStyle, activeColor, selection, commitHighlight]);

  const handleDeleteSelectedHighlight = useCallback(async () => {
    if (!selection?.existingHighlight) return;
    const targetId = selection.existingHighlight.id;
    setHighlights((prev) => prev.filter((h) => h.id !== targetId));
    setSelection((cur) => (cur ? { ...cur, existingHighlight: null } : null));
    if (!targetId.startsWith('opt-')) {
      try {
        await dataLayer.deleteHighlight(targetId);
      } catch (err) {
        console.error('[ReadingView] highlight delete failed:', err);
      }
    }
  }, [selection, dataLayer]);

  // ── Margin Note Composer ───────────────────────────────────────────────
  const handleOpenNoteForSelection = useCallback(() => {
    if (!selection) return;
    const quote = selection.block.text.slice(selection.range.start, selection.range.end);
    setNoteModal({
      block: selection.block,
      highlight: selection.existingHighlight,
      range: selection.range,
      quoteContext: quote || selection.block.text,
    });
  }, [selection]);

  const handleEditNote = useCallback((block: ReadingBlock, hl: Highlight) => {
    setNoteModal({
      block,
      highlight: hl,
      range: {
        start: hl.start_offset ?? 0,
        end: hl.end_offset ?? block.text.length,
      },
      quoteContext: hl.selected_text ?? block.text,
    });
  }, []);

  const handleNoteSave = useCallback(
    async (text: string, meta?: { tags: string[]; color: string }) => {
      if (!noteModal) return;
      const { block, highlight, range } = noteModal;
      const chosenColor = meta?.color ?? highlight?.color ?? activeColor;
      const chosenTags = meta?.tags ?? highlight?.tags ?? [];
      const sourceLabel = sourceLabelForBlock(block);
      setNoteModal(null);

      const { selectedText, quotePrefix, quoteSuffix } = extractQuoteAffixes(
        block.text,
        range.start,
        range.end
      );

      const hasPersisted = Boolean(highlight?.id && !highlight.id.startsWith('opt-'));
      try {
        let result: Highlight;
        if (hasPersisted && highlight) {
          result = await dataLayer.updateHighlight(highlight.id, {
            noteText: text || null,
            color: chosenColor,
            tags: chosenTags,
            contextText: block.text,
            sourceLabel,
          });
          setHighlights((prev) => prev.map((h) => (h.id === highlight.id ? result : h)));
        } else {
          result = await dataLayer.saveHighlight({
            verseRef: block.anchorRef,
            color: chosenColor,
            style: activeStyle,
            startOffset: range.start,
            endOffset: range.end,
            selectedText: selectedText || block.text,
            noteText: text || null,
            bookId,
            chapterId: block.chapterId,
            quotePrefix,
            quoteSuffix,
            tags: chosenTags,
            contextText: block.text,
            sourceLabel,
          });
          setHighlights((prev) => [
            ...prev.filter((h) => h.id !== highlight?.id),
            result,
          ]);
        }
        if (text.length > 0) {
          setExpandedNoteIds((prev) => new Set(prev).add(result.id));
        }
        setSelection(null);
      } catch (err) {
        console.error('[ReadingView] note save failed:', err);
      }
    },
    [noteModal, activeColor, activeStyle, bookId, sourceLabelForBlock, dataLayer]
  );

  const handleNoteDelete = useCallback(async () => {
    if (!noteModal?.highlight) return;
    const hl = noteModal.highlight;
    setNoteModal(null);
    if (hl.id.startsWith('opt-')) return;
    setHighlights((prev) =>
      prev.map((h) =>
        h.id === hl.id ? { ...h, note_text: null, note_updated_at: null } : h
      )
    );
    try {
      await dataLayer.updateHighlight(hl.id, { noteText: null });
    } catch {
      // ignore
    }
  }, [noteModal, dataLayer]);

  const handleToggleNoteAccordion = useCallback((highlightId: string) => {
    setExpandedNoteIds((prev) => {
      const next = new Set(prev);
      if (next.has(highlightId)) next.delete(highlightId);
      else next.add(highlightId);
      return next;
    });
  }, []);

  // ── Bidirectional Passage Echoes (`✦`) ─────────────────────────────────
  const handleOpenEchoes = useCallback(
    async (blk?: ReadingBlock, customExcerpt?: string) => {
      const targetBlock = blk ?? selection?.block ?? blocks[currentBlockIdx];
      if (!targetBlock) return;
      const excerpt =
        customExcerpt ??
        (selection && selection.block.id === targetBlock.id
          ? targetBlock.text.slice(selection.range.start, selection.range.end)
          : targetBlock.text);
      const label = sourceLabelForBlock(targetBlock);

      setEchoesState({
        visible: true,
        sourceLabel: label,
        excerpt,
        loading: true,
        result: null,
      });

      try {
        const res = dataLayer.findPassageEchoes
          ? await dataLayer.findPassageEchoes(excerpt, label, {
              bookId,
              excludePassageId: targetBlock.passageId ?? null,
            })
          : await dataLayer.findResonance(excerpt);
        setEchoesState((prev) => ({ ...prev, loading: false, result: res }));
      } catch {
        setEchoesState((prev) => ({ ...prev, loading: false, result: null }));
      }
    },
    [selection, blocks, currentBlockIdx, sourceLabelForBlock, dataLayer, bookId]
  );

  const handleOpenEchoCard = useCallback(
    (card: ResonanceCard) => {
      if (card.kind === 'scripture' || card.translation) {
        handleNavigateScriptureRef(card.source.replace(/\s*\([A-Z]+\)\s*$/, ''));
        return;
      }
      if (card.bookId && onOpenLibraryBook) {
        onOpenLibraryBook(card.bookId, card.passageId || undefined);
      }
    },
    [handleNavigateScriptureRef, onOpenLibraryBook]
  );

  // ── Send to Journal & Copy Citation ────────────────────────────────────
  const handleSendSelectionToJournal = useCallback(async () => {
    if (!selection) return;
    const excerpt = selection.block.text.slice(selection.range.start, selection.range.end);
    const label = sourceLabelForBlock(selection.block);
    try {
      await dataLayer.appendQuoteToJournal(excerpt, label);
      setJournalSentFeedback(true);
      setTimeout(() => setJournalSentFeedback(false), 1800);
    } catch {
      // ignore
    }
  }, [selection, sourceLabelForBlock, dataLayer]);

  const handleCopySelectionCitation = useCallback(async () => {
    if (!selection) return;
    const excerpt = selection.block.text.slice(selection.range.start, selection.range.end);
    const formatted = formatPassageCitation({
      text: excerpt,
      title: isScripture ? selection.block.anchorRef : libraryBook?.title ?? bookId,
      author: isScripture ? null : libraryBook?.author,
      section: isScripture ? null : chapters[selection.block.chapterIndex]?.title,
      translation: mode.kind === 'scripture' ? mode.translation : null,
    });
    await copyOrShareText(formatted);
    setCopiedFeedback(true);
    setTimeout(() => setCopiedFeedback(false), 1800);
  }, [selection, isScripture, libraryBook, bookId, chapters, mode]);

  // ── Progress & Reading Time Derived Metrics ────────────────────────────
  const progressPct =
    blocks.length > 1
      ? Math.min(100, Math.round((currentBlockIdx / (blocks.length - 1)) * 100))
      : 0;
  const remainingMinutes = Math.max(
    1,
    Math.ceil(((totalWords * (100 - progressPct)) / 100) / 210)
  );

  const prevScriptureCh = isScripture && mode.chapter > 1 ? mode.chapter - 1 : 0;
  const nextScriptureCh =
    isScripture && mode.chapter < mode.totalChapters ? mode.chapter + 1 : 0;
  const canPrevLibCh = !isScripture && currentChapterIdx > 0;
  const canNextLibCh = !isScripture && currentChapterIdx < chapters.length - 1;

  const activeSearchHitBlockId = findHits[activeHitIdx]?.blockId ?? null;
  const horizontalPad = resolveHorizontalPadding(prefs.margin);
  const loadCrossRefsBatch = useCallback(
    (refs: string[]) => dataLayer.getCrossReferencesBatch(refs),
    [dataLayer]
  );

  const renderBlockItem = useCallback(
    ({ item: blk }: { item: ReadingBlock }) => {
      const hls = [
        ...(highlightsByRef.get(blk.anchorRef) ?? []),
        ...(blk.legacyRef ? highlightsByRef.get(blk.legacyRef) ?? [] : []),
      ];
      return (
        <ReadingBlockRow
          block={blk}
          isScripture={isScripture}
          scriptureFlow={isScripture && prefs.scriptureMode === 'flow'}
          prefs={prefs}
          theme={theme}
          highlights={hls}
          activeSelectionRange={
            selection && selection.block.id === blk.id ? selection.range : null
          }
          searchQuery={findOpen ? findQuery : ''}
          isActiveSearchHit={findOpen && activeSearchHitBlockId === blk.id}
          expandedNoteIds={expandedNoteIds}
          crossRefList={crossRefs[blk.anchorRef]}
          onSelectBlock={handleSelectBlock}
          onPressHighlight={handlePressHighlight}
          onToggleNote={handleToggleNoteAccordion}
          onEditNote={handleEditNote}
          onLoadCrossRefs={loadCrossRefsBatch}
          onNavigateScriptureRef={handleNavigateScriptureRef}
        />
      );
    },
    [
      highlightsByRef,
      isScripture,
      prefs,
      theme,
      selection,
      findOpen,
      findQuery,
      activeSearchHitBlockId,
      expandedNoteIds,
      crossRefs,
      handleSelectBlock,
      handlePressHighlight,
      handleToggleNoteAccordion,
      handleEditNote,
      loadCrossRefsBatch,
      handleNavigateScriptureRef,
    ]
  );

  // End-of-chapter footer for Scripture (seamless next chapter CTA)
  const listFooter = useMemo(() => {
    if (loading || blocks.length === 0) return null;
    if (isScripture && nextScriptureCh > 0) {
      return (
        <Pressable
          onPress={() => onNavigateChapter?.(mode.bookName, nextScriptureCh)}
          style={[
            styles.nextChapterCard,
            { backgroundColor: theme.surface, borderColor: theme.border },
          ]}
        >
          <Text style={[styles.nextChapterEyebrow, { color: theme.textTertiary }]}>
            Continue Reading
          </Text>
          <Text style={[styles.nextChapterTitle, { color: theme.accent }]}>
            {mode.bookName} {nextScriptureCh} →
          </Text>
        </Pressable>
      );
    }
    return (
      <View style={styles.endOfWork}>
        <Text style={[styles.dividerGlyph, { color: theme.accentMuted }]}>❦</Text>
      </View>
    );
  }, [loading, blocks.length, isScripture, nextScriptureCh, mode, onNavigateChapter, theme]);

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      {/* ── Top Header (auto-hides in immersive focus mode) ────────────── */}
      {!immersive ? (
        <View
          style={[
            styles.topHeader,
            { backgroundColor: theme.background, borderBottomColor: theme.border },
          ]}
        >
          <Pressable
            onPress={onBack}
            hitSlop={8}
            style={({ pressed }) => [styles.backBtn, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={isScripture ? 'Back to Books' : 'Back to Library'}
          >
            <ChevronLeftIcon size={18} color={theme.accent} />
            <Text style={[styles.backBtnText, { color: theme.accent }]}>
              {isScripture ? 'Books' : 'Library'}
            </Text>
          </Pressable>

          <Pressable
            onPress={() => setDrawerState({ open: true, tab: 'contents' })}
            style={styles.topTitleWrap}
            accessibilityRole="button"
            accessibilityLabel="Open table of contents"
          >
            <Text style={[styles.topTitle, { color: theme.textPrimary }]} numberOfLines={1}>
              {headerTitle}
            </Text>
            {headerSubtitle ? (
              <Text style={[styles.topSubtitle, { color: theme.textTertiary }]} numberOfLines={1}>
                {headerSubtitle}
              </Text>
            ) : null}
          </Pressable>

          <View style={styles.topActions}>
            <Pressable
              onPress={() => {
                setFindOpen((prev) => {
                  if (prev) {
                    setFindQuery('');
                    setFindHits([]);
                  }
                  return !prev;
                });
              }}
              hitSlop={6}
              style={styles.headerIconBtn}
              accessibilityRole="button"
              accessibilityLabel="Find in book"
            >
              <SearchIcon size={18} color={findOpen ? theme.accent : theme.textSecondary} />
            </Pressable>

            <Pressable
              onPress={() => setAppearanceOpen(true)}
              hitSlop={6}
              style={styles.headerIconBtn}
              accessibilityRole="button"
              accessibilityLabel="Reading typography"
            >
              <TypeIcon size={18} color={theme.textSecondary} />
            </Pressable>

            <BookmarkButton bookmarked={isBookmarked} onPress={handleToggleBookmark} />
          </View>
        </View>
      ) : null}

      {/* ── In-Book Find Bar (Exact + Semantic) ────────────────────────── */}
      {findOpen && !immersive ? (
        <View
          style={[
            styles.findBar,
            { backgroundColor: theme.surface, borderBottomColor: theme.border },
          ]}
        >
          <View style={styles.findRow}>
            <View
              style={[
                styles.findInputWrap,
                { backgroundColor: theme.background, borderColor: theme.border },
              ]}
            >
              <TextInput
                value={findQuery}
                onChangeText={setFindQuery}
                placeholder={
                  findMode === 'semantic'
                    ? 'Search concepts in this book…'
                    : 'Find in this book…'
                }
                placeholderTextColor={theme.textTertiary}
                autoFocus
                returnKeyType="search"
                onSubmitEditing={() => void runInBookSearch(findQuery, findMode)}
                style={[styles.findInput, { color: theme.textPrimary }]}
              />
              {findLoading ? (
                <ActivityIndicator size="small" color={theme.accentMuted} />
              ) : findHits.length > 0 ? (
                <Pressable onPress={() => setFindResultsExpanded((e) => !e)}>
                  <Text style={[styles.findCount, { color: theme.accent }]}>
                    {activeHitIdx + 1}/{findHits.length}
                  </Text>
                </Pressable>
              ) : null}
            </View>

            <Pressable
              onPress={() => stepSearchHit(-1)}
              disabled={findHits.length === 0}
              style={[styles.findNavBtn, findHits.length === 0 && styles.disabled]}
              accessibilityLabel="Previous match"
            >
              <ChevronUpIcon size={16} color={theme.textSecondary} />
            </Pressable>
            <Pressable
              onPress={() => stepSearchHit(1)}
              disabled={findHits.length === 0}
              style={[styles.findNavBtn, findHits.length === 0 && styles.disabled]}
              accessibilityLabel="Next match"
            >
              <ChevronDownIcon size={16} color={theme.textSecondary} />
            </Pressable>
            <Pressable
              onPress={() => {
                setFindOpen(false);
                setFindQuery('');
                setFindHits([]);
              }}
              style={styles.findNavBtn}
              accessibilityLabel="Close search"
            >
              <XIcon size={16} color={theme.textTertiary} />
            </Pressable>
          </View>

          {!isScripture ? (
            <View style={styles.findModeRow}>
              {(['keyword', 'semantic'] as const).map((m) => {
                const active = findMode === m;
                return (
                  <Pressable
                    key={m}
                    onPress={() => setFindMode(m)}
                    style={[
                      styles.findModePill,
                      {
                        backgroundColor: active ? theme.accent : theme.background,
                        borderColor: active ? theme.accent : theme.border,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.findModeText,
                        { color: active ? theme.surface : theme.textSecondary },
                      ]}
                    >
                      {m === 'keyword' ? 'Exact' : '✦ Meaning'}
                    </Text>
                  </Pressable>
                );
              })}
              {findHits.length > 0 ? (
                <Pressable
                  onPress={() => setFindResultsExpanded((e) => !e)}
                  style={styles.findListToggle}
                >
                  <Text style={[styles.findListToggleText, { color: theme.accent }]}>
                    {findResultsExpanded ? 'Hide matches ▴' : 'Show all matches ▾'}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}

          {findResultsExpanded && findHits.length > 0 ? (
            <View style={[styles.findDropdown, { borderTopColor: theme.border }]}>
              {findHits.slice(0, 8).map((hit, i) => (
                <Pressable
                  key={`${hit.blockId}-${i}`}
                  onPress={() => {
                    setActiveHitIdx(i);
                    setFindResultsExpanded(false);
                    jumpToBlockIndex(hit.blockIndex);
                  }}
                  style={[
                    styles.findDropdownRow,
                    i === activeHitIdx && { backgroundColor: withAlpha(theme.accent, 0.12) },
                  ]}
                >
                  <Text style={[styles.findDropdownCh, { color: theme.accent }]} numberOfLines={1}>
                    {hit.chapterTitle}
                  </Text>
                  <Text
                    style={[styles.findDropdownSnip, { color: theme.textSecondary }]}
                    numberOfLines={2}
                  >
                    {hit.snippet}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}

      {/* ── Reading Body ───────────────────────────────────────────────── */}
      {loading ? (
        <View style={styles.centerLoading}>
          <ActivityIndicator color={theme.accentMuted} />
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={blocks}
          keyExtractor={(item) => item.id}
          style={styles.passageList}
          contentContainerStyle={[
            styles.passageListContent,
            {
              paddingHorizontal: horizontalPad,
              paddingBottom: Platform.OS === 'web' ? 150 : 36,
            },
          ]}
          renderItem={renderBlockItem}
          ListFooterComponent={listFooter}
          initialNumToRender={18}
          maxToRenderPerBatch={14}
          windowSize={9}
          viewabilityConfig={viewabilityConfig}
          onViewableItemsChanged={onViewableItemsChanged}
          onScrollToIndexFailed={(info) => {
            listRef.current?.scrollToOffset({
              offset: info.averageItemLength * info.index,
              animated: false,
            });
          }}
        />
      )}

      {/* ── Bottom Chrome: Selection Bar OR Quiet Reader Bar ────────────── */}
      {selection ? (
        <View style={Platform.OS === 'web' ? styles.bottomChromeWeb : undefined}>
          <SelectionActionBar
            theme={theme}
            selectedPreview={selection.block.text.slice(
              selection.range.start,
              selection.range.end
            )}
            activeColor={activeColor}
            activeStyle={activeStyle}
            hasExistingHighlight={Boolean(selection.existingHighlight)}
            canAdjustPhrase={selection.block.text.length > 24}
            onSelectColor={handleSelectColor}
            onToggleStyle={handleToggleStyle}
            onStepStartLeft={() =>
              setSelection((s) =>
                s
                  ? { ...s, range: stepRangeByWord(s.block.text, s.range, 'start', 'left') }
                  : null
              )
            }
            onStepStartRight={() =>
              setSelection((s) =>
                s
                  ? { ...s, range: stepRangeByWord(s.block.text, s.range, 'start', 'right') }
                  : null
              )
            }
            onStepEndLeft={() =>
              setSelection((s) =>
                s
                  ? { ...s, range: stepRangeByWord(s.block.text, s.range, 'end', 'left') }
                  : null
              )
            }
            onStepEndRight={() =>
              setSelection((s) =>
                s
                  ? { ...s, range: stepRangeByWord(s.block.text, s.range, 'end', 'right') }
                  : null
              )
            }
            onSelectSentence={() =>
              setSelection((s) =>
                s ? { ...s, range: getSentenceRange(s.block.text, s.range.start) } : null
              )
            }
            onSelectFull={() =>
              setSelection((s) =>
                s ? { ...s, range: { start: 0, end: s.block.text.length } } : null
              )
            }
            onAnnotate={handleOpenNoteForSelection}
            onEchoes={() => void handleOpenEchoes()}
            onSendToJournal={() => void handleSendSelectionToJournal()}
            onCopyCitation={() => void handleCopySelectionCitation()}
            onDeleteHighlight={() => void handleDeleteSelectedHighlight()}
            onDismiss={() => setSelection(null)}
            copiedFeedback={copiedFeedback}
            journalSentFeedback={journalSentFeedback}
          />
        </View>
      ) : (
        <View
          style={[
            styles.bottomChrome,
            { backgroundColor: theme.background, borderTopColor: theme.border },
            Platform.OS === 'web' && styles.bottomChromeWeb,
          ]}
        >
          {/* Subtle reading progress hairline */}
          <View style={[styles.progressTrack, { backgroundColor: theme.border }]}>
            <View
              style={[
                styles.progressFill,
                { backgroundColor: theme.accent, width: `${Math.max(2, progressPct)}%` },
              ]}
            />
          </View>

          {immersive ? (
            <Pressable
              onPress={() => setImmersive(false)}
              style={styles.immersiveFooter}
              accessibilityRole="button"
              accessibilityLabel="Restore reader toolbar"
            >
              <Text style={[styles.progressText, { color: theme.textTertiary }]}>
                {isScripture
                  ? `${mode.bookName} ${mode.chapter} · Tap to show controls`
                  : `${progressPct}% · ~${remainingMinutes} min left · Tap for controls`}
              </Text>
            </Pressable>
          ) : (
            <View style={styles.bottomNav}>
              {/* Left: Book Drawer (TOC / Notes / Bookmarks) + Prev/Next */}
              <View style={styles.bottomLeft}>
                <Pressable
                  onPress={() => setDrawerState({ open: true, tab: 'contents' })}
                  hitSlop={6}
                  style={[
                    styles.navIconBtn,
                    { borderColor: theme.border, backgroundColor: theme.surface },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Contents, highlights, and bookmarks"
                >
                  <ListIcon size={17} color={theme.accent} />
                </Pressable>

                {isScripture ? (
                  <>
                    <Pressable
                      onPress={() =>
                        prevScriptureCh > 0 &&
                        onNavigateChapter?.(mode.bookName, prevScriptureCh)
                      }
                      disabled={prevScriptureCh === 0}
                      style={[
                        styles.navStepBtn,
                        { borderColor: theme.border, backgroundColor: theme.surface },
                        prevScriptureCh === 0 && styles.disabled,
                      ]}
                      accessibilityLabel="Previous chapter"
                    >
                      <Text style={[styles.navArrow, { color: theme.accent }]}>‹</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => setDrawerState({ open: true, tab: 'contents' })}
                      style={styles.posBtn}
                    >
                      <Text style={[styles.posText, { color: theme.textSecondary }]}>
                        {mode.chapter} / {mode.totalChapters}
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() =>
                        nextScriptureCh > 0 &&
                        onNavigateChapter?.(mode.bookName, nextScriptureCh)
                      }
                      disabled={nextScriptureCh === 0}
                      style={[
                        styles.navStepBtn,
                        { borderColor: theme.border, backgroundColor: theme.surface },
                        nextScriptureCh === 0 && styles.disabled,
                      ]}
                      accessibilityLabel="Next chapter"
                    >
                      <Text style={[styles.navArrow, { color: theme.accent }]}>›</Text>
                    </Pressable>
                  </>
                ) : (
                  <>
                    <Pressable
                      onPress={() => canPrevLibCh && jumpToLibraryChapter(currentChapterIdx - 1)}
                      disabled={!canPrevLibCh}
                      style={[
                        styles.navStepBtn,
                        { borderColor: theme.border, backgroundColor: theme.surface },
                        !canPrevLibCh && styles.disabled,
                      ]}
                      accessibilityLabel="Previous chapter"
                    >
                      <Text style={[styles.navArrow, { color: theme.accent }]}>‹</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => setDrawerState({ open: true, tab: 'contents' })}
                      style={styles.posBtn}
                    >
                      <Text style={[styles.posText, { color: theme.textSecondary }]}>
                        {chapters.length > 0
                          ? `Ch ${currentChapterIdx + 1}/${chapters.length} · ${progressPct}%`
                          : `${progressPct}%`}
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => canNextLibCh && jumpToLibraryChapter(currentChapterIdx + 1)}
                      disabled={!canNextLibCh}
                      style={[
                        styles.navStepBtn,
                        { borderColor: theme.border, backgroundColor: theme.surface },
                        !canNextLibCh && styles.disabled,
                      ]}
                      accessibilityLabel="Next chapter"
                    >
                      <Text style={[styles.navArrow, { color: theme.accent }]}>›</Text>
                    </Pressable>
                  </>
                )}
              </View>

              {/* Right: Translation (Scripture), Echoes, Focus */}
              <View style={styles.bottomRight}>
                {isScripture && onChangeTranslation ? (
                  <TranslationSelector
                    value={mode.translation}
                    onChange={onChangeTranslation}
                    placement="bottom"
                  />
                ) : null}

                <Pressable
                  onPress={() => void handleOpenEchoes()}
                  hitSlop={6}
                  style={[
                    styles.navIconBtn,
                    { borderColor: theme.border, backgroundColor: theme.surface },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Find resonant echoes for current passage"
                >
                  <SparklesIcon size={17} color={theme.accent} />
                </Pressable>

                <Pressable
                  onPress={() => setImmersive(true)}
                  hitSlop={6}
                  style={[
                    styles.focusPill,
                    { borderColor: theme.border, backgroundColor: theme.surface },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Focus reading mode"
                >
                  <Text style={[styles.focusPillText, { color: theme.textSecondary }]}>
                    Focus
                  </Text>
                </Pressable>
              </View>
            </View>
          )}
        </View>
      )}

      {/* ── Unified Book Drawer (Contents · Highlights · Bookmarks) ────── */}
      <BookDrawerModal
        visible={drawerState.open}
        initialTab={drawerState.tab}
        theme={theme}
        bookTitle={headerTitle}
        bookAuthor={isScripture ? `${mode.translation} Scripture` : libraryBook?.author}
        isScripture={isScripture}
        totalChapters={isScripture ? mode.totalChapters : undefined}
        currentChapterNumber={isScripture ? mode.chapter : undefined}
        onSelectScriptureChapter={(ch) =>
          isScripture && onNavigateChapter?.(mode.bookName, ch)
        }
        chapters={chapters}
        currentChapterIndex={currentChapterIdx}
        highlightCountsByChapter={highlightCountsByChapter}
        onSelectLibraryChapter={jumpToLibraryChapter}
        highlights={highlights}
        bookmarks={bookBookmarks}
        onJumpToHighlight={handleJumpToHighlight}
        onJumpToBookmark={handleJumpToBookmark}
        onRemoveBookmark={(ref) => void handleRemoveBookmark(ref)}
        onClose={() => setDrawerState((prev) => ({ ...prev, open: false }))}
      />

      {/* ── Reading Typography Sheet (`Aa`) ────────────────────────────── */}
      <ReaderAppearanceSheet
        visible={appearanceOpen}
        prefs={prefs}
        theme={theme}
        isScripture={isScripture}
        onChange={updatePrefs}
        onClose={() => setAppearanceOpen(false)}
      />

      {/* ── Margin Note Composer Modal ─────────────────────────────────── */}
      <NoteModal
        visible={noteModal !== null}
        verseRef={noteModal ? sourceLabelForBlock(noteModal.block) : ''}
        quoteContext={noteModal?.quoteContext ?? null}
        initialText={noteModal?.highlight?.note_text ?? ''}
        initialTags={noteModal?.highlight?.tags ?? []}
        initialColor={noteModal?.highlight?.color ?? activeColor}
        theme={theme}
        isEdit={Boolean(
          noteModal?.highlight?.id && !noteModal.highlight.id.startsWith('opt-')
        )}
        onSave={(txt, meta) => void handleNoteSave(txt, meta)}
        onDelete={() => void handleNoteDelete()}
        onClose={() => setNoteModal(null)}
      />

      {/* ── Bidirectional Passage Echoes Sheet (`✦`) ───────────────────── */}
      <PassageEchoesSheet
        visible={echoesState.visible}
        theme={theme}
        sourceLabel={echoesState.sourceLabel}
        passageExcerpt={echoesState.excerpt}
        loading={echoesState.loading}
        result={echoesState.result}
        onOpenCard={handleOpenEchoCard}
        onSendToJournal={(quote, src) => {
          void dataLayer.appendQuoteToJournal(quote, src);
        }}
        onClose={() => setEchoesState((prev) => ({ ...prev, visible: false }))}
      />
    </View>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  pressed: {
    opacity: 0.6,
  },
  disabled: {
    opacity: 0.35,
  },
  topHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 6,
    minHeight: 48,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    minHeight: TOUCH_MIN,
    paddingRight: spacing.xs,
  },
  backBtnText: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 13.5,
  },
  topTitleWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
  },
  topTitle: {
    fontFamily: fontFamilies.serifSemibold,
    fontSize: 17.5,
    textAlign: 'center',
  },
  topSubtitle: {
    fontFamily: fontFamilies.sans,
    fontSize: 11,
    textAlign: 'center',
  },
  topActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  headerIconBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.sm,
  },
  // ── In-book Find Bar ────────────────────────────────────────────────────
  findBar: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 6,
  },
  findRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  findInputWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.md,
    paddingHorizontal: spacing.sm + 2,
    gap: 6,
  },
  findInput: {
    flex: 1,
    fontFamily: fontFamilies.sans,
    fontSize: 14,
    paddingVertical: 7,
  },
  findCount: {
    fontFamily: fontFamilies.sansSemibold,
    fontSize: 11.5,
  },
  findNavBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.sm,
  },
  findModeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  findModePill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  findModeText: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 11.5,
  },
  findListToggle: {
    marginLeft: 'auto',
    paddingVertical: 4,
  },
  findListToggleText: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 11.5,
  },
  findDropdown: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 4,
    maxHeight: 210,
  },
  findDropdownRow: {
    paddingVertical: 6,
    paddingHorizontal: 6,
    borderRadius: radii.sm,
    gap: 2,
  },
  findDropdownCh: {
    fontFamily: fontFamilies.sansSemibold,
    fontSize: 11,
  },
  findDropdownSnip: {
    fontFamily: fontFamilies.serif,
    fontSize: 14,
    lineHeight: 19,
  },
  // ── Reading Body ────────────────────────────────────────────────────────
  centerLoading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  passageList: {
    flex: 1,
  },
  passageListContent: {
    paddingTop: spacing.lg,
    maxWidth: 720,
    width: '100%',
    alignSelf: 'center',
  },
  headingBlock: {
    paddingTop: spacing.xl,
    paddingBottom: spacing.sm,
    marginBottom: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headingBlockMajor: {
    paddingTop: spacing.xxl,
    alignItems: 'center',
  },
  headingRule: {
    width: 36,
    height: 2,
    borderRadius: 1,
    marginBottom: spacing.sm,
  },
  h1Text: {
    fontFamily: fontFamilies.serifSemibold,
    fontSize: 24,
    lineHeight: 31,
    textAlign: 'center',
    letterSpacing: 0.3,
  },
  h2Text: {
    fontFamily: fontFamilies.serifSemibold,
    fontSize: 19,
    lineHeight: 26,
  },
  dividerBlock: {
    paddingVertical: spacing.lg,
    alignItems: 'center',
  },
  dividerGlyph: {
    fontFamily: fontFamilies.serif,
    fontSize: 20,
  },
  blockOuter: {
    marginBottom: spacing.md,
  },
  blockOuterFlow: {
    marginBottom: spacing.xs + 2,
  },
  blockInner: {
    flexDirection: 'row',
    paddingVertical: 3,
    paddingHorizontal: 4,
  },
  blockquoteWrap: {
    borderLeftWidth: 2.5,
    paddingLeft: spacing.md,
    marginVertical: spacing.xs,
  },
  poetryWrap: {
    paddingLeft: spacing.lg,
  },
  epigraphWrap: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  listItemWrap: {
    paddingLeft: spacing.sm,
  },
  listBullet: {
    fontSize: 16,
    marginRight: 8,
    marginTop: 2,
  },
  verseMarginNum: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 10.5,
    marginTop: 6,
    marginRight: 8,
    minWidth: 22,
    textAlign: 'right',
  },
  blockTextCol: {
    flex: 1,
  },
  // ── Collapsible Margin Note Accordion ───────────────────────────────────
  noteAccordion: {
    marginLeft: 18,
    marginTop: 4,
    borderLeftWidth: 2.5,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 6,
  },
  noteAccordionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  noteAccordionToggle: {
    fontFamily: fontFamilies.sansSemibold,
    fontSize: 11.5,
  },
  noteAccordionTags: {
    fontFamily: fontFamilies.sans,
    fontSize: 11,
    flexShrink: 1,
  },
  noteAccordionBody: {
    marginTop: 5,
    gap: 3,
  },
  noteAccordionText: {
    fontFamily: fontFamilies.serifItalic,
    fontStyle: 'italic',
    fontSize: 14.5,
    lineHeight: 20,
  },
  noteTimestamp: {
    fontFamily: fontFamilies.sans,
    fontSize: 10.5,
  },
  nextChapterCard: {
    marginTop: spacing.xl,
    marginBottom: spacing.md,
    padding: spacing.lg,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    gap: 4,
  },
  nextChapterEyebrow: {
    fontFamily: fontFamilies.sansSemibold,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  nextChapterTitle: {
    fontFamily: fontFamilies.serifSemibold,
    fontSize: 19,
  },
  endOfWork: {
    paddingVertical: spacing.xl,
    alignItems: 'center',
  },
  // ── Bottom Chrome ───────────────────────────────────────────────────────
  bottomChrome: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  bottomChromeWeb: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    position: 'fixed' as any,
    bottom: 60,
    left: 0,
    right: 0,
    zIndex: 240,
  },
  progressTrack: {
    height: 2,
    width: '100%',
  },
  progressFill: {
    height: '100%',
  },
  immersiveFooter: {
    paddingVertical: 8,
    alignItems: 'center',
  },
  progressText: {
    fontFamily: fontFamilies.sans,
    fontSize: 11,
  },
  bottomNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 6,
  },
  bottomLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  bottomRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  navIconBtn: {
    width: 38,
    height: 38,
    borderRadius: radii.sm,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navStepBtn: {
    width: 34,
    height: 38,
    borderRadius: radii.sm,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navArrow: {
    fontFamily: fontFamilies.serif,
    fontSize: 20,
    lineHeight: 22,
  },
  posBtn: {
    paddingHorizontal: 6,
    height: 38,
    justifyContent: 'center',
    alignItems: 'center',
  },
  posText: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 12,
  },
  focusPill: {
    height: 38,
    paddingHorizontal: 10,
    borderRadius: radii.sm,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  focusPillText: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 12,
  },
});
