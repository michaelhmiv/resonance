/**
 * Search screen — one search field with Scripture/Library scope toggle.
 *
 * Results render as PassageCards. Tapping "Read in Word" opens the exact
 * Scripture verse or Library book in the reading surface.
 */

import {
  useCallback,
  useEffect,
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
  resolveBibleBookName,
  type PassageHit,
  type SearchScope,
} from '@resonance/core';
import { useDataLayer } from '@resonance/core/data-layer-context';
import { PassageCard, XIcon } from '@resonance/ui';

interface SearchScreenProps {
  onCancel: () => void;
  onOpenScripture: (bookName: string, chapter: number, verse?: number) => void;
  onOpenLibrary?: (bookId: string) => void;
}

const ResultSeparator = () => <View style={styles.separator} />;

export function SearchScreen({
  onCancel,
  onOpenScripture,
  onOpenLibrary,
}: SearchScreenProps): ReactNode {
  const dataLayer = useDataLayer();
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<SearchScope>('scripture');
  const [results, setResults] = useState<PassageHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seqRef = useRef(0);

  // Clean up debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // Android hardware back exits search
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onCancel();
      return true;
    });
    return () => sub.remove();
  }, [onCancel]);

  const runSearch = useCallback(
    async (q: string, s: SearchScope) => {
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
        const hits = await dataLayer.searchPassages(trimmed, s);
        if (seq !== seqRef.current) return; // Discard stale response
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
        void runSearch(text, scope);
      }, 280);
    },
    [scope, runSearch]
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
        void runSearch(query, next);
      }
    },
    [query, runSearch]
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
        onOpenLibrary(hit.book_id);
      }
    },
    [onOpenScripture, onOpenLibrary]
  );

  return (
    <View style={styles.container}>
      {/* ── Search bar ────────────────────────────────────────────── */}
      <View style={styles.searchBar}>
        <View style={styles.inputWrap}>
          <TextInput
            style={styles.input}
            value={query}
            onChangeText={handleChangeText}
            placeholder="Search Scripture and Library…"
            placeholderTextColor={colors.placeholder}
            autoFocus
            returnKeyType="search"
            onSubmitEditing={() => {
              if (debounceRef.current) clearTimeout(debounceRef.current);
              void runSearch(query, scope);
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

      {/* ── Scope toggle ──────────────────────────────────────────── */}
      <View style={styles.scopeRow}>
        {(['scripture', 'library'] as const).map((s) => {
          const active = scope === s;
          const label = s === 'scripture' ? 'Scripture' : 'Library';
          return (
            <Pressable
              key={s}
              onPress={() => handleScopeChange(s)}
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
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* ── Results ───────────────────────────────────────────────── */}
      {loading ? (
        <View style={styles.emptyWrap}>
          <ActivityIndicator color={colors.accentMuted} />
        </View>
      ) : searched && results.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyText}>
            {query.trim().length > 0 ? 'No passages found.' : 'Type to search.'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={results}
          keyExtractor={(item, idx) => `${item.book_id}-${item.id}-${idx}`}
          contentContainerStyle={[listContentContainer, styles.resultsContent]}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item: hit }) => {
            const canOpen =
              (hit.translation != null && hit.chapter != null) ||
              (hit.translation == null && Boolean(hit.book_id) && Boolean(onOpenLibrary));
            return (
              <PassageCard
                text={hit.text}
                source={hit.source}
                onPressRead={canOpen ? () => handleOpenHit(hit) : undefined}
              />
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
    paddingLeft: spacing.lg,
    paddingRight: spacing.sm,
  },
  input: {
    flex: 1,
    fontFamily: fontFamilies.serif,
    fontSize: 17,
    color: colors.textPrimary,
    paddingVertical: spacing.md,
  },
  clearBtn: {
    padding: 6,
  },
  cancelText: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 15,
    color: colors.accent,
  },
  scopeRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: layout.screenPaddingX,
    paddingVertical: spacing.md,
  },
  scopePill: {
    paddingVertical: spacing.xs + 2,
    paddingHorizontal: spacing.lg,
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
    fontSize: 13,
    color: colors.textSecondary,
  },
  scopePillTextActive: {
    color: colors.surface,
  },
  resultsContent: {
    paddingBottom: spacing.xxl,
  },
  separator: {
    height: spacing.md,
  },
  emptyWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    fontFamily: fontFamilies.serifItalic,
    fontStyle: 'italic',
    fontSize: 16,
    color: colors.textTertiary,
  },
});
