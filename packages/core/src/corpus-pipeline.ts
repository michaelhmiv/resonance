/**
 * Pure-TypeScript personal corpus cleaning, unit splitting, and v3 chunk
 * assembly pipeline — exact parity with `scripts/corpus/build_units.py` and
 * `scripts/corpus/chunk_v3.py` (`docs/resonance/chunking-spec.md` §§2–5, §7).
 *
 * Flow:
 *   RawDocumentExtraction -> clean & furniture/index filter (§3) ->
 *   OCR-scar quarantine gate (§3.7) -> canonical units (§2) ->
 *   120–200 word chunks (§5) -> ready to save, render, and embed on-device.
 */

import type {
  CanonicalUnit,
  ChunkedPassage,
  ProcessedPersonalDocument,
  RawDocumentExtraction,
} from './types';

const MIN_CHUNK_WORDS = 120;
const MAX_CHUNK_WORDS = 200;
const MAX_HARD_WORDS = 240;
const SHORT_TAIL_WORDS = 40;
const MIN_FINAL_WORDS = 10;

// ── Furniture, Boilerplate, & Index-Line Filters (chunking-spec §3.1) ───────

const PAGE_NUMBER_RE = /^(?:page\s*)?\d{1,5}$/i;
const ROMAN_PAGE_RE = /^[ivxlcdm]{1,8}$/i;

/** Multi-line index / TOC / Scripture-index debris detector (matches build_units.py). */
const INDEX_LINE_RE =
  /(?:[,\s]\d{1,4}(?:-\d{1,4})?(?:,\s*\d{1,4}(?:-\d{1,4})?){2,}|^\s*[A-Z][a-z]+\.?\s+\d+[:.]\d+.*\b\d{2,4}\b|\.{4,}\s*\d+\s*$)/;

const GUTENBERG_BOILERPLATE_RE =
  /(?:project gutenberg|this ebook is for the use of anyone|gutenberg license|public domain in the usa|google book search|digitized by google|hosted by google|this is a digital copy of a book|make the world's books discoverable|about google book search|books\.google|internet archive|archive\.org|distributed proofreading|transcriber['’]s note|christian classics ethereal library|ccel\.org|imprimatur|nihil obstat)/i;

function countWords(s: string): number {
  const trimmed = s.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

/** Normalize punctuation/whitespace and strip soft hyphens / control chars. */
export function cleanPassageText(raw: string): string {
  return raw
    .replace(/\u00ad/g, '') // soft hyphen
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Furniture / boilerplate detector (§3.1): returns true for standalone page
 * numbers, Gutenberg/Google-Books headers, and multi-line index/TOC blocks.
 */
export function isFurnitureBlock(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (PAGE_NUMBER_RE.test(t) || ROMAN_PAGE_RE.test(t)) return true;
  if (GUTENBERG_BOILERPLATE_RE.test(t)) return true;

  // Multi-line index / Scripture-index / TOC block check
  const lines = t
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length >= 3) {
    const indexHits = lines.filter((l) => INDEX_LINE_RE.test(l)).length;
    if (indexHits / lines.length >= 0.5) return true;
  }
  if (INDEX_LINE_RE.test(t) && countWords(t) < 60 && /\d{2,4}/.test(t)) {
    const numTokens = (t.match(/\b\d{1,4}\b/g) ?? []).length;
    if (numTokens >= 5 && numTokens / Math.max(1, countWords(t)) > 0.35) {
      return true;
    }
  }
  return false;
}

/**
 * OCR-scar / garbage quarantine gate (§3.7): rejects blocks dominated by
 * non-alphanumeric symbol noise or broken OCR gibberish.
 */
export function isQuarantinedGarbage(text: string): boolean {
  const t = text.trim();
  if (t.length < 15) return false;
  let letters = 0;
  let weird = 0;
  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i);
    const isAsciiLetter = (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
    const isLatinExt = c >= 0xc0 && c <= 0x024f;
    const isSpaceOrCommon =
      c === 32 ||
      c === 10 ||
      c === 9 ||
      (c >= 48 && c <= 57) ||
      '.,;:!?\'"()-—–…[]/'.includes(t[i]);
    if (isAsciiLetter || isLatinExt) letters++;
    else if (!isSpaceOrCommon) weird++;
  }
  const letterRatio = letters / t.length;
  const weirdRatio = weird / t.length;
  if (weirdRatio > 0.18) return true;
  if (letterRatio < 0.45 && t.length > 40) return true;
  return false;
}

/** Split oversize prose blocks cleanly at sentence boundaries (matches chunk_v3.py). */
function splitSentences(text: string, targetWords = 150): string[] {
  const sentences = text.split(/(?<=[.!?;])\s+/);
  const pieces: string[] = [];
  let buf = '';

  for (const s of sentences) {
    if (!s.trim()) continue;
    if (buf && countWords(buf) + countWords(s) > targetWords) {
      pieces.push(buf);
      buf = s;
    } else {
      buf = buf ? `${buf} ${s}` : s;
    }
  }
  if (buf) pieces.push(buf);

  const capped: string[] = [];
  for (let piece of pieces) {
    while (countWords(piece) > MAX_HARD_WORDS) {
      let cut = piece.lastIndexOf(' ', 1200);
      if (cut < 200) cut = piece.indexOf(' ', 600);
      if (cut < 0) break;
      capped.push(piece.slice(0, cut).trim());
      piece = piece.slice(cut).trim();
    }
    if (piece.trim()) capped.push(piece.trim());
  }
  return capped;
}

/** Turn a filename stem like `confessions_augustine-v2.epub` into a clean title. */
export function humanizeFilenameTitle(filename: string): string {
  const base = filename
    .replace(/^.*[/\\]/, '')
    .replace(/\.(epub|pdf|docx|html|htm|md|markdown|txt)$/i, '');
  const spaced = base.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!spaced) return 'Untitled Work';
  return spaced.replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Full personal-library document processor:
 *   RawDocumentExtraction -> cleaned units -> v3 chunks + suggested metadata.
 */
export function processPersonalDocument(
  extraction: RawDocumentExtraction
): ProcessedPersonalDocument {
  const warnings = [...extraction.warnings];
  const units: CanonicalUnit[] = [];
  const divisions: string[] = [];
  let currentDivision: string | null = null;
  let currentChapter = 1;
  let quarantinedCount = 0;

  // Detect repeated running headers/footers across pages/blocks (appearing >= 4 times verbatim, short)
  const shortFreq = new Map<string, number>();
  for (const b of extraction.blocks) {
    const norm = cleanPassageText(b.text);
    if (norm.length > 0 && norm.length <= 70 && b.kind !== 'heading') {
      shortFreq.set(norm, (shortFreq.get(norm) ?? 0) + 1);
    }
  }

  for (const block of extraction.blocks) {
    if (block.kind === 'divider') continue;
    const cleaned = cleanPassageText(block.text);
    if (!cleaned) continue;

    if (block.kind === 'heading') {
      if (isFurnitureBlock(cleaned)) continue;
      if (cleaned !== currentDivision) {
        currentDivision = cleaned.slice(0, 140);
        if (units.length > 0) currentChapter++;
        divisions.push(currentDivision);
      }
      continue;
    }

    // Skip repeated running page headers/footers
    if (cleaned.length <= 70 && (shortFreq.get(cleaned) ?? 0) >= 4) {
      continue;
    }

    if (isFurnitureBlock(cleaned)) continue;

    if (isQuarantinedGarbage(cleaned)) {
      quarantinedCount++;
      continue;
    }

    const w = countWords(cleaned);
    if (w === 0) continue;

    units.push({
      seq: units.length,
      division: currentDivision,
      chapter: currentChapter,
      kind: block.kind === 'poetry' ? 'poetry' : 'prose',
      text: cleaned,
      words: w,
    });
  }

  if (quarantinedCount > 0) {
    warnings.push(
      `Quarantined ${quarantinedCount} low-quality or OCR-garbled block${quarantinedCount === 1 ? '' : 's'} so they won't pollute echoes.`
    );
  }

  // ── Assemble v3 chunks (chunking-spec §5 / chunk_v3.py) ─────────────────
  const rawChunks: Array<{
    text: string;
    unitSeqs: number[];
    division: string | null;
    chapter: number;
    kind: 'prose' | 'poetry';
  }> = [];

  let curTexts: string[] = [];
  let curSeqs: number[] = [];
  let curDivision: string | null = null;
  let curChapter = 1;

  const flush = () => {
    if (curTexts.length === 0) return;
    rawChunks.push({
      text: curTexts.join('\n\n'),
      unitSeqs: [...curSeqs],
      division: curDivision,
      chapter: curChapter,
      kind: 'prose',
    });
    curTexts = [];
    curSeqs = [];
  };

  for (const u of units) {
    // Keep divisions separated cleanly so headings map to ReadingView sections
    if (curTexts.length > 0 && u.division !== curDivision) {
      flush();
    }

    if (u.kind === 'poetry') {
      flush();
      rawChunks.push({
        text: u.text,
        unitSeqs: [u.seq],
        division: u.division,
        chapter: u.chapter,
        kind: 'poetry',
      });
      continue;
    }

    if (u.words > 220) {
      flush();
      for (const piece of splitSentences(u.text, 150)) {
        rawChunks.push({
          text: piece,
          unitSeqs: [u.seq],
          division: u.division,
          chapter: u.chapter,
          kind: 'prose',
        });
      }
      continue;
    }

    const curWords = curTexts.reduce((acc, t) => acc + countWords(t), 0);
    if (
      curTexts.length > 0 &&
      ((curWords + u.words > MAX_HARD_WORDS && curWords >= 110) ||
        curWords >= MAX_CHUNK_WORDS)
    ) {
      flush();
    }

    if (curTexts.length === 0) {
      curDivision = u.division;
      curChapter = u.chapter;
    }
    curTexts.push(u.text);
    curSeqs.push(u.seq);

    const nextWords = curTexts.reduce((acc, t) => acc + countWords(t), 0);
    if (nextWords >= MIN_CHUNK_WORDS) {
      flush();
    }
  }
  flush();

  // Merge a short tail (<40w) back into the previous chunk if same division
  if (rawChunks.length >= 2) {
    const last = rawChunks[rawChunks.length - 1];
    const prev = rawChunks[rawChunks.length - 2];
    if (
      countWords(last.text) < SHORT_TAIL_WORDS &&
      last.division === prev.division &&
      last.kind === 'prose' &&
      prev.kind === 'prose'
    ) {
      prev.text = `${prev.text}\n\n${last.text}`;
      prev.unitSeqs = [...prev.unitSeqs, ...last.unitSeqs];
      rawChunks.pop();
    }
  }

  // Final safety cap & debris drop (<10 words, unless it's the only chunk)
  const chunks: ChunkedPassage[] = [];
  for (const rc of rawChunks) {
    if (rc.kind === 'prose' && countWords(rc.text) > 260) {
      for (const piece of splitSentences(rc.text, 170)) {
        const w = countWords(piece);
        if (w >= MIN_FINAL_WORDS || rawChunks.length === 1) {
          chunks.push({
            chunkIndex: chunks.length,
            division: rc.division,
            chapter: rc.chapter,
            kind: rc.kind,
            text: piece,
            words: w,
            unitSeqs: rc.unitSeqs,
          });
        }
      }
    } else {
      const w = countWords(rc.text);
      if (w >= MIN_FINAL_WORDS || rawChunks.length === 1) {
        chunks.push({
          chunkIndex: chunks.length,
          division: rc.division,
          chapter: rc.chapter,
          kind: rc.kind,
          text: rc.text,
          words: w,
          unitSeqs: rc.unitSeqs,
        });
      }
    }
  }

  const wordCount = chunks.reduce((acc, c) => acc + c.words, 0);
  const meta = extraction.detectedMetadata;

  return {
    format: extraction.format,
    filename: extraction.filename,
    suggestedTitle: meta.title?.trim() || humanizeFilenameTitle(extraction.filename),
    suggestedAuthor: meta.author?.trim() || '',
    suggestedEra: meta.era?.trim() || 'Personal',
    suggestedTags: meta.tags ?? [],
    suggestedNotes: meta.description?.trim() || '',
    units,
    chunks,
    divisions,
    wordCount,
    quarantinedCount,
    ocrRequired: extraction.ocrRequired,
    warnings,
  };
}
