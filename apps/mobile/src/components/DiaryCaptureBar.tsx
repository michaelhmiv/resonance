/**
 * DiaryCaptureBar — quiet cream-paper docked footer bar for Voice, Photo,
 * Video, and active-entry Echoes inside the Journal.
 *
 * Strictly gated behind OpenRouter BYOK: renders `null` when OpenRouter is not
 * configured or Life Diary media toggles are off.
 *
 * Mounts the native `useAudioRecorder` hook ONLY while actively recording so
 * idle Journal sessions never poll native Android audio.
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import * as ImagePicker from 'expo-image-picker';
import { colors, fontFamilies, radii, spacing } from '@resonance/theme';
import { useOpenRouterStore } from '../openrouter/openrouterStore';
import { useDiaryMediaStore } from '../diary/diaryMediaService';

interface Props {
  activeEntryText?: string | null;
  onTriggerEchoes?: (text: string) => void;
  onMediaAdded?: () => void;
}

function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ── Active Voice Recorder Strip (mounted only while recording) ──────────────

function VoiceRecorderStrip({
  onFinished,
  onCancel,
}: {
  onFinished: (uri: string, durationMs: number) => Promise<void>;
  onCancel: () => void;
}): ReactNode {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder, 250);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        await setAudioModeAsync({
          allowsRecording: true,
          playsInSilentMode: true,
        });
        await recorder.prepareToRecordAsync();
        if (active) {
          recorder.record();
        }
      } catch (err) {
        if (active) {
          Alert.alert(
            'Could not start recording',
            err instanceof Error ? err.message : 'Please try again.'
          );
          onCancel();
        }
      }
    })();

    return () => {
      active = false;
      try {
        if (recorder.isRecording) {
          void recorder.stop();
        }
      } catch {
        // ignore cleanup errors
      }
    };
  }, [recorder, onCancel]);

  const handleCancel = useCallback(async () => {
    try {
      await recorder.stop();
    } catch {
      // ignore
    }
    onCancel();
  }, [recorder, onCancel]);

  const handleSave = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    const durationMs = recorderState.durationMillis ?? 0;
    try {
      await recorder.stop();
      const uri = recorder.uri ?? recorder.getStatus()?.url ?? null;
      if (!uri) {
        Alert.alert('Recording unavailable', 'No audio file was produced. Please try again.');
        onCancel();
        return;
      }
      await onFinished(uri, Math.max(1000, durationMs));
    } catch (err) {
      Alert.alert(
        'Could not save voice note',
        err instanceof Error ? err.message : 'Please try again.'
      );
      onCancel();
    } finally {
      setSaving(false);
    }
  }, [saving, recorder, recorderState.durationMillis, onFinished, onCancel]);

  return (
    <View style={styles.recordingFloatingWrap} pointerEvents="box-none">
      <View style={styles.recordingPill}>
        <View style={styles.recLeft}>
          <View style={styles.recDot} />
          <Text style={styles.recTimer}>
            {formatDuration(recorderState.durationMillis ?? 0)}
          </Text>
        </View>
        <View style={styles.recActions}>
          <Pressable
            onPress={() => void handleCancel()}
            disabled={saving}
            style={({ pressed }) => [styles.recIconBtn, pressed && styles.pressed]}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Discard voice note"
          >
            <Feather name="trash-2" size={16} color={colors.textSecondary} />
          </Pressable>
          <Pressable
            onPress={() => void handleSave()}
            disabled={saving}
            style={({ pressed }) => [styles.recSaveCircle, pressed && styles.pressed]}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Save voice note"
          >
            {saving ? (
              <ActivityIndicator size="small" color="#ffffff" />
            ) : (
              <Feather name="check" size={16} color="#ffffff" />
            )}
          </Pressable>
        </View>
      </View>
    </View>
  );
}

// ── Main Floating Icon Dock ─────────────────────────────────────────────────

export function DiaryCaptureBar({
  activeEntryText,
  onTriggerEchoes,
  onMediaAdded,
}: Props): ReactNode {
  const hasKey = useOpenRouterStore((s) => s.hasKey);
  const routingMode = useOpenRouterStore((s) => s.routingMode);
  const features = useOpenRouterStore((s) => s.features);

  const voiceAllowed = hasKey && routingMode === 'cloud_with_fallback' && features.voice;
  const visualAllowed =
    hasKey && routingMode === 'cloud_with_fallback' && features.photosAndVideos;

  const addVoiceNote = useDiaryMediaStore((s) => s.addVoiceNote);
  const addPhotos = useDiaryMediaStore((s) => s.addPhotos);
  const addVideo = useDiaryMediaStore((s) => s.addVideo);

  const [isRecordingUi, setIsRecordingUi] = useState(false);
  const [pickerSheet, setPickerSheet] = useState<'photo' | 'video' | null>(null);
  const [busy, setBusy] = useState(false);

  const startVoiceRecording = useCallback(async () => {
    try {
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(
          'Microphone permission needed',
          'Allow microphone access in Android Settings to record voice diary notes.'
        );
        return;
      }
      setIsRecordingUi(true);
    } catch (err) {
      Alert.alert(
        'Could not request microphone permission',
        err instanceof Error ? err.message : 'Please try again.'
      );
    }
  }, []);

  const handleVoiceFinished = useCallback(
    async (uri: string, durationMs: number) => {
      setIsRecordingUi(false);
      setBusy(true);
      try {
        await addVoiceNote({
          sourceUri: uri,
          durationMs,
          mimeType: 'audio/m4a',
        });
        onMediaAdded?.();
      } catch (err) {
        Alert.alert(
          'Could not save voice note',
          err instanceof Error ? err.message : 'Please try again.'
        );
      } finally {
        setBusy(false);
      }
    },
    [addVoiceNote, onMediaAdded]
  );

  const pickPhotoFromCamera = useCallback(async () => {
    setPickerSheet(null);
    setBusy(true);
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Camera permission needed', 'Allow camera access to take a diary photo.');
        return;
      }
      const res = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        quality: 0.88,
      });
      if (!res.canceled && res.assets.length > 0) {
        await addPhotos({ assets: res.assets });
        onMediaAdded?.();
      }
    } catch (err) {
      Alert.alert(
        'Could not add photo',
        err instanceof Error ? err.message : 'Please try again.'
      );
    } finally {
      setBusy(false);
    }
  }, [addPhotos, onMediaAdded]);

  const pickPhotosFromLibrary = useCallback(async () => {
    setPickerSheet(null);
    setBusy(true);
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(
          'Photo library permission needed',
          'Allow photo access to attach photos to your diary.'
        );
        return;
      }
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        selectionLimit: 6,
        quality: 0.88,
      });
      if (!res.canceled && res.assets.length > 0) {
        await addPhotos({ assets: res.assets });
        onMediaAdded?.();
      }
    } catch (err) {
      Alert.alert(
        'Could not add photos',
        err instanceof Error ? err.message : 'Please try again.'
      );
    } finally {
      setBusy(false);
    }
  }, [addPhotos, onMediaAdded]);

  const recordVideoFromCamera = useCallback(async () => {
    setPickerSheet(null);
    setBusy(true);
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Camera permission needed', 'Allow camera access to record a diary video.');
        return;
      }
      const res = await ImagePicker.launchCameraAsync({
        mediaTypes: ['videos'],
        videoMaxDuration: 60,
        videoQuality: ImagePicker.UIImagePickerControllerQualityType?.Medium,
      });
      if (!res.canceled && res.assets[0]) {
        const a = res.assets[0];
        await addVideo({
          sourceUri: a.uri,
          durationMs: a.duration ?? null,
          width: a.width ?? null,
          height: a.height ?? null,
          mimeType: a.mimeType ?? 'video/mp4',
          fileSize: a.fileSize ?? null,
        });
        onMediaAdded?.();
      }
    } catch (err) {
      Alert.alert(
        'Could not add video',
        err instanceof Error ? err.message : 'Please try again.'
      );
    } finally {
      setBusy(false);
    }
  }, [addVideo, onMediaAdded]);

  const pickVideoFromLibrary = useCallback(async () => {
    setPickerSheet(null);
    setBusy(true);
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(
          'Photo library permission needed',
          'Allow library access to attach a video to your diary.'
        );
        return;
      }
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['videos'],
        videoQuality: ImagePicker.UIImagePickerControllerQualityType?.Medium,
      });
      if (!res.canceled && res.assets[0]) {
        const a = res.assets[0];
        await addVideo({
          sourceUri: a.uri,
          durationMs: a.duration ?? null,
          width: a.width ?? null,
          height: a.height ?? null,
          mimeType: a.mimeType ?? 'video/mp4',
          fileSize: a.fileSize ?? null,
        });
        onMediaAdded?.();
      }
    } catch (err) {
      Alert.alert(
        'Could not add video',
        err instanceof Error ? err.message : 'Please try again.'
      );
    } finally {
      setBusy(false);
    }
  }, [addVideo, onMediaAdded]);

  if (!voiceAllowed && !visualAllowed) return null;

  const canEchoActive = Boolean(
    activeEntryText && activeEntryText.trim().length >= 12 && onTriggerEchoes
  );

  return (
    <>
      {isRecordingUi ? (
        <VoiceRecorderStrip
          onFinished={handleVoiceFinished}
          onCancel={() => setIsRecordingUi(false)}
        />
      ) : (
        <View style={styles.floatingWrap} pointerEvents="box-none">
          {canEchoActive ? (
            <Pressable
              onPress={() => onTriggerEchoes?.(activeEntryText!.trim())}
              style={({ pressed }) => [styles.floatingCircle, pressed && styles.pressed]}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel="Find echoes for current entry"
            >
              <Text style={styles.echoGlyph}>✦</Text>
            </Pressable>
          ) : null}

          <View style={styles.floatingCapsule}>
            {voiceAllowed ? (
              <Pressable
                onPress={() => void startVoiceRecording()}
                disabled={busy}
                style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]}
                hitSlop={4}
                accessibilityRole="button"
                accessibilityLabel="Record voice diary note"
              >
                <Feather name="mic" size={18} color={colors.accent} />
              </Pressable>
            ) : null}
            {voiceAllowed && visualAllowed ? <View style={styles.hairlineDivider} /> : null}
            {visualAllowed ? (
              <>
                <Pressable
                  onPress={() => setPickerSheet('photo')}
                  disabled={busy}
                  style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]}
                  hitSlop={4}
                  accessibilityRole="button"
                  accessibilityLabel="Add diary photo"
                >
                  <Feather name="camera" size={18} color={colors.accent} />
                </Pressable>
                <View style={styles.hairlineDivider} />
                <Pressable
                  onPress={() => setPickerSheet('video')}
                  disabled={busy}
                  style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]}
                  hitSlop={4}
                  accessibilityRole="button"
                  accessibilityLabel="Add diary video"
                >
                  <Feather name="video" size={18} color={colors.accent} />
                </Pressable>
              </>
            ) : null}
            {busy ? (
              <View style={styles.busyWrap}>
                <ActivityIndicator size="small" color={colors.accent} />
              </View>
            ) : null}
          </View>
        </View>
      )}

      {/* Photo / Video source chooser */}
      <Modal
        visible={pickerSheet !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setPickerSheet(null)}
      >
        <Pressable style={styles.backdrop} onPress={() => setPickerSheet(null)}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>
              {pickerSheet === 'photo' ? 'Add Photo Memory' : 'Add Video Memory'}
            </Text>
            <Pressable
              onPress={() =>
                void (pickerSheet === 'photo'
                  ? pickPhotoFromCamera()
                  : recordVideoFromCamera())
              }
              style={styles.sheetOption}
            >
              <Feather
                name={pickerSheet === 'photo' ? 'camera' : 'video'}
                size={18}
                color={colors.accent}
              />
              <Text style={styles.sheetOptionText}>
                {pickerSheet === 'photo' ? 'Take a photo' : 'Record a short video'}
              </Text>
            </Pressable>
            <Pressable
              onPress={() =>
                void (pickerSheet === 'photo'
                  ? pickPhotosFromLibrary()
                  : pickVideoFromLibrary())
              }
              style={styles.sheetOption}
            >
              <Feather name="image" size={18} color={colors.accent} />
              <Text style={styles.sheetOptionText}>
                {pickerSheet === 'photo'
                  ? 'Choose from photo library'
                  : 'Choose video from library'}
              </Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  floatingWrap: {
    position: 'absolute',
    right: 16,
    bottom: 14,
    zIndex: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  floatingCapsule: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(249, 246, 239, 0.94)',
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: 5,
    paddingVertical: 4,
    shadowColor: '#2c241b',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.09,
    shadowRadius: 10,
    elevation: 4,
  },
  floatingCircle: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(249, 246, 239, 0.94)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    shadowColor: '#2c241b',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.09,
    shadowRadius: 10,
    elevation: 4,
  },
  echoGlyph: {
    fontSize: 17,
    color: colors.accent,
  },
  iconBtn: {
    width: 40,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hairlineDivider: {
    width: StyleSheet.hairlineWidth,
    height: 18,
    backgroundColor: colors.border,
  },
  busyWrap: {
    paddingHorizontal: 8,
  },
  pressed: {
    opacity: 0.55,
  },
  recordingFloatingWrap: {
    position: 'absolute',
    right: 16,
    bottom: 14,
    zIndex: 20,
    alignItems: 'flex-end',
  },
  recordingPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: 'rgba(249, 246, 239, 0.97)',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#d9b9b0',
    paddingLeft: 14,
    paddingRight: 6,
    paddingVertical: 6,
    shadowColor: '#2c241b',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 5,
  },
  recLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  recDot: {
    width: 9,
    height: 9,
    borderRadius: 4.5,
    backgroundColor: '#b84a39',
  },
  recTimer: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 13.5,
    color: colors.textPrimary,
    fontVariant: ['tabular-nums'],
  },
  recActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  recIconBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recSaveCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(28, 25, 21, 0.36)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    padding: spacing.lg,
    paddingBottom: spacing.xl,
    gap: spacing.xs,
  },
  sheetTitle: {
    fontFamily: fontFamilies.serifSemibold,
    fontSize: 20,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  sheetOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 14,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sheetOptionText: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 15,
    color: colors.textPrimary,
  },
});
