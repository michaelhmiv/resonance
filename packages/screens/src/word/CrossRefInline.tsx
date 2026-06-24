/**
 * CrossRefInline — compact inline cross-reference marker.
 *
 * Shows [N] pinned right after the verse text. Tap to expand
 * the ref list inline. Much tighter than the old block-level version.
 * Only renders if the verse has cross-references.
 */

import { useCallback, useState, type ReactNode } from 'react';
import { Pressable, Text, View, StyleSheet, ActivityIndicator } from 'react-native';
import { colors, fontFamilies, spacing } from '@resonance/theme';

interface CrossRefInlineProps {
  verseRef: string;
  cache: Record<string, string[]>;
  loadRefs: (refs: string[]) => Promise<Record<string, string[]>>;
  onNavigate: (ref: string) => void;
}

export function CrossRefInline({
  verseRef,
  cache,
  loadRefs,
  onNavigate,
}: CrossRefInlineProps): ReactNode {
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [localRefs, setLocalRefs] = useState<string[] | null>(null);

  const refs = localRefs ?? cache[verseRef];
  const hasRefs = refs != null;
  const refCount = hasRefs ? refs.length : undefined;

  // Don't render anything if no refs and nothing loaded
  if (!hasRefs && localRefs === null && !cache[verseRef]) return null;
  // If we loaded and got empty, show nothing
  if (hasRefs && refs.length === 0) return null;

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

  return (
    <View style={styles.inline}>
      {/* Marker — sits right after verse text */}
      <Text style={styles.text}>
        {' '}
        <Text
          style={[styles.marker, expanded && styles.markerActive]}
          onPress={handleToggle}
        >
          [{refCount ?? '...'}]
        </Text>
      </Text>

      {/* Expanded ref list — appears below when tapped */}
      {expanded && (
        <View style={styles.refList}>
          {loading ? (
            <ActivityIndicator size="small" color={colors.accentMuted} />
          ) : hasRefs ? (
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
          ) : (
            <Text style={styles.empty}>None found.</Text>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  inline: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    gap: 0,
  },
  text: {
    // inherit from parent
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
    paddingLeft: spacing.md,
    marginTop: spacing.xs,
    gap: 2,
  },
  refRow: {
    paddingVertical: 1,
  },
  link: {
    fontFamily: fontFamilies.sans,
    fontSize: 12,
    color: colors.accentMuted,
    letterSpacing: 0.2,
  },
  empty: {
    fontFamily: fontFamilies.sans,
    fontSize: 12,
    fontStyle: 'italic',
    color: colors.textTertiary,
  },
});
