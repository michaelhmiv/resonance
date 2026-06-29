/**
 * Patterns screen — gentle, evidence-backed reflection on recurring activity.
 *
 * The backend owns pattern construction. This screen renders the summary:
 * activity dots by day, inline day detail with per-item connections, and a
 * lightweight window-level Connections overview.
 *
 * Every activity row (journal, reading, highlight, note, bookmark) may expand
 * to show connections — echoes, returned-to signals, themes, and trails — that
 * are attached to that specific trace. This keeps the evidence and the pattern
 * in the same place and provides the graph hooks for future cloud views.
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
type ConnectionKind = 'echo' | 'returned_to' | 'theme' | 'trail';

interface PatternEvidence {
  type: ActivityType | 'theme' | 'edge';
  id?: string;
  date?: string;
  title?: string;
  ref?: string | null;
  excerpt?: string | null;
}

interface PatternConnection {
  kind: ConnectionKind;
  id: string;
  label: string;
  summary: string;
  confidence?: number;
  evidence: PatternEvidence[];
  sourceNodeIds?: string[];
  targetNodeIds?: string[];
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

interface JournalDayItem {
  id: string;
  excerpt: string;
  createdAt: string | null;
  connections: PatternConnection[];
}

interface ReadingDayItem {
  id: string;
  label: string;
  ref: string | null;
  createdAt: string | null;
  connections: PatternConnection[];
}

interface HighlightDayItem {
  id: string;
  verseRef: string | null;
  selectedText: string | null;
  color: string | null;
  createdAt: string | null;
  connections: PatternConnection[];
}

interface NoteDayItem {
  id: string;
  verseRef: string | null;
  noteExcerpt: string;
  updatedAt: string | null;
  connections: PatternConnection[];
}

interface BookmarkDayItem {
  id: string;
  verseRef: string | null;
  label: string | null;
  createdAt: string | null;
  connections: PatternConnection[];
}

interface PatternDayDetail {
  date: string;
  counts: ActivityCounts;
  journal: JournalDayItem[];
  reading: ReadingDayItem[];
  highlights: HighlightDayItem[];
  notes: NoteDayItem[];
  bookmarks: BookmarkDayItem[];
  connections: PatternConnection[];
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

const CONNECTION_KIND_COLORS: Record<ConnectionKind, string> = {
  echo: '#6f8fb8',
  returned_to: '#c9a25a',
  theme: '#8b7355',
  trail: '#6b9e6b',
};

const CONNECTION_KIND_LABELS: Record<ConnectionKind, string> = {
  echo: 'Echo',
  returned_to: 'Returned to',
  theme: 'Theme',
  trail: 'Trail',
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
      setDayDetail({
        date: day.date,
        counts: day.counts,
        journal: [],
        reading: [],
        highlights: [],
        notes: [],
        bookmarks: [],
        connections: [],
      });
    } finally {
      setLoadingDay(false);
    }
  }, []);

  const handleReflect = useCallback(async () => {
    setReflecting(true);
    setReflection(null);
    try {
      if (segments.length > 0) {
        const excerpts = segments.filter((s) => s.text).slice(0, 5).map((s) => s.text!);
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

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Recently */}
      <View style={styles.card}>
        <Text style={styles.cardText}>{summary?.recently ?? 'Patterns need a few traces: journal entries, readings, highlights, or notes.'}</Text>
        {error ? <Text style={styles.hint}>Using local data — patterns may be limited.</Text> : null}
      </View>

      {/* Activity */}
      <View style={styles.sectionHeaderRow}>
        <Text style={styles.sectionLabel}>Activity</Text>
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
        {selectedDate ? (
          <>
            <View style={styles.dateLine} />
            <DayDetailInline detail={dayDetail} date={selectedDate} loading={loadingDay} />
          </>
        ) : null}
      </View>

      {/* A Quiet Question */}
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

function DayDetailInline({
  detail,
  date,
  loading,
}: {
  detail: PatternDayDetail | null;
  date: string;
  loading: boolean;
}): ReactNode {
  const displayDate = new Date(date + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
  });

  if (loading) {
    return (
      <View style={styles.dayDetailWrap}>
        <Text style={styles.dateStamp}>{displayDate}</Text>
        <ActivityIndicator size="small" color="#8b7355" />
      </View>
    );
  }

  if (!detail) return null;

  return (
    <View style={styles.dayDetailWrap}>
      <View style={styles.dayDetailHeader}>
        <Text style={styles.dateStamp}>{displayDate}</Text>
        <CountLine counts={detail.counts} />
      </View>

      <DetailSection
        title="Journal"
        items={detail.journal}
        renderBody={(item) => <Text style={styles.detailBody}>{item.excerpt}</Text>}
      />
      <DetailSection
        title="Reading"
        items={detail.reading}
        renderBody={(item) => <Text style={styles.detailBody}>{item.label}</Text>}
      />
      <DetailSection
        title="Highlights"
        items={detail.highlights}
        renderBody={(item) => (
          <Text style={styles.detailBody}>
            {[item.verseRef, item.selectedText].filter(Boolean).join(' — ')}
          </Text>
        )}
      />
      <DetailSection
        title="Notes"
        items={detail.notes}
        renderBody={(item) => (
          <Text style={styles.detailBody}>
            {[item.verseRef, item.noteExcerpt].filter(Boolean).join(' — ')}
          </Text>
        )}
      />
      <DetailSection
        title="Bookmarks"
        items={detail.bookmarks}
        renderBody={(item) => (
          <Text style={styles.detailBody}>
            {[item.verseRef, item.label].filter(Boolean).join(' — ')}
          </Text>
        )}
      />
    </View>
  );
}

function CountLine({ counts }: { counts: ActivityCounts }): ReactNode {
  const parts = (Object.keys(counts) as ActivityType[])
    .filter((type) => counts[type] > 0)
    .map((type) => `${counts[type]} ${ACTIVITY_LABELS[type]}`);
  return <Text style={styles.hint}>{parts.length ? parts.join(' · ') : 'No activity found for this day.'}</Text>;
}

function DetailSection<T extends { id: string; connections: PatternConnection[] }>({
  title,
  items,
  renderBody,
}: {
  title: string;
  items: T[];
  renderBody: (item: T) => ReactNode;
}): ReactNode {
  if (items.length === 0) return null;
  return (
    <View style={styles.detailSection}>
      <Text style={styles.detailSectionTitle}>{title}</Text>
      {items.map((item) => (
        <ActivityItemRow key={item.id} item={item} renderBody={() => renderBody(item)} />
      ))}
    </View>
  );
}

const VISIBLE_CONNECTION_KINDS: ReadonlySet<ConnectionKind> = new Set(['echo', 'returned_to', 'theme', 'trail']);

function ActivityItemRow<T extends { id: string; connections: PatternConnection[] }>({
  item,
  renderBody,
}: {
  item: T;
  renderBody: () => ReactNode;
}): ReactNode {
  const visibleConnections = item.connections.filter((connection) => VISIBLE_CONNECTION_KINDS.has(connection.kind));
  const [expanded, setExpanded] = useState(false);

  return (
    <View style={styles.activityItem}>
      <Pressable
        onPress={() => visibleConnections.length > 0 && setExpanded(!expanded)}
        disabled={visibleConnections.length === 0}
      >
        <View style={styles.activityItemHeader}>
          <View style={styles.activityItemBody}>{renderBody()}</View>
          {visibleConnections.length > 0 ? (
            <View style={styles.expandChip}>
              <Text style={styles.expandChipText}>{expanded ? 'Hide' : `${visibleConnections.length} related`}</Text>
            </View>
          ) : null}
        </View>
      </Pressable>

      {expanded && visibleConnections.length > 0 ? (
        <View style={styles.connectionThread}>
          {visibleConnections.slice(0, 3).map((connection) => (
            <View key={`${connection.kind}-${connection.id}`} style={styles.connectionThreadItem}>
              <View style={[styles.threadLine, { borderLeftColor: CONNECTION_KIND_COLORS[connection.kind] }]} />
              <View style={styles.connectionThreadContent}>
                <View style={styles.connectionThreadHeader}>
                  <View style={[styles.threadKindDot, { backgroundColor: CONNECTION_KIND_COLORS[connection.kind] }]} />
                  <Text style={styles.threadKindText}>{CONNECTION_KIND_LABELS[connection.kind]}</Text>
                </View>
                <Text style={styles.threadLabel}>{connection.label}</Text>
                <Text style={styles.threadSummary}>{connection.summary}</Text>
                {connection.evidence.length > 0 ? (
                  <View style={styles.threadEvidenceList}>
                    {connection.evidence.slice(0, 1).map((ev, evIndex) => (
                      <Text key={evIndex} style={styles.threadEvidenceText} numberOfLines={2}>
                        {ev.ref ? `${ev.ref} · ` : ''}{ev.excerpt || ev.title || 'Evidence'}
                      </Text>
                    ))}
                  </View>
                ) : null}
              </View>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function CalendarGrid({
  currentMonth,
  onPrev,
  onNext,
  days,
  selectedDate,
  onSelectDay,
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

  const cells: Array<number | null> = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  const trailing = (7 - (cells.length % 7)) % 7;
  for (let i = 0; i < trailing; i++) cells.push(null);

  const weekdays = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

  return (
    <View style={calStyles.calendar}>
      <View style={calStyles.header}>
        <Pressable onPress={onPrev} hitSlop={8}>
          <Text style={calStyles.arrow}>{'‹'}</Text>
        </Pressable>
        <Text style={calStyles.monthLabel}>{monthName}</Text>
        <Pressable onPress={onNext} hitSlop={8}>
          <Text style={calStyles.arrow}>{'›'}</Text>
        </Pressable>
      </View>
      <View style={calStyles.weekdayRow}>
        {weekdays.map((wd, i) => (
          <Text key={i} style={calStyles.weekdayText}>{wd}</Text>
        ))}
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
                  {summary.dotTypes.slice(0, 3).map((type) => (
                    <View key={type} style={[calStyles.dot, { backgroundColor: ACTIVITY_COLORS[type] }]} />
                  ))}
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

// ── Local fallback summary ──────────────────────────────────────────
async function buildFallbackSummary(dataLayer: ReturnType<typeof useDataLayer>, month: Date): Promise<PatternsSummary | null> {
  const { start, end } = monthWindow(month);
  const [segs, readingHistory] = await Promise.allSettled([
    dataLayer.loadSegments().catch(() => [] as JournalSegment[]),
    dataLayer.getReadingHistory(start, end).catch(() => [] as Array<{ date: string; count: number }>),
  ]);

  const entries = segs.status === 'fulfilled' ? segs.value : [];
  const byDate = new Map<string, PatternDaySummary>();
  for (const date of eachDate(start, end)) {
    byDate.set(date, { date, counts: emptyCounts(), dotTypes: [] });
  }

  const calendarDays = await dataLayer.getCalendarDays(entries, month.getFullYear(), month.getMonth()).catch(() => []);
  for (const cd of calendarDays) {
    const day = byDate.get(cd.date);
    if (day && cd.entryCount > 0) {
      day.counts.journal = cd.entryCount;
      day.dotTypes.push('journal');
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

  const themes = localCluster(entries).map((item, index): PatternTheme => ({
    id: `local-${index}-${item.word}`,
    label: item.word,
    summary: `Several entries touched on ${item.word}.`,
    confidence: item.score,
    evidenceCount: 0,
    dateRange: { start, end },
    evidence: [],
  }));

  return {
    window: { start, end },
    recently: themes.length
      ? `Recently, several entries gathered around ${themes.slice(0, 3).map((t) => t.label).join(', ')}.`
      : 'Patterns need a few traces: journal entries, readings, highlights, or notes.',
    days: Array.from(byDate.values()),
    themes,
    echoes: [],
    returnedTo: [],
    trails: [],
    quietQuestion: 'What are you noticing these days?',
    health: {
      journalEntryCount: entries.filter((s) => s.segment_type === 'text' && s.text).length,
      readingEventCount: 0,
      highlightCount: 0,
      noteCount: 0,
      bookmarkCount: 0,
      echoCount: 0,
    },
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

function localCluster(segments: JournalSegment[]): ThemeItem[] {
  const textSegs = segments.filter((s) => s.segment_type === 'text' && s.text);
  if (textSegs.length === 0) return [];

  const stopWords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by',
    'is', 'was', 'are', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does',
    'this', 'that', 'these', 'those', 'i', 'me', 'my', 'we', 'us', 'our', 'you', 'your',
    'it', 'its', 'they', 'them', 'their', 'what', 'which', 'who', 'when', 'where', 'why',
    'not', 'no', 'just', 'very', 'really', 'so', 'than', 'too', 'also', 'only', 'about',
    'feel', 'feeling', 'felt', 'am', 'all',
  ]);

  const documents = textSegs.map((s) =>
    s.text!.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !stopWords.has(w))
  );
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

  const maxScore = Math.max(...scored.map((t) => t.score));
  return scored
    .map((t) => ({ word: t.word, score: Math.min(1, t.score / maxScore) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
}

const calStyles = StyleSheet.create({
  calendar: { paddingVertical: 8 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 12 },
  arrow: { fontFamily: 'Inter, sans-serif', fontSize: 18, color: '#8b7355', paddingHorizontal: 8 },
  monthLabel: { fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: 18, fontWeight: '600', color: '#3a3530' },
  weekdayRow: { flexDirection: 'row', paddingBottom: 8 },
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
  emptyText: { fontFamily: 'Cormorant Garamond, Georgia, serif', fontStyle: 'italic', fontSize: 17, color: '#7a7368', textAlign: 'center' },
  hint: { fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#9a9388', lineHeight: 18 },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 },
  sectionLabel: { fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: '600', letterSpacing: 0.6, textTransform: 'uppercase', color: '#9a9388' },
  card: { borderWidth: 1, borderColor: '#e8e5e0', backgroundColor: '#ffffff', borderRadius: 10, padding: 16, gap: 10 },
  cardText: { fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: 16, lineHeight: 23, color: '#3a3530' },
  mutedText: { fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: 15, lineHeight: 22, color: '#9a9388' },
  reflectionText: { fontFamily: 'Cormorant Garamond, Georgia, serif', fontStyle: 'italic', fontSize: 17, lineHeight: 26, color: '#3a3530' },
  reflectBtnText: { fontFamily: 'Cormorant Garamond, Georgia, serif', fontStyle: 'italic', fontSize: 17, lineHeight: 26, color: '#8b7355' },
  legendRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 6, height: 6, borderRadius: 3 },
  legendText: { fontFamily: 'Inter, sans-serif', fontSize: 10, color: '#9a9388' },
  dateLine: { flex: 1, height: 1, backgroundColor: '#e8e5e0', marginVertical: 8 },
  dayDetailWrap: { gap: 10 },
  dayDetailHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 },
  dateStamp: { fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: '500', color: '#9a9388', letterSpacing: 0.4 },
  detailSection: { gap: 6 },
  detailSectionTitle: { fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: '600', letterSpacing: 0.4, textTransform: 'uppercase', color: '#9a9388' },
  activityItem: { gap: 6, paddingVertical: 4 },
  activityItemHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 },
  activityItemBody: { flex: 1 },
  detailBody: { fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: 15, lineHeight: 21, color: '#3a3530' },
  expandChip: { borderWidth: 1, borderColor: '#e8e5e0', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, backgroundColor: '#faf9f6' },
  expandChipText: { fontFamily: 'Inter, sans-serif', fontSize: 10, fontWeight: '500', color: '#8b7355' },
  connectionThread: { gap: 8, paddingTop: 6, paddingLeft: 12 },
  connectionThreadItem: { flexDirection: 'row' },
  threadLine: { width: 0, borderLeftWidth: 1.5, marginRight: 12 },
  connectionThreadContent: { flex: 1, gap: 3 },
  connectionThreadHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  threadKindDot: { width: 5, height: 5, borderRadius: 2.5 },
  threadKindText: { fontFamily: 'Inter, sans-serif', fontSize: 10, fontWeight: '600', letterSpacing: 0.4, textTransform: 'uppercase', color: '#9a9388' },
  threadLabel: { fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: 15, fontWeight: '500', color: '#3a3530' },
  threadSummary: { fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: 14, lineHeight: 20, color: '#7a7368' },
  threadEvidenceList: { gap: 2, paddingTop: 2 },
  threadEvidenceText: { fontFamily: 'Inter, sans-serif', fontSize: 11, color: '#9a9388', lineHeight: 16 },
});
