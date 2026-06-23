# Resonance Web App — Full Remediation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task. Each task is independently dispatchable as a leaf subagent.

**Goal:** Fix every issue from the 2026-06-23 audit — wire API routes to frontend, serve real Bible data, add auth/premium gating, make Settings interactive, build real Patterns, fix shared components for web, harden API routes, and make the app responsive.

**Architecture:** Next.js App Router with API routes reading from the seeded library JSON files on disk (already at `/data/resonance/build/output/seeded_library/`). No Supabase yet — persistence uses server-side SQLite on the Railway volume until Supabase credentials are provided. A simple bearer-token dev auth gate blocks all non-authenticated access. Shared `@resonance/ui` components are made web-safe by replacing `@expo/vector-icons` with inline SVG icons in a `packages/ui/src/icons.tsx` file that works on both platforms.

**Tech Stack:** Next.js 14 App Router, react-native-web, SQLite (better-sqlite3, server-side), OpenRouter API, pre-existing `@resonance/core` / `@resonance/theme` / `@resonance/ui` packages.

**Seeded library data (already on disk):**
- `bible_passages.json` — 244K passages across 3 translations (web, kjv, asv)
- `bible_books.json` — 198 book records (66 × 3 translations)
- `voice_books.json` — 18 voice works (Augustine, Aquinas, Anselm, etc.)
- `voice_passages.json` — voice text passages
- `cross_references.json` — 343K cross-references (keyed by `"Genesis 1:1"` → `"Proverbs 8:22-30"`)
- `verse_of_day.json` — 365 entries keyed by `day_of_year` (1–365)
- `vectors_gte-small.bin` — 265K × 384-dim Float32 (388MB)
- `vectors_gte-small_manifest.json` — passage ID mapping
- `available_packages.json` — book package catalog

---

## Phase 1: Foundation — Fonts, Icons, Responsive CSS

### Task 1.1: Load Google Fonts via layout.tsx

**Objective:** Wire Cormorant Garamond + Inter into the web app.

**Files:**
- Modify: `apps/web/app/layout.tsx`
- Modify: `apps/web/app/globals.css`

**Implementation:**

In `layout.tsx`, add font links to the `<head>`:

```tsx
export const metadata = {
  title: 'Resonance',
  description: 'A private, offline-first Christian spiritual journal.',
};

export default function RootLayout({ children }: { children: ReactNode }): ReactNode {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500&family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <View style={styles.root}>{children}</View>
      </body>
    </html>
  );
}
```

In `globals.css`, update body font-family:

```css
body {
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  background-color: #faf9f6;
  color: #3a3530;
  -webkit-font-smoothing: antialiased;
}
```

**Verification:** Deploy, open site, confirm serif font on verse text and sans font on tabs/buttons via DevTools.

---

### Task 1.2: Create web-safe icon component

**Objective:** Replace `@expo/vector-icons` with a cross-platform SVG icon set that works on web and mobile.

**Files:**
- Create: `packages/ui/src/icons.tsx`
- Modify: `packages/ui/src/ResonanceCardGroup.tsx`
- Modify: `packages/ui/src/BookmarkButton.tsx`
- Modify: `packages/ui/src/TranslationSelector.tsx`
- Modify: `packages/ui/src/HighlightToolbar.tsx`

**Implementation:**

`packages/ui/src/icons.tsx` — inline SVG icons, no external dependency:

```tsx
import { type ReactNode } from 'react';

interface IconProps {
  size?: number;
  color?: string;
  style?: any;
}

function SvgWrap({ size = 24, color = '#3a3530', children, style }: IconProps & { children: ReactNode }): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={style}>
      {children}
    </svg>
  );
}

export function WindIcon(props: IconProps): ReactNode {
  return (
    <SvgWrap {...props}>
      <path d="M9.59 4.59A2 2 0 1 1 11 8H2m10.59 11.41A2 2 0 1 0 14 16H2m15.73-8.27A2.5 2.5 0 1 1 19.5 12H2" />
    </SvgWrap>
  );
}

export function BookmarkIcon(props: IconProps): ReactNode {
  return (
    <SvgWrap {...props}>
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
    </SvgWrap>
  );
}

export function ChevronDownIcon(props: IconProps): ReactNode {
  return (
    <SvgWrap {...props}>
      <polyline points="6 9 12 15 18 9" />
    </SvgWrap>
  );
}

export function HighlighterIcon(props: IconProps): ReactNode {
  return (
    <SvgWrap {...props}>
      <path d="M12 19l7-7 3 3-7 7-3-3z" />
      <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
    </SvgWrap>
  );
}
```

Then update each component to import from `../icons` instead of `@expo/vector-icons`. For example in `ResonanceCardGroup.tsx`:

```tsx
// Before:
import { Feather } from '@expo/vector-icons';
// ...
<Feather name="wind" size={14} color={colors.resonance} />

// After:
import { WindIcon } from '../icons';
// ...
<WindIcon size={14} color={colors.resonance} />
```

Apply the same pattern to all 4 affected components. Map each Feather icon name used:
- `"wind"` → `WindIcon`
- `"bookmark"` → `BookmarkIcon`
- `"chevron-down"` → `ChevronDownIcon`
- `"highlighter"` → `HighlighterIcon` (or whatever names are used)

**Verification:** `npx tsc --noEmit -p packages/ui/tsconfig.json` passes. Import `ResonanceCardGroup` in a web page and confirm it renders without crashing.

---

### Task 1.3: Add responsive CSS and media queries

**Objective:** Make the app responsive on mobile, tablet, and desktop.

**Files:**
- Modify: `apps/web/app/globals.css`
- Modify: `apps/web/app/page.tsx` (add responsive container styles)

**Implementation:**

In `globals.css`, add media queries:

```css
/* ---- Responsive breakpoints ---- */

/* Mobile-first: default styles target phones */
.resonance-container {
  width: 100%;
  max-width: 100%;
  margin: 0;
  padding: 0 16px;
}

/* Tablet: 640px+ */
@media (min-width: 640px) {
  .resonance-container {
    max-width: 720px;
    margin: 0 auto;
    padding: 0 24px;
  }
}

/* Desktop: 1024px+ */
@media (min-width: 1024px) {
  .resonance-container {
    max-width: 800px;
  }
}

/* Header responsive: collapse tabs to icons on small screens */
.resonance-header {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
}

@media (max-width: 480px) {
  .resonance-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }
  .resonance-tab-bar {
    width: 100%;
    justify-content: space-around;
  }
}

/* Chapter grid responsive */
.resonance-chapter-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

@media (max-width: 480px) {
  .resonance-chapter-cell {
    width: 40px !important;
    height: 40px !important;
  }
}
```

In `page.tsx`, add className-based responsive styling alongside existing RN-web styles. Apply `className="resonance-container"` to the container `View`, `className="resonance-header"` to the header, `className="resonance-tab-bar"` to the tab bar, `className="resonance-chapter-grid"` and `className="resonance-chapter-cell"` to grid/cells. React-native-web preserves `className` alongside `style`.

**Verification:** Open site on mobile viewport (DevTools → 375px width). Confirm: header stacks vertically, tabs span full width, content padding shrinks, chapter grid cells are smaller.

---

### Task 1.4: Fix theme package for web — remove `TextStyle` import

**Objective:** `packages/theme/src/typography.ts` imports `TextStyle` from `react-native`, which breaks web builds.

**Files:**
- Modify: `packages/theme/src/typography.ts`

**Implementation:**

Replace the `TextStyle` import with a local type:

```tsx
// Before:
import { TextStyle } from 'react-native';

// After:
type TextStyle = Record<string, any>;
```

This is a plain object type — the actual values pass through to react-native-web's StyleSheet at runtime. No behavior change on mobile.

**Verification:** `npx tsc --noEmit -p packages/theme/tsconfig.json` passes. `npx tsc --noEmit -p apps/web/tsconfig.json` passes.

---

## Phase 2: Bible Data API — Serve Real Scripture from Disk

### Task 2.1: Create `/api/bible/books` endpoint

**Objective:** Return the list of available Bible books with real chapter counts per book, filtered by translation.

**Files:**
- Create: `apps/web/app/api/bible/books/route.ts`

**Implementation:**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { readFileSync, existsSync } from 'fs';

const BOOKS_PATH = '/data/resonance/build/output/seeded_library/bible_books.json';
const PASSAGES_PATH = '/data/resonance/build/output/seeded_library/bible_passages.json';

// Module-level cache — loaded once
let booksCache: any[] | null = null;
let chaptersByBook: Record<string, number[]> | null = null;

function ensureLoaded() {
  if (booksCache) return;

  if (existsSync(BOOKS_PATH)) {
    booksCache = JSON.parse(readFileSync(BOOKS_PATH, 'utf-8'));
  } else {
    booksCache = [];
  }

  // Build chapter lookup from passages JSON
  // This is a large file (244K entries) — optimize by streaming or pre-computing
  chaptersByBook = {};
  if (existsSync(PASSAGES_PATH)) {
    const passages = JSON.parse(readFileSync(PASSAGES_PATH, 'utf-8'));
    for (const p of passages) {
      const key = `${p.translation}_${p.book}`;
      if (!chaptersByBook![key]) chaptersByBook![key] = [];
      if (!chaptersByBook![key].includes(p.chapter)) {
        chaptersByBook![key].push(p.chapter);
      }
    }
    // Sort chapters numerically
    for (const k of Object.keys(chaptersByBook!)) {
      chaptersByBook![k].sort((a, b) => a - b);
    }
  }
}

export async function GET(req: NextRequest) {
  try {
    ensureLoaded();
    const translation = req.nextUrl.searchParams.get('translation') || 'web';

    const books = (booksCache || [])
      .filter((b: any) => b.translation === translation)
      .map((b: any) => ({
        id: b.id,
        name: b.title,
        testament: b.testament,
        order: b.order,
        translation: b.translation,
        chapterCount: (chaptersByBook?.[`${translation}_${b.title}`] || []).length,
        chapters: chaptersByBook?.[`${translation}_${b.title}`] || [],
      }))
      .sort((a: any, b: any) => a.order - b.order);

    return NextResponse.json({ books });
  } catch {
    return NextResponse.json({ error: 'Failed to load books' }, { status: 500 });
  }
}
```

**Verification:** `curl https://localhost:3000/api/bible/books?translation=web` returns 66 books with correct chapter counts (Obadiah=1, Psalms=150, Genesis=50, etc.).

---

### Task 2.2: Create `/api/bible/chapter` endpoint

**Objective:** Return all verses for a specific book/chapter/translation.

**Files:**
- Create: `apps/web/app/api/bible/chapter/route.ts`

**Implementation:**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { readFileSync, existsSync } from 'fs';

const PASSAGES_PATH = '/data/resonance/build/output/seeded_library/bible_passages.json';

let passagesCache: any[] | null = null;

function ensureLoaded() {
  if (passagesCache) return;
  if (!existsSync(PASSAGES_PATH)) {
    passagesCache = [];
    return;
  }
  // The file is large (~50MB) — load once, cache at module level
  passagesCache = JSON.parse(readFileSync(PASSAGES_PATH, 'utf-8'));
}

export async function GET(req: NextRequest) {
  try {
    ensureLoaded();

    const translation = req.nextUrl.searchParams.get('translation') || 'web';
    const book = req.nextUrl.searchParams.get('book');
    const chapter = parseInt(req.nextUrl.searchParams.get('chapter') || '1', 10);

    if (!book) {
      return NextResponse.json({ error: 'Missing book parameter' }, { status: 400 });
    }

    const verses = (passagesCache || [])
      .filter((p: any) =>
        p.translation === translation &&
        p.book === book &&
        p.chapter === chapter
      )
      .sort((a: any, b: any) => a.verse_start - b.verse_start);

    return NextResponse.json({
      book,
      chapter,
      translation,
      verses: verses.map((v: any) => ({
        id: v.id,
        verseStart: v.verse_start,
        verseEnd: v.verse_end,
        text: v.text,
      })),
    });
  } catch {
    return NextResponse.json({ error: 'Failed to load chapter' }, { status: 500 });
  }
}
```

**Note:** Loading the full passages JSON (244K entries, ~50MB) into memory at module level is acceptable for now. When Supabase is wired up, this gets replaced with a DB query. If memory is a concern on Railway, pre-compute per-book JSON shards during the build pipeline.

**Verification:** `curl '.../api/bible/chapter?book=Genesis&chapter=1&translation=web'` returns all 31 verses of Genesis 1 with real text.

---

### Task 2.3: Create `/api/bible/search` endpoint

**Objective:** Full-text search across Bible passages with scope toggle.

**Files:**
- Create: `apps/web/app/api/bible/search/route.ts`

**Implementation:**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { readFileSync, existsSync } from 'fs';

const PASSAGES_PATH = '/data/resonance/build/output/seeded_library/bible_passages.json';
const VOICE_PATH = '/data/resonance/build/output/seeded_library/voice_passages.json';

let passagesCache: any[] | null = null;
let voiceCache: any[] | null = null;

function ensureLoaded(scope: string) {
  if (scope === 'scripture' || scope === 'all') {
    if (!passagesCache && existsSync(PASSAGES_PATH)) {
      passagesCache = JSON.parse(readFileSync(PASSAGES_PATH, 'utf-8'));
    }
  }
  if (scope === 'library' || scope === 'all') {
    if (!voiceCache && existsSync(VOICE_PATH)) {
      voiceCache = JSON.parse(readFileSync(VOICE_PATH, 'utf-8'));
    }
  }
}

export async function GET(req: NextRequest) {
  try {
    const query = req.nextUrl.searchParams.get('q') || '';
    const scope = req.nextUrl.searchParams.get('scope') || 'scripture'; // scripture | library
    if (query.trim().length < 2) {
      return NextResponse.json({ results: [] });
    }

    ensureLoaded(scope);
    const q = query.toLowerCase();
    const results: any[] = [];

    if ((scope === 'scripture' || scope === 'all') && passagesCache) {
      for (const p of passagesCache) {
        if (p.text.toLowerCase().includes(q)) {
          results.push({
            id: p.id,
            book: p.book,
            chapter: p.chapter,
            verseStart: p.verse_start,
            verseEnd: p.verse_end,
            text: p.text,
            translation: p.translation,
            type: 'scripture',
            source: `${p.book} ${p.chapter}:${p.verse_start}${p.verse_end !== p.verse_start ? '-' + p.verse_end : ''} (${p.translation.toUpperCase()})`,
          });
          if (results.length >= 50) break;
        }
      }
    }

    if ((scope === 'library' || scope === 'all') && voiceCache) {
      for (const p of voiceCache) {
        if (p.text.toLowerCase().includes(q)) {
          results.push({
            id: p.id,
            bookId: p.book_id,
            text: p.text,
            type: 'voice',
            source: p.book_id,
          });
          if (results.length >= 100) break;
        }
      }
    }

    return NextResponse.json({ results, count: results.length });
  } catch {
    return NextResponse.json({ error: 'Search failed' }, { status: 500 });
  }
}
```

**Verification:** `curl '.../api/bible/search?q=light&scope=scripture'` returns passages containing "light".

---

### Task 2.4: Create `/api/bible/verse-of-day` endpoint

**Objective:** Return today's verse of the day from the 365-entry pre-curated list.

**Files:**
- Create: `apps/web/app/api/bible/verse-of-day/route.ts`

**Implementation:**

```typescript
import { NextResponse } from 'next/server';
import { readFileSync, existsSync } from 'fs';

const VOD_PATH = '/data/resonance/build/output/seeded_library/verse_of_day.json';
const PASSAGES_PATH = '/data/resonance/build/output/seeded_library/bible_passages.json';

let vodCache: any[] | null = null;
let passagesCache: any[] | null = null;

function ensureLoaded() {
  if (!vodCache && existsSync(VOD_PATH)) {
    vodCache = JSON.parse(readFileSync(VOD_PATH, 'utf-8'));
  }
  if (!passagesCache && existsSync(PASSAGES_PATH)) {
    passagesCache = JSON.parse(readFileSync(PASSAGES_PATH, 'utf-8'));
  }
}

export async function GET() {
  try {
    ensureLoaded();
    if (!vodCache || vodCache.length === 0) {
      return NextResponse.json({ error: 'No verse data' }, { status: 404 });
    }

    const dayOfYear = Math.floor(
      (Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86400000
    );
    const entry = vodCache.find((v: any) => v.day_of_year === dayOfYear) || vodCache[0];

    // Look up the actual passage text
    const passage = passagesCache?.find(
      (p: any) =>
        p.book === entry.book &&
        p.chapter === entry.chapter &&
        p.verse_start === entry.verse &&
        p.translation === entry.translation
    );

    return NextResponse.json({
      book: entry.book,
      chapter: entry.chapter,
      verse: entry.verse,
      translation: entry.translation,
      text: passage?.text || '',
      ref: `${entry.book} ${entry.chapter}:${entry.verse}`,
    });
  } catch {
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
```

**Verification:** `curl '.../api/bible/verse-of-day'` returns today's verse with real text (not hardcoded Psalm 46:10).

---

### Task 2.5: Create `/api/bible/cross-refs` endpoint

**Objective:** Return cross-references for a given verse reference.

**Files:**
- Create: `apps/web/app/api/bible/cross-refs/route.ts`

**Implementation:**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { readFileSync, existsSync } from 'fs';

const XREF_PATH = '/data/resonance/build/output/seeded_library/cross_references.json';

let xrefCache: Map<string, string[]> | null = null;

function ensureLoaded() {
  if (xrefCache) return;
  if (!existsSync(XREF_PATH)) {
    xrefCache = new Map();
    return;
  }
  const data = JSON.parse(readFileSync(XREF_PATH, 'utf-8'));
  xrefCache = new Map();
  for (const entry of data) {
    const existing = xrefCache.get(entry.from_ref) || [];
    existing.push(entry.to_ref);
    xrefCache.set(entry.from_ref, existing);
  }
}

export async function GET(req: NextRequest) {
  try {
    ensureLoaded();
    const ref = req.nextUrl.searchParams.get('ref');
    if (!ref) {
      return NextResponse.json({ error: 'Missing ref parameter' }, { status: 400 });
    }
    const refs = xrefCache?.get(ref) || [];
    return NextResponse.json({ refs });
  } catch {
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
```

**Verification:** `curl '.../api/bible/cross-refs?ref=Genesis%201:1'` returns cross-references (Proverbs 8:22-30, Zechariah 12:1, Acts 14:15, etc.).

---

### Task 2.6: Create `/api/library/books` endpoint

**Objective:** Return voice works (Library browser) grouped by package.

**Files:**
- Create: `apps/web/app/api/library/books/route.ts`

**Implementation:**

```typescript
import { NextResponse } from 'next/server';
import { readFileSync, existsSync } from 'fs';

const VOICE_BOOKS_PATH = '/data/resonance/build/output/seeded_library/voice_books.json';

let cache: any[] | null = null;

function ensureLoaded() {
  if (cache) return;
  if (!existsSync(VOICE_BOOKS_PATH)) {
    cache = [];
    return;
  }
  cache = JSON.parse(readFileSync(VOICE_BOOKS_PATH, 'utf-8'));
}

export async function GET() {
  try {
    ensureLoaded();
    // Group by package_id
    const byPackage: Record<string, any[]> = {};
    for (const book of (cache || [])) {
      const pid = book.package_id || 'seeded';
      if (!byPackage[pid]) byPackage[pid] = [];
      byPackage[pid].push(book);
    }
    const packages = Object.entries(byPackage).map(([packageId, books]) => ({
      packageId,
      label: packageId === 'seeded' ? 'Seeded Library' : packageId,
      books: books.map((b: any) => ({
        id: b.id,
        title: b.title,
        author: b.author,
        era: b.era,
        source: b.source,
      })),
    }));
    return NextResponse.json({ packages });
  } catch {
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
```

**Verification:** `curl '.../api/library/books'` returns 18 voice works grouped by package.

---

## Phase 3: Word Tab — Full Rewrite with Real Data

### Task 3.1: Rewrite WordPage with real Bible data

**Objective:** Replace hardcoded `SAMPLE_PASSAGES` with API calls. Per-book chapter counts. Real verse text.

**Files:**
- Rewrite: `apps/web/app/word/page.tsx`

**Implementation:**

Replace the entire file with a component that:
1. On mount, fetches `/api/bible/books?translation=web` → populates book list with real chapter counts
2. When a book is selected, shows chapter grid using `book.chapters` array from API (no more hardcoded 50)
3. When a chapter is selected, fetches `/api/bible/chapter?book=Genesis&chapter=1&translation=web` → shows real verses
4. Translation selector (WEB/KJV) re-fetches books list when changed
5. Prev/next chapter navigation at bottom of reading view
6. Back navigation through breadcrumb: Books → Book title → Reading view

Key state:
```tsx
type ViewState = 'books' | 'chapters' | 'reading';
const [view, setView] = useState<ViewState>('books');
const [books, setBooks] = useState<BookSummary[]>([]);
const [selectedBook, setSelectedBook] = useState<string | null>(null);
const [selectedChapter, setSelectedChapter] = useState<number | null>(null);
const [translation, setTranslation] = useState<Translation>('WEB');
const [verses, setVerses] = useState<Verse[]>([]);
const [loading, setLoading] = useState(false);
```

**Verification:** Click Word tab → see 66 books with correct chapter counts. Click Genesis → see 50 chapters. Click chapter 1 → see all 31 verses of Genesis 1 with real WEB text. Click John → see 21 chapters. Click Obadiah → see 1 chapter.

---

### Task 3.2: Add translation selector to reading view

**Objective:** Allow switching translation while reading a chapter.

**Files:**
- Modify: `apps/web/app/word/page.tsx`

**Implementation:**

In the reading view header, add a WEB/KJV toggle (same pill-button style as the book list). When switched, re-fetch `/api/bible/chapter` with the new translation and update verses.

**Verification:** Open Genesis 1 in WEB → switch to KJV → text changes to KJV wording.

---

### Task 3.3: Add cross-references to reading view

**Objective:** Show subtle marginal cross-reference links after each verse.

**Files:**
- Modify: `apps/web/app/word/page.tsx`

**Implementation:**

When rendering verses, fetch cross-references for the chapter on mount (`/api/bible/cross-refs?ref=Genesis%201:1`). Render cross-refs as small, understated links below each verse:
- Font size 11px, color `#9a9388`, no underline
- Separated by middots (·)
- Clicking a cross-ref navigates to that reference (parses "Book Chapter:Verse" and navigates)

State: `const [xrefs, setXrefs] = useState<Record<string, string[]>>({});`

Fetch all cross-refs for the chapter's verses in a single batch on chapter load.

**Verification:** Reading Genesis 1:1 shows cross-references below the verse (Proverbs 8:22-30 · Zechariah 12:1 · etc.). Clicking one navigates to that passage.

---

### Task 3.4: Add search screen to Word tab

**Objective:** Add a search icon in the Word header that opens a search overlay with Scripture/Library scope toggle and results as passage cards.

**Files:**
- Create: `apps/web/app/word/search.tsx` (search overlay component)
- Modify: `apps/web/app/word/page.tsx` (add search icon to header)

**Implementation:**

Search overlay:
- Full-width search input at top
- Scope toggle: Scripture | Library (pill buttons)
- Calls `/api/bible/search?q=...&scope=scripture` debounced (300ms)
- Results rendered using shared `PassageCard` component
- Each card has "Read in Word" button that navigates to the passage

In the Word page header (all view states), add a search icon (magnifying glass SVG) that toggles the search overlay.

**Verification:** Click search icon → type "light" → see passage cards containing "light" from Scripture. Toggle to Library → see voice work results. Click "Read in Word" on a result → navigates to that passage.

---

### Task 3.5: Add Library browser to Word tab

**Objective:** Add a library icon in the Word header that opens a Library browser showing voice works by package → author/work.

**Files:**
- Create: `apps/web/app/word/library.tsx` (Library browser component)
- Modify: `apps/web/app/word/page.tsx` (add library icon to header)

**Implementation:**

Library browser:
- Fetches `/api/library/books` on mount
- Shows package groups (e.g., "Seeded Library")
- Clicking a package shows its books (title, author, era)
- Clicking a book opens a reading view of its passages

In the Word page header, add a library/book icon (SVG) that toggles between Scripture browser and Library browser.

**Verification:** Click library icon → see "Seeded Library" → click → see 18 works (Augustine, Aquinas, etc.). Click "Confessions" → see passages from that work.

---

### Task 3.6: Add bookmarks to reading view

**Objective:** Bookmark button in reading view header. Bookmark persists to server-side SQLite.

**Files:**
- Create: `apps/web/app/api/reading/bookmarks/route.ts` (GET list, POST create)
- Create: `apps/web/app/api/reading/bookmarks/[id]/route.ts` (DELETE)
- Modify: `apps/web/app/word/page.tsx`

**Implementation:**

API:
- `GET /api/reading/bookmarks` → returns all bookmarks (from SQLite)
- `POST /api/reading/bookmarks` → `{ verseRef, label? }` → creates bookmark
- `DELETE /api/reading/bookmarks/[id]` → removes bookmark

SQLite schema (server-side only):
```sql
CREATE TABLE IF NOT EXISTS bookmarks (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  verse_ref TEXT NOT NULL,
  label TEXT,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);
```

Reading view header: bookmark icon (outline when not bookmarked, filled when bookmarked). Clicking toggles bookmark for current chapter reference (`Book Chapter`).

**Verification:** Open Genesis 1 → click bookmark icon → icon fills. Reload page → bookmark still present. Click again → removes. `GET /api/reading/bookmarks` returns the bookmark.

---

### Task 3.7: Add highlights to reading view

**Objective:** Text selection in reading view shows a 3-tone highlight toolbar. Highlights persist per verse_ref (shared across translations).

**Files:**
- Create: `apps/web/app/api/reading/highlights/route.ts` (GET, POST)
- Create: `apps/web/app/api/reading/highlights/[id]/route.ts` (DELETE)
- Modify: `apps/web/app/word/page.tsx`

**Implementation:**

On web, implement highlights as:
- Each verse is a clickable row. Clicking a verse selects it (shows highlight toolbar).
- Toolbar shows 3 color swatches (highlightGold #d4a574, highlightSage #a8b89e, highlightRose #c9a0a0) + a remove button.
- Selecting a color saves highlight `{ verseRef, color }` to API.
- On chapter load, fetch all highlights for the chapter's verses and apply background colors.

SQLite:
```sql
CREATE TABLE IF NOT EXISTS highlights (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  verse_ref TEXT NOT NULL,
  color TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);
```

**Verification:** Open Genesis 1 → click verse 3 → toolbar appears → click gold → verse 3 gets gold background. Reload page → highlight persists. Click sage → color changes. Click remove → highlight cleared.

---

## Phase 4: Journal — Persistence, Verse of Day, Resonance

### Task 4.1: Create server-side SQLite store for journal entries

**Objective:** Persist journal entries server-side (stand-in for Supabase).

**Files:**
- Create: `apps/web/app/api/journal/entries/route.ts` (GET list, POST create)
- Create: `apps/web/app/api/journal/entries/[id]/route.ts` (PUT update, DELETE)
- Create: `apps/web/lib/db.ts` (shared SQLite connection helper)

**Implementation:**

`apps/web/lib/db.ts`:
```typescript
import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = process.env.RAILWAY_VOLUME_MOUNT_PATH
  ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'resonance.db')
  : '/tmp/resonance.db';

let db: Database.Database | null = null;

export function getDb() {
  if (db) return db;
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS journal_entries (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      text TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
    );
    CREATE TABLE IF NOT EXISTS bookmarks (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      verse_ref TEXT NOT NULL,
      label TEXT,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
    );
    CREATE TABLE IF NOT EXISTS highlights (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      verse_ref TEXT NOT NULL,
      color TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
    );
    CREATE TABLE IF NOT EXISTS annotations (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      verse_ref TEXT NOT NULL,
      translation TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  return db;
}
```

Install `better-sqlite3`:
```bash
cd apps/web && npm install better-sqlite3
```

Journal API:
- `GET /api/journal/entries` → returns all entries ordered by created_at DESC
- `POST /api/journal/entries` → `{ text }` → creates entry, returns `{ id, text, created_at }`
- `PUT /api/journal/entries/[id]` → `{ text }` → updates entry
- `DELETE /api/journal/entries/[id]` → removes entry

**Verification:** `curl -X POST .../api/journal/entries -d '{"text":"test entry"}'` → 201 with ID. `curl .../api/journal/entries` → array with the entry. `curl -X DELETE .../api/journal/entries/<id>` → 204. Reload → entry persists.

---

### Task 4.2: Rewrite JournalPage with real persistence + verse of day

**Objective:** Journal entries persist via API. Verse of the day loads from API.

**Files:**
- Rewrite: `apps/web/app/journal/page.tsx`

**Implementation:**

1. On mount, fetch `/api/journal/entries` → populate entries list
2. On mount, fetch `/api/bible/verse-of-day` → show real daily verse (changes each day)
3. Save entry: `POST /api/journal/entries` with `{ text }` → add to list
4. Delete entry: `DELETE /api/journal/entries/[id]`
5. Show resonance cards placeholder that says "Resonance will appear as you write" until entries exist, then actually calls the resonance API

Remove the `KeyboardAvoidingView` import — it doesn't exist on web.

State:
```tsx
const [entries, setEntries] = useState<JournalEntry[]>([]);
const [verseOfDay, setVerseOfDay] = useState<{ text: string; ref: string } | null>(null);
const [currentText, setCurrentText] = useState('');
const [loading, setLoading] = useState(true);
```

**Verification:** Write an entry → click Save → entry persists. Refresh page → entry still there. Verse of the day shows today's real verse (e.g., Galatians 4:1 for day 174), not always Psalm 46:10.

---

### Task 4.3: Wire resonance cards to Journal

**Objective:** After saving a journal entry, show resonance cards from the API.

**Files:**
- Modify: `apps/web/app/journal/page.tsx`

**Implementation:**

After a journal entry is saved:
1. Call `POST /api/embed` with the entry text → get vector
2. Call `POST /api/resonance` with the vector → get top passages
3. Render results using a simplified inline card group (not the shared `ResonanceCardGroup` yet — see Task 1.2 for when that's ready)

If the shared `@resonance/ui` components are fixed (Task 1.2), use `ResonanceCardGroup`. Otherwise inline the same markup.

Loading state: "Finding resonance…" spinner/text while API calls are in flight.

```tsx
const [resonance, setResonance] = useState<{ scripture: any[]; voices: any[] } | null>(null);
const [findingResonance, setFindingResonance] = useState(false);

async function handleSave() {
  // ... save entry ...
  setFindingResonance(true);
  try {
    const embedRes = await fetch('/api/embed', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: currentText.trim() }),
    });
    const { vector } = await embedRes.json();
    const resRes = await fetch('/api/resonance', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vector }),
    });
    const data = await resRes.json();
    setResonance(data);
  } finally {
    setFindingResonance(false);
  }
}
```

**Verification:** Write a journal entry about "light" → resonance cards show passages about light. Cards appear below the entry. Refresh → cards re-appear (or stored with entry).

---

### Task 4.4: Wire reflection prompt to Journal

**Objective:** After journal entries exist, offer a gentle reflection question via the LLM API.

**Files:**
- Modify: `apps/web/app/journal/page.tsx`

**Implementation:**

Add a "Reflect" button below the verse-of-day card. When clicked:
1. Take the most recent 3 entries' text
2. Call `POST /api/reflect` with `{ action: 'reflection_prompt', excerpts: [...] }`
3. Show the returned question in a quiet card with serif italic text
4. The question is ephemeral (not stored) — it regenerates each click

```tsx
const [reflection, setReflection] = useState<string | null>(null);
const [reflecting, setReflecting] = useState(false);

async function handleReflect() {
  setReflecting(true);
  try {
    const recentTexts = entries.slice(0, 3).map(e => e.text);
    const res = await fetch('/api/reflect', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reflection_prompt', excerpts: recentTexts }),
    });
    const data = await res.json();
    if (data.text) setReflection(data.text);
  } finally {
    setReflecting(false);
  }
}
```

**Verification:** Write 1-2 journal entries → click "Reflect" → see a gentle question in serif italic. Click again → different question. The question never contains prayers, advice, or Scripture interpretation.

---

## Phase 5: Patterns — Calendar, Clustering, Themes

### Task 5.1: Create real calendar component

**Objective:** Replace the 30 arbitrary circles with a real month calendar showing entry activity.

**Files:**
- Create: `apps/web/app/patterns/calendar.tsx`
- Modify: `apps/web/app/patterns/page.tsx`

**Implementation:**

Real calendar grid:
- Shows current month with day labels (S M T W T F S)
- Previous/next month navigation arrows
- Each day cell: shows a dot if journal entries exist for that date
- Dot size/opacity scales with entry count (1 entry = small, 3+ = large)
- Today is highlighted with accent border

Fetch entry dates from `/api/journal/entries`, group by date, pass to calendar.

```tsx
function CalendarGrid({ entryDates }: { entryDates: Map<string, number> }) {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  // ... build grid: weekday headers, day cells, prev/next nav ...
}
```

**Verification:** Open Patterns → see a real calendar for the current month with correct day layout. Write a journal entry → go to Patterns → today's cell has a dot. Navigate to previous month → different dates.

---

### Task 5.2: Create Patterns API endpoint — weekly roundup

**Objective:** Return a weekly summary of journal entries.

**Files:**
- Create: `apps/web/app/api/patterns/weekly/route.ts`

**Implementation:**

- Fetches journal entries from the past 7 days
- Returns: `{ entryCount, dateRange, excerpts: string[] }`
- If entryCount > 0, calls `/api/reflect` with `action: 'cluster_label'` to generate a 2-3 word theme label
- Returns `{ entryCount, dateRange, excerpts, themeLabel? }`

**Verification:** Write 2-3 entries over the past week → `GET /api/patterns/weekly` returns entry count, excerpts, and a theme label.

---

### Task 5.3: Create Patterns API endpoint — recurring themes (TF-IDF)

**Objective:** Extract top keywords from recent entries using TF-IDF.

**Files:**
- Create: `apps/web/app/api/patterns/themes/route.ts`

**Implementation:**

- Fetches all journal entries
- Uses `extractKeywords` from `@resonance/core/tfidf` to get top 5 keywords
- Returns: `{ themes: { word: string, score: number }[] }`

```typescript
import { extractKeywords } from '../../../../../packages/core/src/tfidf';

export async function GET() {
  const db = getDb();
  const entries = db.prepare('SELECT text FROM journal_entries ORDER BY created_at DESC LIMIT 50').all();
  const texts = entries.map((e: any) => e.text);
  const keywords = extractKeywords(texts, 5);
  return NextResponse.json({ themes: keywords });
}
```

**Verification:** Write several entries about similar topics → `GET /api/patterns/themes` returns keywords from those entries.

---

### Task 5.4: Rewrite PatternsPage with real data

**Objective:** Replace all placeholder text with real calendar, weekly roundup, themes, and a reflection question.

**Files:**
- Rewrite: `apps/web/app/patterns/page.tsx`

**Implementation:**

1. **Calendar:** Render `CalendarGrid` with real entry dates
2. **This Week:** Fetch `/api/patterns/weekly` → show entry count, theme label, excerpts
3. **Recurring Themes:** Fetch `/api/patterns/themes` → show as tag pills (keyword + score as opacity)
4. **A Quiet Question:** Fetch `/api/reflect` with `reflection_prompt` action using recent entries → show reflection question in serif italic card

Empty states: if no entries yet, show the gentle "Patterns will appear as you write" message (keep this copy — it's good).

**Verification:** With journal entries written: calendar shows dots, weekly roundup shows theme label, themes shows keywords. Without entries: gentle empty state.

---

## Phase 6: Settings — Make Everything Interactive

### Task 6.1: Create settings API + store

**Objective:** Persist user settings in SQLite.

**Files:**
- Create: `apps/web/app/api/settings/route.ts` (GET all, PUT update)
- Already created: `apps/web/lib/db.ts` (settings table)

**Implementation:**

- `GET /api/settings` → returns `{ translation, fontSize, theme, textScale, reduceMotion, embeddingModel, llmModel }` from settings table (with defaults)
- `PUT /api/settings` → `{ key, value }` → upserts setting

```typescript
export async function GET() {
  const db = getDb();
  const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
  const settings: Record<string, string> = {};
  for (const r of rows) settings[r.key] = r.value;
  return NextResponse.json({
    translation: settings.translation || 'web',
    fontSize: settings.fontSize || 'medium',
    theme: settings.theme || 'auto',
    textScale: settings.textScale || 'medium',
    reduceMotion: settings.reduceMotion || 'off',
    embeddingModel: settings.embeddingModel || 'gte-small',
    llmModel: settings.llmModel || 'qwen-2.5-72b',
  });
}

export async function PUT(req: NextRequest) {
  const db = getDb();
  const { key, value } = await req.json();
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
  return NextResponse.json({ ok: true });
}
```

**Verification:** `curl -X PUT .../api/settings -d '{"key":"translation","value":"kjv"}'` → 200. `GET /api/settings` → translation is "kjv". Reload → persists.

---

### Task 6.2: Make SettingsPage interactive

**Objective:** Every settings row is a clickable/toggleable control.

**Files:**
- Rewrite: `apps/web/app/settings/page.tsx`

**Implementation:**

1. **Embedding Model:** Radio button list — clicking a model selects it (highlights with accent border). Saves via PUT.
2. **Reflection Model:** Same radio pattern.
3. **Reading Preferences:**
   - Default Translation: tappable → cycles WEB → KJV → WEB. Saves via PUT.
   - Font Size: tappable → cycles Small → Medium → Large → Small. Saves via PUT.
   - Theme: tappable → cycles Auto → Light → Dark (Auto). Saves via PUT.
4. **Privacy & Data:**
   - Export Journal: button → `GET /api/journal/entries` → download as JSON
   - Clear All Journal Data: button → `DELETE /api/journal/entries` (with confirm dialog)
   - Clear Resonance Vectors: button → clears server-side vector cache (with confirm)
   - App Lock: static "Not configured" for now (web doesn't have biometric)
5. **Storage:** Show real size from `SELECT SUM(LENGTH(text)) FROM journal_entries` + highlights + annotations.
6. **Accessibility:**
   - Text Scale: tappable → cycles Small → Medium → Large → Extra Large → Small.
   - Reduce Motion: toggle on/off.

All changes call `PUT /api/settings` immediately on change.

State:
```tsx
const [settings, setSettings] = useState<Settings | null>(null);
// On mount: fetch GET /api/settings
// On change: PUT /api/settings, update local state
```

**Verification:** Open Settings → click KJV in translation → it's selected. Refresh → still KJV. Click "Export Journal" → downloads JSON. Click "Clear All" → confirm → entries gone. Settings persist across reloads.

---

### Task 6.3: Apply settings to the app

**Objective:** Settings actually affect the app (translation default, font size, theme).

**Files:**
- Create: `apps/web/lib/settings.ts` (client-side settings fetcher + React context)
- Modify: `apps/web/app/layout.tsx` (wrap in SettingsProvider)
- Modify: `apps/web/app/word/page.tsx` (use translation from settings)
- Modify: `apps/web/app/journal/page.tsx` (use font size from settings)

**Implementation:**

```tsx
// apps/web/lib/settings.ts
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

interface AppSettings {
  translation: string;
  fontSize: string;
  theme: string;
  textScale: string;
  reduceMotion: string;
}

const SettingsContext = createContext<AppSettings | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>({
    translation: 'web', fontSize: 'medium', theme: 'auto', textScale: 'medium', reduceMotion: 'off',
  });

  useEffect(() => {
    fetch('/api/settings').then(r => r.json()).then(setSettings).catch(() => {});
  }, []);

  return <SettingsContext.Provider value={settings}>{children}</SettingsContext.Provider>;
}

export function useSettings() {
  return useContext(SettingsContext);
}
```

Word tab uses `settings.translation` as the default. Journal uses `settings.fontSize` to scale text.

**Verification:** Set translation to KJV in Settings → go to Word → default is KJV. Set font size to Large → Journal text is bigger.

---

## Phase 7: Auth — Premium Gate

### Task 7.1: Create simple dev auth gate

**Objective:** Block all access to the web app unless authenticated. Since there's no sign-up flow or Supabase yet, use a simple shared-secret password gate. The web app is for testing only.

**Files:**
- Create: `apps/web/app/api/auth/route.ts` (POST: verify password, set cookie)
- Create: `apps/web/middleware.ts` (block all routes except /login and /api/auth)
- Create: `apps/web/app/login/page.tsx` (simple password form)
- Modify: `apps/web/app/layout.tsx` (don't render app if not authed — middleware handles this)

**Implementation:**

The auth token is a simple HMAC or just a signed cookie. Password is stored in env var `RESONANCE_DEV_PASSWORD`.

`middleware.ts`:
```typescript
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const PUBLIC_PATHS = ['/login', '/api/auth'];

export function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;
  if (PUBLIC_PATHS.some(p => path.startsWith(p))) {
    return NextResponse.next();
  }
  const authCookie = req.cookies.get('resonance-auth');
  if (authCookie?.value === process.env.RESONANCE_AUTH_SECRET) {
    return NextResponse.next();
  }
  return NextResponse.redirect(new URL('/login', req.url));
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
```

`/api/auth` POST:
```typescript
export async function POST(req: NextRequest) {
  const { password } = await req.json();
  if (password === process.env.RESONANCE_DEV_PASSWORD) {
    const res = NextResponse.json({ ok: true });
    res.cookies.set('resonance-auth', process.env.RESONANCE_AUTH_SECRET!, {
      httpOnly: true,
      sameSite: 'strict',
      maxAge: 60 * 60 * 24 * 7, // 7 days
    });
    return res;
  }
  return NextResponse.json({ error: 'Invalid password' }, { status: 401 });
}
```

`/login` page: simple centered form — "Resonance" title, password input, submit button. Cream background, serif font, same design language.

Set Railway env vars:
- `RESONANCE_DEV_PASSWORD` — the test password (Michael sets this)
- `RESONANCE_AUTH_SECRET` — a random string for the cookie value

**Important:** This is a dev-only auth gate. When Supabase is wired up, it replaces this entirely. The middleware will check Supabase session instead.

**Also important:** Because web users are always premium, there is no free/premium toggle on web. Once authenticated, all features are available. The middleware guarantees no unauthenticated access.

**Verification:** Open the app → redirected to /login. Enter wrong password → error. Enter correct password → redirected to Journal tab. Refresh → stays logged in (cookie). All API routes also blocked without cookie.

---

### Task 7.2: Add auth context to frontend

**Objective:** Frontend knows the user is authenticated. Shows user info in settings. Can log out.

**Files:**
- Create: `apps/web/lib/auth.ts` (client-side auth context)
- Modify: `apps/web/app/settings/page.tsx` (show auth status, logout button)
- Modify: `apps/web/app/login/page.tsx` (redirect to home on success)

**Implementation:**

Simple: the login page calls `POST /api/auth`, on success redirects to `/`. The middleware handles protection. Settings page shows "Signed in" status and a "Sign out" button that clears the cookie.

Add a user section at the top of Settings:
```
Account
  Status: Premium (dev)
  Sign out → clears cookie → redirect to /login
```

**Verification:** Login → go to Settings → see "Signed in as Premium (dev)". Click "Sign out" → redirected to /login.

---

## Phase 8: API Hardening

### Task 8.1: Fix `/api/resonance` — async loading + memory optimization

**Objective:** Don't block request handling while loading 388MB. Load vectors asynchronously. Pre-build a passage metadata index.

**Files:**
- Modify: `apps/web/app/api/resonance/route.ts`

**Implementation:**

1. Use `fs.promises.readFile` instead of `readFileSync`
2. Load vectors in a background promise at module level — don't block
3. If vectors aren't loaded yet when a request comes in, return `{ scripture: [], voices: [], note: 'Loading library...' }` with 200 status
4. Pre-build a typed array index: `Float32Array` for vectors, and a pre-allocated `passageMetadata` array with known length

```typescript
let vectorsPromise: Promise<void> | null = null;
let vectorsLoaded = false;
let passageVectors: Float32Array | null = null;
let passageCount = 0;

// Start loading immediately at module level (non-blocking)
vectorsPromise = loadVectors();

async function loadVectors() {
  try {
    const buffer = await readFile(VECTORS_PATH);
    passageVectors = new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4);
    passageCount = passageVectors.length / DIM;
    // Load metadata
    const [bibleData, voiceData] = await Promise.all([
      readFileBibleMeta(), readFileVoiceMeta(),
    ]);
    passageMetadata = [...bibleData, ...voiceData];
    vectorsLoaded = true;
  } catch { /* graceful */ }
}
```

5. In the POST handler: if `!vectorsLoaded`, await `vectorsPromise` with a 10s timeout. If still not loaded, return loading response.

**Verification:** First request to `/api/resonance` returns `{ scripture: [], note: 'Loading library...' }` quickly (under 2s). Subsequent requests return real results once vectors are loaded.

---

### Task 8.2: Fix `/api/embed` — use real embedding API

**Objective:** Replace hash-based embedding with a real embedding model API call.

**Files:**
- Modify: `apps/web/app/api/embed/route.ts`

**Implementation:**

Two options (pick whichever is available):

**Option A — OpenRouter embeddings (if available):** Some OpenRouter models support embeddings. Use the same API key.

**Option B — embeddings.io or HuggingFace inference API:** Call a hosted embedding model.

**Option C (recommended for now) — use a lightweight local approach:** Install `@xenova/transformers` (Transformers.js) and run GTE-small in the Node.js process:

```typescript
import { pipeline } from '@xenova/transformers';

let embedder: any = null;

async function getEmbedder() {
  if (!embedder) {
    embedder = await pipeline('feature-extraction', 'Xenova/gte-small');
  }
  return embedder;
}

export async function POST(req: NextRequest) {
  const { text } = await req.json();
  if (!text || text.trim().length < 12) {
    return NextResponse.json({ error: 'Text too short' }, { status: 400 });
  }
  const model = await getEmbedder();
  const output = await model(text, { pooling: 'mean', normalize: true });
  return NextResponse.json({ vector: Array.from(output.data), dim: output.data.length });
}
```

Install: `npm install @xenova/transformers`

**Fallback:** If neither is available, keep the hash-based embedding but document it clearly as temporary.

**Verification:** `curl -X POST .../api/embed -d '{"text":"God is love"}'` → returns 384-dim vector. Compare with cosine similarity against library vectors — results should be semantically relevant, not random.

---

### Task 8.3: Fix `/api/reflect` — proper system message role

**Objective:** Send the system prompt as a `system` role message, not concatenated into the user message.

**Files:**
- Modify: `apps/web/app/api/reflect/route.ts`

**Implementation:**

```typescript
// Before:
messages: [{ role: 'user', content: prompt }]

// After:
messages: [
  { role: 'system', content: REFLECTION_SYSTEM_PROMPT },
  { role: 'user', content: userPrompt },
]
```

Where `userPrompt` is just the journal excerpts + instruction, without the system prompt prepended.

For `cluster_label` and `shift_narrative` actions (which don't use the system prompt), keep using a single user message but add a minimal system message:

```typescript
messages: [
  { role: 'system', content: 'You are a concise assistant. Follow instructions exactly.' },
  { role: 'user', content: prompt },
]
```

**Verification:** Call `/api/reflect` with `reflection_prompt` action → the returned question should be more consistent with the constraints (shorter, gentler, no prayers).

---

### Task 8.4: Fix `/api/health` — report real state

**Objective:** Health endpoint reports whether vectors are actually loaded.

**Files:**
- Modify: `apps/web/app/api/health/route.ts`

**Implementation:**

Export a function from the resonance route that reports loading state, or check a shared module:

```typescript
// In resonance/route.ts — export the state:
export function isVectorsLoaded() { return vectorsLoaded; }

// In health/route.ts:
import { isVectorsLoaded } from '../resonance/route';

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    model: process.env.LLM_MODEL || 'qwen/qwen-2.5-72b-instruct',
    vectorsLoaded: isVectorsLoaded(),
    passageCount: /* exported from resonance route */,
  });
}
```

**Verification:** `GET /api/health` → `vectorsLoaded: false` before first resonance request, `true` after vectors load.

---

### Task 8.5: Add rate limiting to API routes

**Objective:** Prevent abuse of the LLM and embedding endpoints.

**Files:**
- Create: `apps/web/lib/ratelimit.ts`
- Modify: `apps/web/app/api/reflect/route.ts`
- Modify: `apps/web/app/api/embed/route.ts`
- Modify: `apps/web/app/api/resonance/route.ts`

**Implementation:**

Simple in-memory rate limiter (survives per-instance, resets on deploy):

```typescript
// apps/web/lib/ratelimit.ts
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX = 20; // 20 requests per minute per IP

const requests = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(ip: string): { allowed: boolean; retryAfter?: number } {
  const now = Date.now();
  const entry = requests.get(ip);
  if (!entry || entry.resetAt < now) {
    requests.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
    return { allowed: true };
  }
  if (entry.count >= RATE_LIMIT_MAX) {
    return { allowed: false, retryAfter: Math.ceil((entry.resetAt - now) / 1000) };
  }
  entry.count++;
  return { allowed: true };
}
```

In each API route, at the top of the handler:
```typescript
const ip = req.headers.get('x-forwarded-for') || 'unknown';
const rl = rateLimit(ip);
if (!rl.allowed) {
  return NextResponse.json({ error: 'Rate limit exceeded', retryAfter: rl.retryAfter }, { status: 429 });
}
```

Stricter limits for `/api/reflect` (5/min — costs money) vs `/api/resonance` (20/min).

**Verification:** Hit `/api/reflect` 6 times in rapid succession → 6th returns 429 with retryAfter.

---

## Phase 9: Polish — Error Boundaries, Loading States, 404

### Task 9.1: Add error boundary + loading states

**Objective:** No white screens. Graceful error handling.

**Files:**
- Create: `apps/web/app/error.tsx` (Next.js error boundary)
- Create: `apps/web/app/loading.tsx` (Next.js loading state)
- Create: `apps/web/app/not-found.tsx` (custom 404)

**Implementation:**

`error.tsx`:
```tsx
'use client';
import { StyleSheet, Text, View } from 'react-native-web';

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Something went wrong</Text>
      <Text style={styles.text}>An unexpected error occurred. Your data is safe.</Text>
      <Pressable onPress={reset} style={styles.button}>
        <Text style={styles.buttonText}>Try again</Text>
      </Pressable>
    </View>
  );
}
```

`loading.tsx`: simple centered "Loading…" in serif.

`not-found.tsx`:
```tsx
export default function NotFound() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Not found</Text>
      <Pressable onPress={() => window.location.href = '/'}>
        <Text style={styles.link}>Return home</Text>
      </Pressable>
    </View>
  );
}
```

All in the cream/serif design language.

**Verification:** Navigate to `/nonexistent` → see styled 404 page. Trigger a component error → see styled error page with "Try again" button.

---

### Task 9.2: Add loading spinners to all data fetches

**Objective:** Every API-driven screen shows a loading state while fetching.

**Files:**
- Modify: `apps/web/app/word/page.tsx`
- Modify: `apps/web/app/journal/page.tsx`
- Modify: `apps/web/app/patterns/page.tsx`
- Modify: `apps/web/app/settings/page.tsx`

**Implementation:**

Add a shared `Loading` component:
```tsx
function LoadingSpinner() {
  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 40 }}>
      <Text style={{ fontFamily: 'Georgia, serif', fontSize: 16, color: '#9a9388', fontStyle: 'italic' }}>
        Loading…
      </Text>
    </View>
  );
}
```

Show `<LoadingSpinner />` while `loading` state is true on every screen.

**Verification:** Navigate between tabs → brief "Loading…" text appears before content renders.

---

### Task 9.3: Add SEO meta tags + favicon

**Objective:** Proper OpenGraph tags, theme-color, favicon.

**Files:**
- Modify: `apps/web/app/layout.tsx`
- Create: `apps/web/app/icon.svg` (simple favicon)

**Implementation:**

In `layout.tsx` metadata:
```tsx
export const metadata = {
  title: 'Resonance — A private spiritual journal',
  description: 'A warm, reverent space for journaling, reading Scripture, and noticing patterns over time.',
  openGraph: {
    title: 'Resonance',
    description: 'A private, offline-first Christian spiritual journal.',
    type: 'website',
  },
  themeColor: '#faf9f6',
  icons: { icon: '/icon.svg' },
};
```

Simple SVG favicon — a small serif "R" in accent brown on cream.

**Verification:** View page source → meta tags present. Browser tab shows favicon.

---

## Summary — Task-to-Audit Mapping

| Audit ID | Issue | Tasks |
|---|---|---|
| C1 | Frontend disconnected from API | 2.1–2.6, 4.1–4.4, 5.1–5.4, 6.1–6.2 |
| C2 | No auth/premium gating | 7.1, 7.2 |
| C3 | Shared UI broken on web | 1.2, 1.4 |
| M1 | Word tab non-functional | 2.1–2.6, 3.1–3.7 |
| M2 | Journal barely functional | 4.1–4.4 |
| M3 | Patterns 100% placeholder | 5.1–5.4 |
| M4 | Settings zero interactivity | 6.1–6.3 |
| R1 | Fonts not loaded | 1.1 |
| R2 | Responsive gaps | 1.3 |
| R3 | Resonance API timeout | 8.1 |
| R4 | Embed produces garbage | 8.2 |
| R5 | Health lies | 8.4 |
| R6 | System prompt as user msg | 8.3 |
| R7 | No rate limiting | 8.5 |
| N1–N5 | Polish (404, errors, SEO, loading) | 9.1–9.3 |

---

## Dependency Graph

```
Phase 1 (Foundation) ─────────────────────────────► all phases depend on 1.2, 1.4
    │
    ├── Phase 2 (Bible API) ──────────────────────► Phase 3 (Word tab)
    │                                                   │
    ├── Phase 4 (Journal + API) ────────────────► Phase 5 (Patterns)
    │                                                   │
    ├── Phase 6 (Settings) ─────────────────────────────►
    │
    ├── Phase 7 (Auth) ──────────────────────────────────► can run in parallel with 2-6
    │
    └── Phase 8 (API hardening) ───────────────────► depends on 2, 4
            │
            └── Phase 9 (Polish) ──────────────────► last, after all features work
```

**Parallelizable:** Phases 2, 4, 6, and 7 can be developed in parallel after Phase 1. Phase 3 depends on Phase 2. Phase 5 depends on Phase 4. Phase 8 depends on Phases 2 and 4. Phase 9 is last.

---

## Railway Environment Variables Needed

```
OPENROUTER_API_KEY        — already set
LLM_MODEL                 — already set (qwen/qwen-2.5-72b-instruct)
RESONANCE_DEV_PASSWORD    — test password for auth gate (Michael sets this)
RESONANCE_AUTH_SECRET     — random 32-char string for cookie signing
RAILWAY_VOLUME_MOUNT_PATH — Railway volume mount path (for SQLite persistence)
```

Set via: `railway variables --set RESONANCE_DEV_PASSWORD=<password>` etc.

---

## What This Does NOT Address

- **Supabase integration** — everything uses server-side SQLite as a stand-in. When Supabase credentials are provided, swap `lib/db.ts` for Supabase client calls. The DataLayer interface in `@resonance/core` is the contract.
- **Mobile app updates** — the mobile app already has its own implementations. Web-specific fixes don't touch mobile.
- **Sign-up flow** — Michael explicitly said no sign-up on web yet. Auth is a single shared password.
- **Annotations in Word tab** — scoped out for now (highlights + bookmarks cover the core reading experience). Can add as a follow-up.
