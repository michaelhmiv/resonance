/**
 * Word page — Scripture browsing, reading, search, and library (web version).
 *
 * Fetches real Bible data from /api/bible/* endpoints.
 * Includes: book list → chapter grid → reading view with real verses,
 * cross-references, bookmarks, highlights, search, and library browser.
 */

'use client';

import { useState, useEffect, useCallback, type ReactNode } from 'react';
import { StyleSheet, Text, View, Pressable, ScrollView, TextInput, ActivityIndicator } from 'react-native-web';
import { SearchIcon, LibraryIcon, BookmarkIcon as BookmarkFilled } from '@resonance/ui';
import { BIBLE_BOOKS, type Translation } from '@resonance/core';

// ── Types ─────────────────────────────────────────────────────────────────────

interface BookInfo {
  id: string;
  name: string;
  testament: string;
  order: number;
  translation: string;
  chapterCount: number;
  chapters: number[];
}

interface Verse {
  id: number;
  verseStart: number;
  verseEnd: number;
  text: string;
}

interface SearchResult {
  id: number;
  book?: string;
  chapter?: number;
  verseStart?: number;
  verseEnd?: number;
  text: string;
  translation?: string;
  type: string;
  source: string;
}

interface LibraryPackage {
  packageId: string;
  label: string;
  books: { id: string; title: string; author: string; era: string; source: string }[];
}

interface Bookmark {
  id: string;
  verse_ref: string;
  label: string | null;
  created_at: number;
}

interface Highlight {
  id: string;
  verse_ref: string;
  color: string;
}

type ViewMode = 'books' | 'chapters' | 'reading' | 'search' | 'library';

// ── Component ──────────────────────────────────────────────────────────────────

export default function WordPage(): ReactNode {
  const [view, setView] = useState<ViewMode>('books');
  const [books, setBooks] = useState<BookInfo[]>([]);
  const [selectedBook, setSelectedBook] = useState<BookInfo | null>(null);
  const [selectedChapter, setSelectedChapter] = useState<number | null>(null);
  const [translation, setTranslation] = useState<Translation>('WEB');
  const [verses, setVerses] = useState<Verse[]>([]);
  const [crossRefs, setCrossRefs] = useState<Record<string, string[]>>({});
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [selectedVerse, setSelectedVerse] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchScope, setSearchScope] = useState<'scripture' | 'library'>('scripture');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [libraryPackages, setLibraryPackages] = useState<LibraryPackage[]>([]);

  // ── Load books on mount and when translation changes ──────────────────────
  useEffect(() => {
    setLoading(true);
    fetch(`/api/bible/books?translation=${translation.toLowerCase()}`)
      .then(r => r.json())
      .then(data => {
        setBooks(data.books || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [translation]);

  // ── Load bookmarks ────────────────────────────────────────────────────────
  useEffect(() => {
    fetch('/api/reading/bookmarks').then(r => r.json()).then(d => setBookmarks(d.bookmarks || [])).catch(() => {});
  }, []);

  // ── Load chapter when selected ─────────────────────────────────────────────
  useEffect(() => {
    if (!selectedBook || !selectedChapter) return;
    setLoading(true);
    setSelectedVerse(null);

    fetch(`/api/bible/chapter?book=${encodeURIComponent(selectedBook.name)}&chapter=${selectedChapter}&translation=${translation.toLowerCase()}`)
      .then(r => r.json())
      .then(data => {
        setVerses(data.verses || []);
        setLoading(false);
        // Fetch cross-refs for all verses
        const refBase = `${selectedBook.name} ${selectedChapter}:`;
        const refs = (data.verses || []).map((v: Verse) => `${refBase}${v.verseStart}`);
        Promise.all(
          refs.map((ref: string) =>
            fetch(`/api/bible/cross-refs?ref=${encodeURIComponent(ref)}`)
              .then(r => r.json())
              .then(d => ({ ref, refs: d.refs || [] }))
              .catch(() => ({ ref, refs: [] }))
          )
        ).then(results => {
          const map: Record<string, string[]> = {};
          results.forEach(r => { if (r.refs.length > 0) map[r.ref] = r.refs; });
          setCrossRefs(map);
        });

        // Fetch highlights for this chapter
        fetch(`/api/reading/highlights?verseRef=${encodeURIComponent(selectedBook.name + ' ' + selectedChapter)}`)
          .then(r => r.json())
          .then(d => setHighlights(d.highlights || []))
          .catch(() => {});
      })
      .catch(() => setLoading(false));
  }, [selectedBook, selectedChapter, translation]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleBookSelect = (book: BookInfo) => {
    setSelectedBook(book);
    setView('chapters');
  };

  const handleChapterSelect = (ch: number) => {
    setSelectedChapter(ch);
    setView('reading');
  };

  const handleTranslationChange = (t: Translation) => {
    setTranslation(t);
    if (selectedBook) {
      const updated = books.find(b => b.name === selectedBook.name);
      if (updated) setSelectedBook(updated);
    }
  };

  const goPrevChapter = () => {
    if (!selectedBook || !selectedChapter) return;
    const idx = selectedBook.chapters.indexOf(selectedChapter);
    if (idx > 0) setSelectedChapter(selectedBook.chapters[idx - 1]);
  };

  const goNextChapter = () => {
    if (!selectedBook || !selectedChapter) return;
    const idx = selectedBook.chapters.indexOf(selectedChapter);
    if (idx >= 0 && idx < selectedBook.chapters.length - 1) {
      setSelectedChapter(selectedBook.chapters[idx + 1]);
    }
  };

  const isBookmarked = selectedBook && selectedChapter
    ? bookmarks.some(b => b.verse_ref === `${selectedBook.name} ${selectedChapter}`)
    : false;

  const toggleBookmark = async () => {
    if (!selectedBook || !selectedChapter) return;
    const ref = `${selectedBook.name} ${selectedChapter}`;
    const existing = bookmarks.find(b => b.verse_ref === ref);
    if (existing) {
      await fetch(`/api/reading/bookmarks/${existing.id}`, { method: 'DELETE' });
      setBookmarks(bookmarks.filter(b => b.id !== existing.id));
    } else {
      const res = await fetch('/api/reading/bookmarks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ verseRef: ref }),
      });
      const bm = await res.json();
      setBookmarks([bm, ...bookmarks]);
    }
  };

  const applyHighlight = async (verseNum: number, color: string) => {
    if (!selectedBook || !selectedChapter) return;
    const ref = `${selectedBook.name} ${selectedChapter}:${verseNum}`;
    const res = await fetch('/api/reading/highlights', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ verseRef: ref, color }),
    });
    const hl = await res.json();
    setHighlights([...highlights.filter(h => h.verse_ref !== ref), hl]);
  };

  const removeHighlight = async (verseNum: number) => {
    if (!selectedBook || !selectedChapter) return;
    const ref = `${selectedBook.name} ${selectedChapter}:${verseNum}`;
    const existing = highlights.find(h => h.verse_ref === ref);
    if (existing) {
      await fetch(`/api/reading/highlights/${existing.id}`, { method: 'DELETE' });
      setHighlights(highlights.filter(h => h.verse_ref !== ref));
    }
  };

  const performSearch = useCallback(async () => {
    if (searchQuery.trim().length < 2) return;
    setLoading(true);
    const res = await fetch(`/api/bible/search?q=${encodeURIComponent(searchQuery)}&scope=${searchScope}`);
    const data = await res.json();
    setSearchResults(data.results || []);
    setLoading(false);
  }, [searchQuery, searchScope]);

  const loadLibrary = useCallback(() => {
    fetch('/api/library/books').then(r => r.json()).then(d => setLibraryPackages(d.packages || [])).catch(() => {});
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────

  const highlightColors = ['#d4a574', '#a8b89e', '#c9a0a0'];

  return (
    <View style={styles.container}>
      {/* ── Header with icons ─────────────────────────────────────────────── */}
      <View style={styles.wordHeader}>
        {view !== 'books' && (
          <Pressable onPress={() => setView(view === 'reading' ? 'chapters' : view === 'chapters' ? 'books' : 'books')} style={styles.headerBtn}>
            <Text style={styles.headerBtnText}>←</Text>
          </Pressable>
        )}
        <View style={styles.translationRow}>
          {(['WEB', 'KJV'] as const).map(t => (
            <Pressable
              key={t}
              onPress={() => handleTranslationChange(t)}
              style={[styles.transBtn, translation === t && styles.transBtnActive]}
            >
              <Text style={[styles.transText, translation === t && styles.transTextActive]}>{t}</Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.headerIcons}>
          <Pressable onPress={() => setView('search')} style={styles.headerBtn}>
            <SearchIcon size={18} color="#8b7355" />
          </Pressable>
          <Pressable onPress={() => { setView('library'); loadLibrary(); }} style={styles.headerBtn}>
            <LibraryIcon size={18} color="#8b7355" />
          </Pressable>
          {view === 'reading' && (
            <Pressable onPress={toggleBookmark} style={styles.headerBtn}>
              <BookmarkFilled size={18} color={isBookmarked ? '#8b7355' : '#9a9388'} />
            </Pressable>
          )}
        </View>
      </View>

      {loading && <LoadingState />}

      {/* ── Search view ────────────────────────────────────────────────────── */}
      {!loading && view === 'search' && (
        <View style={styles.searchView}>
          <TextInput
            style={styles.searchInput}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search Scripture and library…"
            placeholderTextColor="#b8b0a4"
            onSubmitEditing={performSearch}
          />
          <View style={styles.scopeToggle}>
            {(['scripture', 'library'] as const).map(s => (
              <Pressable
                key={s}
                onPress={() => { setSearchScope(s); if (searchQuery) performSearch(); }}
                style={[styles.scopeBtn, searchScope === s && styles.scopeBtnActive]}
              >
                <Text style={[styles.scopeText, searchScope === s && styles.scopeTextActive]}>
                  {s === 'scripture' ? 'Scripture' : 'Library'}
                </Text>
              </Pressable>
            ))}
          </View>
          <ScrollView style={styles.searchResults}>
            {searchResults.map((result, i) => (
              <View key={i} style={styles.passageCard}>
                <Text style={styles.passageQuote}>"{result.text}"</Text>
                <Text style={styles.passageSource}>{result.source}</Text>
              </View>
            ))}
            {searchResults.length === 0 && searchQuery.length > 1 && (
              <Text style={styles.emptyText}>No results found.</Text>
            )}
          </ScrollView>
        </View>
      )}

      {/* ── Library view ───────────────────────────────────────────────────── */}
      {!loading && view === 'library' && (
        <ScrollView style={styles.libraryView}>
          {libraryPackages.map(pkg => (
            <View key={pkg.packageId} style={styles.librarySection}>
              <Text style={styles.sectionLabel}>{pkg.label}</Text>
              {pkg.books.map(book => (
                <Pressable key={book.id} style={styles.bookRow}>
                  <View>
                    <Text style={styles.bookTitle}>{book.title}</Text>
                    <Text style={styles.bookAuthor}>{book.author}{book.era ? ` · ${book.era}` : ''}</Text>
                  </View>
                  <Text style={styles.chevron}>›</Text>
                </Pressable>
              ))}
            </View>
          ))}
        </ScrollView>
      )}

      {/* ── Reading view ──────────────────────────────────────────────────── */}
      {!loading && view === 'reading' && selectedBook && (
        <ScrollView style={styles.readingScroll}>
          <Text style={styles.readingTitle}>{selectedBook.name} {selectedChapter}</Text>
          {verses.map(v => {
            const ref = `${selectedBook.name} ${selectedChapter}:${v.verseStart}`;
            const hl = highlights.find(h => h.verse_ref === ref);
            const xrefs = crossRefs[ref] || [];
            return (
              <View key={v.id} style={styles.verseRow}>
                <Pressable
                  onPress={() => setSelectedVerse(selectedVerse === v.verseStart ? null : v.verseStart)}
                  style={styles.verseContent}
                >
                  <Text style={styles.verseNum}>{v.verseStart}</Text>
                  <Text
                    className="resonance-verse-text"
                    style={[styles.verseText, hl && { backgroundColor: hl.color + '40' }]}
                  >
                    {v.text}
                  </Text>
                </Pressable>
                {xrefs.length > 0 && (
                  <View style={styles.xrefRow}>
                    {xrefs.slice(0, 5).map((xr, i) => (
                      <Text key={i} style={styles.xrefText}>{xr}{i < Math.min(xrefs.length, 5) - 1 ? ' · ' : ''}</Text>
                    ))}
                  </View>
                )}
                {selectedVerse === v.verseStart && (
                  <View style={styles.highlightToolbar}>
                    {highlightColors.map(color => (
                      <Pressable
                        key={color}
                        onPress={() => applyHighlight(v.verseStart, color)}
                        style={[styles.swatch, { backgroundColor: color, borderColor: hl?.color === color ? '#8b7355' : '#e8e5e0', borderWidth: hl?.color === color ? 2 : 1 }]}
                      />
                    ))}
                    {hl && (
                      <Pressable onPress={() => removeHighlight(v.verseStart)} style={styles.removeHighlight}>
                        <Text style={styles.removeHighlightText}>Remove</Text>
                      </Pressable>
                    )}
                  </View>
                )}
              </View>
            );
          })}
          {/* Prev/Next chapter nav */}
          <View style={styles.chapterNav}>
            <Pressable onPress={goPrevChapter} style={styles.chapterNavBtn}>
              <Text style={styles.chapterNavText}>← Previous</Text>
            </Pressable>
            <Pressable onPress={goNextChapter} style={styles.chapterNavBtn}>
              <Text style={styles.chapterNavText}>Next →</Text>
            </Pressable>
          </View>
        </ScrollView>
      )}

      {/* ── Chapter grid ──────────────────────────────────────────────────── */}
      {!loading && view === 'chapters' && selectedBook && (
        <View>
          <Text style={styles.bookTitle}>{selectedBook.name}</Text>
          <View style={styles.chapterGrid} className="">
            {selectedBook.chapters.map(ch => (
              <Pressable
                key={ch}
                onPress={() => handleChapterSelect(ch)}
                style={styles.chapterCell}>
                <Text style={styles.chapterNum}>{ch}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      )}

      {/* ── Book list ──────────────────────────────────────────────────────── */}
      {!loading && view === 'books' && (
        <ScrollView>
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Old Testament</Text>
            {books.filter(b => b.testament === 'OT').map(book => (
              <Pressable
                key={book.id}
                onPress={() => handleBookSelect(book)}
                style={({ pressed }: { pressed: boolean }) => [styles.bookRow, pressed && styles.bookRowPressed]}
              >
                <View>
                  <Text style={styles.bookName}>{book.name}</Text>
                  <Text style={styles.chapterCount}>{book.chapterCount} chapters</Text>
                </View>
                <Text style={styles.chevron}>›</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>New Testament</Text>
            {books.filter(b => b.testament === 'NT').map(book => (
              <Pressable
                key={book.id}
                onPress={() => handleBookSelect(book)}
                style={({ pressed }: { pressed: boolean }) => [styles.bookRow, pressed && styles.bookRowPressed]}
              >
                <View>
                  <Text style={styles.bookName}>{book.name}</Text>
                  <Text style={styles.chapterCount}>{book.chapterCount} chapters</Text>
                </View>
                <Text style={styles.chevron}>›</Text>
              </Pressable>
            ))}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

function LoadingState(): ReactNode {
  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 40 }}>
      <ActivityIndicator size="small" color="#8b7355" />
      <Text style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: 16, color: '#9a9388', fontStyle: 'italic', marginTop: 8 }}>
        Loading…
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, gap: 16 },
  wordHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  headerBtn: { paddingVertical: 6, paddingHorizontal: 8, cursor: 'pointer' },
  headerBtnText: { fontFamily: 'Inter, sans-serif', fontSize: 18, color: '#8b7355' },
  translationRow: { flexDirection: 'row', gap: 8 },
  transBtn: { paddingVertical: 6, paddingHorizontal: 16, borderWidth: 1, borderColor: '#e8e5e0', borderRadius: 999, backgroundColor: '#ffffff', cursor: 'pointer' },
  transBtnActive: { backgroundColor: '#8b7355', borderColor: '#8b7355' },
  transText: { fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: '500', color: '#7a7368' },
  transTextActive: { color: '#ffffff' },
  headerIcons: { flexDirection: 'row', gap: 4 },
  section: { gap: 2, marginBottom: 16 },
  sectionLabel: { fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: '600', letterSpacing: 0.6, textTransform: 'uppercase', color: '#9a9388', paddingBottom: 8, paddingTop: 16 },
  bookRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, paddingHorizontal: 16, backgroundColor: '#ffffff', borderRadius: 6, borderWidth: 1, borderColor: '#e8e5e0', marginBottom: 2, cursor: 'pointer' },
  bookRowPressed: { backgroundColor: '#faf9f6' },
  bookName: { fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: 17, color: '#3a3530' },
  chapterCount: { fontFamily: 'Inter, sans-serif', fontSize: 11, color: '#9a9388' },
  chevron: { fontFamily: 'Inter, sans-serif', fontSize: 20, color: '#9a9388' },
  bookTitle: { fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: 28, fontWeight: '600', color: '#3a3530', paddingBottom: 16 },
  chapterGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chapterCell: { width: 44, height: 44, borderRadius: 6, borderWidth: 1, borderColor: '#e8e5e0', backgroundColor: '#ffffff', justifyContent: 'center', alignItems: 'center', cursor: 'pointer' },
  chapterNum: { fontFamily: 'Inter, sans-serif', fontSize: 15, fontWeight: '500', color: '#3a3530' },
  readingTitle: { fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: 24, fontWeight: '600', color: '#3a3530', paddingBottom: 16 },
  readingScroll: { flex: 1 },
  verseRow: { paddingVertical: 4 },
  verseContent: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  verseNum: { fontFamily: 'Inter, sans-serif', fontSize: 10, color: '#9a9388', marginTop: 4, minWidth: 20, textAlign: 'right' },
  verseText: { fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: 18, lineHeight: 28, color: '#3a3530', flex: 1 },
  xrefRow: { paddingLeft: 28, paddingTop: 2, paddingBottom: 4 },
  xrefText: { fontFamily: 'Inter, sans-serif', fontSize: 11, color: '#b8b0a4' },
  highlightToolbar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 28, paddingVertical: 4 },
  swatch: { width: 22, height: 22, borderRadius: 11, cursor: 'pointer' },
  removeHighlight: { paddingVertical: 4, paddingHorizontal: 8, cursor: 'pointer' },
  removeHighlightText: { fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#9a9388' },
  chapterNav: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 20, gap: 16 },
  chapterNavBtn: { paddingVertical: 10, paddingHorizontal: 16, borderWidth: 1, borderColor: '#e8e5e0', borderRadius: 8, backgroundColor: '#ffffff', cursor: 'pointer' },
  chapterNavText: { fontFamily: 'Inter, sans-serif', fontSize: 14, fontWeight: '500', color: '#8b7355' },
  searchView: { flex: 1, gap: 12 },
  searchInput: { fontFamily: 'Inter, sans-serif', fontSize: 15, borderWidth: 1, borderColor: '#e8e5e0', backgroundColor: '#ffffff', borderRadius: 10, padding: 12, outlineStyle: 'none' },
  scopeToggle: { flexDirection: 'row', gap: 8 },
  scopeBtn: { paddingVertical: 6, paddingHorizontal: 16, borderWidth: 1, borderColor: '#e8e5e0', borderRadius: 999, backgroundColor: '#ffffff', cursor: 'pointer' },
  scopeBtnActive: { backgroundColor: '#8b7355', borderColor: '#8b7355' },
  scopeText: { fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: '500', color: '#7a7368' },
  scopeTextActive: { color: '#ffffff' },
  searchResults: { flex: 1 },
  passageCard: { borderWidth: 1, borderColor: '#e8e5e0', backgroundColor: '#ffffff', borderRadius: 8, padding: 14, marginBottom: 8, gap: 4 },
  passageQuote: { fontFamily: 'Cormorant Garamond, Georgia, serif', fontStyle: 'italic', fontSize: 15, lineHeight: 22, color: '#3a3530' },
  passageSource: { fontFamily: 'Inter, sans-serif', fontSize: 11, color: '#9a9388' },
  emptyText: { fontFamily: 'Cormorant Garamond, Georgia, serif', fontStyle: 'italic', fontSize: 16, color: '#9a9388', textAlign: 'center', paddingVertical: 20 },
  libraryView: { flex: 1 },
  librarySection: { gap: 2, marginBottom: 16 },
  libraryBookTitle: { fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: 16, color: '#3a3530' },
  libraryBookAuthor: { fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#9a9388' },
});
