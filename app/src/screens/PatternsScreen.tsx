/**
 * Patterns screen — gentle, humane reflection on recurring themes over time.
 *
 * Not a dashboard. Not analytics. This is a calm space for noticing what
 * surfaces in the journal: clusters of similar entries, themes that shift
 * between weeks, and a serene weekly overview.
 *
 * (design spec §7: Patterns tab — reflective, not productivity tracking)
 */

import {
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';

import {
  cardSurface,
  colors,
  fontFamilies,
  layout,
  radii,
  serifText,
  serifQuote,
  spacing,
} from '../theme';
import { useDbStore } from '../db/dbStore';
import { useJournalStore } from '../journal/journalStore';
import {
  type EntryCluster,
  type WeeklyRoundup,
  type CalendarDay,
  clusterEntries,
  generateWeeklyRoundup,
  getCalendarDays,
} from '../embedding/patternsService';
import type { JournalSegment } from '../journal/segmentModel';
import { toParentDate, parentDateToDate } from '../journal/segmentModel';

// ── Component ───────────────────────────────────────────────────────────────

export function PatternsScreen(): ReactNode {
  const { connection: db, status } = useDbStore();
  const { segments, load } = useJournalStore();
  const navigation = useNavigation();

  const [clusters, setClusters] = useState<EntryCluster[] | null>(null);
  const [roundup, setRoundup] = useState<WeeklyRoundup | null>(null);
  const [calendarDays, setCalendarDays] = useState<CalendarDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [calMonth] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });

  // ── Load journal ──────────────────────────────────────────────────────
  useEffect(() => {
    if (db && status === 'ready') {
      void load(db);
    }
  }, [db, status, load]);

  // ── Compute patterns when segments change ─────────────────────────────
  useEffect(() => {
    if (segments.length === 0) {
      setClusters([]);
      setRoundup(null);
      setCalendarDays([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    const compute = async () => {
      const [cl, week, cal] = await Promise.all([
        clusterEntries(segments),
        generateWeeklyRoundup(segments, getWeekStart(new Date())),
        getCalendarDays(segments, calMonth.year, calMonth.month),
      ]);
      if (!cancelled) {
        setClusters(cl);
        setRoundup(week);
        setCalendarDays(cal);
        setLoading(false);
      }
    };
    void compute();

    return () => {
      cancelled = true;
    };
  }, [segments, calMonth]);

  // ── Settings gear in header ───────────────────────────────────────────
  useEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable
          onPress={() => navigation.navigate('Settings' as never)}
          hitSlop={12}
          style={{ marginRight: 16 }}
          accessibilityRole="button"
          accessibilityLabel="Settings"
        >
          <Feather name="settings" size={20} color={colors.textSecondary} />
        </Pressable>
      ),
    });
  }, [navigation]);

  // ── Render ─────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator color={colors.accentMuted} />
      </View>
    );
  }

  if (segments.length === 0) {
    return (
      <View style={[styles.container, styles.center]}>
        <Text style={styles.emptyText}>
          Patterns will appear as you write.
        </Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      {/* ── Calendar ─────────────────────────────────────────────── */}
      <CalendarStrip days={calendarDays} month={calMonth.month} year={calMonth.year} />

      {/* ── Weekly roundup ────────────────────────────────────────── */}
      {roundup && roundup.entryCount > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>This Week</Text>
          <View style={[cardSurface, styles.card, styles.roundupCard]}>
            <Text style={styles.roundupCount}>
              {roundup.entryCount} {roundup.entryCount === 1 ? 'entry' : 'entries'}
            </Text>
            {roundup.themes.length > 0 && (
              <View style={styles.themes}>
                {roundup.themes.map((theme, i) => (
                  <Text key={i} style={styles.themeTag}>
                    {theme}
                  </Text>
                ))}
              </View>
            )}
            {roundup.excerpt.length > 0 && (
              <Text style={styles.roundupExcerpt} numberOfLines={3}>
                {roundup.excerpt}
              </Text>
            )}
          </View>
        </View>
      )}

      {/* ── Clusters ─────────────────────────────────────────────── */}
      {clusters && clusters.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Recurring Themes</Text>
          {clusters.map((cluster) => (
            <ClusterCard key={cluster.id} cluster={cluster} />
          ))}
        </View>
      )}

      {/* ── Reflection prompt ────────────────────────────────────── */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>A Quiet Question</Text>
        <View style={[cardSurface, styles.card]}>
          <Text style={styles.reflectionPrompt}>
            What are you noticing these days?
          </Text>
        </View>
      </View>

      <View style={{ height: spacing.xxl }} />
    </ScrollView>
  );
}

// ── Calendar strip ───────────────────────────────────────────────────────────

function CalendarStrip({
  days,
  month,
  year,
}: {
  days: CalendarDay[];
  month: number;
  year: number;
}): ReactNode {
  const monthName = new Date(year, month, 1).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });

  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>{monthName}</Text>
      <View style={styles.calendarGrid}>
        {days.map((day) => (
          <View
            key={day.date}
            style={[
              styles.calDay,
              day.hasEntries && styles.calDayActive,
            ]}
          >
            {day.hasEntries && (
              <View
                style={[
                  styles.calDot,
                  day.entryCount > 2 && styles.calDotLarge,
                ]}
              />
            )}
          </View>
        ))}
      </View>
    </View>
  );
}

// ── Cluster card ─────────────────────────────────────────────────────────────

function ClusterCard({ cluster }: { cluster: EntryCluster }): ReactNode {
  return (
    <View style={[cardSurface, styles.card]}>
      <Text style={styles.clusterLabel}>{cluster.label}</Text>
      <Text style={styles.clusterCount}>
        {cluster.entryCount} {cluster.entryCount === 1 ? 'entry' : 'entries'}
      </Text>
      {cluster.excerpts.map((excerpt, i) => (
        <Text key={i} style={styles.clusterExcerpt} numberOfLines={2}>
          {excerpt}
        </Text>
      ))}
      {cluster.dateRange.start && (
        <Text style={styles.clusterDate}>
          {formatDateShort(cluster.dateRange.start)}
          {cluster.dateRange.end !== cluster.dateRange.start
            ? ` — ${formatDateShort(cluster.dateRange.end)}`
            : ''}
        </Text>
      )}
    </View>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function getWeekStart(d: Date): string {
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday start
  const monday = new Date(d.setDate(diff));
  return toParentDate(monday);
}

function formatDateShort(dateStr: string): string {
  try {
    const d = parentDateToDate(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return dateStr;
  }
}

// ── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  center: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    paddingHorizontal: layout.screenPaddingX,
    paddingVertical: spacing.lg,
    gap: spacing.xl,
  },
  section: {
    gap: spacing.sm,
  },
  sectionLabel: {
    fontFamily: fontFamilies.sansSemibold,
    fontSize: 12,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.textTertiary,
  },
  card: {
    borderRadius: radii.md,
    padding: layout.cardPadding,
  },
  // ── Calendar ───────────────────────────────────────────────
  calendarGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  calDay: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  calDayActive: {
    borderColor: colors.accentMuted,
    backgroundColor: colors.background,
  },
  calDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.accent,
  },
  calDotLarge: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.accent,
  },
  // ── Weekly roundup ────────────────────────────────────────
  roundupCard: {
    gap: spacing.sm,
  },
  roundupCount: {
    ...serifText,
    fontFamily: fontFamilies.serifSemibold,
    fontSize: 17,
    color: colors.textPrimary,
  },
  themes: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  themeTag: {
    fontFamily: fontFamilies.sans,
    fontSize: 12,
    color: colors.accent,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  roundupExcerpt: {
    ...serifQuote,
    fontStyle: 'italic',
    fontSize: 15,
    lineHeight: 22,
    color: colors.textSecondary,
  },
  // ── Clusters ───────────────────────────────────────────────
  clusterLabel: {
    ...serifText,
    fontFamily: fontFamilies.serifSemibold,
    fontSize: 18,
    color: colors.textPrimary,
    marginBottom: 2,
  },
  clusterCount: {
    fontFamily: fontFamilies.sans,
    fontSize: 12,
    color: colors.textTertiary,
    marginBottom: spacing.sm,
  },
  clusterExcerpt: {
    ...serifQuote,
    fontStyle: 'italic',
    fontSize: 14,
    lineHeight: 20,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  clusterDate: {
    fontFamily: fontFamilies.sans,
    fontSize: 11,
    color: colors.textTertiary,
    marginTop: spacing.xs,
  },
  // ── Reflection prompt ──────────────────────────────────────
  reflectionPrompt: {
    ...serifText,
    fontFamily: fontFamilies.serifItalic,
    fontStyle: 'italic',
    fontSize: 17,
    lineHeight: 26,
    color: colors.textPrimary,
  },
  emptyText: {
    ...serifText,
    fontFamily: fontFamilies.serifItalic,
    fontStyle: 'italic',
    fontSize: 17,
    color: colors.placeholder,
    textAlign: 'center',
    paddingHorizontal: layout.screenPaddingX,
  },
});
