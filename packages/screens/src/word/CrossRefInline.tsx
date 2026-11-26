/**
 * CrossRefInline — compact inline cross-reference marker.
 *
 * Shows [N] after the verse text. Tap to expand the ref list inline.
 * Only renders if the verse has cross-references.
 */

import { memo, useCallback, useEffect, useState, type ReactNode } from 'react';
import { Pressable, Text, View, StyleSheet, ActivityIndicator } from 'react-native';
import { colors, fontFamilies, spacing } from '@resonance/theme';

interface CrossRefInlineProps {
  verseRef: string;
  refs?: string[];
  loadRefs: (refs: string[]) => Promise<Record<string, string[]>>;
  onNavigate: (ref: string) => void;
}

export const CrossRefInline = memo(function CrossRefInline({
  verseRef,
  refs: cachedRefs,
  loadRefs,
  onNavigate,
}: CrossRefInlineProps): ReactNode {
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [localRefs, setLocalRefs] = useState<string[] | null>(null);

  useEffect(() => {
    setExpanded(false);
    setLocalRefs(null);
  }, [verseRef]);

  const refs = localRefs ?? cachedRefs;
  const hasRefs = refs != null;
  const refCount = hasRefs ? refs.length : undefined;

  const handleToggle = useCallback(async () => {
    if (expanded) {
      setExpanded(false);
      return;
    }
    setExpanded(true);
    if (hasRefs) return;
    setLoading(true);
    try {
      const result = await loadRefs([verseRef]);
      setLocalRefs(result[verseRef] ?? []);
    } catch {
      setLocalRefs([]);
    } finally {
      setLoading(false);
    }
  }, [expanded, verseRef, hasRefs, loadRefs]);

  if (!hasRefs || refs.length === 0) return null;

  return (
    <View style={styles.inline}>
      <Pressable
        onPress={handleToggle}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={`${expanded ? 'Hide' : 'Show'} ${refCount} cross-references`}
      >
        <Text style={[styles.marker, expanded && styles.markerActive]}>
          [{refCount}]
        </Text>
      </Pressable>

      {expanded && (
        <View style={styles.refList}>
          {loading ? (
            <ActivityIndicator size="small" color={colors.accentMuted} />
          ) : (
            refs.map((ref) => (
              <Pressable
                key={ref}
                onPress={() => onNavigate(ref)}
                hitSlop={4}
                style={styles.refRow}
                accessibilityRole="link"
              >
                <Text style={styles.link}>↳ {ref}</Text>
              </Pressable>
            ))
          )}
        </View>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  inline: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    marginLeft: 28,
    marginTop: 2,
  },
  marker: {
    fontFamily: fontFamilies.sans,
    fontSize: 12,
    color: colors.accentMuted,
    letterSpacing: 0.3,
  },
  markerActive: {
    color: colors.accent,
    fontFamily: fontFamilies.sansSemibold,
  },
  refList: {
    width: '100%',
    paddingLeft: spacing.sm,
    marginTop: spacing.xs,
    gap: 4,
  },
  refRow: {
    paddingVertical: 2,
  },
  link: {
    fontFamily: fontFamilies.sans,
    fontSize: 12.5,
    color: colors.accent,
    letterSpacing: 0.2,
  },
});
