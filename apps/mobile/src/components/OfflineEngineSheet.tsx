/**
 * Offline Engine Sheet — calm, non-blocking bottom sheet for downloading
 * Resonance's locked on-device stack (~1.08 GB):
 *   - Voyage-4-Nano INT8 ONNX (411 MB · Hugging Face pinned SHA)
 *   - Qwen3-Reranker-0.6B INT8 Yes/No ONNX (583 MB · Hugging Face pinned SHA)
 *   - 80-Work Library & 512d int8 vectors (~82 MB · GitHub Releases)
 *
 * Never blocks reading or writing: "Not now" dismisses immediately and
 * "Journal while downloading" hides the sheet while downloads continue
 * cleanly in the background.
 */

import { type ReactNode } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, fontFamilies, layout, radii, spacing } from '@resonance/theme';
import { useOfflineEngineStore } from '../packages/offlineEngineManager';
import { formatBytes } from '../db/queries/settingsQueries';

export function OfflineEngineSheet(): ReactNode {
  const {
    sheetVisible,
    phase,
    wifiOnly,
    activeArtifactLabel,
    downloadedBytes,
    totalBytes,
    groups,
    errorMessage,
    setSheetVisible,
    dismissFirstLaunchPrompt,
    setWifiOnly,
    startDownload,
    pauseDownload,
  } = useOfflineEngineStore();

  const pct =
    totalBytes > 0 ? Math.min(100, Math.round((downloadedBytes / totalBytes) * 100)) : 0;

  const isBusy = phase === 'downloading' || phase === 'installing_packs';

  return (
    <Modal
      visible={sheetVisible}
      transparent
      animationType="slide"
      onRequestClose={() => {
        if (isBusy) setSheetVisible(false);
        else void dismissFirstLaunchPrompt();
      }}
    >
      <View style={styles.overlay}>
        <Pressable
          style={styles.backdrop}
          onPress={() => {
            if (isBusy) setSheetVisible(false);
            else void dismissFirstLaunchPrompt();
          }}
        />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scrollContent}
          >
            {/* Header */}
            <View style={styles.headerRow}>
              <Text style={styles.eyebrow}>
                <Text style={styles.goldMark}>✦ </Text>
                OFFLINE RESONANCE ENGINE
              </Text>
              <Pressable
                onPress={() => {
                  if (isBusy) setSheetVisible(false);
                  else void dismissFirstLaunchPrompt();
                }}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="Close"
              >
                <Feather name="x" size={18} color={colors.textTertiary} />
              </Pressable>
            </View>

            {phase === 'ready' ? (
              <>
                <Text style={styles.title}>Ready for private, offline echoes</Text>
                <Text style={styles.subtitle}>
                  Everything is stored on this device. Your writing and your
                  Library never leave your phone.
                </Text>

                <View style={styles.card}>
                  <ComponentRow
                    label="Voyage-4-Nano (512d INT8)"
                    detail="Apache 2.0 · On-device embeddings"
                    done={groups.embedder.ready}
                    sizeText={formatBytes(groups.embedder.totalBytes)}
                  />
                  <View style={styles.divider} />
                  <ComponentRow
                    label="Qwen3-Reranker-0.6B (INT8)"
                    detail="Apache 2.0 · Passage judgment only"
                    done={groups.reranker.ready}
                    sizeText={formatBytes(groups.reranker.totalBytes)}
                  />
                  <View style={styles.divider} />
                  <ComponentRow
                    label="80-Work Library & 512d Vectors"
                    detail="GitHub Releases · Updatable packs"
                    done={groups.corpus.ready}
                    sizeText={formatBytes(groups.corpus.totalBytes)}
                  />
                </View>

                <Pressable
                  onPress={() => setSheetVisible(false)}
                  style={styles.primaryBtn}
                  accessibilityRole="button"
                >
                  <Text style={styles.primaryBtnText}>Return to Journal</Text>
                </Pressable>
              </>
            ) : isBusy || phase === 'paused' ? (
              <>
                <Text style={styles.title}>
                  {phase === 'paused'
                    ? 'Download paused'
                    : phase === 'installing_packs'
                      ? 'Preparing your Library…'
                      : 'Downloading offline engine'}
                </Text>
                <Text style={styles.subtitle}>
                  You can write or read Scripture right now while this finishes
                  quietly in the background.
                </Text>

                {/* Overall progress card */}
                <View style={styles.card}>
                  <View style={styles.progressHeader}>
                    <Text style={styles.progressPct}>{pct}%</Text>
                    <Text style={styles.progressBytes}>
                      {formatBytes(downloadedBytes)} / {formatBytes(totalBytes)}
                    </Text>
                  </View>
                  <View style={styles.progressTrack}>
                    <View style={[styles.progressFill, { width: `${pct}%` }]} />
                  </View>
                  {activeArtifactLabel ? (
                    <View style={styles.activeRow}>
                      {isBusy ? (
                        <ActivityIndicator size="small" color={colors.accent} />
                      ) : null}
                      <Text style={styles.activeLabel} numberOfLines={1}>
                        {activeArtifactLabel}
                      </Text>
                    </View>
                  ) : null}

                  <View style={styles.divider} />
                  <ComponentRow
                    label="Voyage-4-Nano (INT8)"
                    detail={`${formatBytes(groups.embedder.downloadedBytes)} / ${formatBytes(groups.embedder.totalBytes)}`}
                    done={groups.embedder.ready}
                    sizeText={groups.embedder.ready ? 'Done' : ''}
                  />
                  <View style={styles.divider} />
                  <ComponentRow
                    label="Qwen3-Reranker-0.6B (INT8)"
                    detail={`${formatBytes(groups.reranker.downloadedBytes)} / ${formatBytes(groups.reranker.totalBytes)}`}
                    done={groups.reranker.ready}
                    sizeText={groups.reranker.ready ? 'Done' : ''}
                  />
                  <View style={styles.divider} />
                  <ComponentRow
                    label="Library Packs (512d int8)"
                    detail={`${formatBytes(groups.corpus.downloadedBytes)} / ${formatBytes(groups.corpus.totalBytes)}`}
                    done={groups.corpus.ready}
                    sizeText={groups.corpus.ready ? 'Done' : ''}
                  />
                </View>

                <View style={styles.actionStack}>
                  <Pressable
                    onPress={() => setSheetVisible(false)}
                    style={styles.primaryBtn}
                    accessibilityRole="button"
                  >
                    <Text style={styles.primaryBtnText}>Journal while downloading</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      if (phase === 'paused') void startDownload();
                      else void pauseDownload();
                    }}
                    style={styles.secondaryBtn}
                    accessibilityRole="button"
                  >
                    <Text style={styles.secondaryBtnText}>
                      {phase === 'paused' ? 'Resume download' : 'Pause'}
                    </Text>
                  </Pressable>
                </View>
              </>
            ) : (
              <>
                <Text style={styles.title}>Download the offline engine once</Text>
                <Text style={styles.subtitle}>
                  Resonance runs 100% on your phone with zero cloud calls. Download
                  the local models and 80-work Library once ({formatBytes(totalBytes)}),
                  or keep reading Scripture now and set it up later in Settings.
                </Text>

                <View style={styles.card}>
                  <ComponentRow
                    label="Voyage-4-Nano (512d INT8)"
                    detail="Finds echoes across Scripture & Library · Apache 2.0"
                    done={groups.embedder.ready}
                    sizeText="411 MB"
                  />
                  <View style={styles.divider} />
                  <ComponentRow
                    label="Qwen3-Reranker-0.6B (INT8)"
                    detail="Judges passage fit — never writes advice · Apache 2.0"
                    done={groups.reranker.ready}
                    sizeText="583 MB"
                  />
                  <View style={styles.divider} />
                  <ComponentRow
                    label="80-Work Church Library"
                    detail="Pre-embedded 512d int8 vectors · GitHub Releases"
                    done={groups.corpus.ready}
                    sizeText="~82 MB"
                  />
                </View>

                <View style={styles.wifiRow}>
                  <View style={styles.wifiTextWrap}>
                    <Text style={styles.wifiLabel}>Prefer Wi-Fi</Text>
                    <Text style={styles.wifiHint}>
                      {wifiOnly
                        ? 'Recommended for the 1.08 GB one-time download.'
                        : 'Downloading over cellular data may use ~1.08 GB of your plan.'}
                    </Text>
                  </View>
                  <Switch
                    value={wifiOnly}
                    onValueChange={(v) => void setWifiOnly(v)}
                    trackColor={{ false: colors.border, true: colors.accent }}
                    thumbColor={colors.surface}
                  />
                </View>

                {errorMessage ? (
                  <View style={styles.errorBox}>
                    <Text style={styles.errorText}>{errorMessage}</Text>
                  </View>
                ) : null}

                <View style={styles.actionStack}>
                  <Pressable
                    onPress={() => void startDownload({ includeCorpusPacks: true })}
                    style={styles.primaryBtn}
                    accessibilityRole="button"
                  >
                    <Text style={styles.primaryBtnText}>
                      Download now (~1.08 GB)
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => void dismissFirstLaunchPrompt()}
                    style={styles.secondaryBtn}
                    accessibilityRole="button"
                  >
                    <Text style={styles.secondaryBtnText}>
                      Not now — keep reading &amp; writing
                    </Text>
                  </Pressable>
                </View>
              </>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function ComponentRow({
  label,
  detail,
  done,
  sizeText,
}: {
  label: string;
  detail: string;
  done: boolean;
  sizeText: string;
}): ReactNode {
  return (
    <View style={styles.compRow}>
      <View style={styles.compLeft}>
        <View style={styles.compTitleRow}>
          {done ? (
            <Feather name="check-circle" size={14} color={colors.accent} />
          ) : (
            <Feather name="circle" size={14} color={colors.border} />
          )}
          <Text style={styles.compLabel}>{label}</Text>
        </View>
        <Text style={styles.compDetail}>{detail}</Text>
      </View>
      {sizeText ? <Text style={styles.compSize}>{sizeText}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(58, 53, 48, 0.35)',
  },
  backdrop: {
    flex: 1,
  },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    maxHeight: '88%',
    paddingHorizontal: layout.screenPaddingX,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    alignSelf: 'center',
    marginBottom: spacing.md,
  },
  scrollContent: {
    gap: spacing.md,
    paddingBottom: spacing.md,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  eyebrow: {
    fontFamily: fontFamilies.sansSemibold,
    fontSize: 11,
    letterSpacing: 0.9,
    color: colors.textTertiary,
  },
  goldMark: {
    color: colors.resonance,
  },
  title: {
    fontFamily: fontFamilies.serifSemibold,
    fontSize: 24,
    lineHeight: 30,
    color: colors.textPrimary,
  },
  subtitle: {
    fontFamily: fontFamilies.sans,
    fontSize: 14,
    lineHeight: 20,
    color: colors.textSecondary,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: layout.cardPadding,
    gap: spacing.sm,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
  },
  compRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  compLeft: {
    flex: 1,
    gap: 2,
  },
  compTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  compLabel: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 14,
    color: colors.textPrimary,
  },
  compDetail: {
    fontFamily: fontFamilies.sans,
    fontSize: 12,
    color: colors.textTertiary,
    marginLeft: 20,
  },
  compSize: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 12.5,
    color: colors.accent,
  },
  progressHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  progressPct: {
    fontFamily: fontFamilies.serifSemibold,
    fontSize: 22,
    color: colors.textPrimary,
  },
  progressBytes: {
    fontFamily: fontFamilies.sans,
    fontSize: 12.5,
    color: colors.textTertiary,
  },
  progressTrack: {
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.background,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.accent,
  },
  activeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  activeLabel: {
    fontFamily: fontFamilies.sans,
    fontSize: 12.5,
    color: colors.textSecondary,
    flex: 1,
  },
  wifiRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: layout.cardPadding,
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  wifiTextWrap: {
    flex: 1,
    gap: 2,
  },
  wifiLabel: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 14,
    color: colors.textPrimary,
  },
  wifiHint: {
    fontFamily: fontFamilies.sans,
    fontSize: 12,
    lineHeight: 17,
    color: colors.textTertiary,
  },
  errorBox: {
    backgroundColor: '#fdf2f2',
    borderColor: '#e7c6c6',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  errorText: {
    fontFamily: fontFamilies.sans,
    fontSize: 13,
    color: '#8f4444',
  },
  actionStack: {
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  primaryBtn: {
    backgroundColor: colors.accent,
    borderRadius: radii.md,
    paddingVertical: 13,
    alignItems: 'center',
  },
  primaryBtnText: {
    fontFamily: fontFamilies.sansSemibold,
    fontSize: 15,
    color: colors.surface,
  },
  secondaryBtn: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingVertical: 12,
    alignItems: 'center',
  },
  secondaryBtnText: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 14,
    color: colors.textSecondary,
  },
});
