/**
 * SearchScreen v2 — unified Hybrid (Keyword + Semantic) Search & Smart Reference Jump.
 *
 * Features:
 *   - Smart Scripture Reference Jump card ("Rom 8:28", "ps 23", "1 cor 13:4-7")
 *   - 4 Scopes: All | Scripture | Library | My Notes
 *   - 3 Modes: Hybrid (RRF) | Exact Keyword | ✦ Meaning (Semantic)
 *   - Exact passage deep-linking for BOTH Scripture AND Library results
 *   - Displays user margin notes & highlight color bar on My Notes hits
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  ActivityIndicator,
  BackHandler,
  FlatList,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  colors,
  fontFamilies,
  layout,
  listContentContainer,
  radii,
  spacing,
} from '@resonance/theme';
import {
  parseReferenceQuery,
  resolveBibleBookName,
  type PassageHit,
  type SearchMode,
  type SearchScope,
} from '@resonance/core';
import { useDataLayer } from '@resonance/core/data-layer-context';
import { PassageCard, SparklesIcon, XIcon } from '@resonance/ui';

interface SearchScreenProps {
  onCancel: () => void;
  onOpenScripture: (bookName: string, chapter: number, verse?: number) => void;
  onOpenLibrary?: (bookId: string, passageId?: number) => void;
}

const ResultSeparator = () => <View style={styles.separator} />;

const SCOPES: Array<{ id: SearchScope; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'scripture', label: 'Scripture' },
  { id: 'library', label: 'Library' },
  { id: 'highlights', label: 'My Notes' },
];

const MODES: Array<{ id: SearchMode; label: string }> = [
  { id: 'hybrid', label: '✦ Hybrid' },
  { id: 'keyword', label: 'Exact' },
  { id: 'semantic', label: 'Meaning' },
];

export function SearchScreen({
  onCancel,
  onOpenScripture,
  onOpenLibrary,
}: SearchScreenProps): ReactNode {
  const dataLayer = useDataLayer();
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<SearchScope>('all');
  const [mode, setMode] = useState<SearchMode>('hybrid');
  const [results, setResults] = useState<PassageHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seqRef = useRef(0);

  const smartJump = useMemo(() => parseReferenceQuery(query), [query]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onCancel();
      return true;
    });
    return () => sub.remove();
  }, [onCancel]);

  const runSearch = useCallback(
    async (q: string, s: SearchScope, m: SearchMode) => {
      const seq = ++seqRef.current;
      const trimmed = q.trim();
      if (trimmed.length === 0) {
        setResults([]);
        setSearched(false);
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        let hits: PassageHit[];
        if (dataLayer.searchPassagesHybrid) {
          hits = await dataLayer.searchPassagesHybrid(trimmed, s, m);
        } else {
          // Graceful fallback for implementations without searchPassagesHybrid
          const fallbackScope = s === 'library' ? 'library' : 'scripture';
          hits = await dataLayer.searchPassages(trimmed, fallbackScope);
        }
        if (seq !== seqRef.current) return;
        setResults(hits);
        setSearched(true);
      } catch {
        if (seq !== seqRef.current) return;
        setResults([]);
        setSearched(true);
      } finally {
        if (seq === seqRef.current) {
          setLoading(false);
        }
      }
    },
    [dataLayer]
  );

  const handleChangeText = useCallback(
    (text: string) => {
      setQuery(text);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (text.trim().length === 0) {
        seqRef.current += 1;
        setResults([]);
        setSearched(false);
        setLoading(false);
        return;
      }
      debounceRef.current = setTimeout(() => {
        void runSearch(text, scope, mode);
      }, 280);
    },
    [scope, mode, runSearch]
  );

  const handleClear = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    seqRef.current += 1;
    setQuery('');
    setResults([]);
    setSearched(false);
    setLoading(false);
  }, []);

  const handleScopeChange = useCallback(
    (next: SearchScope) => {
      setScope(next);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (query.trim().length > 0) {
        void runSearch(query, next, mode);
      }
    },
    [query, mode, runSearch]
  );

  const handleModeChange = useCallback(
    (next: SearchMode) => {
      setMode(next);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (query.trim().length > 0) {
        void runSearch(query, scope, next);
      }
    },
    [query, scope, runSearch]
  );

  const handleOpenHit = useCallback(
    (hit: PassageHit) => {
      if (hit.translation != null && hit.chapter != null) {
        const bookName =
          resolveBibleBookName(hit.book_id) ??
          hit.book_id.replace(/^[A-Za-z]+_/, '').replace(/_/g, ' ');
        onOpenScripture(bookName, hit.chapter, hit.verse_start ?? undefined);
        return;
      }
      if (hit.book_id && onOpenLibrary) {
        onOpenLibrary(hit.book_id, hit.id > 0 ? hit.id : undefined);
      }
    },
    [onOpenScripture, onOpenLibrary]
  );

  const matchBadgeLabel = (kind?: PassageHit['matchKind']): string | null => {
    if (kind === 'highlight') return 'Your Highlight';
    if (kind === 'semantic') return '✦ Meaning match';
    if (kind === 'hybrid') return '✦ Hybrid match';
    return null;
  };

  return (
    <View style={styles.container}>
      {/* ── Search bar ────────────────────────────────────────────── */}
      <View style={styles.searchBar}>
        <View style={styles.inputWrap}>
          <TextInput
            style={styles.input}
            value={query}
            onChangeText={handleChangeText}
            placeholder="Search phrases, concepts, or Rom 8:28…"
            placeholderTextColor={colors.placeholder}
            autoFocus
            returnKeyType="search"
            onSubmitEditing={() => {
              if (debounceRef.current) clearTimeout(debounceRef.current);
              void runSearch(query, scope, mode);
              Keyboard.dismiss();
            }}
          />
          {query.length > 0 ? (
            <Pressable
              onPress={handleClear}
              hitSlop={8}
              style={styles.clearBtn}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
            >
              <XIcon size={15} color={colors.textTertiary} />
            </Pressable>
          ) : null}
        </View>

        <Pressable
          onPress={onCancel}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Cancel search"
        >
          <Text style={styles.cancelText}>Cancel</Text>
        </Pressable>
      </View>

      {/* ── Scope + Mode Controls ─────────────────────────────────── */}
      <View style={styles.controlsBlock}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.pillRow}
        >
          {SCOPES.map((s) => {
            const active = scope === s.id;
            return (
              <Pressable
                key={s.id}
                onPress={() => handleScopeChange(s.id)}
                style={[styles.scopePill, active && styles.scopePillActive]}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
              >
                <Text
                  style={[
                    styles.scopePillText,
                    active && styles.scopePillTextActive,
                  ]}
                >
                  {s.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <View style={styles.modeRow}>
          {MODES.map((m) => {
            const active = mode === m.id;
            return (
              <Pressable
                key={m.id}
                onPress={() => handleModeChange(m.id)}
                style={[styles.modeChip, active && styles.modeChipActive]}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
              >
                <Text
                  style={[styles.modeChipText, active && styles.modeChipTextActive]}
                >
                  {m.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* ── Smart Reference Jump Card ─────────────────────────────── */}
      {smartJump ? (
        <View style={styles.jumpWrap}>
          <Pressable
            onPress={() =>
              onOpenScripture(
                smartJump.bookName,
                smartJump.chapter,
                smartJump.verseStart
              )
            }
            style={styles.jumpCard}
            accessibilityRole="button"
            accessibilityLabel={`Jump directly to ${smartJump.label}`}
          >
            <View style={styles.jumpLeft}>
              <Text style={styles.jumpEyebrow}>Jump to Scripture</Text>
              <Text style={styles.jumpTitle}>{smartJump.label}</Text>
            </View>
            <Text style={styles.jumpAction}>Open →</Text>
          </Pressable>
        </View>
      ) : null}

      {/* ── Results ───────────────────────────────────────────────── */}
      {loading ? (
        <View style={styles.emptyWrap}>
          <ActivityIndicator color={colors.accentMuted} />
        </View>
      ) : searched && results.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyText}>
            {query.trim().length > 0
              ? 'No passages found. Try switching to Meaning search.'
              : 'Type a phrase, concept, or Scripture reference.'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={results}
          keyExtractor={(item, idx) =>
            `${item.book_id}-${item.id}-${item.highlightId ?? idx}`
          }
          contentContainerStyle={[listContentContainer, styles.resultsContent]}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item: hit }) => {
            const canOpen =
              (hit.translation != null && hit.chapter != null) ||
              (hit.translation == null && Boolean(hit.book_id) && Boolean(onOpenLibrary));
            const badge = matchBadgeLabel(hit.matchKind);

            return (
              <View style={styles.hitWrap}>
                {badge ? (
                  <View style={styles.badgeRow}>
                    <SparklesIcon size={11} color={colors.accent} />
                    <Text style={styles.badgeText}>{badge}</Text>
                  </View>
                ) : null}
                <PassageCard
                  text={hit.text}
                  source={hit.source}
                  onPressRead={canOpen ? () => handleOpenHit(hit) : undefined}
                />
                {hit.highlightNote ? (
                  <View
                    style={[
                      styles.noteStrip,
                      hit.highlightColor
                        ? { borderLeftColor: hit.highlightColor }
                        : null,
                    ]}
                  >
                    <Text style={styles.noteStripText}>
                      Note: {hit.highlightNote}
                    </Text>
                  </View>
                ) : null}
              </View>
            );
          }}
          ItemSeparatorComponent={ResultSeparator}
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
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: layout.screenPaddingX,
    paddingTop: spacing.md,
  },
  inputWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    paddingLeft: spacing.md,
    paddingRight: spacing.sm,
  },
  input: {
    flex: 1,
    fontFamily: fontFamilies.serif,
    fontSize: 16.5,
    color: colors.textPrimary,
    paddingVertical: spacing.sm + 3,
  },
  clearBtn: {
    padding: 6,
  },
  cancelText: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 15,
    color: colors.accent,
  },
  controlsBlock: {
    gap: spacing.xs + 2,
    paddingTop: spacing.sm + 2,
    paddingBottom: spacing.sm,
  },
  pillRow: {
    flexDirection: 'row',
    gap: spacing.xs + 2,
    paddingHorizontal: layout.screenPaddingX,
  },
  scopePill: {
    paddingVertical: 6,
    paddingHorizontal: 13,
    borderRadius: radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  scopePillActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  scopePillText: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 12.5,
    color: colors.textSecondary,
  },
  scopePillTextActive: {
    color: colors.surface,
  },
  modeRow: {
    flexDirection: 'row',
    gap: spacing.xs + 2,
    paddingHorizontal: layout.screenPaddingX,
  },
  modeChip: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: radii.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  modeChipActive: {
    borderColor: colors.accent,
    backgroundColor: '#f5efe6',
  },
  modeChipText: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 11.5,
    color: colors.textTertiary,
  },
  modeChipTextActive: {
    color: colors.accent,
  },
  jumpWrap: {
    paddingHorizontal: layout.screenPaddingX,
    paddingBottom: spacing.sm,
  },
  jumpCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#f6f1e7',
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.accentMuted,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  jumpLeft: {
    gap: 1,
  },
  jumpEyebrow: {
    fontFamily: fontFamilies.sansSemibold,
    fontSize: 10.5,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: colors.textTertiary,
  },
  jumpTitle: {
    fontFamily: fontFamilies.serifSemibold,
    fontSize: 18,
    color: colors.textPrimary,
  },
  jumpAction: {
    fontFamily: fontFamilies.sansSemibold,
    fontSize: 13.5,
    color: colors.accent,
  },
  resultsContent: {
    paddingBottom: spacing.xxl,
  },
  separator: {
    height: spacing.md,
  },
  hitWrap: {
    gap: 4,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingLeft: 4,
  },
  badgeText: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 11,
    color: colors.accent,
  },
  noteStrip: {
    marginLeft: spacing.md,
    borderLeftWidth: 2.5,
    borderLeftColor: colors.accentMuted,
    paddingLeft: spacing.sm,
    paddingVertical: 3,
  },
  noteStripText: {
    fontFamily: fontFamilies.serifItalic,
    fontStyle: 'italic',
    fontSize: 14,
    color: colors.textSecondary,
  },
  emptyWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
  },
  emptyText: {
    fontFamily: fontFamilies.serifItalic,
    fontStyle: 'italic',
    fontSize: 16,
    color: colors.textTertiary,
    textAlign: 'center',
  },
});
