/**
 * PatternsScreen — calm, offline-capable living concordance across three lenses:
 *
 *   - Threads:  "What Kept Finding You", multi-hop Trails Across Days, and
 *               A Quiet Question with inline Journal reply.
 *   - Explore:  Study Bookshelf (66 Bible books + installed Christian literature)
 *               with uniform cloth-bound spines, a gentle Group toggle, and a
 *               live Book Bridge panel below for both visited and unread books.
 *   - Activity: Monthly multi-dot activity calendar + inline day detail with
 *               cross-day echoes, returns, and trails.
 *
 * Timeframe controls (30d | 90d | All) + a subtle "?" Spine Key button sit at
 * the top bar. All data flows through DataLayer so mobile runs 100% offline
 * against local SQLite while web uses the shared concordance engine via API.
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
import {
  BIBLE_BOOKS,
  BIBLE_BOOK_ABBR,
  SCRIPTURE_SHELF_GROUPS,
  emptyActivityCounts,
  eachDateInRange,
  getCachedSync,
  type BookBridgeResult,
  type BookshelfVolume,
  type JournalSegment,
  type PatternDayDetail,
  type PatternDaySummary,
  type PatternFeedbackInput,
  type PatternTheme,
  type PatternTimeframe,
  type PatternsSummary,
} from '@resonance/core';
import { ExploreBookshelfLens } from './ExploreBookshelfLens';
import { ThreadsLens } from './ThreadsLens';
import { ActivityLens } from './ActivityLens';
import { SpineKeyModal } from './SpineKeyModal';

export interface PatternsScreenProps {
  onNavigateToBook?: (bookId: string, chapter?: number, verse?: number) => void;
  onNavigateToJournal?: () => void;
}

type PatternsLens = 'threads' | 'explore' | 'activity';

const TIMEFRAMES: readonly { id: PatternTimeframe; label: string }[] = [
  { id: '30d', label: '30d' },
  { id: '90d', label: '90d' },
  { id: 'all', label: 'All' },
];

const LENSES: readonly { id: PatternsLens; label: string }[] = [
  { id: 'threads', label: 'Threads' },
  { id: 'explore', label: 'Explore' },
  { id: 'activity', label: 'Activity' },
];

export function PatternsScreen({
  onNavigateToBook,
  onNavigateToJournal,
}: PatternsScreenProps = {}): ReactNode {
  const dataLayer = useDataLayer();
  const [lens, setLens] = useState<PatternsLens>('explore');
  const [timeframe, setTimeframe] = useState<PatternTimeframe>('30d');
  const [spineKeyOpen, setSpineKeyOpen] = useState(false);

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

    try {
      let next: PatternsSummary;
      if (dataLayer.getPatternsSummary) {
        next = await dataLayer.getPatternsSummary(start, end, timeframe);
      } else {
        const res = await fetch(
          `/api/patterns/summary?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&timeframe=${encodeURIComponent(timeframe)}`,
        );
        if (!res.ok) throw new Error(`Patterns API ${res.status}`);
        next = (await res.json()) as PatternsSummary;
      }
      setSummary(next);
      void dataLayer.loadSegments().then(setSegments).catch(() => null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Patterns unavailable';
      setError(message);
      const fallback = await buildFallbackSummary(dataLayer, currentMonth, timeframe).catch(
        () => null,
      );
      if (fallback) setSummary(fallback);
    } finally {
      setLoading(false);
    }
  }, [currentMonth, timeframe, dataLayer]);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  const handleSelectDay = useCallback(
    async (day: PatternDaySummary) => {
      setSelectedDate(day.date);
      setDayDetail(null);
      setLoadingDay(true);
      try {
        let detail: PatternDayDetail;
        if (dataLayer.getPatternDayDetail) {
          detail = await dataLayer.getPatternDayDetail(day.date);
        } else {
          const res = await fetch(`/api/patterns/day?date=${encodeURIComponent(day.date)}`);
          if (!res.ok) throw new Error(`Day API ${res.status}`);
          detail = (await res.json()) as PatternDayDetail;
        }
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
    },
    [dataLayer],
  );

  const handleLoadBookBridges = useCallback(
    async (kind: 'bible' | 'voice', id: string, bookId?: string): Promise<BookBridgeResult | null> => {
      try {
        if (dataLayer.getBookBridges) {
          return await dataLayer.getBookBridges(kind, id, timeframe, bookId);
        }
        const params = new URLSearchParams({ kind, id, timeframe });
        if (bookId) params.set('bookId', bookId);
        const res = await fetch(`/api/patterns/book-bridge?${params.toString()}`);
        if (!res.ok) return null;
        return (await res.json()) as BookBridgeResult;
      } catch {
        return null;
      }
    },
    [dataLayer, timeframe],
  );

  const handleFeedback = useCallback(
    async (input: PatternFeedbackInput): Promise<void> => {
      try {
        if (dataLayer.recordPatternFeedback) {
          await dataLayer.recordPatternFeedback(input);
        } else {
          await fetch('/api/patterns/feedback', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(input),
          });
        }
      } catch {
        // best-effort feedback
      }
    },
    [dataLayer],
  );

  const handleReflect = useCallback(async () => {
    setReflecting(true);
    try {
      if (segments.length > 0) {
        const excerpts = segments
          .filter((s) => s.text)
          .slice(0, 5)
          .map((s) => s.text!);
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

  const handleSaveQuietReply = useCallback(
    async (text: string): Promise<boolean> => {
      try {
        const now = Date.now();
        const today = new Date(now).toISOString().slice(0, 10);
        await dataLayer.saveSegment({
          id: `quiet-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
          created_at: now,
          updated_at: now,
          segment_type: 'text',
          text,
          position_index: Math.floor(now / 1000),
          parent_date: today,
        });
        void handleFeedback({
          action: 'saved',
          surface: 'quiet_question',
          itemId: today,
        });
        void onNavigateToJournal;
        return true;
      } catch {
        return false;
      }
    },
    [dataLayer, handleFeedback, onNavigateToJournal],
  );

  if (loading && !summary) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="small" color="#8b7355" />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      {/* Top Controls: Timeframe Pill + "?" Spine Key Button */}
      <View style={styles.controlsBar}>
        <Text style={styles.controlsTitle}>Patterns</Text>
        <View style={styles.controlsRight}>
          <View style={styles.timeframePill}>
            {TIMEFRAMES.map((tf) => {
              const active = timeframe === tf.id;
              return (
                <Pressable
                  key={tf.id}
                  onPress={() => setTimeframe(tf.id)}
                  style={[styles.tfBtn, active && styles.tfBtnActive]}
                >
                  <Text style={[styles.tfBtnText, active && styles.tfBtnTextActive]}>
                    {tf.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Pressable
            onPress={() => setSpineKeyOpen(true)}
            style={styles.helpBtn}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Bookshelf key"
          >
            <Text style={styles.helpBtnText}>?</Text>
          </Pressable>
        </View>
      </View>

      {/* 3-Lens Underline Switcher */}
      <View style={styles.lensBar}>
        {LENSES.map((item) => {
          const active = lens === item.id;
          return (
            <Pressable
              key={item.id}
              onPress={() => setLens(item.id)}
              style={[styles.lensTab, active && styles.lensTabActive]}
            >
              <Text style={[styles.lensTabText, active && styles.lensTabTextActive]}>
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {lens === 'explore' ? (
          <ExploreBookshelfLens
            bookshelf={summary?.bookshelf}
            timeframe={timeframe}
            onLoadBookBridges={handleLoadBookBridges}
            onNavigateToBook={onNavigateToBook}
          />
        ) : lens === 'threads' ? (
          <ThreadsLens
            summary={summary}
            error={error}
            reflection={reflection}
            reflecting={reflecting}
            onReflect={handleReflect}
            onSaveQuietReply={handleSaveQuietReply}
            onFeedback={handleFeedback}
            onNavigateToBook={onNavigateToBook}
          />
        ) : (
          <ActivityLens
            currentMonth={currentMonth}
            onPrevMonth={() => {
              setSelectedDate(null);
              setDayDetail(null);
              setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1));
            }}
            onNextMonth={() => {
              setSelectedDate(null);
              setDayDetail(null);
              setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1));
            }}
            summary={summary}
            selectedDate={selectedDate}
            dayDetail={dayDetail}
            loadingDay={loadingDay}
            onSelectDay={handleSelectDay}
            reflection={reflection}
            reflecting={reflecting}
            onReflect={handleReflect}
            onSaveQuietReply={handleSaveQuietReply}
            onFeedback={handleFeedback}
            onNavigateToBook={onNavigateToBook}
          />
        )}
      </ScrollView>

      <SpineKeyModal visible={spineKeyOpen} onClose={() => setSpineKeyOpen(false)} />
    </View>
  );
}

// ── Local fallback summary (if DataLayer/API fails) ─────────────────────────

async function buildFallbackSummary(
  dataLayer: ReturnType<typeof useDataLayer>,
  month: Date,
  timeframe: PatternTimeframe,
): Promise<PatternsSummary | null> {
  const { start, end } = monthWindow(month);
  const [segs, readingHistory] = await Promise.allSettled([
    dataLayer.loadSegments().catch(() => [] as JournalSegment[]),
    dataLayer.getReadingHistory(start, end).catch(() => [] as Array<{ date: string; count: number }>),
  ]);

  const entries = segs.status === 'fulfilled' ? segs.value : [];
  const byDate = new Map<string, PatternDaySummary>();
  for (const date of eachDateInRange(start, end)) {
    byDate.set(date, { date, counts: emptyActivityCounts(), dotTypes: [] });
  }

  const calendarDays = await dataLayer
    .getCalendarDays(entries, month.getFullYear(), month.getMonth())
    .catch(() => []);
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

  const themes: PatternTheme[] = localCluster(entries).map((item, index) => ({
    id: `local-${index}-${item.word}`,
    label: item.word,
    summary: `Several entries touched on ${item.word}.`,
    confidence: item.score,
    evidenceCount: 0,
    dateRange: { start, end },
    evidence: [],
  }));

  const scriptureVolumes: BookshelfVolume[] = BIBLE_BOOKS.map((b) => {
    const grp = SCRIPTURE_SHELF_GROUPS.find((g) => g.books.includes(b.name));
    return {
      kind: 'bible',
      id: b.name,
      bookId: `web_${b.name.replace(/\s+/g, '_')}`,
      spineLabel: BIBLE_BOOK_ABBR[b.name] ?? b.name.slice(0, 4),
      title: b.name,
      subtitle: `${b.testament === 'OT' ? 'Old Testament' : 'New Testament'} · ${grp?.label ?? 'Scripture'}`,
      groupId: grp?.id ?? 'law',
      testament: b.testament,
      readCount: 0,
      highlightCount: 0,
      noteCount: 0,
      bookmarkCount: 0,
      echoCount: 0,
      clothState: 'unread',
    };
  });

  return {
    window: { start, end },
    timeframe,
    recently: themes.length
      ? `Recently, several entries gathered around ${themes.slice(0, 3).map((t) => t.label).join(', ')}.`
      : 'Patterns need a few traces: journal entries, readings, highlights, or notes.',
    days: Array.from(byDate.values()),
    themes,
    echoes: [],
    findingYou: [],
    returnedTo: [],
    trails: [],
    bookshelf: {
      timeframe,
      scripture: scriptureVolumes,
      literature: [],
    },
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

function localCluster(segments: JournalSegment[]): Array<{ word: string; score: number }> {
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
    s.text!
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !stopWords.has(w)),
  );
  const docFreq = new Map<string, number>();
  const tf = new Map<string, number>();
  for (const doc of documents) {
    const seen = new Set(doc);
    for (const word of seen) docFreq.set(word, (docFreq.get(word) || 0) + 1);
    for (const word of doc) tf.set(word, (tf.get(word) || 0) + 1);
  }

  const N = documents.length;
  const scored: Array<{ word: string; score: number }> = [];
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
    .slice(0, 6);
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#faf9f6',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 40,
  },
  controlsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 10,
    gap: 8,
  },
  controlsTitle: {
    fontFamily: 'Cormorant Garamond, Georgia, serif',
    fontSize: 21,
    fontWeight: '600',
    color: '#3a3530',
  },
  controlsRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  timeframePill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#e3dcd0',
    backgroundColor: '#ffffff',
    padding: 2,
  },
  tfBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  tfBtnActive: {
    backgroundColor: '#8b7355',
  },
  tfBtnText: {
    fontFamily: 'Inter, sans-serif',
    fontSize: 11,
    color: '#7a7368',
  },
  tfBtnTextActive: {
    color: '#faf8f4',
    fontWeight: '600',
  },
  helpBtn: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: '#e3dcd0',
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  helpBtnText: {
    fontFamily: 'Inter, sans-serif',
    fontSize: 12,
    fontWeight: '600',
    color: '#8b7355',
  },
  lensBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#e8e2d8',
    marginBottom: 14,
  },
  lensTab: {
    flex: 1,
    paddingVertical: 9,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  lensTabActive: {
    borderBottomColor: '#3a3530',
  },
  lensTabText: {
    fontFamily: 'Inter, sans-serif',
    fontSize: 12.5,
    color: '#8c8478',
  },
  lensTabTextActive: {
    color: '#3a3530',
    fontWeight: '600',
  },
  container: {
    flex: 1,
  },
  content: {
    paddingBottom: 40,
  },
});
