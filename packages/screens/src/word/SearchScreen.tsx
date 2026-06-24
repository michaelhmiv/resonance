/**
 * Search screen — one search field with Scripture/Library scope toggle.
 *
 * Results render as PassageCards. Tapping "Read in Word" opens the
 * passage in the reading surface.
 *
 * (design spec §6.4: search — one field, scope toggles, passage cards)
 */

import {
  useCallback,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  Keyboard,
} from 'react-native';

import {
  colors,
  fontFamilies,
  layout,
  listContentContainer,
  radii,
  spacing,
} from '@resonance/theme';
import { type SearchScope, type PassageHit } from '@resonance/core';
import { useDataLayer } from '@resonance/core/data-layer-context';
import { PassageCard } from '@resonance/ui';

interface SearchScreenProps {
  onCancel: () => void;
  onOpenScripture: (bookName: string, chapter: number) => void;
  onOpenLibrary?: (bookId: string) => void;
}

export function SearchScreen({
  onCancel,
  onOpenScripture,
  onOpenLibrary,
}: SearchScreenProps): ReactNode {
  const dataLayer = useDataLayer();
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<SearchScope>('scripture');
  const [results, setResults] = useState<PassageHit[]>([]);
  const [searched, setSearched] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runSearch = useCallback(
    async (q: string, s: SearchScope) => {
      if (q.trim().length === 0) {
        setResults([]);
        setSearched(false);
        return;
      }
      const hits = await dataLayer.searchPassages(q, s);
      setResults(hits);
      setSearched(true);
    },
    [dataLayer]
  );

  const handleChangeText = useCallback(
    (text: string) => {
      setQuery(text);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        void runSearch(text, scope);
      }, 300);
    },
    [scope, runSearch]
  );

  const handleScopeChange = useCallback(
    (next: SearchScope) => {
      setScope(next);
      void runSearch(query, next);
    },
    [query, runSearch]
  );

  const handleOpenHit = useCallback(
    (hit: PassageHit) => {
      // Scripture hits: navigate to book + chapter
      if (hit.translation != null && hit.chapter != null) {
        const bookName = hit.book_id
          .replace(/^[A-Z]+_/, '')
          .replace(/_/g, ' ');
        onOpenScripture(bookName, hit.chapter);
        return;
      }
      // Library hits: open library reading surface
      if (hit.translation == null && onOpenLibrary) {
        onOpenLibrary(hit.book_id);
      }
    },
    [onOpenScripture, onOpenLibrary]
  );

  return (
    <View style={styles.container}>
      {/* ── Search bar ────────────────────────────────────────────── */}
      <View style={styles.searchBar}>
        <TextInput
          style={styles.input}
          value={query}
          onChangeText={handleChangeText}
          placeholder="Search Scripture and Library…"
          placeholderTextColor={colors.placeholder}
          autoFocus
          returnKeyType="search"
          onSubmitEditing={() => {
            void runSearch(query, scope);
            Keyboard.dismiss();
          }}
        />
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
      {searched && results.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyText}>
            {query.trim().length > 0
              ? 'No passages found.'
              : 'Type to search.'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={results}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={listContentContainer}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item: hit }) => (
            <PassageCard
              text={hit.text}
              source={hit.source}
              onPressRead={
                hit.translation != null
                  ? () => handleOpenHit(hit)
                  : undefined
              }
            />
          )}
          ItemSeparatorComponent={() => (
            <View style={{ height: spacing.md }} />
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
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: layout.screenPaddingX,
    paddingTop: spacing.md,
  },
  input: {
    flex: 1,
    fontFamily: fontFamilies.serif,
    fontSize: 17,
    color: colors.textPrimary,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
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
