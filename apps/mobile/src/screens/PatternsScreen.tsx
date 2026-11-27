/**
 * Mobile Patterns screen — thin wrapper around the shared offline-capable
 * `@resonance/screens` PatternsScreen, backed by MobileDataLayer (local SQLite).
 */

import { useCallback, useEffect, useMemo, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';
import { DataLayerProvider } from '@resonance/core/data-layer-context';
import { PatternsScreen as SharedPatternsScreen } from '@resonance/screens';
import { colors, fontFamilies, layout, radii, spacing } from '@resonance/theme';
import { MobileDataLayer } from '../data/mobileDataLayer';
import { useOpenRouterStore } from '../openrouter/openrouterStore';
import { useDiaryMediaStore } from '../diary/diaryMediaService';

export function PatternsScreen(): ReactNode {
  const navigation = useNavigation();
  const dataLayer = useMemo(() => new MobileDataLayer(), []);

  const hasKey = useOpenRouterStore((s) => s.hasKey);
  const routingMode = useOpenRouterStore((s) => s.routingMode);
  const features = useOpenRouterStore((s) => s.features);
  const diaryUnlocked =
    hasKey &&
    routingMode === 'cloud_with_fallback' &&
    (features.voice || features.photosAndVideos);

  const allMedia = useDiaryMediaStore((s) => s.allMedia);
  const people = useDiaryMediaStore((s) => s.people);

  useEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable
          onPress={() => navigation.navigate('Settings' as never)}
          hitSlop={12}
          style={{ marginRight: 16 }}
          accessibilityRole="button"
          accessibilityLabel="Settings"
        >
          <Feather name="settings" size={20} color={colors.textSecondary} />
        </Pressable>
      ),
    });
  }, [navigation]);

  const handleNavigateToBook = useCallback(
    (bookId: string, chapter?: number, verse?: number) => {
      (navigation as { navigate: (name: string, params?: unknown) => void }).navigate(
        'Word',
        { bookId, chapter, verse }
      );
    },
    [navigation],
  );

  const handleNavigateToJournal = useCallback(() => {
    navigation.navigate('Journal' as never);
  }, [navigation]);

  const handleFilterPerson = useCallback(
    (personId: string) => {
      (navigation as { navigate: (name: string, params?: unknown) => void }).navigate(
        'Journal',
        { filterPersonId: personId }
      );
    },
    [navigation]
  );

  const voiceCount = allMedia.filter((m) => m.kind === 'voice').length;
  const photoCount = allMedia.filter((m) => m.kind === 'photo').length;
  const videoCount = allMedia.filter((m) => m.kind === 'video').length;

  return (
    <View style={styles.container}>
      {diaryUnlocked && (allMedia.length > 0 || people.length > 0) ? (
        <View style={styles.peopleCard}>
          <View style={styles.peopleHeader}>
            <Text style={styles.peopleTitle}>People & Moments</Text>
            <Text style={styles.peopleStats}>
              {voiceCount} voice · {photoCount} photos · {videoCount} videos
            </Text>
          </View>
          {people.length > 0 ? (
            <View style={styles.peopleChips}>
              {people.slice(0, 8).map((p) => (
                <Pressable
                  key={p.id}
                  onPress={() => handleFilterPerson(p.id)}
                  style={styles.personChip}
                >
                  <Feather name="user" size={12} color={colors.accent} />
                  <Text style={styles.personChipText}>
                    {p.name} ({p.memoryCount ?? 0})
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : (
            <Text style={styles.peopleHint}>
              Tag people on photos, videos, or voice notes in Journal to trace seasons with them.
            </Text>
          )}
        </View>
      ) : null}

      <DataLayerProvider layer={dataLayer}>
        <SharedPatternsScreen
          onNavigateToBook={handleNavigateToBook}
          onNavigateToJournal={handleNavigateToJournal}
        />
      </DataLayerProvider>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: layout.screenPaddingX,
    paddingTop: spacing.md,
  },
  peopleCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.md,
    gap: spacing.xs,
  },
  peopleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.xs,
  },
  peopleTitle: {
    fontFamily: fontFamilies.serifSemibold,
    fontSize: 18,
    color: colors.textPrimary,
  },
  peopleStats: {
    fontFamily: fontFamilies.sans,
    fontSize: 12,
    color: colors.textTertiary,
  },
  peopleChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 4,
  },
  personChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
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
  peopleHint: {
    fontFamily: fontFamilies.sans,
    fontSize: 12,
    color: colors.textSecondary,
  },
});
