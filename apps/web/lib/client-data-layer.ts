'use client';

import type {
  DataLayer,
  Translation,
  BookSummary,
  VersePassage,
  PassageHit,
  SearchScope,
  LibraryPackage,
  LibraryBook,
  LibraryPassage,
  JournalSegment,
  HighlightMap,
  AnnotationMap,
  Bookmark,
  ResonanceResult,
  EntryCluster,
  WeeklyRoundup,
  ShiftReport,
  CalendarDay,
  ReflectionPrompt,
  EmbeddingModelId,
} from '@resonance/core';

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${path}`);
  return res.json();
}

function bibleBookId(bookName: string, translation: Translation): string {
  return `${translation}_${bookName.replace(/\s+/g, '_')}`;
}

function scriptureRef(bookName: string, chapter: number | null, verseStart: number | null, verseEnd: number | null): string {
  const ref = `${bookName} ${chapter ?? ''}:${verseStart ?? ''}`;
  return verseEnd != null && verseEnd !== verseStart ? `${ref}-${verseEnd}` : ref.trim();
}

interface WebBookRow {
  id: string;
  name: string;
  testament: 'OT' | 'NT';
  order: number;
  translation: string;
  chapterCount: number;
  chapters: number[];
}

interface WebSearchRow {
  id: number;
  book: string | null;
  chapter: number | null;
  verseStart: number | null;
  verseEnd: number | null;
  text: string;
  translation: string | null;
  type: 'scripture' | 'library';
  source: string | null;
}

interface WebLibraryPackage {
  packageId: string;
  label: string;
  books: { id: string; title: string | null; author: string | null; era: string | null; source?: string | null }[];
}

export class WebDataLayer implements DataLayer {
  async getBooks(translation: Translation): Promise<BookSummary[]> {
    const data = await api<{ books: WebBookRow[] }>(`/api/bible/books?translation=${translation.toLowerCase()}`);
    return data.books.map((b) => ({
      name: b.name,
      testament: b.testament,
      order: b.order,
      available: b.chapterCount > 0,
      bookId: bibleBookId(b.name, translation),
    }));
  }

  async getChapters(bookName: string, translation: Translation): Promise<number[]> {
    const data = await api<{ books: WebBookRow[] }>(`/api/bible/books?translation=${translation.toLowerCase()}`);
    return data.books.find((b) => b.name === bookName)?.chapters ?? [];
  }

  async getVerses(bookName: string, chapter: number, translation: Translation): Promise<VersePassage[]> {
    const data = await api<{ verses: { id: number; verseStart: number; verseEnd: number; text: string }[] }>(
      `/api/bible/chapter?book=${encodeURIComponent(bookName)}&chapter=${chapter}&translation=${translation.toLowerCase()}`,
    );
    return data.verses.map((v) => ({
      id: v.id,
      book_id: bibleBookId(bookName, translation),
      chapter,
      verse_start: v.verseStart,
      verse_end: v.verseEnd,
      text: v.text,
      translation,
      chunk_id: null,
    }));
  }

  async searchPassages(query: string, scope: SearchScope): Promise<PassageHit[]> {
    const data = await api<{ results: WebSearchRow[] }>(`/api/bible/search?q=${encodeURIComponent(query)}&scope=${scope}`);
    return data.results.map((r) => ({
      id: r.id,
      book_id: r.translation ? bibleBookId(r.book ?? '', r.translation.toUpperCase() as Translation) : r.book ?? '',
      chapter: r.chapter,
      verse_start: r.verseStart,
      verse_end: r.verseEnd,
      text: r.text,
      translation: r.translation ? r.translation.toUpperCase() : null,
      source: r.translation
        ? `${scriptureRef(r.book ?? '', r.chapter, r.verseStart, r.verseEnd)} (${r.translation.toUpperCase()})`
        : [r.source, r.book].filter(Boolean).join(' — '),
    }));
  }

  async getLibraryPackages(): Promise<LibraryPackage[]> {
    const data = await api<{ packages: WebLibraryPackage[] }>('/api/library/books');
    return data.packages.map((pkg) => ({
      package_id: pkg.packageId,
      label: pkg.label,
      books: pkg.books.map((book) => ({
        id: book.id,
        title: book.title,
        author: book.author,
        era: book.era,
        package_id: pkg.packageId,
      })),
    }));
  }

  async getLibraryBook(bookId: string): Promise<LibraryBook | null> {
    const packages = await this.getLibraryPackages();
    for (const pkg of packages) {
      const found = pkg.books.find((book) => book.id === bookId);
      if (found) return found;
    }
    return null;
  }

  async getLibraryPassages(bookId: string): Promise<LibraryPassage[]> {
    const data = await api<{ passages: LibraryPassage[] }>(`/api/library/passages?bookId=${encodeURIComponent(bookId)}`);
    return data.passages;
  }

  async loadSegments(): Promise<JournalSegment[]> { return []; }
  async saveSegment(_segment: JournalSegment): Promise<void> {}
  async deleteSegment(_id: string): Promise<void> {}

  async getHighlightsForRefs(refs: string[]): Promise<HighlightMap> {
    if (refs.length === 0) return {};
    const prefix = refs[0].replace(/:\d+.*$/, '');
    const data = await api<{ highlights: { verse_ref: string; color: string }[] }>(`/api/reading/highlights?verseRef=${encodeURIComponent(prefix)}`);
    const wanted = new Set(refs);
    const map: HighlightMap = {};
    for (const highlight of data.highlights) {
      if (wanted.has(highlight.verse_ref)) map[highlight.verse_ref] = highlight.color;
    }
    return map;
  }

  async saveHighlight(verseRef: string, color: string): Promise<void> {
    await api('/api/reading/highlights', { method: 'POST', body: JSON.stringify({ verseRef, color }) });
  }

  async removeHighlight(verseRef: string): Promise<void> {
    const data = await api<{ highlights: { id: string; verse_ref: string }[] }>(`/api/reading/highlights?verseRef=${encodeURIComponent(verseRef)}`);
    const existing = data.highlights.find((h) => h.verse_ref === verseRef);
    if (existing) await fetch(`/api/reading/highlights/${existing.id}`, { method: 'DELETE' });
  }

  async getAnnotationsForRefs(refs: string[], translation: Translation): Promise<AnnotationMap> {
    if (refs.length === 0) return {};
    const prefix = refs[0].replace(/:\d+.*$/, '');
    const data = await api<{ annotations: { verse_ref: string; text: string }[] }>(
      `/api/reading/annotations?verseRef=${encodeURIComponent(prefix)}&translation=${translation}`,
    );
    const wanted = new Set(refs);
    const map: AnnotationMap = {};
    for (const annotation of data.annotations) {
      if (wanted.has(annotation.verse_ref)) map[annotation.verse_ref] = annotation.text;
    }
    return map;
  }

  async saveAnnotation(verseRef: string, translation: Translation, text: string): Promise<void> {
    await api('/api/reading/annotations', { method: 'POST', body: JSON.stringify({ verseRef, translation, text }) });
  }

  async saveBookmark(verseRef: string, label?: string): Promise<void> {
    await api('/api/reading/bookmarks', { method: 'POST', body: JSON.stringify({ verseRef, label }) });
  }

  async removeBookmark(verseRef: string): Promise<void> {
    const data = await api<{ bookmarks: { id: string; verse_ref: string }[] }>('/api/reading/bookmarks');
    const existing = data.bookmarks.find((b) => b.verse_ref === verseRef);
    if (existing) await fetch(`/api/reading/bookmarks/${existing.id}`, { method: 'DELETE' });
  }

  async getBookmarks(): Promise<Bookmark[]> {
    const data = await api<{ bookmarks: Bookmark[] }>('/api/reading/bookmarks');
    return data.bookmarks;
  }

  async getCrossReferences(verseRef: string): Promise<string[]> {
    const data = await api<{ refs: string[] }>(`/api/bible/cross-refs?ref=${encodeURIComponent(verseRef)}`);
    return data.refs;
  }

  async findResonance(_journalText: string): Promise<ResonanceResult | null> { return null; }
  async storeSegmentVector(_segmentId: string, _text: string): Promise<void> {}
  async clusterEntries(_segments: JournalSegment[]): Promise<EntryCluster[]> { return []; }
  async generateWeeklyRoundup(_segments: JournalSegment[], weekStart: string): Promise<WeeklyRoundup> {
    return { weekStart, entryCount: 0, themes: [], excerpt: '' };
  }
  async generateShiftReport(_segments: JournalSegment[], p1Start: string, p2Start: string): Promise<ShiftReport> {
    return { comparisonDate: '', period1Start: p1Start, period2Start: p2Start, narrative: null };
  }
  async getCalendarDays(_segments: JournalSegment[], _year: number, _month: number): Promise<CalendarDay[]> { return []; }
  async generateReflectionPrompt(_excerpts: string[]): Promise<ReflectionPrompt | null> { return null; }
  async generateClusterLabel(_excerpts: string[]): Promise<string | null> { return null; }
  async generateShiftNarrative(_p1Excerpts: string[], _p2Excerpts: string[]): Promise<string | null> { return null; }
  async getActiveEmbeddingModel(): Promise<EmbeddingModelId> { return 'gte-small'; }
  async setActiveEmbeddingModel(_id: EmbeddingModelId): Promise<void> {}
}
