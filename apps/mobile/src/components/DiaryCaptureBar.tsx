/**
 * DiaryCaptureBar — compact, quiet cream-paper capture dock for Voice, Photo,
 * and Video inside the Journal.
 *
 * Strictly gated behind OpenRouter BYOK: renders `null` when OpenRouter is not
 * configured or Life Diary media toggles are off.
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
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
  keyboardHeight: number;
  onMediaAdded?: () => void;
}

function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function DiaryCaptureBar({ keyboardHeight, onMediaAdded }: Props): ReactNode {
  const hasKey = useOpenRouterStore((s) => s.hasKey);
  const routingMode = useOpenRouterStore((s) => s.routingMode);
  const features = useOpenRouterStore((s) => s.features);

  const voiceAllowed = hasKey && routingMode === 'cloud_with_fallback' && features.voice;
  const visualAllowed =
    hasKey && routingMode === 'cloud_with_fallback' && features.photosAndVideos;

  const addVoiceNote = useDiaryMediaStore((s) => s.addVoiceNote);
  const addPhotos = useDiaryMediaStore((s) => s.addPhotos);
  const addVideo = useDiaryMediaStore((s) => s.addVideo);

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder, 250);

  const [isRecordingUi, setIsRecordingUi] = useState(false);
  const [pickerSheet, setPickerSheet] = useState<'photo' | 'video' | null>(null);

  useEffect(() => {
    if (!recorderState.isRecording && isRecordingUi) {
      // Keep UI synced if OS interrupted recording
    }
  }, [recorderState.isRecording, isRecordingUi]);

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
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
      });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setIsRecordingUi(true);
    } catch (err) {
      Alert.alert(
        'Could not start recording',
        err instanceof Error ? err.message : 'Please try again.'
      );
    }
  }, [recorder]);

  const cancelVoiceRecording = useCallback(async () => {
    try {
      await recorder.stop();
    } catch {
      // ignore
    } finally {
      setIsRecordingUi(false);
    }
  }, [recorder]);

  const saveVoiceRecording = useCallback(async () => {
    const durationMs = recorderState.durationMillis ?? 0;
    try {
      await recorder.stop();
      setIsRecordingUi(false);
      const uri = recorder.uri;
      if (uri) {
        await addVoiceNote({
          sourceUri: uri,
          durationMs: Math.max(1000, durationMs),
          mimeType: 'audio/m4a',
        });
        onMediaAdded?.();
      }
    } catch (err) {
      setIsRecordingUi(false);
      Alert.alert(
        'Could not save voice note',
        err instanceof Error ? err.message : 'Please try again.'
      );
    }
  }, [recorder, recorderState.durationMillis, addVoiceNote, onMediaAdded]);

  const pickPhotoFromCamera = useCallback(async () => {
    setPickerSheet(null);
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
  }, [addPhotos, onMediaAdded]);

  const pickPhotosFromLibrary = useCallback(async () => {
    setPickerSheet(null);
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
  }, [addPhotos, onMediaAdded]);

  const recordVideoFromCamera = useCallback(async () => {
    setPickerSheet(null);
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Camera permission needed', 'Allow camera access to record a diary video.');
      return;
    }
    const res = await ImagePicker.launchCameraAsync({
      mediaTypes: ['videos'],
      videoMaxDuration: 60,
      videoQuality: ImagePicker.UIImagePickerControllerQualityType.Medium,
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
  }, [addVideo, onMediaAdded]);

  const pickVideoFromLibrary = useCallback(async () => {
    setPickerSheet(null);
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
      videoQuality: ImagePicker.UIImagePickerControllerQualityType.Medium,
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
  }, [addVideo, onMediaAdded]);

  if (!voiceAllowed && !visualAllowed) return null;

  const bottomOffset = keyboardHeight > 0 ? 8 : 14;

  return (
    <>
      {isRecordingUi ? (
        <View style={[styles.recordingBar, { bottom: bottomOffset }]}>
          <View style={styles.recLeft}>
            <View style={styles.recDot} />
            <Text style={styles.recTimer}>
              Recording · {formatDuration(recorderState.durationMillis ?? 0)}
            </Text>
          </View>
          <View style={styles.recActions}>
            <Pressable
              onPress={() => void cancelVoiceRecording()}
              style={styles.recCancelBtn}
              hitSlop={8}
            >
              <Feather name="trash-2" size={16} color={colors.textSecondary} />
            </Pressable>
            <Pressable
              onPress={() => void saveVoiceRecording()}
              style={styles.recSaveBtn}
              hitSlop={8}
            >
              <Feather name="check" size={16} color="#ffffff" />
              <Text style={styles.recSaveText}>Save</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <View
          style={[
            styles.dockWrap,
            keyboardHeight > 0 ? styles.dockKeyboard : styles.dockFloating,
            { bottom: bottomOffset },
          ]}
        >
          {voiceAllowed ? (
            <Pressable
              onPress={() => void startVoiceRecording()}
              style={styles.dockBtn}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Record voice diary note"
            >
              <Feather name="mic" size={18} color={colors.textPrimary} />
            </Pressable>
          ) : null}
          {visualAllowed ? (
            <>
              <Pressable
                onPress={() => setPickerSheet('photo')}
                style={styles.dockBtn}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Add diary photo"
              >
                <Feather name="camera" size={18} color={colors.textPrimary} />
              </Pressable>
              <Pressable
                onPress={() => setPickerSheet('video')}
                style={styles.dockBtn}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Add diary video"
              >
                <Feather name="video" size={18} color={colors.textPrimary} />
              </Pressable>
            </>
          ) : null}
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
  dockWrap: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 5,
    gap: 4,
    shadowColor: '#2c2620',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  dockFloating: {
    right: 16,
  },
  dockKeyboard: {
    right: 16,
  },
  dockBtn: {
    width: 38,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordingBar: {
    position: 'absolute',
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: '#d9b9b0',
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    shadowColor: '#2c2620',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  recLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  recDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#b84a39',
  },
  recTimer: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 14,
    color: colors.textPrimary,
  },
  recActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  recCancelBtn: {
    padding: 8,
    borderRadius: radii.sm,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  recSaveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radii.sm,
    backgroundColor: colors.accent,
  },
  recSaveText: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 13,
    color: '#ffffff',
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
