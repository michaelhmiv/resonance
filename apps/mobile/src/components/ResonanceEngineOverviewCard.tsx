/**
 * ResonanceEngineOverviewCard — top-of-Settings live status dashboard that
 * eliminates every bit of guesswork about:
 *   1. Whether embeddings, reranking, and diary media are currently running
 *      On-Device vs via OpenRouter Cloud (or Hybrid).
 *   2. Which vector space is active (Shared Voyage-4 512d vs Custom model).
 *   3. Exactly what is ALREADY embedded (pre-embedded `.rvec` packs + SQLite
 *      local/cloud vectors) vs what still needs embedding.
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
import { colors, fontFamilies, radii, spacing } from '@resonance/theme';
import {
  formatShortModelName,
  getIndexCoverageReport,
  type EngineBadgeKind,
  type IndexCoverageReport,
  type ScopeCoverageStatus,
} from '../openrouter/indexStatusService';
import { modelSupportsMultimodalEmbeddings } from '@resonance/core';
import { useOpenRouterStore } from '../openrouter/openrouterStore';
import { useOfflineEngineStore } from '../packages/offlineEngineManager';
import { usePersonalLibraryStore } from '../personal/personalLibraryService';
import { useReembedStore } from '../openrouter/reembedService';

interface Props {
  onOpenReembedSheet: (modelId: string) => void;
}

function EnginePill({
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

  const loadReport = useCallback(async () => {
    setRefreshing(true);
    try {
      const next = await getIndexCoverageReport();
      setReport(next);
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

  return (
    <View style={styles.wrapper}>
      <View style={styles.headerRow}>
        <Text style={styles.sectionTitle}>Active Engine & Index Status</Text>
        <Pressable
          onPress={() => void loadReport()}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Refresh index status"
        >
          {refreshing ? (
            <ActivityIndicator size="small" color={colors.accent} />
          ) : (
            <Feather name="refresh-cw" size={14} color={colors.textSecondary} />
          )}
        </Pressable>
      </View>
      <Text style={styles.sectionDesc}>
        Live summary of whether each feature is running On-Device or via OpenRouter, and
        exactly which libraries are already embedded for your active model.
      </Text>

      <View style={styles.card}>
        {!pipeline ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : (
          <>
            {/* 1. Overall Active Mode Banner */}
            <View style={styles.topModeRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.modeHeading}>Current Mode</Text>
                <Text style={styles.modeSub}>
                  Active space:{' '}
                  <Text style={styles.monoStrong}>
                    {pipeline.isVoyage4Space
                      ? 'Voyage-4 Shared (512d)'
                      : formatShortModelName(pipeline.activeSearchModel)}
                  </Text>
                </Text>
              </View>
              <EnginePill
                kind={pipeline.overallMode}
                text={pipeline.overallLabel}
              />
            </View>

            <View style={styles.divider} />

            {/* 2. Where Each Task Runs Right Now */}
            <View style={styles.pipelineBlock}>
              <Text style={styles.subHeader}>Where each task runs right now</Text>
              <View style={styles.pipelineRow}>
                <Text style={styles.pipelineLabel}>Books & Search</Text>
                <EnginePill
                  kind={pipeline.booksEngine}
                  text={
                    pipeline.booksEngine === 'cloud'
                      ? `OpenRouter · ${formatShortModelName(pipeline.booksModel)}`
                      : pipeline.booksEngine === 'local'
                        ? 'On-Device · Voyage-4-Nano'
                        : 'Download Offline Engine'
                  }
                />
              </View>
              <View style={styles.pipelineRow}>
                <Text style={styles.pipelineLabel}>Journal & Echoes</Text>
                <EnginePill
                  kind={pipeline.journalEngine}
                  text={
                    pipeline.journalEngine === 'cloud'
                      ? `OpenRouter · ${formatShortModelName(pipeline.journalModel)}`
                      : pipeline.journalEngine === 'local'
                        ? 'On-Device · Voyage-4-Nano'
                        : 'Download Offline Engine'
                  }
                />
              </View>
              <View style={styles.pipelineRow}>
                <Text style={styles.pipelineLabel}>Neural Reranker</Text>
                <EnginePill
                  kind={pipeline.rerankerEngine}
                  text={
                    pipeline.rerankerEngine === 'cloud'
                      ? `OpenRouter · ${formatShortModelName(pipeline.rerankerModel)}`
                      : pipeline.rerankerEngine === 'local'
                        ? 'On-Device · Qwen3-0.6B'
                        : 'Off · Dense only'
                  }
                />
              </View>
              <View style={styles.pipelineRow}>
                <Text style={styles.pipelineLabel}>Life Diary Media</Text>
                <EnginePill kind={pipeline.diaryEngine} text={pipeline.diaryDetail} />
              </View>
            </View>

            <View style={styles.divider} />

            {/* 3. Vector Space Compatibility Explainer */}
            <View
              style={[
                styles.spaceCallout,
                pipeline.isVoyage4Space
                  ? styles.spaceCalloutShared
                  : styles.spaceCalloutCustom,
              ]}
            >
              <Feather
                name={pipeline.isVoyage4Space ? 'check-circle' : 'alert-triangle'}
                size={15}
                color={pipeline.isVoyage4Space ? '#3f734e' : '#9c6419'}
              />
              <View style={{ flex: 1, gap: 6 }}>
                <Text style={styles.spaceCalloutText}>
                  {pipeline.isVoyage4Space
                    ? 'Shared Voyage-4 Space: Pre-embedded Bible & Church packs work right away with zero re-embedding, and On-Device + OpenRouter Voyage-4 vectors mix seamlessly.'
                    : `Custom Vector Space (${formatShortModelName(pipeline.activeSearchModel)}): Pre-embedded Voyage-4 packs cannot be mixed with this model. Only items marked green below are searchable until re-embedded. Your Voyage-4 packs stay safe if you switch back.`}
                </Text>
                {pipeline.diaryEngine === 'cloud' ? (
                  <Text style={styles.multimodalNote}>
                    {modelSupportsMultimodalEmbeddings(pipeline.activeSearchModel)
                      ? `Multimodal indexing: Native pixel + text vectors via ${formatShortModelName(pipeline.activeSearchModel)} (photos are embedded directly as images + text).`
                      : 'Multimodal indexing: Voice, Photos & Videos do NOT require a Google/multimodal embedder — Whisper & Gemini Vision turn speech, scenes, and OCR into text first, which works with Voyage-4 or any embedder. Switching to Gemini Embedding 2 or Cohere Embed 5 is optional if you also want raw image pixels embedded directly.'}
                  </Text>
                ) : null}
              </View>
            </View>

            <View style={styles.divider} />

            {/* 4. Live Index Coverage Across All 5 Corpora */}
            <View style={styles.coverageBlock}>
              <Text style={styles.subHeader}>
                What&apos;s already embedded in your active space
              </Text>
              {report.scopes.map((scope) => (
                <View key={scope.scope} style={styles.scopeRow}>
                  <StatusDot status={scope.status} />
                  <View style={{ flex: 1 }}>
                    <View style={styles.scopeTopLine}>
                      <Text style={styles.scopeLabel}>{scope.label}</Text>
                      <Text style={styles.scopeCount}>{scope.countLabel}</Text>
                    </View>
                    <View style={styles.scopeBottomLine}>
                      <EnginePill kind={scope.sourceKind} text={scope.sourceBadge} />
                    </View>
                    {scope.status !== 'ready' && scope.status !== 'empty' ? (
                      <Text style={styles.scopeDetail}>{scope.detail}</Text>
                    ) : null}
                  </View>
                </View>
              ))}

              {/* Contextual One-Tap Action */}
              {!pipeline.isVoyage4Space &&
              report.totalMissingInActiveSpace > 0 &&
              hasKey ? (
                <Pressable
                  onPress={() => onOpenReembedSheet(pipeline.activeSearchModel)}
                  style={styles.ctaBtn}
                >
                  <Feather name="layers" size={14} color="#ffffff" />
                  <Text style={styles.ctaBtnText}>
                    Re-embed missing items for{' '}
                    {formatShortModelName(pipeline.activeSearchModel)}
                  </Text>
                </Pressable>
              ) : pipeline.isVoyage4Space && !report.biblePreembeddedReady ? (
                <Pressable
                  onPress={() => setEngineSheetVisible(true)}
                  style={styles.ctaBtnSecondary}
                >
                  <Feather name="download" size={14} color={colors.accent} />
                  <Text style={styles.ctaBtnSecondaryText}>
                    Download pre-embedded Bible pack (~4 MB · free)
                  </Text>
                </Pressable>
              ) : null}
            </View>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    marginBottom: spacing.xl,
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
  sectionDesc: {
    fontFamily: fontFamilies.sans,
    fontSize: 13,
    lineHeight: 19,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  loadingBox: {
    padding: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
  },
  topModeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    padding: spacing.md,
  },
  modeHeading: {
    fontFamily: fontFamilies.sansSemibold,
    fontSize: 15,
    color: colors.textPrimary,
  },
  modeSub: {
    fontFamily: fontFamilies.sans,
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  monoStrong: {
    fontFamily: fontFamilies.sansSemibold,
    color: colors.textPrimary,
  },
  subHeader: {
    fontFamily: fontFamilies.sansSemibold,
    fontSize: 11,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.textTertiary,
    marginBottom: spacing.xs,
  },
  pipelineBlock: {
    padding: spacing.md,
    gap: 8,
  },
  pipelineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  pipelineLabel: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 13,
    color: colors.textPrimary,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: '66%',
  },
  pillText: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 11.5,
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
  spaceCallout: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
    padding: spacing.md,
  },
  spaceCalloutShared: {
    backgroundColor: '#f3f8f4',
  },
  spaceCalloutCustom: {
    backgroundColor: '#fbf5e9',
  },
  spaceCalloutText: {
    fontFamily: fontFamilies.sans,
    fontSize: 12.5,
    lineHeight: 18,
    color: colors.textPrimary,
  },
  multimodalNote: {
    fontFamily: fontFamilies.sans,
    fontSize: 12,
    lineHeight: 17,
    color: colors.textSecondary,
  },
  coverageBlock: {
    padding: spacing.md,
    gap: 12,
  },
  scopeRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 5,
  },
  scopeTopLine: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: spacing.xs,
  },
  scopeLabel: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 13.5,
    color: colors.textPrimary,
  },
  scopeCount: {
    fontFamily: fontFamilies.sans,
    fontSize: 12,
    color: colors.textSecondary,
  },
  scopeBottomLine: {
    flexDirection: 'row',
    marginTop: 4,
  },
  scopeDetail: {
    fontFamily: fontFamilies.sans,
    fontSize: 11.5,
    lineHeight: 16,
    color: colors.textSecondary,
    marginTop: 4,
  },
  ctaBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    marginTop: 4,
    paddingVertical: 11,
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
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
    borderRadius: radii.sm,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  ctaBtnSecondaryText: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 13,
    color: colors.accent,
  },
});
