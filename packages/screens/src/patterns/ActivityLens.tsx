/**
 * ActivityLens — calm monthly calendar + inline day detail with cross-day
 * connections attached directly to each trace, plus A Quiet Question.
 */

import { useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  emptyActivityCounts,
  parseVerseRefParts,
  type PatternActivityCounts,
  type PatternActivityType,
  type PatternConnection,
  type PatternConnectionKind,
  type PatternDayDetail,
  type PatternDaySummary,
  type PatternFeedbackInput,
  type PatternsSummary,
} from '@resonance/core';
import { QuietQuestionCard } from './ThreadsLens';

interface ActivityLensProps {
  currentMonth: Date;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  summary: PatternsSummary | null;
  selectedDate: string | null;
  dayDetail: PatternDayDetail | null;
  loadingDay: boolean;
  onSelectDay: (day: PatternDaySummary) => void;
  reflection: string | null;
  reflecting: boolean;
  onReflect: () => void;
  onSaveQuietReply: (text: string) => Promise<boolean>;
  onFeedback: (input: PatternFeedbackInput) => Promise<void>;
  onNavigateToBook?: (bookId: string, chapter?: number, verse?: number) => void;
}

const ACTIVITY_LABELS: Record<PatternActivityType, string> = {
  journal: 'Journal',
  reading: 'Reading',
  highlight: 'Highlight',
  note: 'Note',
  bookmark: 'Bookmark',
  echo: 'Echo',
};

const ACTIVITY_COLORS: Record<PatternActivityType, string> = {
  journal: '#8b7355',
  reading: '#6b9e6b',
  highlight: '#c9a25a',
  note: '#7d79a8',
  bookmark: '#b86f52',
  echo: '#6f8fb8',
};

const CONNECTION_KIND_COLORS: Record<PatternConnectionKind, string> = {
  echo: '#c9a25a',
  returned_to: '#8b7355',
  theme: '#7d79a8',
  trail: '#6b9e6b',
};

const CONNECTION_KIND_LABELS: Record<PatternConnectionKind, string> = {
  echo: 'Cross-day echo',
  returned_to: 'Returned to',
  theme: 'Thread',
  trail: 'Trail',
};

export function ActivityLens({
  currentMonth,
  onPrevMonth,
  onNextMonth,
  summary,
  selectedDate,
  dayDetail,
  loadingDay,
  onSelectDay,
  reflection,
  reflecting,
  onReflect,
  onSaveQuietReply,
  onFeedback,
  onNavigateToBook,
}: ActivityLensProps): ReactNode {
  return (
    <View style={styles.root}>
      <View style={styles.sectionHeaderRow}>
        <Text style={styles.sectionLabel}>Activity</Text>
        <Legend />
      </View>

      <View style={styles.card}>
        <CalendarGrid
          currentMonth={currentMonth}
          onPrev={onPrevMonth}
          onNext={onNextMonth}
          days={summary?.days ?? []}
          selectedDate={selectedDate}
          onSelectDay={onSelectDay}
        />

        {selectedDate ? (
          <>
            <View style={styles.dateLine} />
            <DayDetailInline
              detail={dayDetail}
              date={selectedDate}
              loading={loadingDay}
              onFeedback={onFeedback}
              onNavigateToBook={onNavigateToBook}
            />
          </>
        ) : (
          <Text style={styles.selectHint}>Tap any day to inspect its traces & cross-day echoes.</Text>
        )}
      </View>

      <QuietQuestionCard
        promptText={reflection ?? summary?.quietQuestion ?? 'What are you noticing these days?'}
        reflecting={reflecting}
        onRefreshPrompt={onReflect}
        onSaveReply={onSaveQuietReply}
      />
    </View>
  );
}

function Legend(): ReactNode {
  return (
    <View style={styles.legendRow}>
      {(['journal', 'reading', 'highlight', 'note', 'echo'] as PatternActivityType[]).map((type) => (
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
  onFeedback,
  onNavigateToBook,
}: {
  detail: PatternDayDetail | null;
  date: string;
  loading: boolean;
  onFeedback: (input: PatternFeedbackInput) => Promise<void>;
  onNavigateToBook?: (bookId: string, chapter?: number, verse?: number) => void;
}): ReactNode {
  const displayDate = new Date(`${date}T00:00:00`).toLocaleDateString('en-US', {
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
        onFeedback={onFeedback}
        onNavigateToBook={onNavigateToBook}
        renderBody={(item) => <Text style={styles.detailBody}>{item.excerpt}</Text>}
      />
      <DetailSection
        title="Reading"
        items={detail.reading}
        onFeedback={onFeedback}
        onNavigateToBook={onNavigateToBook}
        renderBody={(item) => <Text style={styles.detailBody}>{item.label}</Text>}
      />
      <DetailSection
        title="Highlights"
        items={detail.highlights}
        onFeedback={onFeedback}
        onNavigateToBook={onNavigateToBook}
        renderBody={(item) => (
          <Text style={styles.detailBody}>
            {[item.verseRef, item.selectedText].filter(Boolean).join(' — ')}
          </Text>
        )}
      />
      <DetailSection
        title="Notes"
        items={detail.notes}
        onFeedback={onFeedback}
        onNavigateToBook={onNavigateToBook}
        renderBody={(item) => (
          <Text style={styles.detailBody}>
            {[item.verseRef, item.noteExcerpt].filter(Boolean).join(' — ')}
          </Text>
        )}
      />
      <DetailSection
        title="Bookmarks"
        items={detail.bookmarks}
        onFeedback={onFeedback}
        onNavigateToBook={onNavigateToBook}
        renderBody={(item) => (
          <Text style={styles.detailBody}>
            {[item.verseRef, item.label].filter(Boolean).join(' — ')}
          </Text>
        )}
      />
    </View>
  );
}

function CountLine({ counts }: { counts: PatternActivityCounts }): ReactNode {
  const parts = (Object.keys(counts) as PatternActivityType[])
    .filter((type) => counts[type] > 0)
    .map((type) => `${counts[type]} ${ACTIVITY_LABELS[type]}`);
  return <Text style={styles.hint}>{parts.length ? parts.join(' · ') : 'No traces recorded on this day.'}</Text>;
}

function DetailSection<T extends { id: string; connections: PatternConnection[] }>({
  title,
  items,
  renderBody,
  onFeedback,
  onNavigateToBook,
}: {
  title: string;
  items: T[];
  renderBody: (item: T) => ReactNode;
  onFeedback: (input: PatternFeedbackInput) => Promise<void>;
  onNavigateToBook?: (bookId: string, chapter?: number, verse?: number) => void;
}): ReactNode {
  if (items.length === 0) return null;
  return (
    <View style={styles.detailSection}>
      <Text style={styles.detailSectionTitle}>{title}</Text>
      {items.map((item) => (
        <ActivityItemRow
          key={item.id}
          item={item}
          renderBody={() => renderBody(item)}
          onFeedback={onFeedback}
          onNavigateToBook={onNavigateToBook}
        />
      ))}
    </View>
  );
}

function ActivityItemRow<T extends { id: string; connections: PatternConnection[] }>({
  item,
  renderBody,
  onFeedback,
  onNavigateToBook,
}: {
  item: T;
  renderBody: () => ReactNode;
  onFeedback: (input: PatternFeedbackInput) => Promise<void>;
  onNavigateToBook?: (bookId: string, chapter?: number, verse?: number) => void;
}): ReactNode {
  const [expanded, setExpanded] = useState(item.connections.length > 0);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const visibleConnections = item.connections.filter(
    (c) => !dismissed.has(`${c.kind}-${c.id}`),
  );

  const handleJumpConnection = (conn: PatternConnection) => {
    if (!onNavigateToBook) return;
    const ref = conn.ref ?? conn.evidence.find((e) => e.ref)?.ref;
    const parsed = parseVerseRefParts(ref);
    const targetBookId =
      conn.bookId ??
      conn.evidence.find((e) => e.bookId)?.bookId ??
      (parsed.book ? `web_${parsed.book.replace(/\s+/g, '_')}` : null);
    if (!targetBookId) return;
    onNavigateToBook(targetBookId, parsed.chapter ?? undefined, parsed.verse ?? undefined);
  };

  return (
    <View style={styles.activityItem}>
      <Pressable
        onPress={() => visibleConnections.length > 0 && setExpanded((prev) => !prev)}
        disabled={visibleConnections.length === 0}
      >
        <View style={styles.activityItemHeader}>
          <View style={styles.activityItemBody}>{renderBody()}</View>
          {visibleConnections.length > 0 ? (
            <View style={styles.expandChip}>
              <Text style={styles.expandChipText}>
                {expanded ? 'Hide' : `${visibleConnections.length} related`}
              </Text>
            </View>
          ) : null}
        </View>
      </Pressable>

      {expanded && visibleConnections.length > 0 ? (
        <View style={styles.connectionThread}>
          {visibleConnections.slice(0, 3).map((connection) => {
            const key = `${connection.kind}-${connection.id}`;
            const canOpen = Boolean(onNavigateToBook && (connection.ref || connection.bookId));
            return (
              <View key={key} style={styles.connectionThreadItem}>
                <View
                  style={[
                    styles.threadLine,
                    { borderLeftColor: CONNECTION_KIND_COLORS[connection.kind] },
                  ]}
                />
                <View style={styles.connectionThreadContent}>
                  <View style={styles.connectionThreadHeader}>
                    <View
                      style={[
                        styles.threadKindDot,
                        { backgroundColor: CONNECTION_KIND_COLORS[connection.kind] },
                      ]}
                    />
                    <Text style={styles.threadKindText}>
                      {CONNECTION_KIND_LABELS[connection.kind]}
                    </Text>
                  </View>
                  <Text style={styles.threadLabel}>{connection.label}</Text>
                  <Text style={styles.threadSummary}>{connection.summary}</Text>
                  {connection.evidence.length > 0 ? (
                    <View style={styles.threadEvidenceList}>
                      {connection.evidence.slice(0, 2).map((ev, evIndex) => (
                        <Text key={evIndex} style={styles.threadEvidenceText} numberOfLines={2}>
                          {ev.date ? `${ev.date} · ` : ''}
                          {ev.ref ? `${ev.ref} · ` : ''}
                          {ev.excerpt || ev.title || 'Evidence'}
                        </Text>
                      ))}
                    </View>
                  ) : null}
                  <View style={styles.connActions}>
                    {canOpen ? (
                      <Pressable onPress={() => handleJumpConnection(connection)} hitSlop={6}>
                        <Text style={styles.connOpen}>Open →</Text>
                      </Pressable>
                    ) : null}
                    <Pressable
                      onPress={() => {
                        setDismissed((prev) => new Set(prev).add(key));
                        void onFeedback({
                          action: 'dismissed',
                          surface: connection.kind,
                          itemId: connection.id,
                          edgeId: connection.edgeId ?? undefined,
                        });
                      }}
                      hitSlop={6}
                    >
                      <Text style={styles.connDismiss}>Not quite</Text>
                    </Pressable>
                  </View>
                </View>
              </View>
            );
          })}
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
          const summary = byDate.get(key) ?? { date: key, counts: emptyActivityCounts(), dotTypes: [] };
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

const calStyles = StyleSheet.create({
  calendar: { paddingVertical: 6 },
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
  root: { gap: 14 },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 },
  sectionLabel: { fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: '600', letterSpacing: 0.7, textTransform: 'uppercase', color: '#9a9388' },
  card: { borderWidth: 1, borderColor: '#e8e5e0', backgroundColor: '#ffffff', borderRadius: 12, padding: 15, gap: 10 },
  hint: { fontFamily: 'Inter, sans-serif', fontSize: 11.5, color: '#9a9388', lineHeight: 17 },
  selectHint: { fontFamily: 'Cormorant Garamond, Georgia, serif', fontStyle: 'italic', fontSize: 14.5, color: '#9a9388', textAlign: 'center', paddingTop: 4 },
  legendRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 6, height: 6, borderRadius: 3 },
  legendText: { fontFamily: 'Inter, sans-serif', fontSize: 10, color: '#9a9388' },
  dateLine: { height: 1, backgroundColor: '#e8e5e0', marginVertical: 4 },
  dayDetailWrap: { gap: 10 },
  dayDetailHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 },
  dateStamp: { fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: '500', color: '#9a9388', letterSpacing: 0.4 },
  detailSection: { gap: 6 },
  detailSectionTitle: { fontFamily: 'Inter, sans-serif', fontSize: 10.5, fontWeight: '600', letterSpacing: 0.5, textTransform: 'uppercase', color: '#9a9388' },
  activityItem: { gap: 6, paddingVertical: 4 },
  activityItemHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 },
  activityItemBody: { flex: 1 },
  detailBody: { fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: 15.5, lineHeight: 22, color: '#3a3530' },
  expandChip: { borderWidth: 1, borderColor: '#e8e5e0', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, backgroundColor: '#faf9f6' },
  expandChipText: { fontFamily: 'Inter, sans-serif', fontSize: 10, fontWeight: '500', color: '#8b7355' },
  connectionThread: { gap: 8, paddingTop: 4, paddingLeft: 10 },
  connectionThreadItem: { flexDirection: 'row' },
  threadLine: { width: 0, borderLeftWidth: 1.5, marginRight: 10 },
  connectionThreadContent: { flex: 1, gap: 3 },
  connectionThreadHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  threadKindDot: { width: 5, height: 5, borderRadius: 2.5 },
  threadKindText: { fontFamily: 'Inter, sans-serif', fontSize: 10, fontWeight: '600', letterSpacing: 0.4, textTransform: 'uppercase', color: '#9a9388' },
  threadLabel: { fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: 15.5, fontWeight: '600', color: '#3a3530' },
  threadSummary: { fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: 14, lineHeight: 20, color: '#7a7368' },
  threadEvidenceList: { gap: 2, paddingTop: 2 },
  threadEvidenceText: { fontFamily: 'Inter, sans-serif', fontSize: 11, color: '#9a9388', lineHeight: 16 },
  connActions: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingTop: 3 },
  connOpen: { fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: '600', color: '#8b7355' },
  connDismiss: { fontFamily: 'Inter, sans-serif', fontSize: 11, color: '#9a9388' },
});
