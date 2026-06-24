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

  async loadSegments(): Promise<JournalSegment[]> {
    const data = await api<{ entries: { id: string; text: string; created_at: number; updated_at?: number }[] }>('/api/journal/entries');
    return data.entries
      .slice()
      .reverse()
      .map((entry, index) => {
        const createdMs = entry.created_at * 1000;
        return {
          id: entry.id,
          created_at: createdMs,
          updated_at: (entry.updated_at ?? entry.created_at) * 1000,
          segment_type: 'text' as const,
          text: entry.text,
          position_index: index,
          parent_date: new Date(createdMs).toISOString().slice(0, 10),
        };
      });
  }

  async saveSegment(segment: JournalSegment): Promise<void> {
    if (segment.segment_type !== 'text') return;
    await api('/api/journal/entries', {
      method: 'POST',
      body: JSON.stringify({
        id: segment.id,
        text: segment.text ?? '',
        created_at: Math.floor(segment.created_at / 1000),
        updated_at: Math.floor(segment.updated_at / 1000),
      }),
    });
  }

  async deleteSegment(id: string): Promise<void> {
    await fetch(`/api/journal/entries/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

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

  async findResonance(journalText: string): Promise<ResonanceResult | null> {
    if (journalText.trim().length < 12) return null;

    // 1. Embed the journal text via /api/embed (Xenova/gte-small in-browser or server-side)
    let vector: number[] | undefined;
    let model = 'gte-small';
    try {
      const embedResult = await api<{ vector: number[]; dim: number; model: string }>('/api/embed', {
        method: 'POST',
        body: JSON.stringify({ text: journalText }),
      });
      if (embedResult.vector && embedResult.vector.length > 0) {
        vector = embedResult.vector;
        model = embedResult.model || model;
      }
    } catch (err) {
      console.warn('[resonance] Embedding call failed, will use lexical fallback:', err);
    }

    // 2. Send vector + text to /api/resonance — semantic when vector is available, lexical fallback otherwise
    const body: Record<string, unknown> = { text: journalText };
    if (vector) {
      body.vector = vector;
      body.model = model;
    }

    const data = await api<ResonanceResult>('/api/resonance', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return data;
  }

  async storeSegmentVector(_segmentId: string, _text: string): Promise<void> {
    // Web resonance is server-side. Segment vectors are persisted once the
    // cloud/Supabase DataLayer replaces the temporary JSON store.
  }

  async clusterEntries(segments: JournalSegment[]): Promise<EntryCluster[]> {
    const textSegments = segments.filter((s) => s.segment_type === 'text' && (s.text ?? '').trim().length > 12);
    const byWord = new Map<string, JournalSegment[]>();
    const stop = new Set(['the','and','that','with','from','this','have','will','your','you','are','was','were','for','but','not','feel','feeling','really','just']);
    for (const seg of textSegments) {
      const words = (seg.text ?? '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 4 && !stop.has(w));
      for (const word of new Set(words.slice(0, 30))) {
        const bucket = byWord.get(word) ?? [];
        bucket.push(seg);
        byWord.set(word, bucket);
      }
    }
    return Array.from(byWord.entries())
      .filter(([, bucket]) => bucket.length >= 2)
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 6)
      .map(([label, bucket], index) => ({
        id: `cluster-${index}-${label}`,
        label,
        entryCount: bucket.length,
        excerpts: bucket.slice(0, 3).map((s) => s.text ?? ''),
        dateRange: { start: bucket[0]?.parent_date ?? '', end: bucket[bucket.length - 1]?.parent_date ?? '' },
      }));
  }

  async generateWeeklyRoundup(segments: JournalSegment[], weekStart: string): Promise<WeeklyRoundup> {
    const weekStartMs = new Date(`${weekStart}T00:00:00Z`).getTime();
    const weekEndMs = weekStartMs + 7 * 86400000;
    const week = segments.filter((s) => s.created_at >= weekStartMs && s.created_at < weekEndMs && s.segment_type === 'text' && (s.text ?? '').trim());
    const excerpt = week.slice().sort((a, b) => (b.text?.length ?? 0) - (a.text?.length ?? 0))[0]?.text?.slice(0, 200) ?? '';
    const clusters = await this.clusterEntries(week);
    return { weekStart, entryCount: week.length, themes: clusters.map((c) => c.label).slice(0, 5), excerpt };
  }

  async generateShiftReport(_segments: JournalSegment[], p1Start: string, p2Start: string): Promise<ShiftReport> {
    return { comparisonDate: new Date().toISOString().slice(0, 10), period1Start: p1Start, period2Start: p2Start, narrative: null };
  }

  async getCalendarDays(segments: JournalSegment[], year: number, month: number): Promise<CalendarDay[]> {
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    return Array.from({ length: daysInMonth }, (_, i) => {
      const day = i + 1;
      const date = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const count = segments.filter((s) => s.parent_date === date && s.segment_type === 'text' && (s.text ?? '').trim()).length;
      return { date, hasEntries: count > 0, entryCount: count };
    });
  }

  async generateReflectionPrompt(excerpts: string[]): Promise<ReflectionPrompt | null> {
    const data = await api<{ text?: string }>('/api/reflect', { method: 'POST', body: JSON.stringify({ action: 'reflection_prompt', excerpts }) });
    return data.text ? { prompt: data.text, generatedAt: Date.now() } : null;
  }

  async generateClusterLabel(excerpts: string[]): Promise<string | null> {
    const data = await api<{ text?: string }>('/api/reflect', { method: 'POST', body: JSON.stringify({ action: 'cluster_label', excerpts }) });
    return data.text ?? null;
  }

  async generateShiftNarrative(p1Excerpts: string[], p2Excerpts: string[]): Promise<string | null> {
    const data = await api<{ text?: string }>('/api/reflect', { method: 'POST', body: JSON.stringify({ action: 'shift_narrative', period1Excerpts: p1Excerpts, period2Excerpts: p2Excerpts }) });
    return data.text ?? null;
  }
  async getActiveEmbeddingModel(): Promise<EmbeddingModelId> { return 'gte-small'; }
  async setActiveEmbeddingModel(_id: EmbeddingModelId): Promise<void> {}
}
