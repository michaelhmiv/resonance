/**
 * Resonance — Root App component.
 *
 * Loads fonts, opens the database, and mounts the root navigator.
 * (design spec §4.1, implementation plan Task 1.1)
 */

import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Text, View, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import {
  useFonts,
  CormorantGaramond_400Regular,
  CormorantGaramond_500Medium,
  CormorantGaramond_600SemiBold,
  CormorantGaramond_400Regular_Italic,
} from '@expo-google-fonts/cormorant-garamond';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
} from '@expo-google-fonts/inter';

import { colors, fontFamilies, spacing } from './src/theme';
import { openDatabase } from './src/db/database';
import { useDbStore } from './src/db/dbStore';
import { RootNavigator } from './src/navigation/RootNavigator';

export default function App(): ReactNode {
  const [fontsLoaded] = useFonts({
    CormorantGaramond_400Regular,
    CormorantGaramond_500Medium,
    CormorantGaramond_600SemiBold,
    CormorantGaramond_400Regular_Italic,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
  });

  const { status, setLoading, setReady, setError } = useDbStore();

  useEffect(() => {
    if (!fontsLoaded) return;

    setLoading();
    openDatabase()
      .then((db) => setReady(db))
      .catch((err) => {
        console.error('[App] database open failed:', err);
        setError(
          'Could not open the journal database. Please restart the app.'
        );
      });
  }, [fontsLoaded, setLoading, setReady, setError]);

  if (!fontsLoaded) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.accent} size="small" />
      </View>
    );
  }

  if (status === 'loading') {
    return (
      <View style={styles.loading}>
        <Text style={styles.loadingText}>Resonance</Text>
      </View>
    );
  }

  if (status === 'error') {
    return (
      <View style={styles.loading}>
        <Text style={styles.loadingText}>Resonance</Text>
        <Text style={styles.errorText}>
          Could not open the journal database. Please restart the app.
        </Text>
      </View>
    );
  }

  return (
    <>
      <StatusBar style="dark" />
      <RootNavigator />
    </>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    fontFamily: fontFamilies.serifSemibold,
    fontSize: 24,
    color: colors.accent,
    letterSpacing: 0.5,
  },
  errorText: {
    fontFamily: fontFamilies.sans,
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: spacing.md,
    paddingHorizontal: spacing.xl,
    textAlign: 'center',
  },
});
