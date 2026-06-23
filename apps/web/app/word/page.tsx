/**
 * Word page — Scripture browsing and reading surface (web version).
 *
 * Uses the shared @resonance/ui components and @resonance/core bible canon.
 * Mock data layer returns sample passages. When Supabase is wired in,
 * this swaps to real database queries behind the DataLayer interface.
 */

'use client';

import { useState, type ReactNode } from 'react';
import { StyleSheet, Text, View, Pressable, ScrollView, TextInput } from 'react-native-web';
import { BIBLE_BOOKS, scriptureRef, type Translation } from '@resonance/core';
import { PassageCard } from '@resonance/ui';

const SAMPLE_PASSAGES: { book: string; chapter: number; verses: { start: number; text: string }[] }[] = [
  {
    book: 'Genesis',
    chapter: 1,
    verses: [
      { start: 1, text: 'In the beginning, God created the heavens and the earth.' },
      { start: 2, text: 'The earth was formless and empty. Darkness was on the surface of the deep, and God\'s Spirit was hovering over the surface of the waters.' },
      { start: 3, text: 'God said, "Let there be light," and there was light.' },
    ],
  },
  {
    book: 'John',
    chapter: 1,
    verses: [
      { start: 1, text: 'In the beginning was the Word, and the Word was with God, and the Word was God.' },
      { start: 2, text: 'The same was in the beginning with God.' },
      { start: 3, text: 'All things were made through him. Without him, nothing was made that has been made.' },
    ],
  },
];

export default function WordPage(): ReactNode {
  const [selectedBook, setSelectedBook] = useState<string | null>(null);
  const [selectedChapter, setSelectedChapter] = useState<number | null>(null);
  const [translation, setTranslation] = useState<Translation>('WEB');

  // ── Reading view ─────────────────────────────────────────────────────
  if (selectedBook && selectedChapter) {
    const passageData = SAMPLE_PASSAGES.find(
      (p) => p.book === selectedBook && p.chapter === selectedChapter
    ) ?? SAMPLE_PASSAGES[0];

    return (
      <View style={styles.container}>
        <Pressable onPress={() => setSelectedChapter(null)} style={styles.backLink}>
          <Text style={styles.backText}>← Chapters</Text>
        </Pressable>
        <Text style={styles.readingTitle}>{selectedBook} {selectedChapter}</Text>
        <ScrollView style={styles.readingScroll}>
          {passageData.verses.map((v) => (
            <View key={v.start} style={styles.verseRow}>
              <Text style={styles.verseNum}>{v.start}</Text>
              <Text style={styles.verseText}>{v.text}</Text>
            </View>
          ))}
        </ScrollView>
      </View>
    );
  }

  // ── Chapter grid ────────────────────────────────────────────────────
  if (selectedBook) {
    return (
      <View style={styles.container}>
        <Pressable onPress={() => setSelectedBook(null)} style={styles.backLink}>
          <Text style={styles.backText}>← Books</Text>
        </Pressable>
        <Text style={styles.bookTitle}>{selectedBook}</Text>
        <View style={styles.chapterGrid}>
          {Array.from({ length: 50 }, (_, i) => i + 1).map((ch) => (
            <Pressable
              key={ch}
              onPress={() => setSelectedChapter(ch)}
              style={styles.chapterCell}
            >
              <Text style={styles.chapterNum}>{ch}</Text>
            </Pressable>
          ))}
        </View>
      </View>
    );
  }

  // ── Book list ────────────────────────────────────────────────────────
  const otBooks = BIBLE_BOOKS.filter((b) => b.testament === 'OT');
  const ntBooks = BIBLE_BOOKS.filter((b) => b.testament === 'NT');

  return (
    <View style={styles.container}>
      {/* Translation selector */}
      <View style={styles.translationRow}>
        {(['WEB', 'KJV'] as const).map((t) => (
          <Pressable
            key={t}
            onPress={() => setTranslation(t)}
            style={[styles.transBtn, translation === t && styles.transBtnActive]}
          >
            <Text style={[styles.transText, translation === t && styles.transTextActive]}>{t}</Text>
          </Pressable>
        ))}
      </View>

      {/* Old Testament */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Old Testament</Text>
        {otBooks.map((book) => (
          <Pressable
            key={book.name}
            onPress={() => setSelectedBook(book.name)}
            style={({ pressed }: { pressed: boolean }) => [styles.bookRow, pressed && styles.bookRowPressed]}
          >
            <Text style={styles.bookName}>{book.name}</Text>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        ))}
      </View>

      {/* New Testament */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>New Testament</Text>
        {ntBooks.map((book) => (
          <Pressable
            key={book.name}
            onPress={() => setSelectedBook(book.name)}
            style={({ pressed }: { pressed: boolean }) => [styles.bookRow, pressed && styles.bookRowPressed]}
          >
            <Text style={styles.bookName}>{book.name}</Text>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    gap: 16,
  },
  translationRow: {
    flexDirection: 'row',
    gap: 8,
  },
  transBtn: {
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: '#e8e5e0',
    borderRadius: 999,
    backgroundColor: '#ffffff',
  },
  transBtnActive: {
    backgroundColor: '#8b7355',
    borderColor: '#8b7355',
  },
  transText: {
    fontFamily: 'Inter, sans-serif',
    fontSize: 13,
    fontWeight: '500',
    color: '#7a7368',
  },
  transTextActive: {
    color: '#ffffff',
  },
  section: {
    gap: 2,
  },
  sectionLabel: {
    fontFamily: 'Inter, sans-serif',
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: '#9a9388',
    paddingBottom: 8,
    paddingTop: 16,
  },
  bookRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: '#ffffff',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#e8e5e0',
    marginBottom: 2,
  },
  bookRowPressed: {
    backgroundColor: '#faf9f6',
  },
  bookName: {
    fontFamily: 'Georgia, serif',
    fontSize: 17,
    color: '#3a3530',
  },
  chevron: {
    fontFamily: 'Inter, sans-serif',
    fontSize: 20,
    color: '#9a9388',
  },
  backLink: {
    paddingVertical: 8,
  },
  backText: {
    fontFamily: 'Inter, sans-serif',
    fontSize: 14,
    fontWeight: '500',
    color: '#8b7355',
  },
  bookTitle: {
    fontFamily: 'Georgia, serif',
    fontSize: 28,
    fontWeight: '600',
    color: '#3a3530',
    paddingBottom: 16,
  },
  chapterGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chapterCell: {
    width: 44,
    height: 44,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#e8e5e0',
    backgroundColor: '#ffffff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  chapterNum: {
    fontFamily: 'Inter, sans-serif',
    fontSize: 15,
    fontWeight: '500',
    color: '#3a3530',
  },
  readingTitle: {
    fontFamily: 'Georgia, serif',
    fontSize: 22,
    fontWeight: '600',
    color: '#3a3530',
    paddingBottom: 16,
  },
  readingScroll: {
    flex: 1,
  },
  verseRow: {
    flexDirection: 'row',
    paddingVertical: 4,
    gap: 8,
  },
  verseNum: {
    fontFamily: 'Inter, sans-serif',
    fontSize: 10,
    color: '#9a9388',
    marginTop: 4,
    minWidth: 20,
    textAlign: 'right',
  },
  verseText: {
    fontFamily: 'Georgia, serif',
    fontSize: 18,
    lineHeight: 28,
    color: '#3a3530',
    flex: 1,
  },
});
