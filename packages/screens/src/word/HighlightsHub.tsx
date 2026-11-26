/**
 * HighlightsHub — the Commonplace Book for all highlights & margin notes
 * across Scripture, Church Classics, and Personal Library works.
 *
 * Features:
 *   - Search across quoted phrases, margin notes, references, and #tags
 *   - Color meaning filter chips (Insight / Practice / Question / Theology)
 *   - Dynamic #tag filter row
 *   - 1-tap jump straight into the exact book, chapter, or verse
 *   - 1-tap Markdown export/share for your commonplace book
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  FlatList,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  colors,
  fontFamilies,
  highlightColorMeta,
  layout,
  listContentContainer,
  radii,
  spacing,
  withAlpha,
} from '@resonance/theme';
import {
  formatHighlightsMarkdown,
  resolveBibleBookName,
  type Highlight,
} from '@resonance/core';
import { useDataLayer } from '@resonance/core/data-layer-context';
import { ChevronLeftIcon, CopyIcon, SparklesIcon, XIcon } from '@resonance/ui';

export interface HighlightsHubProps {
  onBack: () => void;
  onOpenScripture: (bookName: string, chapter: number, verse?: number) => void;
  onOpenLibrary: (bookId: string, passageId?: number) => void;
}

const RowSep = () => <View style={styles.sep} />;

export function HighlightsHub({
  onBack,
  onOpenScripture,
  onOpenLibrary,
}: HighlightsHubProps): ReactNode {
  const dataLayer = useDataLayer();
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [colorFilter, setColorFilter] = useState<string | null>(null);
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [exportedFeedback, setExportedFeedback] = useState(false);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onBack();
      return true;
    });
    return () => sub.remove();
  }, [onBack]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const load = async () => {
      try {
        const list = dataLayer.getAllHighlights
          ? await dataLayer.getAllHighlights()
          : [];
        if (!cancelled) {
          setHighlights(list);
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setHighlights([]);
          setLoading(false);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [dataLayer]);

  const allTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const h of highlights) {
      for (const t of h.tags ?? []) {
        counts.set(t, (counts.get(t) ?? 0) + 1);
      }
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([tag]) => tag);
  }, [highlights]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return highlights.filter((h) => {
      if (colorFilter && h.color !== colorFilter) return false;
      if (tagFilter && !(h.tags ?? []).includes(tagFilter)) return false;
      if (q.length > 0) {
        const hay = `${h.selected_text ?? ''} ${h.note_text ?? ''} ${h.verse_ref} ${(h.tags ?? []).join(' ')}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [highlights, colorFilter, tagFilter, query]);

  const handleOpenHighlight = useCallback(
    (hl: Highlight) => {
      const refMatch = /^(.+?)\s+(\d+):(\d+)/.exec(hl.verse_ref);
      if (refMatch) {
        const canonical = resolveBibleBookName(refMatch[1].trim());
        if (canonical) {
          onOpenScripture(
            canonical,
            parseInt(refMatch[2], 10),
            parseInt(refMatch[3], 10)
          );
          return;
        }
      }
      if (hl.book_id) {
        const pidNum = /^\d+$/.test(hl.verse_ref) ? parseInt(hl.verse_ref, 10) : undefined;
        onOpenLibrary(hl.book_id, pidNum);
      }
    },
    [onOpenScripture, onOpenLibrary]
  );

  const handleExportMarkdown = useCallback(async () => {
    const md = formatHighlightsMarkdown(filtered);
    if (!md) return;
    if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(md);
        setExportedFeedback(true);
        setTimeout(() => setExportedFeedback(false), 2000);
        return;
      } catch {
        // fall through
      }
    }
    try {
      await Share.share({ message: md, title: 'Resonance Commonplace Book' });
      setExportedFeedback(true);
      setTimeout(() => setExportedFeedback(false), 2000);
    } catch {
      // dismissed
    }
  }, [filtered]);

  return (
    <View style={styles.container}>
      {/* Top Bar */}
      <View style={styles.header}>
        <Pressable onPress={onBack} hitSlop={8} style={styles.backBtn} accessibilityRole="button">
          <ChevronLeftIcon size={18} color={colors.accent} />
          <Text style={styles.backText}>Word</Text>
        </Pressable>

        <Text style={styles.headerTitle}>Commonplace Book</Text>

        <Pressable
          onPress={() => void handleExportMarkdown()}
          disabled={filtered.length === 0}
          hitSlop={8}
          style={[styles.exportBtn, filtered.length === 0 && styles.disabled]}
          accessibilityRole="button"
          accessibilityLabel="Export highlights as Markdown"
        >
          <CopyIcon size={15} color={colors.accent} />
          <Text style={styles.exportText}>
            {exportedFeedback ? 'Exported' : 'Export'}
          </Text>
        </Pressable>
      </View>

      {/* Search & Filters */}
      <View style={styles.filtersWrap}>
        <View style={styles.searchBox}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Filter highlights, notes, or #tags…"
            placeholderTextColor={colors.placeholder}
            style={styles.searchInput}
          />
          {query.length > 0 ? (
            <Pressable onPress={() => setQuery('')} hitSlop={8}>
              <XIcon size={14} color={colors.textTertiary} />
            </Pressable>
          ) : null}
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipsRow}
        >
          <Pressable
            onPress={() => setColorFilter(null)}
            style={[styles.chip, !colorFilter && styles.chipActive]}
          >
            <Text style={[styles.chipText, !colorFilter && styles.chipTextActive]}>
              All ({highlights.length})
            </Text>
          </Pressable>
          {highlightColorMeta.map((c) => {
            const active = colorFilter === c.color;
            return (
              <Pressable
                key={c.color}
                onPress={() => setColorFilter(active ? null : c.color)}
                style={[
                  styles.chip,
                  active && {
                    borderColor: c.color,
                    backgroundColor: withAlpha(c.color, 0.25),
                  },
                ]}
              >
                <View style={[styles.dot, { backgroundColor: c.color }]} />
                <Text style={styles.chipText}>{c.meaning}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {allTags.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipsRow}
          >
            {allTags.map((t) => {
              const active = tagFilter === t;
              return (
                <Pressable
                  key={t}
                  onPress={() => setTagFilter(active ? null : t)}
                  style={[styles.tagChip, active && styles.chipActive]}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>
                    #{t}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        ) : null}
      </View>

      {/* List */}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accentMuted} />
        </View>
      ) : filtered.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyTitle}>
            {highlights.length === 0 ? 'Your commonplace book is quiet.' : 'No matching marks.'}
          </Text>
          <Text style={styles.emptyBody}>
            {highlights.length === 0
              ? 'Tap any verse or paragraph while reading to highlight phrases, write margin notes, and feed them into Resonance.'
              : 'Try clearing a filter or search term.'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[listContentContainer, styles.listContent]}
          ItemSeparatorComponent={RowSep}
          renderItem={({ item: hl }) => (
            <Pressable
              onPress={() => handleOpenHighlight(hl)}
              style={[styles.card, { borderLeftColor: hl.color }]}
            >
              <View style={styles.cardHeader}>
                <Text style={styles.cardRef} numberOfLines={1}>
                  {hl.verse_ref}
                </Text>
                {hl.embedded_at ? (
                  <View style={styles.embeddedBadge}>
                    <SparklesIcon size={11} color={colors.accent} />
                    <Text style={styles.embeddedText}>In Resonance</Text>
                  </View>
                ) : null}
              </View>

              {hl.selected_text ? (
                <Text style={styles.cardQuote}>“{hl.selected_text}”</Text>
              ) : null}

              {hl.note_text ? (
                <View style={styles.noteBox}>
                  <Text style={styles.cardNote}>{hl.note_text}</Text>
                </View>
              ) : null}

              {hl.tags && hl.tags.length > 0 ? (
                <View style={styles.cardTags}>
                  {hl.tags.map((t) => (
                    <Text key={t} style={styles.cardTagText}>
                      #{t}
                    </Text>
                  ))}
                </View>
              ) : null}
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    minWidth: 68,
  },
  backText: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 14,
    color: colors.accent,
  },
  headerTitle: {
    fontFamily: fontFamilies.serifSemibold,
    fontSize: 18.5,
    color: colors.textPrimary,
  },
  exportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radii.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  exportText: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 12,
    color: colors.accent,
  },
  disabled: {
    opacity: 0.4,
  },
  filtersWrap: {
    paddingHorizontal: layout.screenPaddingX,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    gap: spacing.xs + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
  },
  searchInput: {
    flex: 1,
    fontFamily: fontFamilies.serif,
    fontSize: 16,
    color: colors.textPrimary,
    paddingVertical: 9,
  },
  chipsRow: {
    flexDirection: 'row',
    gap: 6,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  tagChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  chipText: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 12,
    color: colors.textSecondary,
  },
  chipTextActive: {
    color: colors.surface,
  },
  dot: {
    width: 9,
    height: 9,
    borderRadius: 5,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    gap: spacing.sm,
  },
  emptyTitle: {
    fontFamily: fontFamilies.serifSemibold,
    fontSize: 19,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  emptyBody: {
    fontFamily: fontFamilies.serif,
    fontSize: 15.5,
    lineHeight: 22,
    color: colors.textTertiary,
    textAlign: 'center',
  },
  listContent: {
    paddingTop: spacing.md,
    paddingBottom: spacing.xxl,
  },
  sep: {
    height: spacing.sm + 2,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderLeftWidth: 3.5,
    padding: spacing.md,
    gap: 8,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  cardRef: {
    flex: 1,
    fontFamily: fontFamilies.sansSemibold,
    fontSize: 11.5,
    color: colors.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  embeddedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  embeddedText: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 10.5,
    color: colors.accent,
  },
  cardQuote: {
    fontFamily: fontFamilies.serif,
    fontSize: 16.5,
    lineHeight: 24,
    color: colors.textPrimary,
  },
  noteBox: {
    borderLeftWidth: 2,
    borderLeftColor: colors.accentMuted,
    paddingLeft: spacing.sm,
  },
  cardNote: {
    fontFamily: fontFamilies.serifItalic,
    fontStyle: 'italic',
    fontSize: 14.5,
    lineHeight: 20,
    color: colors.textSecondary,
  },
  cardTags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  cardTagText: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 11.5,
    color: colors.accent,
  },
});
