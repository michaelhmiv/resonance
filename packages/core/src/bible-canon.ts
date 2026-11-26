/**
 * Bible canon — 66 books in canonical order, OT/NT grouped.
 * Pure data, no platform dependencies. Used by both mobile and web
 * browse surfaces.
 */

import type { CanonicalBook, BookSummary, Translation } from './types';

export const TRANSLATIONS: readonly Translation[] = ['WEB', 'KJV'];
export const DEFAULT_TRANSLATION: Translation = 'WEB';

export const BIBLE_BOOKS: readonly CanonicalBook[] = [
  { name: 'Genesis', testament: 'OT', order: 1 },
  { name: 'Exodus', testament: 'OT', order: 2 },
  { name: 'Leviticus', testament: 'OT', order: 3 },
  { name: 'Numbers', testament: 'OT', order: 4 },
  { name: 'Deuteronomy', testament: 'OT', order: 5 },
  { name: 'Joshua', testament: 'OT', order: 6 },
  { name: 'Judges', testament: 'OT', order: 7 },
  { name: 'Ruth', testament: 'OT', order: 8 },
  { name: '1 Samuel', testament: 'OT', order: 9 },
  { name: '2 Samuel', testament: 'OT', order: 10 },
  { name: '1 Kings', testament: 'OT', order: 11 },
  { name: '2 Kings', testament: 'OT', order: 12 },
  { name: '1 Chronicles', testament: 'OT', order: 13 },
  { name: '2 Chronicles', testament: 'OT', order: 14 },
  { name: 'Ezra', testament: 'OT', order: 15 },
  { name: 'Nehemiah', testament: 'OT', order: 16 },
  { name: 'Esther', testament: 'OT', order: 17 },
  { name: 'Job', testament: 'OT', order: 18 },
  { name: 'Psalms', testament: 'OT', order: 19 },
  { name: 'Proverbs', testament: 'OT', order: 20 },
  { name: 'Ecclesiastes', testament: 'OT', order: 21 },
  { name: 'Song of Solomon', testament: 'OT', order: 22 },
  { name: 'Isaiah', testament: 'OT', order: 23 },
  { name: 'Jeremiah', testament: 'OT', order: 24 },
  { name: 'Lamentations', testament: 'OT', order: 25 },
  { name: 'Ezekiel', testament: 'OT', order: 26 },
  { name: 'Daniel', testament: 'OT', order: 27 },
  { name: 'Hosea', testament: 'OT', order: 28 },
  { name: 'Joel', testament: 'OT', order: 29 },
  { name: 'Amos', testament: 'OT', order: 30 },
  { name: 'Obadiah', testament: 'OT', order: 31 },
  { name: 'Jonah', testament: 'OT', order: 32 },
  { name: 'Micah', testament: 'OT', order: 33 },
  { name: 'Nahum', testament: 'OT', order: 34 },
  { name: 'Habakkuk', testament: 'OT', order: 35 },
  { name: 'Zephaniah', testament: 'OT', order: 36 },
  { name: 'Haggai', testament: 'OT', order: 37 },
  { name: 'Zechariah', testament: 'OT', order: 38 },
  { name: 'Malachi', testament: 'OT', order: 39 },
  { name: 'Matthew', testament: 'NT', order: 40 },
  { name: 'Mark', testament: 'NT', order: 41 },
  { name: 'Luke', testament: 'NT', order: 42 },
  { name: 'John', testament: 'NT', order: 43 },
  { name: 'Acts', testament: 'NT', order: 44 },
  { name: 'Romans', testament: 'NT', order: 45 },
  { name: '1 Corinthians', testament: 'NT', order: 46 },
  { name: '2 Corinthians', testament: 'NT', order: 47 },
  { name: 'Galatians', testament: 'NT', order: 48 },
  { name: 'Ephesians', testament: 'NT', order: 49 },
  { name: 'Philippians', testament: 'NT', order: 50 },
  { name: 'Colossians', testament: 'NT', order: 51 },
  { name: '1 Thessalonians', testament: 'NT', order: 52 },
  { name: '2 Thessalonians', testament: 'NT', order: 53 },
  { name: '1 Timothy', testament: 'NT', order: 54 },
  { name: '2 Timothy', testament: 'NT', order: 55 },
  { name: 'Titus', testament: 'NT', order: 56 },
  { name: 'Philemon', testament: 'NT', order: 57 },
  { name: 'Hebrews', testament: 'NT', order: 58 },
  { name: 'James', testament: 'NT', order: 59 },
  { name: '1 Peter', testament: 'NT', order: 60 },
  { name: '2 Peter', testament: 'NT', order: 61 },
  { name: '1 John', testament: 'NT', order: 62 },
  { name: '2 John', testament: 'NT', order: 63 },
  { name: '3 John', testament: 'NT', order: 64 },
  { name: 'Jude', testament: 'NT', order: 65 },
  { name: 'Revelation', testament: 'NT', order: 66 },
];

/** Lowercase, strip non-alphanumerics — used to match book names across data. */
export function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** The canonical passages.book_id for a translation+book name. */
export function bibleBookId(bookName: string, translation: Translation): string {
  return `${translation}_${bookName.replace(/\s+/g, '_')}`;
}

/** Build a "Book Chapter:Verse" reference, tolerating nulls. */
export function scriptureRef(
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

/**
 * Build the canonical 66-book browse spine, annotated with which books
 * have passages available. `availableBookIds` is a Set of normalized
 * passages.book_id values that exist in the database.
 */
export function buildBookSpine(
  translation: Translation,
  availableBookIds: Set<string>
): BookSummary[] {
  return BIBLE_BOOKS.map((b) => {
    const candidates = [
      normalize(bibleBookId(b.name, translation)),
      normalize(b.name),
    ];
    const available = candidates.some((c) => availableBookIds.has(c));
    return {
      name: b.name,
      testament: b.testament,
      order: b.order,
      available,
      bookId: bibleBookId(b.name, translation),
    };
  });
}

const BIBLE_BOOK_ALIASES: Record<string, string> = {
  gen: 'Genesis',
  exod: 'Exodus',
  exo: 'Exodus',
  lev: 'Leviticus',
  num: 'Numbers',
  deut: 'Deuteronomy',
  deu: 'Deuteronomy',
  josh: 'Joshua',
  jos: 'Joshua',
  judg: 'Judges',
  jdg: 'Judges',
  '1sam': '1 Samuel',
  '2sam': '2 Samuel',
  '1kgs': '1 Kings',
  '2kgs': '2 Kings',
  '1chr': '1 Chronicles',
  '2chr': '2 Chronicles',
  neh: 'Nehemiah',
  est: 'Esther',
  ps: 'Psalms',
  psa: 'Psalms',
  psalm: 'Psalms',
  prov: 'Proverbs',
  pro: 'Proverbs',
  eccl: 'Ecclesiastes',
  ecc: 'Ecclesiastes',
  song: 'Song of Solomon',
  songofsongs: 'Song of Solomon',
  sos: 'Song of Solomon',
  isa: 'Isaiah',
  jer: 'Jeremiah',
  lam: 'Lamentations',
  ezek: 'Ezekiel',
  eze: 'Ezekiel',
  dan: 'Daniel',
  hos: 'Hosea',
  obad: 'Obadiah',
  mic: 'Micah',
  nah: 'Nahum',
  hab: 'Habakkuk',
  zeph: 'Zephaniah',
  hag: 'Haggai',
  zech: 'Zechariah',
  mal: 'Malachi',
  matt: 'Matthew',
  mat: 'Matthew',
  mk: 'Mark',
  lk: 'Luke',
  jn: 'John',
  joh: 'John',
  rom: 'Romans',
  '1cor': '1 Corinthians',
  '2cor': '2 Corinthians',
  gal: 'Galatians',
  eph: 'Ephesians',
  phil: 'Philippians',
  php: 'Philippians',
  col: 'Colossians',
  '1thess': '1 Thessalonians',
  '2thess': '2 Thessalonians',
  '1tim': '1 Timothy',
  '2tim': '2 Timothy',
  tit: 'Titus',
  phlm: 'Philemon',
  phm: 'Philemon',
  heb: 'Hebrews',
  jas: 'James',
  '1pet': '1 Peter',
  '2pet': '2 Peter',
  '1jn': '1 John',
  '2jn': '2 John',
  '3jn': '3 John',
  rev: 'Revelation',
};

const CANONICAL_BY_NORM: Map<string, string> = (() => {
  const map = new Map<string, string>();
  for (const b of BIBLE_BOOKS) {
    map.set(normalize(b.name), b.name);
  }
  for (const [alias, canonical] of Object.entries(BIBLE_BOOK_ALIASES)) {
    map.set(alias, canonical);
  }
  return map;
})();

/**
 * Resolve any Bible book identifier ("WEB_Matthew", "web_1_Corinthians",
 * "Exod", "Psalms", etc.) to its canonical name in `BIBLE_BOOKS`, or return
 * `null` if the identifier does not correspond to a canonical Bible book
 * (e.g., a Library or Personal work slug like "augustine-confessions").
 */
export function resolveBibleBookName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const stripped = trimmed
    .replace(/^(web|kjv|asv|esv|niv|nrsv)[_\s]+/i, '')
    .replace(/_/g, ' ')
    .trim();
  return CANONICAL_BY_NORM.get(normalize(stripped)) ?? null;
}

