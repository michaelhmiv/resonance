/**
 * Patterns page — calendar, weekly roundup, recurring themes, and
 * a gentle reflection question (web version).
 *
 * Fetches real data from /api/journal/entries, /api/patterns/weekly,
 * /api/patterns/themes, and /api/reflect.
 */

'use client';

import { useState, useEffect, useCallback, type ReactNode } from 'react';
import { StyleSheet, Text, View, Pressable, ScrollView, ActivityIndicator } from 'react-native-web';

interface JournalEntry {
  id: string;
  text: string;
  created_at: number;
}

interface WeeklyData {
  entryCount: number;
  dateRange: { start: string; end: string };
  excerpts: string[];
  themeLabel?: string;
}

interface ThemeItem {
  word: string;
  score: number;
}

export default function PatternsPage(): ReactNode {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [weekly, setWeekly] = useState<WeeklyData | null>(null);
  const [themes, setThemes] = useState<ThemeItem[]>([]);
  const [reflection, setReflection] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reflecting, setReflecting] = useState(false);
  const [currentMonth, setCurrentMonth] = useState(new Date());

  useEffect(() => {
    Promise.all([
      fetch('/api/journal/entries').then(r => r.json()).then(d => d.entries || []).catch(() => []),
      fetch('/api/patterns/weekly').then(r => r.json()).catch(() => null),
      fetch('/api/patterns/themes').then(r => r.json()).then(d => d.themes || []).catch(() => []),
    ]).then(([ents, wkly, thms]) => {
      setEntries(ents);
      setWeekly(wkly);
      setThemes(thms);
      setLoading(false);
    });
  }, []);

  // Build entry date map
  const entryDates = new Map<string, number>();
  for (const e of entries) {
    const d = new Date(e.created_at * 1000);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    entryDates.set(key, (entryDates.get(key) || 0) + 1);
  }

  const handleReflect = useCallback(async () => {
    if (entries.length === 0) return;
    setReflecting(true);
    setReflection(null);
    try {
      const recent = entries.slice(0, 5).map(e => e.text);
      const res = await fetch('/api/reflect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reflection_prompt', excerpts: recent }),
      });
      const data = await res.json();
      if (data.text) setReflection(data.text);
    } catch { /* best-effort */ } finally {
      setReflecting(false);
    }
  }, [entries]);

  if (loading) return <LoadingState />;

  const hasEntries = entries.length > 0;

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

      {/* ── Real Calendar ──────────────────────────────────────────────── */}
      <CalendarGrid
        currentMonth={currentMonth}
        onPrev={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1))}
        onNext={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1))}
        entryDates={entryDates}
      />

      {/* ── This Week ──────────────────────────────────────────────────── */}
      <Text style={styles.sectionLabel}>This Week</Text>
      <View style={styles.card}>
        {weekly && weekly.entryCount > 0 ? (
          <>
            {weekly.themeLabel && <Text style={styles.themeTag}>{weekly.themeLabel}</Text>}
            <Text style={styles.cardText}>{weekly.entryCount} {weekly.entryCount === 1 ? 'entry' : 'entries'} this week.</Text>
            {weekly.excerpts.length > 0 && (
              <Text style={styles.excerpt} numberOfLines={2}>{weekly.excerpts[0]}</Text>
            )}
          </>
        ) : (
          <Text style={styles.mutedText}>No entries yet this week.</Text>
        )}
      </View>

      {/* ── Recurring Themes ───────────────────────────────────────────── */}
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

      {/* ── A Quiet Question ────────────────────────────────────────────── */}
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

// ── Calendar Component ──────────────────────────────────────────────────────────

function CalendarGrid({
  currentMonth,
  onPrev,
  onNext,
  entryDates,
}: {
  currentMonth: Date;
  onPrev: () => void;
  onNext: () => void;
  entryDates: Map<string, number>;
}): ReactNode {
  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const monthName = currentMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const today = new Date();
  const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month;

  // First day of month (0 = Sunday)
  const firstDay = new Date(year, month, 1).getDay();
  // Days in month
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
          const key = `${year}-${month}-${day}`;
          const count = entryDates.get(key) || 0;
          const isToday = isCurrentMonth && day === today.getDate();
          return (
            <View key={i} style={styles.calCell}>
              <View style={[
                styles.calDay,
                isToday && styles.calDayToday,
              ]}>
                <Text style={[styles.calDayNum, count > 0 && styles.calDayHasEntries]}>{day}</Text>
                {count > 0 && <View style={[styles.calDot, count >= 3 && styles.calDotLarge]} />}
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
