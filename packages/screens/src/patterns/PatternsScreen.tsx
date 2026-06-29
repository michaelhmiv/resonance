/**
 * Patterns screen — evidence-backed reflection on recurring activity.
 *
 * The backend owns pattern construction. This screen renders the summary:
 * activity dots by day, day detail evidence, returned-to signals, echoes,
 * theme snapshots, trails, and a quiet question.
 */

import { useState, useEffect, useCallback, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useDataLayer } from '@resonance/core/data-layer-context';
import { type JournalSegment, getCachedSync } from '@resonance/core';

type ActivityType = 'journal' | 'reading' | 'highlight' | 'note' | 'bookmark' | 'echo';
type ActivityCounts = Record<ActivityType, number>;

interface PatternEvidence {
  type: ActivityType | 'theme' | 'edge';
  id?: string;
  date?: string;
  title?: string;
  ref?: string | null;
  excerpt?: string | null;
}

interface PatternDaySummary {
  date: string;
  counts: ActivityCounts;
  dotTypes: ActivityType[];
}

interface PatternTheme {
  id: string;
  label: string;
  summary: string;
  confidence: number;
  evidenceCount: number;
  dateRange: { start: string; end: string };
  evidence: PatternEvidence[];
}

interface PatternEcho {
  id: string;
  title: string;
  sourceLabel: string;
  targetLabel: string;
  reason: string;
  confidence: number;
  lastSeenAt: string | null;
  evidence: PatternEvidence[];
}

interface ReturnedSignal {
  id: string;
  label: string;
  count: number;
  activityTypes: ActivityType[];
  lastSeenAt: string | null;
  evidence: PatternEvidence[];
}

interface PatternTrail {
  id: string;
  label: string;
  summary: string;
  evidence: PatternEvidence[];
}

interface PatternsSummary {
  window: { start: string; end: string };
  recently: string;
  days: PatternDaySummary[];
  themes: PatternTheme[];
  echoes: PatternEcho[];
  returnedTo: ReturnedSignal[];
  trails: PatternTrail[];
  quietQuestion: string;
  health: {
    journalEntryCount: number;
    readingEventCount: number;
    highlightCount: number;
    noteCount: number;
    bookmarkCount: number;
    echoCount: number;
  };
}

interface PatternDayDetail {
  date: string;
  counts: ActivityCounts;
  journal: Array<{ id: string; excerpt: string; createdAt: string | null }>;
  reading: Array<{ id: string; label: string; ref: string | null; createdAt: string | null }>;
  highlights: Array<{ id: string; verseRef: string | null; selectedText: string | null; color: string | null; createdAt: string | null }>;
  notes: Array<{ id: string; verseRef: string | null; noteExcerpt: string; updatedAt: string | null }>;
  bookmarks: Array<{ id: string; verseRef: string | null; label: string | null; createdAt: string | null }>;
  echoes: PatternEcho[];
}

interface ThemeItem {
  word: string;
  score: number;
}

const ACTIVITY_LABELS: Record<ActivityType, string> = {
  journal: 'Journal',
  reading: 'Reading',
  highlight: 'Highlight',
  note: 'Note',
  bookmark: 'Bookmark',
  echo: 'Echo',
};

const ACTIVITY_COLORS: Record<ActivityType, string> = {
  journal: '#8b7355',
  reading: '#6b9e6b',
  highlight: '#c9a25a',
  note: '#7d79a8',
  bookmark: '#b86f52',
  echo: '#6f8fb8',
};

export function PatternsScreen(): ReactNode {
  const dataLayer = useDataLayer();
  const [segments, setSegments] = useState<JournalSegment[]>(() => {
    const cached = getCachedSync<{ entries: JournalSegment[] }>('/api/journal/entries');
    return cached?.entries ?? [];
  });
  const [summary, setSummary] = useState<PatternsSummary | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [dayDetail, setDayDetail] = useState<PatternDayDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingDay, setLoadingDay] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reflection, setReflection] = useState<string | null>(null);
  const [reflecting, setReflecting] = useState(false);
  const [currentMonth, setCurrentMonth] = useState(new Date());

  const loadSummary = useCallback(async () => {
    const { start, end } = monthWindow(currentMonth);
    setLoading(true);
    setError(null);
    setSelectedDate(null);
    setDayDetail(null);

    try {
      const res = await fetch(`/api/patterns/summary?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`);
      if (!res.ok) throw new Error(`Patterns API ${res.status}`);
      const next = await res.json() as PatternsSummary;
      setSummary(next);
      void dataLayer.loadSegments().then(setSegments).catch(() => null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Patterns unavailable';
      setError(message);
      const fallback = await buildFallbackSummary(dataLayer, currentMonth).catch(() => null);
      if (fallback) setSummary(fallback);
    } finally {
      setLoading(false);
    }
  }, [currentMonth, dataLayer]);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  const handleSelectDay = useCallback(async (day: PatternDaySummary) => {
    setSelectedDate(day.date);
    setDayDetail(null);
    setLoadingDay(true);
    try {
      const res = await fetch(`/api/patterns/day?date=${encodeURIComponent(day.date)}`);
      if (!res.ok) throw new Error(`Day API ${res.status}`);
      const detail = await res.json() as PatternDayDetail;
      setDayDetail(detail);
    } catch {
      setDayDetail({ date: day.date, counts: day.counts, journal: [], reading: [], highlights: [], notes: [], bookmarks: [], echoes: [] });
    } finally {
      setLoadingDay(false);
    }
  }, []);

  const handleReflect = useCallback(async () => {
    setReflecting(true);
    setReflection(null);
    try {
      if (segments.length > 0) {
        const excerpts = segments.filter(s => s.text).slice(0, 5).map(s => s.text!);
        const result = await dataLayer.generateReflectionPrompt(excerpts);
        if (result?.prompt) {
          setReflection(result.prompt);
          return;
        }
      }
      setReflection(summary?.quietQuestion ?? 'What are you noticing these days?');
    } catch {
      setReflection(summary?.quietQuestion ?? 'What are you noticing these days?');
    } finally {
      setReflecting(false);
    }
  }, [segments, dataLayer, summary]);

  if (loading && !summary) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="small" color="#8b7355" />
      </View>
    );
  }

  const hasActivity = summary ? totalHealth(summary) > 0 : false;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {error ? (
        <View style={styles.noticeCard}>
          <Text style={styles.noticeTitle}>Patterns are using local fallback.</Text>
          <Text style={styles.noticeText}>{error}</Text>
        </View>
      ) : null}

      <Text style={styles.screenTitle}>Patterns</Text>
      <View style={styles.card}>
        <Text style={styles.cardText}>{summary?.recently ?? 'Patterns need a few traces: journal entries, readings, highlights, or notes.'}</Text>
        {summary ? <HealthLine summary={summary} /> : null}
      </View>

      {!hasActivity ? (
        <View style={styles.card}>
          <Text style={styles.emptyText}>Patterns will appear as you leave traces.</Text>
          <Text style={styles.hint}>Write a few entries, read, highlight, or add a note. This tab will stay evidence-based and show why each pattern appeared.</Text>
        </View>
      ) : null}

      <View style={styles.sectionHeaderRow}>
        <Text style={styles.sectionLabel}>Activity Calendar</Text>
        <Legend />
      </View>
      <View style={styles.card}>
        <CalendarGrid
          currentMonth={currentMonth}
          onPrev={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1))}
          onNext={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1))}
          days={summary?.days ?? []}
          selectedDate={selectedDate}
          onSelectDay={handleSelectDay}
        />
      </View>

      {selectedDate ? (
        <DayDetailCard detail={dayDetail} date={selectedDate} loading={loadingDay} />
      ) : null}

      <Text style={styles.sectionLabel}>Echoes Worth Revisiting</Text>
      <View style={styles.card}>
        {summary?.echoes.length ? summary.echoes.slice(0, 4).map((echo) => (
          <EvidenceCard key={echo.id} title={echo.title} subtitle={echo.reason} evidence={echo.evidence} />
        )) : <Text style={styles.mutedText}>Echoes will appear when entries, notes, highlights, and passages begin sitting near each other.</Text>}
      </View>

      <Text style={styles.sectionLabel}>Returned To</Text>
      <View style={styles.card}>
        {summary?.returnedTo.length ? summary.returnedTo.slice(0, 5).map((signal) => (
          <EvidenceCard
            key={signal.id}
            title={signal.label}
            subtitle={`${signal.count} traces across ${signal.activityTypes.map(t => ACTIVITY_LABELS[t]).join(', ')}`}
            evidence={signal.evidence}
          />
        )) : <Text style={styles.mutedText}>Repeated passages and themes will show here after multiple traces.</Text>}
      </View>

      <Text style={styles.sectionLabel}>Recurring Themes</Text>
      <View style={styles.card}>
        {summary?.themes.length ? summary.themes.slice(0, 5).map((theme) => (
          <EvidenceCard
            key={theme.id}
            title={theme.label}
            subtitle={`${theme.evidenceCount} pieces of evidence · ${theme.dateRange.start} to ${theme.dateRange.end}`}
            body={theme.summary}
            evidence={theme.evidence}
          />
        )) : <Text style={styles.mutedText}>Themes will cluster here with evidence, not as permanent labels.</Text>}
      </View>

      <Text style={styles.sectionLabel}>Trails</Text>
      <View style={styles.card}>
        {summary?.trails.length ? summary.trails.slice(0, 4).map((trail) => (
          <EvidenceCard key={trail.id} title={trail.label} subtitle={trail.summary} evidence={trail.evidence} />
        )) : <Text style={styles.mutedText}>Trails appear when a thread connects across several days or activity types.</Text>}
      </View>

      <Text style={styles.sectionLabel}>A Quiet Question</Text>
      <View style={styles.card}>
        {reflection ? (
          <Text style={styles.reflectionText}>{reflection}</Text>
        ) : (
          <Pressable onPress={handleReflect} disabled={reflecting}>
            {reflecting ? <ActivityIndicator size="small" color="#8b7355" /> : <Text style={styles.reflectBtnText}>{summary?.quietQuestion ?? 'What are you noticing these days?'}</Text>}
          </Pressable>
        )}
      </View>
    </ScrollView>
  );
}

function HealthLine({ summary }: { summary: PatternsSummary }): ReactNode {
  const parts = [
    summary.health.journalEntryCount ? `${summary.health.journalEntryCount} journal` : null,
    summary.health.readingEventCount ? `${summary.health.readingEventCount} reading` : null,
    summary.health.highlightCount ? `${summary.health.highlightCount} highlight` : null,
    summary.health.noteCount ? `${summary.health.noteCount} note` : null,
    summary.health.bookmarkCount ? `${summary.health.bookmarkCount} bookmark` : null,
    summary.health.echoCount ? `${summary.health.echoCount} echo` : null,
  ].filter(Boolean);
  if (parts.length === 0) return <Text style={styles.hint}>No activity in this window yet.</Text>;
  return <Text style={styles.hint}>{parts.join(' · ')}</Text>;
}

function Legend(): ReactNode {
  return (
    <View style={styles.legendRow}>
      {(['journal', 'reading', 'highlight', 'note', 'echo'] as ActivityType[]).map((type) => (
        <View key={type} style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: ACTIVITY_COLORS[type] }]} />
          <Text style={styles.legendText}>{ACTIVITY_LABELS[type]}</Text>
        </View>
      ))}
    </View>
  );
}

function DayDetailCard({ detail, date, loading }: { detail: PatternDayDetail | null; date: string; loading: boolean }): ReactNode {
  return (
    <View style={styles.card}>
      <Text style={styles.detailTitle}>{date}</Text>
      {loading ? <ActivityIndicator size="small" color="#8b7355" /> : null}
      {detail ? (
        <>
          <CountLine counts={detail.counts} />
          <DetailSection title="Journal" rows={detail.journal.map((j) => j.excerpt)} />
          <DetailSection title="Reading" rows={detail.reading.map((r) => r.label)} />
          <DetailSection title="Highlights" rows={detail.highlights.map((h) => [h.verseRef, h.selectedText].filter(Boolean).join(' — '))} />
          <DetailSection title="Notes" rows={detail.notes.map((n) => [n.verseRef, n.noteExcerpt].filter(Boolean).join(' — '))} />
          <DetailSection title="Bookmarks" rows={detail.bookmarks.map((b) => [b.verseRef, b.label].filter(Boolean).join(' — '))} />
          <DetailSection title="Echoes" rows={detail.echoes.map((e) => e.title)} />
        </>
      ) : null}
    </View>
  );
}

function CountLine({ counts }: { counts: ActivityCounts }): ReactNode {
  const parts = (Object.keys(counts) as ActivityType[]).filter((type) => counts[type] > 0).map((type) => `${counts[type]} ${ACTIVITY_LABELS[type]}`);
  return <Text style={styles.hint}>{parts.length ? parts.join(' · ') : 'No activity found for this day.'}</Text>;
}

function DetailSection({ title, rows }: { title: string; rows: string[] }): ReactNode {
  const filtered = rows.filter((row) => row && row.trim().length > 0);
  if (filtered.length === 0) return null;
  return (
    <View style={styles.detailSection}>
      <Text style={styles.detailSectionTitle}>{title}</Text>
      {filtered.slice(0, 5).map((row, index) => <Text key={index} style={styles.detailRow}>• {row}</Text>)}
    </View>
  );
}

function EvidenceCard({ title, subtitle, body, evidence }: { title: string; subtitle?: string; body?: string; evidence?: PatternEvidence[] }): ReactNode {
  return (
    <View style={styles.evidenceCard}>
      <Text style={styles.evidenceTitle}>{title}</Text>
      {subtitle ? <Text style={styles.evidenceSubtitle}>{subtitle}</Text> : null}
      {body ? <Text style={styles.cardText}>{body}</Text> : null}
      {evidence?.length ? (
        <View style={styles.evidenceList}>
          {evidence.slice(0, 3).map((item, index) => (
            <Text key={index} style={styles.evidenceText} numberOfLines={2}>
              {item.date ? `${item.date} · ` : ''}{item.ref ? `${item.ref} · ` : ''}{item.excerpt || item.title || 'Evidence'}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function CalendarGrid({
  currentMonth, onPrev, onNext, days, selectedDate, onSelectDay,
}: {
  currentMonth: Date;
  onPrev: () => void;
  onNext: () => void;
  days: PatternDaySummary[];
  selectedDate: string | null;
  onSelectDay: (day: PatternDaySummary) => void;
}): ReactNode {
  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const monthName = currentMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const today = new Date();
  const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month;
  const byDate = new Map(days.map((day) => [day.date, day]));

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const weekdays = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  return (
    <View style={calStyles.calendar}>
      <View style={calStyles.header}>
        <Pressable onPress={onPrev} style={calStyles.navBtn}><Text style={calStyles.navText}>‹</Text></Pressable>
        <Text style={calStyles.monthLabel}>{monthName}</Text>
        <Pressable onPress={onNext} style={calStyles.navBtn}><Text style={calStyles.navText}>›</Text></Pressable>
      </View>
      <View style={calStyles.weekdays}>
        {weekdays.map((d, i) => <Text key={i} style={calStyles.weekdayText}>{d}</Text>)}
      </View>
      <View style={calStyles.grid}>
        {cells.map((day, i) => {
          if (day === null) return <View key={i} style={calStyles.cell} />;
          const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          const summary = byDate.get(key) ?? { date: key, counts: emptyCounts(), dotTypes: [] };
          const isToday = isCurrentMonth && day === today.getDate();
          const isSelected = selectedDate === key;
          const hasActivity = summary.dotTypes.length > 0;
          return (
            <Pressable key={i} style={calStyles.cell} onPress={() => onSelectDay(summary)}>
              <View style={[calStyles.day, isToday && calStyles.dayToday, isSelected && calStyles.daySelected]}>
                <Text style={[calStyles.dayNum, hasActivity && calStyles.dayHasEntries]}>{day}</Text>
                <View style={calStyles.dotRow}>
                  {summary.dotTypes.slice(0, 3).map((type) => <View key={type} style={[calStyles.dot, { backgroundColor: ACTIVITY_COLORS[type] }]} />)}
                  {summary.dotTypes.length > 3 ? <Text style={calStyles.moreText}>+</Text> : null}
                </View>
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

async function buildFallbackSummary(dataLayer: ReturnType<typeof useDataLayer>, month: Date): Promise<PatternsSummary> {
  const { start, end } = monthWindow(month);
  const year = month.getFullYear();
  const monthIdx = month.getMonth();
  const segs = await dataLayer.loadSegments();
  const [calendarDays, readingHistory] = await Promise.allSettled([
    dataLayer.getCalendarDays(segs, year, monthIdx),
    dataLayer.getReadingHistory(start, end),
  ]);
  const days = eachDate(start, end).map((date): PatternDaySummary => ({ date, counts: emptyCounts(), dotTypes: [] }));
  const byDate = new Map(days.map((day) => [day.date, day]));

  if (calendarDays.status === 'fulfilled') {
    for (const cd of calendarDays.value) {
      const day = byDate.get(cd.date);
      if (day && cd.entryCount > 0) {
        day.counts.journal = cd.entryCount;
        day.dotTypes.push('journal');
      }
    }
  }
  if (readingHistory.status === 'fulfilled') {
    for (const rd of readingHistory.value) {
      const day = byDate.get(rd.date);
      if (day && rd.count > 0) {
        day.counts.reading = rd.count;
        if (!day.dotTypes.includes('reading')) day.dotTypes.push('reading');
      }
    }
  }
  const themes = localCluster(segs).map((item, index): PatternTheme => ({
    id: `local-${index}-${item.word}`,
    label: item.word,
    summary: `Several entries touched on ${item.word}.`,
    confidence: item.score,
    evidenceCount: 0,
    dateRange: { start, end },
    evidence: [],
  }));
  setTimeout(() => null, 0);
  return {
    window: { start, end },
    recently: themes.length ? `Recently, several entries gathered around ${themes.slice(0, 3).map(t => t.label).join(', ')}.` : 'Patterns need a few traces: journal entries, readings, highlights, or notes.',
    days: Array.from(byDate.values()),
    themes,
    echoes: [],
    returnedTo: [],
    trails: [],
    quietQuestion: 'What are you noticing these days?',
    health: { journalEntryCount: segs.filter(s => s.segment_type === 'text' && s.text).length, readingEventCount: 0, highlightCount: 0, noteCount: 0, bookmarkCount: 0, echoCount: 0 },
  };
}

function monthWindow(month: Date): { start: string; end: string } {
  const year = month.getFullYear();
  const idx = month.getMonth();
  return {
    start: `${year}-${String(idx + 1).padStart(2, '0')}-01`,
    end: `${year}-${String(idx + 1).padStart(2, '0')}-${String(new Date(year, idx + 1, 0).getDate()).padStart(2, '0')}`,
  };
}

function eachDate(start: string, end: string): string[] {
  const dates: string[] = [];
  const cur = new Date(`${start}T00:00:00Z`).getTime();
  const last = new Date(`${end}T00:00:00Z`).getTime();
  for (let t = cur; t <= last; t += 86_400_000) dates.push(new Date(t).toISOString().slice(0, 10));
  return dates;
}

function emptyCounts(): ActivityCounts {
  return { journal: 0, reading: 0, highlight: 0, note: 0, bookmark: 0, echo: 0 };
}

function totalHealth(summary: PatternsSummary): number {
  return Object.values(summary.health).reduce((sum, count) => sum + count, 0);
}

function localCluster(segments: JournalSegment[]): ThemeItem[] {
  const textSegs = segments.filter(s => s.segment_type === 'text' && s.text);
  if (textSegs.length === 0) return [];
  const stopWords = new Set(['the','a','an','and','or','but','in','on','at','to','for','of','with','by','is','was','are','were','be','been','being','have','has','had','do','does','this','that','these','those','i','me','my','we','us','our','you','your','it','its','they','them','their','what','which','who','when','where','why','not','no','just','very','really','so','than','too','also','only','about','feel','feeling','felt','am','all']);
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
    scored.push({ word, score: freq * idf });
  }
  if (scored.length === 0) return [];
  const maxScore = Math.max(...scored.map(t => t.score));
  return scored.map(t => ({ word: t.word, score: Math.min(1, t.score / maxScore) })).sort((a, b) => b.score - a.score).slice(0, 8);
}

const calStyles = StyleSheet.create({
  calendar: { paddingVertical: 8 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 12 },
  navBtn: { paddingVertical: 4, paddingHorizontal: 12 },
  navText: { fontFamily: 'Inter, sans-serif', fontSize: 22, color: '#8b7355' },
  monthLabel: { fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: 18, fontWeight: '600', color: '#3a3530' },
  weekdays: { flexDirection: 'row', marginBottom: 4 },
  weekdayText: { flex: 1, textAlign: 'center', fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: '600', color: '#9a9388' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: '14.28%', aspectRatio: 1, justifyContent: 'center', alignItems: 'center', padding: 2 },
  day: { width: 34, height: 34, borderRadius: 17, justifyContent: 'center', alignItems: 'center' },
  dayToday: { borderWidth: 1.5, borderColor: '#8b7355' },
  daySelected: { backgroundColor: '#f0ebe3' },
  dayNum: { fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#7a7368' },
  dayHasEntries: { fontWeight: '600', color: '#3a3530' },
  dot: { width: 5, height: 5, borderRadius: 2.5 },
  dotRow: { flexDirection: 'row', gap: 3, position: 'absolute', bottom: 2, alignItems: 'center' },
  moreText: { fontFamily: 'Inter, sans-serif', fontSize: 8, color: '#7a7368', lineHeight: 8 },
});

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { gap: 16, paddingBottom: 40 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 40 },
  screenTitle: { fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: 30, fontWeight: '600', color: '#3a3530' },
  emptyText: { fontFamily: 'Cormorant Garamond, Georgia, serif', fontStyle: 'italic', fontSize: 17, color: '#7a7368', textAlign: 'center' },
  hint: { fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#9a9388', lineHeight: 18 },
  sectionHeaderRow: { gap: 8 },
  sectionLabel: { fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: '600', letterSpacing: 0.6, textTransform: 'uppercase', color: '#9a9388' },
  card: { borderWidth: 1, borderColor: '#e8e5e0', backgroundColor: '#ffffff', borderRadius: 10, padding: 16, gap: 10 },
  noticeCard: { borderWidth: 1, borderColor: '#ead9bd', backgroundColor: '#fff9ee', borderRadius: 10, padding: 12, gap: 4 },
  noticeTitle: { fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: '600', color: '#8b7355' },
  noticeText: { fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#9a9388' },
  cardText: { fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: 16, lineHeight: 23, color: '#3a3530' },
  mutedText: { fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: 15, lineHeight: 22, color: '#9a9388' },
  reflectionText: { fontFamily: 'Cormorant Garamond, Georgia, serif', fontStyle: 'italic', fontSize: 17, lineHeight: 26, color: '#3a3530' },
  reflectBtnText: { fontFamily: 'Cormorant Garamond, Georgia, serif', fontStyle: 'italic', fontSize: 17, lineHeight: 26, color: '#8b7355' },
  legendRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 6, height: 6, borderRadius: 3 },
  legendText: { fontFamily: 'Inter, sans-serif', fontSize: 10, color: '#9a9388' },
  detailTitle: { fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: 21, fontWeight: '600', color: '#3a3530' },
  detailSection: { gap: 4, paddingTop: 4 },
  detailSectionTitle: { fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: '600', letterSpacing: 0.4, textTransform: 'uppercase', color: '#9a9388' },
  detailRow: { fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: 15, lineHeight: 21, color: '#3a3530' },
  evidenceCard: { borderTopWidth: 1, borderTopColor: '#f0eee9', paddingTop: 10, gap: 5 },
  evidenceTitle: { fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: 17, fontWeight: '600', color: '#3a3530' },
  evidenceSubtitle: { fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#8b7355', lineHeight: 17 },
  evidenceList: { gap: 3, paddingTop: 2 },
  evidenceText: { fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#7a7368', lineHeight: 17 },
});
