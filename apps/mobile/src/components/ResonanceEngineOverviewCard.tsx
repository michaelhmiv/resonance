/**
 * ResonanceEngineOverviewCard — compact, calm top-of-Settings status card.
 *
 * Shows in one glance:
 *   - Active mode (`OpenRouter Cloud` / `Hybrid` / `On-Device`)
 *   - Active embedder, reranker, and Life Diary summary
 *   - A collapsible `Index Coverage` drawer (auto-collapsed to 1 summary line
 *     when everything is ready; auto-expanded only when something needs action,
 *     like re-embedding for a custom model or downloading the free Bible pack).
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { modelSupportsMultimodalEmbeddings } from '@resonance/core';
import { colors, fontFamilies, radii, spacing } from '@resonance/theme';
import {
  formatShortModelName,
  getIndexCoverageReport,
  type EngineBadgeKind,
  type IndexCoverageReport,
  type ScopeCoverageStatus,
} from '../openrouter/indexStatusService';
import { useOpenRouterStore } from '../openrouter/openrouterStore';
import { useOfflineEngineStore } from '../packages/offlineEngineManager';
import { usePersonalLibraryStore } from '../personal/personalLibraryService';
import { useReembedStore } from '../openrouter/reembedService';

interface Props {
  onOpenReembedSheet: (modelId: string) => void;
}

function ModePill({
  kind,
  text,
}: {
  kind: EngineBadgeKind;
  text: string;
}): ReactNode {
  const pillStyle =
    kind === 'cloud'
      ? styles.pillCloud
      : kind === 'preembedded'
        ? styles.pillPreembedded
        : kind === 'local'
          ? styles.pillLocal
          : kind === 'hybrid'
            ? styles.pillHybrid
            : styles.pillOff;
  const textStyle =
    kind === 'cloud'
      ? styles.pillCloudText
      : kind === 'preembedded'
        ? styles.pillPreembeddedText
        : kind === 'local'
          ? styles.pillLocalText
          : kind === 'hybrid'
            ? styles.pillHybridText
            : styles.pillOffText;
  const iconName: React.ComponentProps<typeof Feather>['name'] =
    kind === 'cloud'
      ? 'cloud'
      : kind === 'preembedded'
        ? 'package'
        : kind === 'local'
          ? 'smartphone'
          : kind === 'hybrid'
            ? 'layers'
            : 'minus-circle';

  return (
    <View style={[styles.pill, pillStyle]}>
      <Feather name={iconName} size={11} color={textStyle.color} />
      <Text style={[styles.pillText, textStyle]} numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}

function StatusDot({ status }: { status: ScopeCoverageStatus }): ReactNode {
  const bg =
    status === 'ready'
      ? '#3f734e'
      : status === 'partial'
        ? '#c07a28'
        : status === 'missing'
          ? '#b85449'
          : '#b7afa1';
  return <View style={[styles.statusDot, { backgroundColor: bg }]} />;
}

export function ResonanceEngineOverviewCard({
  onOpenReembedSheet,
}: Props): ReactNode {
  const hasKey = useOpenRouterStore((s) => s.hasKey);
  const routingMode = useOpenRouterStore((s) => s.routingMode);
  const features = useOpenRouterStore((s) => s.features);
  const embeddingModel = useOpenRouterStore((s) => s.embeddingModel);
  const rerankerModel = useOpenRouterStore((s) => s.rerankerModel);
  const transcriptionModel = useOpenRouterStore((s) => s.transcriptionModel);
  const visionModel = useOpenRouterStore((s) => s.visionModel);
  const creditsExhausted = useOpenRouterStore((s) => s.creditsExhausted);

  const offlinePhase = useOfflineEngineStore((s) => s.phase);
  const rerankerPhase = useOfflineEngineStore((s) => s.rerankerPhase);
  const installedWorkIds = useOfflineEngineStore((s) => s.installedWorkIds);
  const setEngineSheetVisible = useOfflineEngineStore((s) => s.setSheetVisible);

  const libraryRevision = usePersonalLibraryStore((s) => s.libraryRevision);
  const reembedRunning = useReembedStore((s) => s.running);
  const reembedCompleted = useReembedStore((s) => s.completed);

  const [report, setReport] = useState<IndexCoverageReport | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [coverageOpen, setCoverageOpen] = useState(false);

  const loadReport = useCallback(async () => {
    setRefreshing(true);
    try {
      const next = await getIndexCoverageReport();
      setReport(next);
      // Auto-expand only if custom space needs re-embedding
      if (next.customSpaceNeedsInitialReembed) {
        setCoverageOpen(true);
      }
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadReport();
  }, [
    loadReport,
    hasKey,
    routingMode,
    features,
    embeddingModel,
    rerankerModel,
    transcriptionModel,
    visionModel,
    creditsExhausted,
    offlinePhase,
    rerankerPhase,
    installedWorkIds.length,
    libraryRevision,
    reembedRunning,
    reembedCompleted,
  ]);

  const pipeline = report?.pipeline;
  const needsAction = Boolean(
    report &&
      ((!report.pipeline.isVoyage4Space && report.totalMissingInActiveSpace > 0 && hasKey) ||
        (report.pipeline.isVoyage4Space && !report.biblePreembeddedReady))
  );

  const readyScopes = (report?.scopes ?? []).filter((s) => s.status === 'ready');
  const summaryLine =
    !report
      ? 'Checking index…'
      : needsAction
        ? !report.pipeline.isVoyage4Space
          ? `${report.totalMissingInActiveSpace.toLocaleString()} items need re-embedding for ${formatShortModelName(report.pipeline.activeSearchModel)}`
          : 'Pre-embedded Bible pack not downloaded yet'
        : readyScopes.length > 0
          ? `${readyScopes.map((s) => s.label.split(' ')[0]).join(', ')} ready`
          : 'Ready';

  return (
    <View style={styles.wrapper}>
      <View style={styles.headerRow}>
        <Text style={styles.sectionTitle}>Resonance Engine</Text>
        <Pressable
          onPress={() => void loadReport()}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Refresh engine status"
        >
          {refreshing ? (
            <ActivityIndicator size="small" color={colors.accent} />
          ) : (
            <Feather name="refresh-cw" size={13} color={colors.textTertiary} />
          )}
        </Pressable>
      </View>

      <View style={styles.card}>
        {!pipeline ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : (
          <>
            {/* Compact 1-glance summary */}
            <View style={styles.topRow}>
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={styles.activeModelLine} numberOfLines={1}>
                  {pipeline.booksEngine === 'cloud'
                    ? formatShortModelName(pipeline.booksModel)
                    : pipeline.booksEngine === 'local'
                      ? 'Voyage-4-Nano (512d)'
                      : 'Embedder not downloaded'}
                  {pipeline.rerankerEngine !== 'off'
                    ? ` · ${formatShortModelName(pipeline.rerankerModel)}`
                    : ''}
                </Text>
                <Text style={styles.subLine} numberOfLines={1}>
                  {pipeline.isVoyage4Space
                    ? 'Voyage-4 shared space (zero re-embed)'
                    : 'Custom vector space'}
                  {pipeline.diaryEngine === 'cloud' ? ' · Life Diary active' : ''}
                </Text>
              </View>
              <ModePill kind={pipeline.overallMode} text={pipeline.overallLabel} />
            </View>

            <View style={styles.divider} />

            {/* Collapsible Index Coverage Row */}
            <Pressable
              onPress={() => setCoverageOpen((v) => !v)}
              style={styles.accordionHeader}
              accessibilityRole="button"
            >
              <StatusDot status={needsAction ? 'partial' : 'ready'} />
              <View style={{ flex: 1 }}>
                <Text style={styles.accordionTitle}>Index Coverage</Text>
                <Text style={styles.accordionSub} numberOfLines={1}>
                  {summaryLine}
                </Text>
              </View>
              <Feather
                name={coverageOpen ? 'chevron-up' : 'chevron-down'}
                size={16}
                color={colors.textTertiary}
              />
            </Pressable>

            {coverageOpen ? (
              <View style={styles.expandedBody}>
                <View style={styles.divider} />

                {/* Concise Vector Space & Multimodal note */}
                <View style={styles.noteBox}>
                  <Text style={styles.noteText}>
                    {pipeline.isVoyage4Space
                      ? 'Shared Voyage-4 Space: Pre-embedded Bible & Church packs work out of the box with zero API cost, and On-Device + OpenRouter Voyage-4 vectors mix seamlessly.'
                      : `Custom Space (${formatShortModelName(pipeline.activeSearchModel)}): Pre-embedded Voyage-4 packs stay safe if you switch back, but won't mix with this model until re-embedded.`}
                  </Text>
                  {pipeline.diaryEngine === 'cloud' ? (
                    <Text style={styles.noteSub}>
                      {modelSupportsMultimodalEmbeddings(pipeline.activeSearchModel)
                        ? `Multimodal: Photos embed directly as pixels + text via ${formatShortModelName(pipeline.activeSearchModel)}.`
                        : 'Multimodal: Voice, Photos & Videos work with any embedder via Whisper & Gemini Vision (Google/multimodal embedder is optional for direct pixel vectors).'}
                    </Text>
                  ) : null}
                </View>

                <View style={styles.divider} />

                {/* 5-Scope Coverage Rows */}
                <View style={styles.scopesList}>
                  {report.scopes.map((scope) => (
                    <View key={scope.scope} style={styles.scopeRow}>
                      <StatusDot status={scope.status} />
                      <View style={{ flex: 1 }}>
                        <View style={styles.scopeTopLine}>
                          <Text style={styles.scopeLabel}>{scope.label}</Text>
                          <Text style={styles.scopeCount}>{scope.countLabel}</Text>
                        </View>
                        <Text style={styles.scopeSource}>{scope.sourceBadge}</Text>
                      </View>
                    </View>
                  ))}

                  {!pipeline.isVoyage4Space &&
                  report.totalMissingInActiveSpace > 0 &&
                  hasKey ? (
                    <Pressable
                      onPress={() => onOpenReembedSheet(pipeline.activeSearchModel)}
                      style={styles.ctaBtn}
                    >
                      <Feather name="layers" size={14} color="#ffffff" />
                      <Text style={styles.ctaBtnText}>
                        Re-embed for {formatShortModelName(pipeline.activeSearchModel)}
                      </Text>
                    </Pressable>
                  ) : pipeline.isVoyage4Space && !report.biblePreembeddedReady ? (
                    <Pressable
                      onPress={() => setEngineSheetVisible(true)}
                      style={styles.ctaBtnSecondary}
                    >
                      <Feather name="download" size={14} color={colors.accent} />
                      <Text style={styles.ctaBtnSecondaryText}>
                        Download pre-embedded Bible pack (~4 MB)
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            ) : null}
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    marginBottom: spacing.lg,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  sectionTitle: {
    fontFamily: fontFamilies.sansSemibold,
    fontSize: 12,
    letterSpacing: 0.9,
    textTransform: 'uppercase',
    color: colors.textTertiary,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  loadingBox: {
    padding: spacing.lg,
    alignItems: 'center',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    padding: spacing.md,
  },
  activeModelLine: {
    fontFamily: fontFamilies.sansSemibold,
    fontSize: 14,
    color: colors.textPrimary,
  },
  subLine: {
    fontFamily: fontFamilies.sans,
    fontSize: 12,
    color: colors.textSecondary,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  pillText: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 11,
  },
  pillCloud: {
    backgroundColor: '#edf5ef',
    borderColor: '#bdd7c4',
  },
  pillCloudText: {
    color: '#2f603d',
  },
  pillPreembedded: {
    backgroundColor: '#f3eee2',
    borderColor: '#dad0bc',
  },
  pillPreembeddedText: {
    color: '#6b532f',
  },
  pillLocal: {
    backgroundColor: '#eef2f6',
    borderColor: '#cad5e0',
  },
  pillLocalText: {
    color: '#34506b',
  },
  pillHybrid: {
    backgroundColor: '#faf3e6',
    borderColor: '#e2cca3',
  },
  pillHybridText: {
    color: '#80561b',
  },
  pillOff: {
    backgroundColor: colors.background,
    borderColor: colors.border,
  },
  pillOffText: {
    color: colors.textTertiary,
  },
  accordionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
  },
  accordionTitle: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 13.5,
    color: colors.textPrimary,
  },
  accordionSub: {
    fontFamily: fontFamilies.sans,
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 1,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  expandedBody: {
    backgroundColor: colors.background,
  },
  noteBox: {
    padding: spacing.md,
    gap: 5,
  },
  noteText: {
    fontFamily: fontFamilies.sans,
    fontSize: 12,
    lineHeight: 17,
    color: colors.textPrimary,
  },
  noteSub: {
    fontFamily: fontFamilies.sans,
    fontSize: 11.5,
    lineHeight: 16,
    color: colors.textSecondary,
  },
  scopesList: {
    padding: spacing.md,
    gap: 10,
  },
  scopeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  scopeTopLine: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: spacing.xs,
  },
  scopeLabel: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 13,
    color: colors.textPrimary,
  },
  scopeCount: {
    fontFamily: fontFamilies.sans,
    fontSize: 12,
    color: colors.textSecondary,
  },
  scopeSource: {
    fontFamily: fontFamilies.sans,
    fontSize: 11.5,
    color: colors.textTertiary,
    marginTop: 1,
  },
  ctaBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    marginTop: 4,
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
    borderRadius: radii.sm,
    backgroundColor: colors.accent,
  },
  ctaBtnText: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 13,
    color: '#ffffff',
  },
  ctaBtnSecondary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    marginTop: 4,
    paddingVertical: 9,
    paddingHorizontal: spacing.md,
    borderRadius: radii.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  ctaBtnSecondaryText: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 13,
    color: colors.accent,
  },
});
