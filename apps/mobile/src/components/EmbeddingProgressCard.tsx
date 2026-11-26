/**
 * EmbeddingProgressCard — dedicated live progress indicator for on-device
 * Voyage-4-Nano passage embedding.
 *
 * Renders immediately whenever:
 *   - The ONNX model is loading into memory (`loading_model`)
 *   - Passages are actively being embedded (`embedding`) with live chunk count,
 *     percentage bar, book queue position (`Book 1 of 3`), and Pause control
 *   - An error occurred (`error`) with the real diagnostic reason + Retry button
 *   - Books are waiting on the Offline Engine download (`waiting_engine`)
 */

import { type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, fontFamilies, radii, spacing } from '@resonance/theme';
import { usePersonalLibraryStore } from '../personal/personalLibraryService';
import { useOfflineEngineStore } from '../packages/offlineEngineManager';

interface EmbeddingProgressCardProps {
  /** Optional compact styling when pinned inside a modal header/banner. */
  compact?: boolean;
  /** Optional extra container style (only applied when the card is visible). */
  style?: ViewStyle;
  /** Optional callback when user taps "Download Engine" from the card. */
  onOpenEngineSheet?: () => void;
}

export function EmbeddingProgressCard({
  compact = false,
  style,
  onOpenEngineSheet,
}: EmbeddingProgressCardProps): ReactNode {
  const embeddingProgress = usePersonalLibraryStore((s) => s.embeddingProgress);
  const works = usePersonalLibraryStore((s) => s.works);
  const pauseEmbeddingQueue = usePersonalLibraryStore((s) => s.pauseEmbeddingQueue);
  const processEmbeddingQueue = usePersonalLibraryStore((s) => s.processEmbeddingQueue);
  const clearEmbeddingError = usePersonalLibraryStore((s) => s.clearEmbeddingError);

  const embedderReady = useOfflineEngineStore(
    (s) => s.phase === 'ready' || s.groups.embedder.ready
  );
  const enginePhase = useOfflineEngineStore((s) => s.phase);
  const setEngineSheetVisible = useOfflineEngineStore((s) => s.setSheetVisible);

  const pendingWorks = works.filter(
    (w) =>
      w.totalChunks > 0 &&
      !w.ocrRequired &&
      (w.embeddingStatus === 'pending' || w.embeddingStatus === 'embedding')
  );

  // 1. Active model load
  if (embeddingProgress?.phase === 'loading_model') {
    const queueLabel =
      embeddingProgress.queueTotal > 1
        ? `Book 1 of ${embeddingProgress.queueTotal}`
        : embeddingProgress.bookTitle ?? 'Personal Library';
    return (
      <View style={[styles.card, compact && styles.cardCompact, style]}>
        <View style={styles.topRow}>
          <ActivityIndicator size="small" color={colors.accent} />
          <View style={styles.flexOne}>
            <Text style={styles.title} numberOfLines={1}>
              Loading Voyage-4-Nano embedder…
            </Text>
            <Text style={styles.sub} numberOfLines={1}>
              {queueLabel} · Preparing on-device ONNX runtime
            </Text>
          </View>
          <Pressable
            onPress={() => pauseEmbeddingQueue()}
            style={styles.actionBtn}
            accessibilityRole="button"
            accessibilityLabel="Pause embedding"
          >
            <Text style={styles.actionBtnText}>Pause</Text>
          </Pressable>
        </View>
        <View style={styles.track}>
          <View style={[styles.fill, styles.fillLoading]} />
        </View>
        <Text style={styles.caption}>
          First load takes a few seconds · runs 100% locally in background
        </Text>
      </View>
    );
  }

  // 2. Actively embedding passages
  if (embeddingProgress?.phase === 'embedding') {
    const total = Math.max(1, embeddingProgress.totalChunks);
    const done = Math.min(total, embeddingProgress.embeddedChunks);
    const pct = Math.min(100, Math.round((done / total) * 100));
    const fillPct = Math.max(3, pct);

    return (
      <View style={[styles.card, compact && styles.cardCompact, style]}>
        <View style={styles.topRow}>
          <ActivityIndicator size="small" color={colors.accent} />
          <View style={styles.flexOne}>
            <Text style={styles.title} numberOfLines={1}>
              Embedding &ldquo;{embeddingProgress.bookTitle ?? 'Book'}&rdquo;
            </Text>
            <Text style={styles.sub} numberOfLines={1}>
              {done} / {total} passages ({pct}%)
              {embeddingProgress.queueTotal > 1
                ? ` · Book ${embeddingProgress.queueIndex} of ${embeddingProgress.queueTotal}`
                : ''}
            </Text>
          </View>
          <Pressable
            onPress={() => pauseEmbeddingQueue()}
            style={styles.actionBtn}
            accessibilityRole="button"
            accessibilityLabel="Pause embedding"
          >
            <Text style={styles.actionBtnText}>Pause</Text>
          </Pressable>
        </View>
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${fillPct}%` }]} />
        </View>
        <Text style={styles.caption}>
          Voyage-4-Nano 512d on-device · continues in background if closed
        </Text>
      </View>
    );
  }

  // 3. Diagnostic error state (never silent!)
  if (embeddingProgress?.phase === 'error') {
    return (
      <View style={[styles.card, styles.errorCard, compact && styles.cardCompact, style]}>
        <View style={styles.topRow}>
          <Feather name="alert-circle" size={16} color="#a85c5c" />
          <View style={styles.flexOne}>
            <Text style={[styles.title, styles.errorTitle]} numberOfLines={1}>
              Embedding paused
              {embeddingProgress.bookTitle
                ? ` · ${embeddingProgress.bookTitle}`
                : ''}
            </Text>
            <Text style={styles.errorBody}>
              {embeddingProgress.error ??
                'On-device embedding could not complete.'}
            </Text>
          </View>
        </View>
        <View style={styles.errorActions}>
          <Pressable
            onPress={() =>
              void processEmbeddingQueue({ force: true, retryErrors: true })
            }
            style={styles.retryBtn}
            accessibilityRole="button"
            accessibilityLabel="Retry embedding"
          >
            <Feather name="refresh-cw" size={12} color={colors.surface} />
            <Text style={styles.retryBtnText}>Retry</Text>
          </Pressable>
          <Pressable
            onPress={() => clearEmbeddingError()}
            style={styles.actionBtn}
            accessibilityRole="button"
            accessibilityLabel="Dismiss error"
          >
            <Text style={styles.actionBtnText}>Dismiss</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // 4. Queued works waiting on Offline Engine download
  if (!embedderReady && pendingWorks.length > 0) {
    return (
      <View style={[styles.card, compact && styles.cardCompact, style]}>
        <View style={styles.topRow}>
          <Feather name="cpu" size={15} color={colors.accent} />
          <View style={styles.flexOne}>
            <Text style={styles.title} numberOfLines={1}>
              {pendingWorks.length} book{pendingWorks.length === 1 ? '' : 's'} queued
              to embed
            </Text>
            <Text style={styles.sub} numberOfLines={2}>
              {enginePhase === 'downloading'
                ? 'Offline Engine is downloading — embedding will start automatically once ready.'
                : 'Download the Offline Engine to embed books locally for echoes and semantic search.'}
            </Text>
          </View>
          <Pressable
            onPress={() => {
              onOpenEngineSheet?.();
              setEngineSheetVisible(true);
            }}
            style={styles.actionBtn}
            accessibilityRole="button"
            accessibilityLabel="Open Offline Engine"
          >
            <Text style={styles.actionBtnText}>
              {enginePhase === 'downloading' ? 'View' : 'Download'}
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#f5f1e8',
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    gap: 8,
  },
  cardCompact: {
    borderRadius: 0,
    borderLeftWidth: 0,
    borderRightWidth: 0,
    borderTopWidth: 0,
  },
  errorCard: {
    backgroundColor: '#fbf2ef',
    borderColor: '#e3c4bc',
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  flexOne: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontFamily: fontFamilies.sansSemibold,
    fontSize: 13,
    color: colors.textPrimary,
  },
  sub: {
    fontFamily: fontFamilies.sans,
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 1,
  },
  track: {
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.border,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 3,
    backgroundColor: colors.accent,
  },
  fillLoading: {
    width: '28%',
    opacity: 0.7,
  },
  caption: {
    fontFamily: fontFamilies.sans,
    fontSize: 11,
    color: colors.textTertiary,
  },
  actionBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radii.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  actionBtnText: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 12,
    color: colors.textSecondary,
  },
  errorTitle: {
    color: '#a85c5c',
  },
  errorBody: {
    fontFamily: fontFamilies.sans,
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
    lineHeight: 17,
  },
  errorActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radii.sm,
    backgroundColor: colors.accent,
  },
  retryBtnText: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 12,
    color: colors.surface,
  },
});
