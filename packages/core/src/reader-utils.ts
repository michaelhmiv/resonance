/**
 * Reader v2 pure-TypeScript utilities — shared across mobile & web.
 *
 * Powers:
 *   - Rich reading block reconstruction (paragraphs, poetry, blockquotes,
 *     headings, dividers, inline Scripture references & emphasis spans)
 *   - Hierarchical chapter / TOC outline inference (for both structured EPUBs
 *     and flat Church Library packs)
 *   - Scripture Paragraph Flow vs. Verse Study layout
 *   - Native word/sentence-snapping phrase selection & W3C TextQuoteSelector
 *     re-anchoring
 *   - Smart Scripture reference jump parsing ("Rom 8:28", "1 cor 13:4-7")
 *   - Fast in-book keyword search with snippet extraction
 *   - Contextualized highlight/note embedding prompts & Markdown export
 */

import { resolveBibleBookName } from './bible-canon';
import type {
  BookChapter,
  Highlight,
  InBookSearchHit,
  InlineSpan,
  LibraryPassage,
  ReaderPreferences,
  ReadingBlock,
  ReadingBlockKind,
  SmartReferenceJump,
  VersePassage,
} from './types';

// ── Default Reader Preferences ──────────────────────────────────────────────

export const DEFAULT_READER_PREFERENCES: ReaderPreferences = {
  theme: 'cream',
  fontFamily: 'garamond',
  fontSize: 18,
  lineHeightMultiplier: 1.65,
  margin: 'book',
  align: 'left',
  scriptureMode: 'study',
  showMarginEchoes: true,
};

export function parseReaderPreferences(
  raw: string | null | undefined,
  legacyFontSize?: string
): ReaderPreferences {
  const base: ReaderPreferences = { ...DEFAULT_READER_PREFERENCES };
  if (legacyFontSize === 'small') base.fontSize = 15;
  else if (legacyFontSize === 'large') base.fontSize = 21;

  if (!raw) return base;
  try {
    const parsed = JSON.parse(raw) as Partial<ReaderPreferences>;
    if (
      parsed.theme === 'cream' ||
      parsed.theme === 'parchment' ||
      parsed.theme === 'dusk' ||
      parsed.theme === 'night'
    ) {
      base.theme = parsed.theme;
    }
    if (
      parsed.fontFamily === 'garamond' ||
      parsed.fontFamily === 'serif' ||
      parsed.fontFamily === 'sans'
    ) {
      base.fontFamily = parsed.fontFamily;
    }
    if (typeof parsed.fontSize === 'number' && parsed.fontSize >= 14 && parsed.fontSize <= 28) {
      base.fontSize = Math.round(parsed.fontSize);
    }
    if (
      typeof parsed.lineHeightMultiplier === 'number' &&
      parsed.lineHeightMultiplier >= 1.35 &&
      parsed.lineHeightMultiplier <= 2.1
    ) {
      base.lineHeightMultiplier = Math.round(parsed.lineHeightMultiplier * 100) / 100;
    }
    if (parsed.margin === 'compact' || parsed.margin === 'book' || parsed.margin === 'wide') {
      base.margin = parsed.margin;
    }
    if (parsed.align === 'left' || parsed.align === 'justify') {
      base.align = parsed.align;
    }
    if (parsed.scriptureMode === 'flow' || parsed.scriptureMode === 'study') {
      base.scriptureMode = parsed.scriptureMode;
    }
    if (typeof parsed.showMarginEchoes === 'boolean') {
      base.showMarginEchoes = parsed.showMarginEchoes;
    }
  } catch {
    // ignore malformed preference JSON
  }
  return base;
}

export function serializeReaderPreferences(prefs: ReaderPreferences): string {
  return JSON.stringify(prefs);
}

// ── Word Count & Reading Time ───────────────────────────────────────────────

export function countReadingWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

export function estimateReadingMinutes(wordCount: number, wpm = 210): number {
  if (wordCount <= 0) return 0;
  return Math.max(1, Math.ceil(wordCount / wpm));
}

// ── Smart Scripture Reference Parser ("Rom 8:28", "ps 23", "1 cor 13:4-7") ──

const REF_QUERY_RE =
  /^((?:[1-3]\s*)?[a-zA-Z]+(?:\s+[a-zA-Z]+){0,3}?)\.?\s+(\d{1,3})(?:\s*[:.]\s*(\d{1,3})(?:\s*[-–]\s*(\d{1,3}))?)?$/;

export function parseReferenceQuery(rawQuery: string): SmartReferenceJump | null {
  const q = rawQuery.trim();
  if (q.length < 3 || q.length > 48) return null;
  const m = REF_QUERY_RE.exec(q);
  if (!m) return null;

  const bookCandidate = m[1].trim();
  const resolved = resolveBibleBookName(bookCandidate);
  if (!resolved) return null;

  const chapter = parseInt(m[2], 10);
  if (!Number.isFinite(chapter) || chapter < 1 || chapter > 150) return null;

  const verseStart = m[3] ? parseInt(m[3], 10) : undefined;
  const verseEnd = m[4] ? parseInt(m[4], 10) : undefined;

  let label = `${resolved} ${chapter}`;
  if (verseStart != null) {
    label += `:${verseStart}`;
    if (verseEnd != null && verseEnd > verseStart) {
      label += `–${verseEnd}`;
    }
  }

  return {
    kind: 'scripture',
    bookName: resolved,
    chapter,
    verseStart,
    verseEnd,
    label,
  };
}

// ── Inline Span Detection (Scripture Refs inside Library Prose) ─────────────

const INLINE_SCRIPTURE_RE =
  /\b((?:[1-3]\s)?(?:Gen|Exod?|Lev|Num|Deut|Josh|Judg|Ruth|Sam|Kgs|Kings|Chr|Chron|Ezra|Neh|Esth|Job|Psa?s?|Psalms?|Prov|Eccl|Song|Isa|Jer|Lam|Ezek|Dan|Hos|Joel|Amos|Obad|Jonah|Mic|Nah|Hab|Zeph|Hag|Zech|Mal|Matt?|Mark|Luke|John|Jn|Acts|Rom|Cor|Gal|Eph|Phil|Col|Thess|Tim|Titus|Phlm|Heb|Jas|James|Pet|Jude|Rev)\.?)\s+(\d{1,3}):(\d{1,3}(?:[-–]\d{1,3})?)\b/g;

export function detectInlineScriptureSpans(text: string): InlineSpan[] {
  const spans: InlineSpan[] = [];
  INLINE_SCRIPTURE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = INLINE_SCRIPTURE_RE.exec(text)) !== null) {
    const resolved = resolveBibleBookName(m[1].replace(/\.$/, ''));
    if (!resolved) continue;
    const chapter = m[2];
    const versePart = m[3].split(/[-–]/)[0];
    spans.push({
      start: m.index,
      end: m.index + m[0].length,
      kind: 'scripture_ref',
      target: `${resolved} ${chapter}:${versePart}`,
    });
  }
  return spans;
}

// ── Block Kind & Hierarchy Heuristics ───────────────────────────────────────

const POETIC_BIBLE_BOOKS = new Set([
  'Psalms',
  'Proverbs',
  'Song of Solomon',
  'Lamentations',
  'Job',
]);

const MAJOR_HEADING_RE =
  /^(BOOK|PART|VOLUME|TREATISE|SERMON|HOMILY|CONFERENCE|MANSION|CENTURY|EPISTLE|LETTER)\s+([IVXLCDM]+|\d+|ONE|TWO|THREE|FOUR|FIVE|SIX|SEVEN|EIGHT|NINE|TEN|FIRST|SECOND|THIRD|FOURTH|FIFTH)\b/i;

const CHAPTER_HEADING_RE =
  /^(CHAPTER|CHAP\.?|SECTION|SECT\.?|QUESTION|ARTICLE|MEDITATION|PRAYER|CANON|ACT|DISCOURSE|DAY|WEEK|LECTURE)\s+([IVXLCDM]+|\d+)\b/i;

const ORNAMENT_DIVIDER_RE = /^(\*\s*\*\s*\*|—\s*—\s*—|-{3,}|_{3,}|❦|§\s*§)$/;

function classifyParagraphKind(text: string): ReadingBlockKind {
  const t = text.trim();
  if (ORNAMENT_DIVIDER_RE.test(t)) return 'divider';

  const lines = t.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length >= 3) {
    const avgLen = lines.reduce((acc, l) => acc + l.length, 0) / lines.length;
    if (avgLen <= 68 && lines.every((l) => l.length <= 95)) {
      return 'poetry';
    }
  }

  // Blockquote heuristic: starts and ends with quotation marks and >= 90 chars
  if (
    t.length >= 90 &&
    ((t.startsWith('“') && t.endsWith('”')) ||
      (t.startsWith('"') && t.endsWith('"')))
  ) {
    return 'blockquote';
  }

  // Short standalone italicized/epigraph-style quote with attribution dash
  if (t.length <= 220 && /[—–]\s*[A-Z][a-z]+/.test(t) && t.startsWith('"')) {
    return 'epigraph';
  }

  // List item heuristic
  if (/^(?:•|-|\d+[.)]|[a-z][.)])\s+\S/.test(t) && t.length <= 320) {
    return 'list_item';
  }

  return 'paragraph';
}

function splitDivisionHierarchy(rawDivision: string): {
  parent: string | null;
  title: string;
  level: number;
} {
  const clean = rawDivision.trim().replace(/\s+/g, ' ');
  // Split compound divisions like "Book I — Chapter 3" or "Part II: On Humility" or "Book I / Ch. 2"
  const sepMatch = /^(.+?)\s+(?:—|–|\/|\||::)\s+(.+)$/.exec(clean);
  if (sepMatch) {
    const left = sepMatch[1].trim();
    const right = sepMatch[2].trim();
    if (left.length <= 60 && right.length >= 2) {
      return { parent: left, title: right, level: 2 };
    }
  }

  if (MAJOR_HEADING_RE.test(clean)) {
    return { parent: null, title: clean, level: 1 };
  }
  if (CHAPTER_HEADING_RE.test(clean)) {
    return { parent: null, title: clean, level: 2 };
  }
  return { parent: null, title: clean, level: 1 };
}

function detectEmbeddedHeading(paragraph: string): {
  heading: string;
  level: number;
  rest: string;
} | null {
  const trimmed = paragraph.trim();
  // Case 1: Standalone short heading paragraph
  if (
    trimmed.length >= 3 &&
    trimmed.length <= 85 &&
    !trimmed.includes('\n') &&
    !/[.!?;,]$/.test(trimmed)
  ) {
    if (MAJOR_HEADING_RE.test(trimmed)) {
      return { heading: trimmed, level: 1, rest: '' };
    }
    if (CHAPTER_HEADING_RE.test(trimmed)) {
      return { heading: trimmed, level: 2, rest: '' };
    }
    // Roman numeral standalone heading like "IV." or "CHAPTER IV"
    if (/^[IVXLCDM]{1,7}\.?$/.test(trimmed)) {
      return { heading: `Chapter ${trimmed.replace(/\.$/, '')}`, level: 2, rest: '' };
    }
  }
  return null;
}

export interface ReconstructedBookDocument {
  blocks: ReadingBlock[];
  chapters: BookChapter[];
  totalWords: number;
  estimatedMinutes: number;
}

/**
 * Reconstruct a structured, book-grade reading surface (rich blocks + nested
 * chapter outline) from a book's passages. Works seamlessly for both newly
 * imported rich documents AND existing Church Library packs.
 */
export function reconstructBookDocument(
  bookId: string,
  passages: LibraryPassage[],
  fallbackTitle = 'Opening'
): ReconstructedBookDocument {
  if (passages.length === 0) {
    return { blocks: [], chapters: [], totalWords: 0, estimatedMinutes: 0 };
  }

  const blocks: ReadingBlock[] = [];
  const chapters: BookChapter[] = [];
  const parentIdByTitle = new Map<string, string>();

  const hasExplicitDivisions = passages.some(
    (p) => typeof p.division === 'string' && p.division.trim().length > 0
  );

  let activeChapterIdx = -1;
  let activeDivisionKey: string | null = null;
  let activeParentId: string | null = null;

  const ensureChapter = (
    rawTitle: string,
    levelHint?: number,
    explicitParentTitle?: string | null
  ): number => {
    const parsed = explicitParentTitle
      ? { parent: explicitParentTitle, title: rawTitle, level: levelHint ?? 2 }
      : splitDivisionHierarchy(rawTitle);

    let parentId: string | null = null;
    if (parsed.parent) {
      const pKey = parsed.parent.toLowerCase();
      let existingPid = parentIdByTitle.get(pKey);
      if (!existingPid) {
        existingPid = `${bookId}:ch:${chapters.length}`;
        parentIdByTitle.set(pKey, existingPid);
        const startIdx = blocks.length;
        chapters.push({
          id: existingPid,
          bookId,
          parentId: null,
          level: 1,
          orderIndex: chapters.length,
          title: parsed.parent,
          startBlockIndex: startIdx,
          endBlockIndex: startIdx,
          wordCount: 0,
          estimatedMinutes: 0,
          passageCount: 0,
        });
        blocks.push({
          id: `${bookId}:h1:${blocks.length}`,
          anchorRef: `${bookId}#h:${chapters.length - 1}`,
          bookId,
          chapterId: existingPid,
          chapterIndex: chapters.length - 1,
          blockIndex: blocks.length,
          kind: 'h1',
          text: parsed.parent,
          level: 1,
          division: parsed.parent,
        });
      }
      parentId = existingPid;
      activeParentId = existingPid;
    } else if ((levelHint ?? parsed.level) === 2 && activeParentId) {
      parentId = activeParentId;
    } else if ((levelHint ?? parsed.level) === 1) {
      activeParentId = `${bookId}:ch:${chapters.length}`;
    }

    const chapterIdx = chapters.length;
    const chapterId = `${bookId}:ch:${chapterIdx}`;
    const level = levelHint ?? parsed.level;
    const startIdx = blocks.length;

    chapters.push({
      id: chapterId,
      bookId,
      parentId,
      level,
      orderIndex: chapterIdx,
      title: parsed.title,
      startBlockIndex: startIdx,
      endBlockIndex: startIdx,
      wordCount: 0,
      estimatedMinutes: 0,
      passageCount: 0,
    });

    blocks.push({
      id: `${bookId}:hd:${blocks.length}`,
      anchorRef: `${bookId}#h:${chapterIdx}`,
      bookId,
      chapterId,
      chapterIndex: chapterIdx,
      blockIndex: blocks.length,
      kind: level <= 1 ? 'h1' : 'h2',
      text: parsed.title,
      level,
      division: parsed.title,
    });

    return chapterIdx;
  };

  // Fallback synthetic sectioning only when a book truly has zero headings or divisions
  let passagesInCurrentPart = 0;
  const SYNTHETIC_PART_SIZE = 22;

  for (let pIdx = 0; pIdx < passages.length; pIdx++) {
    const p = passages[pIdx];
    const div = typeof p.division === 'string' && p.division.trim().length > 0
      ? p.division.trim()
      : null;

    if (hasExplicitDivisions) {
      const targetDiv: string = div ?? activeDivisionKey ?? fallbackTitle;
      if (targetDiv !== activeDivisionKey) {
        activeDivisionKey = targetDiv;
        activeChapterIdx = ensureChapter(targetDiv);
      }
    } else if (activeChapterIdx < 0) {
      activeChapterIdx = ensureChapter(fallbackTitle, 1);
    }

    // Split retrieval chunks back into natural paragraphs along blank lines
    const rawParas = p.text
      .split(/\n{2,}/)
      .map((s) => s.trim())
      .filter(Boolean);

    const stableChunkNum = p.chunk_id ?? pIdx;

    for (let paraIdx = 0; paraIdx < rawParas.length; paraIdx++) {
      const para = rawParas[paraIdx];

      // Check for embedded headings inside books lacking division metadata
      if (!hasExplicitDivisions) {
        const embedded = detectEmbeddedHeading(para);
        if (embedded) {
          activeChapterIdx = ensureChapter(embedded.heading, embedded.level);
          passagesInCurrentPart = 0;
          if (!embedded.rest) continue;
        }
      }

      if (activeChapterIdx < 0) {
        activeChapterIdx = ensureChapter(fallbackTitle, 1);
      }

      const kind = classifyParagraphKind(para);
      const spans =
        kind === 'paragraph' || kind === 'blockquote' || kind === 'list_item'
          ? detectInlineScriptureSpans(para)
          : undefined;

      const ch = chapters[activeChapterIdx];
      const blockIndex = blocks.length;
      const anchorRef =
        rawParas.length === 1
          ? String(p.id)
          : `${bookId}#c${stableChunkNum}:p${paraIdx}`;

      blocks.push({
        id: `p:${p.id}:${paraIdx}`,
        anchorRef,
        legacyRef: paraIdx === 0 ? String(p.id) : undefined,
        bookId,
        chapterId: ch.id,
        chapterIndex: activeChapterIdx,
        blockIndex,
        kind,
        text: para,
        spans: spans && spans.length > 0 ? spans : undefined,
        passageId: p.id,
        chunkIndex: p.chunk_id ?? pIdx,
        division: p.division ?? ch.title,
      });

      const w = countReadingWords(para);
      ch.wordCount += w;
      ch.endBlockIndex = blockIndex;
      if (paraIdx === 0) ch.passageCount += 1;
    }

    if (!hasExplicitDivisions) {
      passagesInCurrentPart += 1;
      // Only create synthetic parts if the book had zero embedded headings either
      if (
        chapters.length <= 1 &&
        passages.length > SYNTHETIC_PART_SIZE + 8 &&
        passagesInCurrentPart >= SYNTHETIC_PART_SIZE &&
        pIdx < passages.length - 4
      ) {
        // Defer: we'll only slice if no embedded heading ever appeared
      }
    }
  }

  // If a long book had ZERO divisions and ZERO embedded headings, create clean reading parts
  if (chapters.length === 1 && blocks.length > 45) {
    const allContentBlocks = blocks.filter((b) => b.kind !== 'h1' && b.kind !== 'h2');
    const rebuiltBlocks: ReadingBlock[] = [];
    const rebuiltChapters: BookChapter[] = [];
    const PART_BLOCKS = 28;
    for (let i = 0; i < allContentBlocks.length; i += PART_BLOCKS) {
      const slice = allContentBlocks.slice(i, i + PART_BLOCKS);
      const chIdx = rebuiltChapters.length;
      const chId = `${bookId}:ch:${chIdx}`;
      const title = `Section ${chIdx + 1}`;
      const startIdx = rebuiltBlocks.length;
      rebuiltBlocks.push({
        id: `${bookId}:hd:${startIdx}`,
        anchorRef: `${bookId}#h:${chIdx}`,
        bookId,
        chapterId: chId,
        chapterIndex: chIdx,
        blockIndex: startIdx,
        kind: 'h2',
        text: title,
        level: 2,
        division: title,
      });
      let words = 0;
      const seenPassages = new Set<number>();
      for (const blk of slice) {
        const idx = rebuiltBlocks.length;
        words += countReadingWords(blk.text);
        if (blk.passageId != null) seenPassages.add(blk.passageId);
        rebuiltBlocks.push({
          ...blk,
          chapterId: chId,
          chapterIndex: chIdx,
          blockIndex: idx,
        });
      }
      rebuiltChapters.push({
        id: chId,
        bookId,
        parentId: null,
        level: 1,
        orderIndex: chIdx,
        title,
        startBlockIndex: startIdx,
        endBlockIndex: rebuiltBlocks.length - 1,
        wordCount: words,
        estimatedMinutes: estimateReadingMinutes(words),
        passageCount: seenPassages.size || slice.length,
      });
    }
    const totalWords = rebuiltChapters.reduce((a, c) => a + c.wordCount, 0);
    return {
      blocks: rebuiltBlocks,
      chapters: rebuiltChapters,
      totalWords,
      estimatedMinutes: estimateReadingMinutes(totalWords),
    };
  }

  // Finalize estimated reading times & parent chapter rollups
  let totalWords = 0;
  for (const ch of chapters) {
    ch.estimatedMinutes = estimateReadingMinutes(ch.wordCount);
    totalWords += ch.wordCount;
  }

  return {
    blocks,
    chapters,
    totalWords,
    estimatedMinutes: estimateReadingMinutes(totalWords),
  };
}

// ── Scripture Document Builder (Flow vs. Study) ─────────────────────────────

export function isPoeticBibleBook(bookName: string): boolean {
  return POETIC_BIBLE_BOOKS.has(bookName);
}

export function formatScriptureRef(
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

export function buildScriptureBlocks(
  bookName: string,
  chapter: number,
  verses: VersePassage[]
): ReadingBlock[] {
  const poetic = isPoeticBibleBook(bookName);
  const chapterId = `${bookName}:${chapter}`;
  return verses.map((v, idx) => {
    const ref = formatScriptureRef(bookName, chapter, v.verse_start, v.verse_end);
    return {
      id: `v:${v.id}`,
      anchorRef: ref,
      bookId: bookName,
      chapterId,
      chapterIndex: chapter - 1,
      blockIndex: idx,
      kind: poetic ? 'poetry' : 'paragraph',
      text: v.text,
      passageId: v.id,
      verseStart: v.verse_start,
      verseEnd: v.verse_end,
    };
  });
}

// ── Native Word / Sentence Selection & W3C TextQuoteSelector Anchoring ─────

export interface TextRange {
  start: number;
  end: number;
}

/** Find sentence boundaries around a character offset (defaults to first sentence). */
export function getSentenceRange(text: string, offset = 0): TextRange {
  if (!text) return { start: 0, end: 0 };
  const clamped = Math.max(0, Math.min(offset, text.length - 1));
  let start = 0;
  for (let i = clamped; i > 0; i--) {
    const prev = text[i - 1];
    if ((prev === '.' || prev === '!' || prev === '?' || prev === '\n') && /\s/.test(text[i])) {
      start = i;
      while (start < text.length && /\s/.test(text[start])) start++;
      break;
    }
  }
  let end = text.length;
  for (let i = clamped; i < text.length; i++) {
    const ch = text[i];
    if (ch === '.' || ch === '!' || ch === '?') {
      end = i + 1;
      // Include closing quote/paren if immediately following punctuation
      while (end < text.length && /["”’)\]]/.test(text[end])) end++;
      break;
    }
    if (ch === '\n') {
      end = i;
      break;
    }
  }
  if (end <= start) return { start: 0, end: text.length };
  return { start, end };
}

/** Expand or shrink a selection boundary by one word in either direction. */
export function stepRangeByWord(
  text: string,
  range: TextRange,
  edge: 'start' | 'end',
  direction: 'left' | 'right'
): TextRange {
  const len = text.length;
  if (len === 0) return { start: 0, end: 0 };

  if (edge === 'start') {
    let s = range.start;
    if (direction === 'left') {
      while (s > 0 && /\s/.test(text[s - 1])) s--;
      while (s > 0 && !/\s/.test(text[s - 1])) s--;
    } else {
      while (s < range.end && !/\s/.test(text[s])) s++;
      while (s < range.end && /\s/.test(text[s])) s++;
      if (s >= range.end) return range;
    }
    return { start: Math.max(0, s), end: range.end };
  } else {
    let e = range.end;
    if (direction === 'right') {
      while (e < len && /\s/.test(text[e])) e++;
      while (e < len && !/\s/.test(text[e])) e++;
    } else {
      while (e > range.start && /\s/.test(text[e - 1])) e--;
      while (e > range.start && !/\s/.test(text[e - 1])) e--;
      while (e > range.start && /\s/.test(text[e - 1])) e--;
      if (e <= range.start) return range;
    }
    return { start: range.start, end: Math.min(len, e) };
  }
}

/** Extract W3C TextQuoteSelector prefix & suffix (32 chars each) for durable anchoring. */
export function extractQuoteAffixes(
  fullText: string,
  startOffset: number,
  endOffset: number
): { selectedText: string; quotePrefix: string; quoteSuffix: string } {
  const s = Math.max(0, Math.min(startOffset, fullText.length));
  const e = Math.max(s, Math.min(endOffset, fullText.length));
  return {
    selectedText: fullText.slice(s, e),
    quotePrefix: fullText.slice(Math.max(0, s - 32), s),
    quoteSuffix: fullText.slice(e, Math.min(fullText.length, e + 32)),
  };
}

/**
 * Re-anchor a highlight onto block text using offsets first, then falling back
 * to W3C TextQuoteSelector (quote_exact + quote_prefix + quote_suffix).
 */
export function resolveHighlightOffsets(
  blockText: string,
  highlight: Highlight
): TextRange | null {
  if (!blockText) return null;

  // 1. Direct offset verification
  if (
    highlight.start_offset != null &&
    highlight.end_offset != null &&
    highlight.start_offset >= 0 &&
    highlight.end_offset <= blockText.length &&
    highlight.start_offset < highlight.end_offset
  ) {
    if (
      !highlight.selected_text ||
      blockText.slice(highlight.start_offset, highlight.end_offset) ===
        highlight.selected_text
    ) {
      return { start: highlight.start_offset, end: highlight.end_offset };
    }
  }

  // 2. W3C TextQuoteSelector fuzzy anchor
  if (highlight.selected_text && highlight.selected_text.length > 0) {
    const exact = highlight.selected_text;
    let idx = blockText.indexOf(exact);
    if (idx >= 0) {
      // If multiple occurrences exist, disambiguate via prefix/suffix
      if (highlight.quote_prefix || highlight.quote_suffix) {
        let bestIdx = idx;
        let bestScore = -1;
        let searchFrom = 0;
        while ((idx = blockText.indexOf(exact, searchFrom)) >= 0) {
          let score = 0;
          if (
            highlight.quote_prefix &&
            blockText.slice(Math.max(0, idx - highlight.quote_prefix.length), idx) ===
              highlight.quote_prefix
          ) {
            score += 2;
          }
          if (
            highlight.quote_suffix &&
            blockText.slice(
              idx + exact.length,
              idx + exact.length + highlight.quote_suffix.length
            ) === highlight.quote_suffix
          ) {
            score += 2;
          }
          if (score > bestScore) {
            bestScore = score;
            bestIdx = idx;
          }
          searchFrom = idx + 1;
        }
        return { start: bestIdx, end: bestIdx + exact.length };
      }
      return { start: idx, end: idx + exact.length };
    }
  }

  // 3. Legacy full-block fallback
  if (highlight.start_offset == null && highlight.end_offset == null) {
    return { start: 0, end: blockText.length };
  }

  return null;
}

// ── In-Book Keyword Search ──────────────────────────────────────────────────

export function searchBlocksKeyword(
  blocks: ReadingBlock[],
  chapters: BookChapter[],
  rawQuery: string,
  maxHits = 200
): InBookSearchHit[] {
  const q = rawQuery.trim();
  if (q.length === 0) return [];
  const qLower = q.toLowerCase();
  const terms = qLower.split(/\s+/).filter(Boolean);
  const hits: InBookSearchHit[] = [];

  for (const blk of blocks) {
    if (blk.kind === 'divider') continue;
    const textLower = blk.text.toLowerCase();
    const exactIdx = textLower.indexOf(qLower);

    let matchStart = exactIdx;
    let matchEnd = exactIdx >= 0 ? exactIdx + q.length : -1;
    let score = exactIdx >= 0 ? 1.0 : 0;

    // Multi-word AND fallback when exact phrase isn't contiguous
    if (exactIdx < 0 && terms.length > 1) {
      if (terms.every((t) => textLower.includes(t))) {
        const firstIdx = textLower.indexOf(terms[0]);
        matchStart = firstIdx;
        matchEnd = firstIdx + terms[0].length;
        score = 0.72;
      }
    }

    if (matchStart < 0) continue;

    const snipStart = Math.max(0, matchStart - 48);
    const snipEnd = Math.min(blk.text.length, matchEnd + 72);
    const prefix = snipStart > 0 ? '…' : '';
    const suffix = snipEnd < blk.text.length ? '…' : '';
    const snippet = `${prefix}${blk.text.slice(snipStart, snipEnd).replace(/\s+/g, ' ')}${suffix}`;

    const chTitle =
      chapters[blk.chapterIndex]?.title ?? blk.division ?? `Section ${blk.chapterIndex + 1}`;

    hits.push({
      blockId: blk.id,
      anchorRef: blk.anchorRef,
      passageId: blk.passageId ?? null,
      chapterIndex: blk.chapterIndex,
      chapterTitle: chTitle,
      blockIndex: blk.blockIndex,
      snippet,
      matchStart,
      matchEnd,
      score,
      mode: 'keyword',
    });

    if (hits.length >= maxHits) break;
  }

  return hits;
}

// ── Contextual Embedding Prompts & Citations ────────────────────────────────

export function buildHighlightEmbedText(input: {
  sourceLabel?: string | null;
  verseRef: string;
  selectedText: string;
  contextText?: string | null;
  tags?: string[];
}): string {
  const source = input.sourceLabel?.trim() || input.verseRef;
  const parts = [`${source}: ${input.selectedText.trim()}`];
  // Add surrounding sentence context if the highlight itself is short (<12 words)
  if (
    input.contextText &&
    countReadingWords(input.selectedText) < 12 &&
    input.contextText.trim().length > input.selectedText.trim().length
  ) {
    parts.push(`Context: ${input.contextText.trim().slice(0, 320)}`);
  }
  if (input.tags && input.tags.length > 0) {
    parts.push(`Themes: ${input.tags.join(', ')}`);
  }
  return parts.join('\n');
}

export function buildNoteEmbedText(input: {
  sourceLabel?: string | null;
  verseRef: string;
  selectedText?: string | null;
  noteText: string;
  tags?: string[];
}): string {
  const source = input.sourceLabel?.trim() || input.verseRef;
  const parts = [`Personal note on ${source}`];
  if (input.selectedText?.trim()) {
    parts.push(`Passage: "${input.selectedText.trim().slice(0, 260)}"`);
  }
  parts.push(`Reflection: ${input.noteText.trim()}`);
  if (input.tags && input.tags.length > 0) {
    parts.push(`Tags: ${input.tags.join(', ')}`);
  }
  return parts.join('\n');
}

export function formatPassageCitation(input: {
  text: string;
  title: string;
  author?: string | null;
  section?: string | null;
  translation?: string | null;
}): string {
  const quote = input.text.trim();
  const metaParts: string[] = [];
  if (input.author?.trim()) metaParts.push(input.author.trim());
  metaParts.push(input.title.trim());
  if (input.section?.trim() && input.section.trim() !== input.title.trim()) {
    metaParts.push(input.section.trim());
  }
  const suffix = input.translation ? ` (${input.translation})` : '';
  return `“${quote}”\n— ${metaParts.join(', ')}${suffix}`;
}

export function formatHighlightsMarkdown(
  highlights: Highlight[],
  bookTitleLookup?: Record<string, string>
): string {
  if (highlights.length === 0) return '';
  const lines: string[] = ['# Resonance Highlights & Margin Notes', ''];
  const grouped = new Map<string, Highlight[]>();
  for (const h of highlights) {
    const groupKey =
      (h.book_id && bookTitleLookup?.[h.book_id]) ||
      h.book_id ||
      h.verse_ref.replace(/\s+\d+:\d+.*$/, '') ||
      'Notes';
    const arr = grouped.get(groupKey) ?? [];
    arr.push(h);
    grouped.set(groupKey, arr);
  }
  for (const [bookTitle, items] of grouped.entries()) {
    lines.push(`## ${bookTitle}`, '');
    for (const h of items) {
      const quote = (h.selected_text ?? '').trim();
      if (quote) {
        lines.push(`> ${quote}`);
        lines.push(`> — *${h.verse_ref}*`);
      } else {
        lines.push(`- **${h.verse_ref}**`);
      }
      if (h.note_text?.trim()) {
        lines.push('', `**Note:** ${h.note_text.trim()}`);
      }
      if (h.tags && h.tags.length > 0) {
        lines.push('', h.tags.map((t) => `#${t}`).join(' '));
      }
      lines.push('');
    }
  }
  return lines.join('\n').trim();
}
