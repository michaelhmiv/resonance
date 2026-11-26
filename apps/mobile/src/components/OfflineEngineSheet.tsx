/**
 * Offline Engine Sheet — calm, non-blocking bottom sheet for downloading
 * Resonance's core on-device engine (~998 MB, one-time):
 *   - Voyage-4-Nano INT8 ONNX (411 MB · Hugging Face pinned SHA)
 *   - Qwen3-Reranker-0.6B INT8 Yes/No ONNX (583 MB · Hugging Face pinned SHA)
 *   - World English Bible 512d int8 vectors (~4 MB · GitHub Releases)
 *
 * Voices of the Church (Church Fathers, Mystics, Reformers, Modern Witnesses)
 * are NOT part of this initial download — users can browse and download
 * individual books or collections anytime in Word → Library → Browse Catalog.
 */

import { type ReactNode } from 'react';
import {
  ActivityIndicator,
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
import { BottomSheetModal } from './BottomSheetModal';

export function OfflineEngineSheet(): ReactNode {
  const sheetVisible = useOfflineEngineStore((s) => s.sheetVisible);
  if (!sheetVisible) return null;
  return <OfflineEngineSheetInner />;
}

function OfflineEngineSheetInner(): ReactNode {
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

  const isBusy = phase === 'downloading';

  const handleClose = () => {
    if (isBusy) setSheetVisible(false);
    else void dismissFirstLaunchPrompt();
  };

  const modalHeader = (
    <View style={styles.headerRow}>
      <Text style={styles.eyebrow}>
        <Text style={styles.goldMark}>✦ </Text>
        OFFLINE RESONANCE ENGINE
      </Text>
      <Pressable
        onPress={handleClose}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel="Close"
        style={({ pressed }) => [styles.closeBtn, pressed && styles.closeBtnPressed]}
      >
        <Feather name="x" size={18} color={colors.textSecondary} />
      </Pressable>
    </View>
  );

  return (
    <BottomSheetModal
      visible={sheetVisible}
      onClose={handleClose}
      height={undefined}
      maxHeight="88%"
      header={modalHeader}
    >
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scrollContent}
          >

            {phase === 'ready' ? (
              <>
                <Text style={styles.title}>Ready for private, offline echoes</Text>
                <Text style={styles.subtitle}>
                  The core engine is installed on this device. Optional Church
                  Library books and collections can be browsed and downloaded
                  individually anytime in Word → Library.
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
                    label="World English Bible vectors"
                    detail="512d int8 · Optional Library packs in Word → Library"
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
                    : 'Downloading offline engine'}
                </Text>
                <Text style={styles.subtitle}>
                  You can write or read Scripture right now while this finishes
                  quietly in the background.
                </Text>

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
                    label="Bible Scripture vectors"
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
                  the core engine once (~{formatBytes(totalBytes)}), or keep reading
                  Scripture now and set it up later in Settings.
                </Text>

                <View style={styles.card}>
                  <ComponentRow
                    label="Voyage-4-Nano (512d INT8)"
                    detail="Finds echoes across Scripture & your books · Apache 2.0"
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
                    label="World English Bible vectors"
                    detail="512d int8 index for Scripture echoes"
                    done={groups.corpus.ready}
                    sizeText="~4 MB"
                  />
                </View>

                <Text style={styles.libraryNote}>
                  Church Fathers, Mystics, Reformers, and other Library packs are
                  optional — browse and pick individual books or collections anytime
                  in Word → Library → Browse Catalog.
                </Text>

                <View style={styles.wifiRow}>
                  <View style={styles.wifiTextWrap}>
                    <Text style={styles.wifiLabel}>Prefer Wi-Fi</Text>
                    <Text style={styles.wifiHint}>
                      {wifiOnly
                        ? 'Recommended for the one-time ~998 MB engine download.'
                        : 'Downloading over cellular data may use ~998 MB of your plan.'}
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
                    onPress={() => void startDownload()}
                    style={styles.primaryBtn}
                    accessibilityRole="button"
                  >
                    <Text style={styles.primaryBtnText}>
                      Download core engine (~998 MB)
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
    </BottomSheetModal>
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
  scrollContent: {
    gap: spacing.md,
    paddingBottom: spacing.md,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: spacing.sm,
  },
  closeBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  closeBtnPressed: {
    opacity: 0.65,
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
  libraryNote: {
    fontFamily: fontFamilies.sans,
    fontSize: 12.5,
    lineHeight: 18,
    color: colors.textTertiary,
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
