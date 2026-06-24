/**
 * CollapsibleCrossRefs — a lazy inline cross-reference marker.
 *
 * Shows a small superscript [N] (count of refs for this verse). On first
 * tap, lazily loads cross-refs via getCrossReferencesBatch. Expands inline
 * with clickable refs styled as ↳ John 3:16. Each ref navigates via onPress.
 *
 * (design spec §6.3: cross-references as quiet, expandable marginal notes)
 */

import { useCallback, useState, type ReactNode } from 'react';
import { Pressable, Text, View, StyleSheet, ActivityIndicator } from 'react-native';
import { colors, fontFamilies, spacing } from '@resonance/theme';

interface CollapsibleCrossRefsProps {
  verseRef: string;
  /** Batch loader — returns a map of verseRef → ref list */
  loadRefs: (refs: string[]) => Promise<Record<string, string[]>>;
  /** Preloaded refs cache — if the key exists, skip the load call */
  cache?: Record<string, string[]>;
  onPress?: (ref: string) => void;
}

export function CollapsibleCrossRefs({
  verseRef,
  loadRefs,
  cache = {},
  onPress,
}: CollapsibleCrossRefsProps): ReactNode {
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [localRefs, setLocalRefs] = useState<string[] | null>(null);

  const refs: string[] = localRefs ?? cache[verseRef] ?? [];

  const handleToggle = useCallback(async () => {
    if (expanded) {
      setExpanded(false);
      return;
    }
    // Expand — load if we don't have data yet
    setExpanded(true);
    if (refs.length > 0) return; // Already have data (from cache)
    setLoading(true);
    try {
      const result = await loadRefs([verseRef]);
      setLocalRefs(result[verseRef] ?? []);
    } catch {
      setLocalRefs([]);
    } finally {
      setLoading(false);
    }
  }, [expanded, verseRef, refs.length, loadRefs]);

  const refCount = refs.length > 0 ? refs.length : '...';

  return (
    <View style={styles.container}>
      <Pressable
        onPress={handleToggle}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={
          expanded ? 'Collapse cross-references' : `Show ${refCount} cross-references`
        }
      >
        <Text style={[styles.marker, expanded && styles.markerActive]}>
          [{refCount}]
        </Text>
      </Pressable>

      {expanded && (
        <View style={styles.refList}>
          {loading ? (
            <ActivityIndicator size="small" color={colors.accentMuted} />
          ) : refs.length === 0 ? (
            <Text style={styles.emptyText}>No cross-references found.</Text>
          ) : (
            refs.map((ref) => (
              <Pressable
                key={ref}
                onPress={() => onPress?.(ref)}
                hitSlop={6}
                disabled={!onPress}
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
}

const styles = StyleSheet.create({
  container: {
    marginTop: spacing.xs,
    paddingLeft: spacing.xs,
  },
  marker: {
    fontFamily: fontFamilies.sans,
    fontSize: 13,
    color: colors.accentMuted,
    letterSpacing: 0.3,
  },
  markerActive: {
    color: colors.accent,
    fontFamily: fontFamilies.sansSemibold,
  },
  refList: {
    paddingLeft: spacing.md,
    marginTop: spacing.xs,
    gap: 2,
  },
  link: {
    fontFamily: fontFamilies.sans,
    fontSize: 12,
    color: colors.accentMuted,
    letterSpacing: 0.2,
  },
  emptyText: {
    fontFamily: fontFamilies.sans,
    fontSize: 12,
    fontStyle: 'italic',
    color: colors.textTertiary,
  },
});
