/**
 * Mobile Patterns screen — thin wrapper around the shared offline-capable
 * `@resonance/screens` PatternsScreen, backed by MobileDataLayer (local SQLite).
 */

import { useCallback, useEffect, useMemo, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';
import { DataLayerProvider } from '@resonance/core/data-layer-context';
import { PatternsScreen as SharedPatternsScreen } from '@resonance/screens';
import { colors, layout, spacing } from '@resonance/theme';
import { MobileDataLayer } from '../data/mobileDataLayer';

export function PatternsScreen(): ReactNode {
  const navigation = useNavigation();
  const dataLayer = useMemo(() => new MobileDataLayer(), []);

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
    (_bookId: string, _chapter?: number, _verse?: number) => {
      navigation.navigate('Word' as never);
    },
    [navigation],
  );

  const handleNavigateToJournal = useCallback(() => {
    navigation.navigate('Journal' as never);
  }, [navigation]);

  return (
    <View style={styles.container}>
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
});
