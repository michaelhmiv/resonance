/**
 * Patterns page — calendar, weekly roundup, recurring themes, and
 * a gentle reflection question (web version).
 *
 * All data access goes through the DataLayer contract.
 */

'use client';

import { useState, useEffect, useCallback, useMemo, type ReactNode } from 'react';
import { StyleSheet, Text, View, Pressable, ScrollView, ActivityIndicator } from 'react-native-web';
import { DataLayerProvider, useDataLayer } from '@resonance/core/data-layer-context';
import type { JournalSegment, EntryCluster, WeeklyRoundup, CalendarDay } from '@resonance/core';
import { WebDataLayer } from '../../lib/client-data-layer';

interface ThemeItem {
  word: string;
  score: number;
}

function PatternsInner(): ReactNode {
  const dataLayer = useDataLayer();
  const [segments, setSegments] = useState<JournalSegment[]>([]);
  const [weekly, setWeekly] = useState<WeeklyRoundup | null>(null);
  const [themes, setThemes] = useState<ThemeItem[]>([]);
  const [calendarDays, setCalendarDays] = useState<CalendarDay[]>([]);
  const [readingDates, setReadingDates] = useState<Map<string, number>>(new Map());
  const [reflection, setReflection] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reflecting, setReflecting] = useState(false);
  const [currentMonth, setCurrentMonth] = useState(new Date());

  const loadPatterns = useCallback(async (segs: JournalSegment[], month: Date) => {
    const year = month.getFullYear();
    const monthIdx = month.getMonth();
    const weekStart = new Date().toISOString().slice(0, 10);

    const [weeklyData, calendarDaysData, clusters, readingHistory] = await Promise.all([
      dataLayer.generateWeeklyRoundup(segs, weekStart).catch(() => null),
      dataLayer.getCalendarDays(segs, year, monthIdx),
      Promise.resolve().then(() => clusterFromEntries(segs)),
      dataLayer.getReadingHistory(
        `${year}-${String(monthIdx + 1).padStart(2, '0')}-01`,
        `${year}-${String(monthIdx + 1).padStart(2, '0')}-31`
      ).catch(() => []),
    ]);

    setWeekly(weeklyData);
    setCalendarDays(calendarDaysData);
    setThemes(clusters);
    const rdMap = new Map<string, number>();
    for (const rd of readingHistory) rdMap.set(rd.date, rd.count);
    setReadingDates(rdMap);
  }, [dataLayer]);

  useEffect(() => {
    dataLayer.loadSegments().then((segs) => {
      setSegments(segs);
      return loadPatterns(segs, currentMonth);
    }).then(() => setLoading(false));
  }, [dataLayer, loadPatterns, currentMonth]);

  useEffect(() => {
    if (segments.length > 0) {
      loadPatterns(segments, currentMonth);
    }
  }, [currentMonth]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleReflect = useCallback(async () => {
    if (segments.length === 0) return;
    setReflecting(true);
    setReflection(null);
    try {
      const excerpts = segments.filter(s => s.text).slice(0, 5).map(s => s.text!);
      const result = await dataLayer.generateReflectionPrompt(excerpts);
      if (result?.prompt) setReflection(result.prompt);
    } catch { /* best-effort */ } finally {
      setReflecting(false);
    }
  }, [segments, dataLayer]);

  if (loading) return <LoadingState />;

  const hasEntries = segments.length > 0;

  // Build entry date map from calendarDays
  const entryDates = new Map<string, number>();
  if (calendarDays.length > 0) {
    for (const cd of calendarDays) {
      if (cd.hasEntries) entryDates.set(cd.date, cd.entryCount);
    }
  } else {
    // Fallback: build from segments
    for (const s of segments) {
      if (s.parent_date && s.segment_type === 'text' && s.text) {
        entryDates.set(s.parent_date, (entryDates.get(s.parent_date) || 0) + 1);
      }
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {!hasEntries && (
        <>
          <Text style={styles.emptyText}>Patterns will appear as you write.</Text>
          <Text style={styles.hint}>
            Recurring themes, weekly roundups, and gentle reflections will surface here
            once your journal has entries.
          </Text>
        </>
      )}

      {/* ── Calendar ──────────────────────────────────────────────── */}
      <CalendarGrid
        currentMonth={currentMonth}
        onPrev={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1))}
        onNext={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1))}
        entryDates={entryDates}
        readingDates={readingDates}
      />

      {/* ── This Week ────────────────────────────────────────────── */}
      <Text style={styles.sectionLabel}>This Week</Text>
      <View style={styles.card}>
        {weekly && weekly.entryCount > 0 ? (
          <>
            {weekly.themes.length > 0 && <Text style={styles.themeTag}>{weekly.themes[0]}</Text>}
            <Text style={styles.cardText}>{weekly.entryCount} {weekly.entryCount === 1 ? 'entry' : 'entries'} this week.</Text>
            {weekly.excerpt ? (
              <Text style={styles.excerpt} numberOfLines={2}>{weekly.excerpt}</Text>
            ) : null}
          </>
        ) : (
          <Text style={styles.mutedText}>No entries yet this week.</Text>
        )}
      </View>

      {/* ── Recurring Themes ──────────────────────────────────────── */}
      <Text style={styles.sectionLabel}>Recurring Themes</Text>
      <View style={styles.card}>
        {themes.length > 0 ? (
          <View style={styles.themeRow}>
            {themes.map((t, i) => (
              <View key={i} style={[styles.themePill, { opacity: 0.4 + (t.score * 0.6) }]}>
                <Text style={styles.themePillText}>{t.word}</Text>
              </View>
            ))}
          </View>
        ) : (
          <Text style={styles.mutedText}>Themes will cluster here as your journal grows.</Text>
        )}
      </View>

      {/* ── A Quiet Question ──────────────────────────────────────── */}
      <Text style={styles.sectionLabel}>A Quiet Question</Text>
      <View style={styles.card}>
        {reflection ? (
          <Text style={styles.reflectionText}>{reflection}</Text>
        ) : hasEntries ? (
          <Pressable onPress={handleReflect} disabled={reflecting} style={styles.reflectBtn}>
            {reflecting ? (
              <ActivityIndicator size="small" color="#8b7355" />
            ) : (
              <Text style={styles.reflectBtnText}>What are you noticing these days?</Text>
            )}
          </Pressable>
        ) : (
          <Text style={styles.reflectionText}>What are you noticing these days?</Text>
        )}
      </View>
    </ScrollView>
  );
}

export default function PatternsPage(): ReactNode {
  const dataLayer = useMemo(() => new WebDataLayer(), []);
  return (
    <DataLayerProvider layer={dataLayer}>
      <PatternsInner />
    </DataLayerProvider>
  );
}

// ── Local TF-IDF clustering ─────────────────────────────────────────────

function clusterFromEntries(segments: JournalSegment[]): ThemeItem[] {
  const textSegs = segments.filter(s => s.segment_type === 'text' && s.text);
  if (textSegs.length === 0) return [];

  const stopWords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by',
    'is', 'was', 'are', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does',
    'this', 'that', 'these', 'those', 'i', 'me', 'my', 'we', 'us', 'our', 'you', 'your',
    'it', 'its', 'they', 'them', 'their', 'what', 'which', 'who', 'when', 'where', 'why',
    'not', 'no', 'just', 'very', 'really', 'so', 'than', 'too', 'also', 'only', 'about',
    'feel', 'feeling', 'felt', 'am', 'all',
  ]);

  const documents = textSegs.map(s => s.text!.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 2 && !stopWords.has(w)));
  const docFreq = new Map<string, number>();
  const tf = new Map<string, number>();
  for (const doc of documents) {
    const seen = new Set(doc);
    for (const word of seen) docFreq.set(word, (docFreq.get(word) || 0) + 1);
    for (const word of doc) tf.set(word, (tf.get(word) || 0) + 1);
  }
  const N = documents.length;
  const scored: ThemeItem[] = [];
  for (const [word, freq] of tf) {
    const df = docFreq.get(word) || 1;
    const idf = Math.log(N / df) + 1;
    const rawScore = freq * idf;
    scored.push({ word, score: Math.min(1, rawScore / (Math.max(...scored.map(t => t.score || rawScore), rawScore))) });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 8);
}

// ── Calendar Component ─────────────────────────────────────────────────

function CalendarGrid({
  currentMonth,
  onPrev,
  onNext,
  entryDates,
  readingDates,
}: {
  currentMonth: Date;
  onPrev: () => void;
  onNext: () => void;
  entryDates: Map<string, number>;
  readingDates: Map<string, number>;
}): ReactNode {
  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const monthName = currentMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const today = new Date();
  const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month;

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const weekdays = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  return (
    <View style={styles.calendar}>
      <View style={styles.calHeader}>
        <Pressable onPress={onPrev} style={styles.calNavBtn}><Text style={styles.calNavText}>‹</Text></Pressable>
        <Text style={styles.calMonthLabel}>{monthName}</Text>
        <Pressable onPress={onNext} style={styles.calNavBtn}><Text style={styles.calNavText}>›</Text></Pressable>
      </View>
      <View style={styles.calWeekdays}>
        {weekdays.map((d, i) => (
          <Text key={i} style={styles.calWeekdayText}>{d}</Text>
        ))}
      </View>
      <View style={styles.calGrid}>
        {cells.map((day, i) => {
          if (day === null) return <View key={i} style={styles.calCell} />;
          const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          const count = entryDates.get(key) || 0;
          const readCount = readingDates.get(key) || 0;
          const isToday = isCurrentMonth && day === today.getDate();
          return (
            <View key={i} style={styles.calCell}>
              <View style={[styles.calDay, isToday && styles.calDayToday]}>
                <Text style={[styles.calDayNum, count > 0 && styles.calDayHasEntries]}>{day}</Text>
                <View style={styles.dotRow}>
                  {count > 0 && <View style={[styles.calDot, count >= 3 && styles.calDotLarge]} />}
                  {readCount > 0 && <View style={[styles.calReadingDot, readCount >= 3 && styles.calDotLarge]} />}
                </View>
              </View>
            </View>
          );
        })}
      </View>
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
  container: { flex: 1 },
  content: { gap: 16, paddingBottom: 40 },
  emptyText: { fontFamily: 'Cormorant Garamond, Georgia, serif', fontStyle: 'italic', fontSize: 17, color: '#b8b0a4', textAlign: 'center' },
  hint: { fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#9a9388', textAlign: 'center', lineHeight: 20 },
  calendar: { paddingVertical: 8 },
  calHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 12 },
  calNavBtn: { paddingVertical: 4, paddingHorizontal: 12, cursor: 'pointer' },
  calNavText: { fontFamily: 'Inter, sans-serif', fontSize: 22, color: '#8b7355' },
  calMonthLabel: { fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: 18, fontWeight: '600', color: '#3a3530' },
  calWeekdays: { flexDirection: 'row', marginBottom: 4 },
  calWeekdayText: { flex: 1, textAlign: 'center', fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: '600', color: '#9a9388' },
  calGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  calCell: { width: '14.28%', aspectRatio: 1, justifyContent: 'center', alignItems: 'center', padding: 2 },
  calDay: { width: 32, height: 32, borderRadius: 16, justifyContent: 'center', alignItems: 'center' },
  calDayToday: { borderWidth: 1.5, borderColor: '#8b7355' },
  calDayNum: { fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#7a7368' },
  calDayHasEntries: { fontWeight: '600', color: '#3a3530' },
  calDot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: '#8b7355', position: 'absolute', bottom: 4 },
  calDotLarge: { width: 7, height: 7, borderRadius: 3.5 },
  calReadingDot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: '#6b9e6b', position: 'absolute', bottom: 4 },
  dotRow: { flexDirection: 'row', gap: 3, position: 'absolute', bottom: 2 },
  sectionLabel: { fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: '600', letterSpacing: 0.6, textTransform: 'uppercase', color: '#9a9388' },
  card: { borderWidth: 1, borderColor: '#e8e5e0', backgroundColor: '#ffffff', borderRadius: 10, padding: 16, gap: 8 },
  cardText: { fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: 15, lineHeight: 22, color: '#3a3530' },
  mutedText: { fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: 15, lineHeight: 22, color: '#9a9388' },
  excerpt: { fontFamily: 'Cormorant Garamond, Georgia, serif', fontStyle: 'italic', fontSize: 14, lineHeight: 20, color: '#7a7368' },
  themeTag: { fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: '600', color: '#c9a25a', letterSpacing: 0.3 },
  themeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  themePill: { paddingVertical: 4, paddingHorizontal: 12, borderWidth: 1, borderColor: '#e8e5e0', borderRadius: 999, backgroundColor: '#faf9f6' },
  themePillText: { fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#3a3530' },
  reflectionText: { fontFamily: 'Cormorant Garamond, Georgia, serif', fontStyle: 'italic', fontSize: 17, lineHeight: 26, color: '#3a3530' },
  reflectBtn: { cursor: 'pointer' },
  reflectBtnText: { fontFamily: 'Cormorant Garamond, Georgia, serif', fontStyle: 'italic', fontSize: 17, lineHeight: 26, color: '#8b7355' },
});
