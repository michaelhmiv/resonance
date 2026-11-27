/**
 * DiaryMediaCard — warm cream-paper inline card rendered inside JournalScreen
 * for Voice notes, Photos, and Videos.
 *
 * Design rules (locked via /grill-me):
 *  - Voice notes stay as tactile audio cards with editable verbatim transcript underneath.
 *  - Photos & Videos display user's own caption + People chips upfront, while AI
 *    scene summary & handwritten OCR live in a collapsible, editable "Memory details" drawer.
 *  - Supports tapping People chips to filter, adding people with autocomplete,
 *    full-screen photo lightbox, inline `expo-video` playback, and `✦ Echoes`.
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { VideoView, useVideoPlayer } from 'expo-video';
import type { DiaryMediaItem, DiaryPerson } from '@resonance/core';
import { colors, fontFamilies, radii, spacing } from '@resonance/theme';
import {
  buildDiarySearchableText,
  useDiaryMediaStore,
} from '../diary/diaryMediaService';

interface Props {
  item: DiaryMediaItem;
  onSelectPerson?: (person: DiaryPerson) => void;
  onTriggerEchoes?: (queryText: string) => void;
}

function formatDurationSec(ms: number | null): string {
  if (ms == null || ms <= 0) return '0:00';
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatTimeShort(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
}

// ── Inline Audio Player Strip ───────────────────────────────────────────────

function VoicePlayerStrip({
  uri,
  durationMs,
}: {
  uri: string;
  durationMs: number | null;
}): ReactNode {
  const player = useAudioPlayer(uri);
  const status = useAudioPlayerStatus(player);

  const totalSec = status.duration > 0 ? status.duration : (durationMs ?? 0) / 1000;
  const currentSec = status.currentTime ?? 0;
  const pct = totalSec > 0 ? Math.min(100, Math.round((currentSec / totalSec) * 100)) : 0;

  const togglePlay = useCallback(() => {
    if (status.playing) {
      player.pause();
    } else {
      if (totalSec > 0 && currentSec >= totalSec - 0.2) {
        void player.seekTo(0);
      }
      player.play();
    }
  }, [player, status.playing, currentSec, totalSec]);

  return (
    <View style={styles.audioRow}>
      <Pressable
        onPress={togglePlay}
        style={styles.playCircle}
        accessibilityRole="button"
        accessibilityLabel={status.playing ? 'Pause voice note' : 'Play voice note'}
      >
        <Feather
          name={status.playing ? 'pause' : 'play'}
          size={16}
          color="#ffffff"
        />
      </Pressable>
      <View style={styles.audioTrackWrap}>
        <View style={styles.audioTrack}>
          <View style={[styles.audioFill, { width: `${pct}%` }]} />
        </View>
        <View style={styles.audioTimeRow}>
          <Text style={styles.audioTime}>
            {formatDurationSec(currentSec * 1000)}
          </Text>
          <Text style={styles.audioTime}>
            {formatDurationSec(totalSec * 1000)}
          </Text>
        </View>
      </View>
    </View>
  );
}

// ── Inline Video Player ─────────────────────────────────────────────────────

function InlineVideoPlayer({ uri }: { uri: string }): ReactNode {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = false;
    p.play();
  });

  return (
    <View style={styles.videoPlayerBox}>
      <VideoView
        player={player}
        style={styles.videoView}
        nativeControls
        contentFit="contain"
      />
    </View>
  );
}

// ── Main Card ───────────────────────────────────────────────────────────────

export function DiaryMediaCard({
  item,
  onSelectPerson,
  onTriggerEchoes,
}: Props): ReactNode {
  const updateMediaFields = useDiaryMediaStore((s) => s.updateMediaFields);
  const addPersonToMedia = useDiaryMediaStore((s) => s.addPersonToMedia);
  const removePersonFromMedia = useDiaryMediaStore((s) => s.removePersonFromMedia);
  const deleteMediaMemory = useDiaryMediaStore((s) => s.deleteMediaMemory);
  const retryMediaProcessing = useDiaryMediaStore((s) => s.retryMediaProcessing);
  const allPeople = useDiaryMediaStore((s) => s.people);

  const [captionDraft, setCaptionDraft] = useState(item.caption ?? '');
  const [transcriptDraft, setTranscriptDraft] = useState(item.transcript ?? '');
  const [summaryDraft, setSummaryDraft] = useState(item.aiSummary ?? '');
  const [ocrDraft, setOcrDraft] = useState(item.ocrText ?? '');
  const [locationDraft, setLocationDraft] = useState(item.locationLabel ?? '');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [playingVideo, setPlayingVideo] = useState(false);
  const [personModalOpen, setPersonModalOpen] = useState(false);
  const [personQuery, setPersonQuery] = useState('');

  useEffect(() => {
    setCaptionDraft(item.caption ?? '');
    setTranscriptDraft(item.transcript ?? '');
    setSummaryDraft(item.aiSummary ?? '');
    setOcrDraft(item.ocrText ?? '');
    setLocationDraft(item.locationLabel ?? '');
  }, [item.caption, item.transcript, item.aiSummary, item.ocrText, item.locationLabel]);

  const handleSaveCaption = useCallback(() => {
    const trimmed = captionDraft.trim();
    if (trimmed !== (item.caption ?? '')) {
      void updateMediaFields(item.id, { caption: trimmed || null });
    }
  }, [captionDraft, item.caption, item.id, updateMediaFields]);

  const handleSaveTranscript = useCallback(() => {
    const trimmed = transcriptDraft.trim();
    if (trimmed !== (item.transcript ?? '')) {
      void updateMediaFields(item.id, { transcript: trimmed || null });
    }
  }, [transcriptDraft, item.transcript, item.id, updateMediaFields]);

  const handleSaveMemoryDetails = useCallback(() => {
    void updateMediaFields(item.id, {
      aiSummary: summaryDraft.trim() || null,
      ocrText: ocrDraft.trim() || null,
      locationLabel: locationDraft.trim() || null,
    });
  }, [item.id, summaryDraft, ocrDraft, locationDraft, updateMediaFields]);

  const handleAddPerson = useCallback(
    async (name: string) => {
      const cleaned = name.trim();
      if (!cleaned) return;
      await addPersonToMedia(item.id, cleaned);
      setPersonQuery('');
      setPersonModalOpen(false);
    },
    [addPersonToMedia, item.id]
  );

  const handleDelete = useCallback(() => {
    Alert.alert(
      'Delete memory?',
      'This removes the media file and its journal card from your device.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => void deleteMediaMemory(item.id),
        },
      ]
    );
  }, [deleteMediaMemory, item.id]);

  const echoText = buildDiarySearchableText(item);
  const hasMemoryDetails = Boolean(
    item.aiSummary || item.ocrText || item.locationLabel || (item.kind === 'video' && item.transcript)
  );

  const suggestedPeople = allPeople.filter((p) => {
    const already = item.people.some((linked) => linked.id === p.id);
    if (already) return false;
    const q = personQuery.trim().toLowerCase();
    return !q || p.name.toLowerCase().includes(q);
  });

  return (
    <View style={styles.card}>
      {/* Top quiet meta bar */}
      <View style={styles.headerRow}>
        <View style={styles.kindRow}>
          <Feather
            name={
              item.kind === 'voice'
                ? 'mic'
                : item.kind === 'photo'
                  ? 'camera'
                  : 'video'
            }
            size={13}
            color={colors.accent}
          />
          <Text style={styles.kindLabel}>
            {item.kind === 'voice'
              ? 'Voice note'
              : item.kind === 'photo'
                ? 'Photo'
                : 'Video'}{' '}
            · {formatTimeShort(item.capturedAt)}
          </Text>
          {item.locationLabel ? (
            <Text style={styles.locationText} numberOfLines={1}>
              · {item.locationLabel}
            </Text>
          ) : null}
        </View>
        <View style={styles.headerActions}>
          {echoText.length >= 12 && onTriggerEchoes ? (
            <Pressable
              onPress={() => onTriggerEchoes(echoText)}
              style={styles.echoBtn}
              hitSlop={8}
            >
              <Text style={styles.echoBtnText}>✦ Echoes</Text>
            </Pressable>
          ) : null}
          <Pressable onPress={handleDelete} hitSlop={10}>
            <Feather name="trash-2" size={14} color={colors.textTertiary} />
          </Pressable>
        </View>
      </View>

      {/* Modality body */}
      {item.kind === 'voice' ? (
        <>
          <VoicePlayerStrip uri={item.localUri} durationMs={item.durationMs} />
          <TextInput
            value={transcriptDraft}
            onChangeText={setTranscriptDraft}
            onBlur={handleSaveTranscript}
            multiline
            placeholder={
              item.processingStatus === 'processing'
                ? 'Transcribing voice note…'
                : item.processingStatus === 'queued'
                  ? 'Queued for OpenRouter transcription…'
                  : 'Tap to add or edit transcript…'
            }
            placeholderTextColor={colors.textTertiary}
            style={styles.transcriptInput}
          />
        </>
      ) : null}

      {item.kind === 'photo' ? (
        <Pressable onPress={() => setLightboxOpen(true)}>
          <Image
            source={{ uri: item.localUri }}
            style={styles.photoPreview}
            resizeMode="cover"
          />
        </Pressable>
      ) : null}

      {item.kind === 'video' ? (
        playingVideo ? (
          <InlineVideoPlayer uri={item.localUri} />
        ) : (
          <Pressable
            onPress={() => setPlayingVideo(true)}
            style={styles.videoPosterWrap}
          >
            {item.thumbUri ? (
              <Image
                source={{ uri: item.thumbUri }}
                style={styles.photoPreview}
                resizeMode="cover"
              />
            ) : (
              <View style={[styles.photoPreview, styles.videoPlaceholder]}>
                <Feather name="film" size={32} color={colors.textTertiary} />
              </View>
            )}
            <View style={styles.videoOverlay}>
              <View style={styles.videoPlayCircle}>
                <Feather name="play" size={22} color="#ffffff" />
              </View>
              {item.durationMs ? (
                <View style={styles.durationBadge}>
                  <Text style={styles.durationBadgeText}>
                    {formatDurationSec(item.durationMs)}
                  </Text>
                </View>
              ) : null}
            </View>
          </Pressable>
        )
      ) : null}

      {/* User's own caption upfront (for Photo & Video) */}
      {item.kind !== 'voice' ? (
        <TextInput
          value={captionDraft}
          onChangeText={setCaptionDraft}
          onBlur={handleSaveCaption}
          multiline
          placeholder="Add a note or caption about this moment…"
          placeholderTextColor={colors.textTertiary}
          style={styles.captionInput}
        />
      ) : null}

      {/* People chips upfront */}
      <View style={styles.peopleRow}>
        {item.people.map((person) => (
          <Pressable
            key={person.id}
            onPress={() => onSelectPerson?.(person)}
            onLongPress={() => void removePersonFromMedia(item.id, person.id)}
            style={styles.personChip}
          >
            <Feather name="user" size={11} color={colors.accent} />
            <Text style={styles.personChipText}>{person.name}</Text>
          </Pressable>
        ))}
        <Pressable
          onPress={() => setPersonModalOpen(true)}
          style={styles.addPersonChip}
          hitSlop={6}
        >
          <Feather name="plus" size={11} color={colors.textSecondary} />
          <Text style={styles.addPersonText}>Person</Text>
        </Pressable>
      </View>

      {/* Processing status indicator */}
      {item.processingStatus !== 'ready' ? (
        <View style={styles.statusRow}>
          {item.processingStatus === 'processing' ? (
            <ActivityIndicator size="small" color={colors.accent} />
          ) : (
            <Feather
              name={item.processingStatus === 'error' ? 'alert-circle' : 'clock'}
              size={13}
              color={item.processingStatus === 'error' ? '#a85c5c' : colors.textTertiary}
            />
          )}
          <Text
            style={[
              styles.statusText,
              item.processingStatus === 'error' && styles.errorText,
            ]}
            numberOfLines={2}
          >
            {item.processingStatus === 'processing'
              ? item.kind === 'voice'
                ? 'Transcribing via OpenRouter…'
                : 'Indexing memory via OpenRouter…'
              : item.processingError || 'Queued — will process automatically when online'}
          </Text>
          {item.processingStatus === 'error' || item.processingStatus === 'queued' ? (
            <Pressable
              onPress={() => void retryMediaProcessing(item.id)}
              style={styles.retryPill}
            >
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {/* Collapsible, editable "Memory details" drawer (AI summary / OCR / video transcript / place) */}
      {item.kind !== 'voice' && (hasMemoryDetails || item.processingStatus === 'ready') ? (
        <View style={styles.detailsWrap}>
          <Pressable
            onPress={() => setDetailsOpen((v) => !v)}
            style={styles.detailsToggle}
          >
            <Text style={styles.detailsToggleText}>
              Memory details{item.ocrText ? ' · OCR' : ''}
              {item.kind === 'video' && item.transcript ? ' · Transcript' : ''}
            </Text>
            <Feather
              name={detailsOpen ? 'chevron-up' : 'chevron-down'}
              size={14}
              color={colors.textTertiary}
            />
          </Pressable>

          {detailsOpen ? (
            <View style={styles.detailsBody}>
              <Text style={styles.detailLabel}>Place / Location</Text>
              <TextInput
                value={locationDraft}
                onChangeText={setLocationDraft}
                onBlur={handleSaveMemoryDetails}
                placeholder="e.g. Front porch, Lake Trail, St. Jude's"
                placeholderTextColor={colors.textTertiary}
                style={styles.detailInput}
              />

              <Text style={styles.detailLabel}>Visual summary (searchable)</Text>
              <TextInput
                value={summaryDraft}
                onChangeText={setSummaryDraft}
                onBlur={handleSaveMemoryDetails}
                multiline
                placeholder="No visual summary yet"
                placeholderTextColor={colors.textTertiary}
                style={styles.detailInput}
              />

              {item.kind === 'video' ? (
                <>
                  <Text style={styles.detailLabel}>Spoken transcript</Text>
                  <TextInput
                    value={transcriptDraft}
                    onChangeText={setTranscriptDraft}
                    onBlur={handleSaveTranscript}
                    multiline
                    placeholder="No speech detected"
                    placeholderTextColor={colors.textTertiary}
                    style={styles.detailInput}
                  />
                </>
              ) : null}

              <Text style={styles.detailLabel}>Handwritten / visible text (OCR)</Text>
              <TextInput
                value={ocrDraft}
                onChangeText={setOcrDraft}
                onBlur={handleSaveMemoryDetails}
                multiline
                placeholder="No visible text extracted"
                placeholderTextColor={colors.textTertiary}
                style={styles.detailInput}
              />
            </View>
          ) : null}
        </View>
      ) : null}

      {/* Full-screen Photo Lightbox */}
      <Modal
        visible={lightboxOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setLightboxOpen(false)}
      >
        <View style={styles.lightboxBackdrop}>
          <Pressable
            onPress={() => setLightboxOpen(false)}
            style={styles.lightboxClose}
            hitSlop={12}
          >
            <Feather name="x" size={24} color="#ffffff" />
          </Pressable>
          <Image
            source={{ uri: item.localUri }}
            style={styles.lightboxImage}
            resizeMode="contain"
          />
          {item.caption ? (
            <Text style={styles.lightboxCaption}>{item.caption}</Text>
          ) : null}
        </View>
      </Modal>

      {/* Tag a Person modal with autocomplete */}
      <Modal
        visible={personModalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setPersonModalOpen(false)}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => setPersonModalOpen(false)}
        >
          <Pressable style={styles.personModal} onPress={() => {}}>
            <Text style={styles.personModalTitle}>Tag a person</Text>
            <View style={styles.personInputRow}>
              <TextInput
                value={personQuery}
                onChangeText={setPersonQuery}
                placeholder="Name (e.g. Sarah, Mom, Small Group)"
                placeholderTextColor={colors.textTertiary}
                style={styles.personInput}
                autoFocus
                onSubmitEditing={() => void handleAddPerson(personQuery)}
              />
              <Pressable
                onPress={() => void handleAddPerson(personQuery)}
                disabled={!personQuery.trim()}
                style={[
                  styles.addBtn,
                  !personQuery.trim() && { opacity: 0.45 },
                ]}
              >
                <Text style={styles.addBtnText}>Add</Text>
              </Pressable>
            </View>
            {suggestedPeople.length > 0 ? (
              <ScrollView style={{ maxHeight: 180 }}>
                {suggestedPeople.map((p) => (
                  <Pressable
                    key={p.id}
                    onPress={() => void handleAddPerson(p.name)}
                    style={styles.suggestRow}
                  >
                    <Feather name="user" size={14} color={colors.accent} />
                    <Text style={styles.suggestName}>{p.name}</Text>
                    <Text style={styles.suggestCount}>
                      {p.memoryCount ?? 0} memories
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.xs,
  },
  kindRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    flex: 1,
  },
  kindLabel: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 12,
    color: colors.textSecondary,
  },
  locationText: {
    fontFamily: fontFamilies.sans,
    fontSize: 12,
    color: colors.textTertiary,
    flexShrink: 1,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  echoBtn: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: '#f1ece2',
  },
  echoBtnText: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 11,
    color: colors.accent,
  },
  audioRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.background,
    borderRadius: radii.sm,
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  playCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  audioTrackWrap: {
    flex: 1,
    gap: 4,
  },
  audioTrack: {
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.border,
    overflow: 'hidden',
  },
  audioFill: {
    height: 5,
    backgroundColor: colors.accent,
  },
  audioTimeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  audioTime: {
    fontFamily: fontFamilies.sans,
    fontSize: 11,
    color: colors.textTertiary,
  },
  transcriptInput: {
    fontFamily: fontFamilies.serif,
    fontSize: 17,
    lineHeight: 26,
    color: colors.textPrimary,
    padding: 0,
  },
  photoPreview: {
    width: '100%',
    height: 220,
    borderRadius: radii.sm,
    backgroundColor: '#ebe6dc',
  },
  videoPosterWrap: {
    position: 'relative',
    borderRadius: radii.sm,
    overflow: 'hidden',
  },
  videoPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(28, 25, 21, 0.22)',
  },
  videoPlayCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(28, 25, 21, 0.65)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  durationBadge: {
    position: 'absolute',
    right: 10,
    bottom: 10,
    backgroundColor: 'rgba(28, 25, 21, 0.72)',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: radii.sm,
  },
  durationBadgeText: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 11,
    color: '#ffffff',
  },
  videoPlayerBox: {
    width: '100%',
    height: 240,
    borderRadius: radii.sm,
    overflow: 'hidden',
    backgroundColor: '#1a1816',
  },
  videoView: {
    width: '100%',
    height: '100%',
  },
  captionInput: {
    fontFamily: fontFamilies.serif,
    fontSize: 16,
    lineHeight: 24,
    color: colors.textPrimary,
    padding: 0,
  },
  peopleRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  personChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: '#f1ece2',
    borderWidth: 1,
    borderColor: colors.border,
  },
  personChipText: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 12,
    color: colors.textPrimary,
  },
  addPersonChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border,
  },
  addPersonText: {
    fontFamily: fontFamilies.sans,
    fontSize: 12,
    color: colors.textSecondary,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingTop: 2,
  },
  statusText: {
    flex: 1,
    fontFamily: fontFamilies.sans,
    fontSize: 12,
    color: colors.textTertiary,
  },
  errorText: {
    color: '#a85c5c',
  },
  retryPill: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  retryText: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 11,
    color: colors.accent,
  },
  detailsWrap: {
    borderTopWidth: 1,
    borderColor: colors.border,
    paddingTop: spacing.xs,
  },
  detailsToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  detailsToggleText: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 12,
    color: colors.textTertiary,
  },
  detailsBody: {
    gap: 6,
    marginTop: spacing.xs,
  },
  detailLabel: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 11,
    letterSpacing: 0.4,
    color: colors.textTertiary,
    textTransform: 'uppercase',
  },
  detailInput: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 7,
    fontFamily: fontFamilies.sans,
    fontSize: 13,
    color: colors.textPrimary,
  },
  lightboxBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(18, 16, 14, 0.94)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  lightboxClose: {
    position: 'absolute',
    top: 48,
    right: 20,
    zIndex: 10,
  },
  lightboxImage: {
    width: '100%',
    height: '78%',
  },
  lightboxCaption: {
    marginTop: spacing.md,
    fontFamily: fontFamilies.serif,
    fontSize: 17,
    color: '#f7f4ee',
    textAlign: 'center',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(28, 25, 21, 0.36)',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  personModal: {
    backgroundColor: colors.background,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  personModalTitle: {
    fontFamily: fontFamilies.serifSemibold,
    fontSize: 20,
    color: colors.textPrimary,
  },
  personInputRow: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  personInput: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 9,
    fontFamily: fontFamilies.sans,
    fontSize: 14,
    color: colors.textPrimary,
  },
  addBtn: {
    backgroundColor: colors.accent,
    paddingHorizontal: 14,
    borderRadius: radii.sm,
    justifyContent: 'center',
  },
  addBtnText: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 13,
    color: '#ffffff',
  },
  suggestRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderColor: colors.border,
  },
  suggestName: {
    flex: 1,
    fontFamily: fontFamilies.sansMedium,
    fontSize: 14,
    color: colors.textPrimary,
  },
  suggestCount: {
    fontFamily: fontFamilies.sans,
    fontSize: 12,
    color: colors.textTertiary,
  },
});
