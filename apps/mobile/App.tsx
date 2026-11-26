/**
 * Resonance — Root App component.
 *
 * Loads fonts, opens the database, and mounts the root navigator.
 * (design spec §4.1, implementation plan Task 1.1)
 */

import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, AppState, Text, View, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
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
import { useSettingsStore } from './src/settings/settingsStore';
import { useOfflineEngineStore } from './src/packages/offlineEngineManager';
import { usePersonalLibraryStore } from './src/personal/personalLibraryService';
import { RootNavigator } from './src/navigation/RootNavigator';

// Keep the native splash up until fonts + database are ready, then hide
// it from the effects below (issue #53, P1-15).
void SplashScreen.preventAutoHideAsync();

function AppContent(): ReactNode {
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
      .then((db) => {
        setReady(db);
        // Load persisted user preferences now that the connection is live,
        // so accessibility/text-scale choices take effect from first paint.
        void useSettingsStore.getState().load();
        void useOfflineEngineStore.getState().initialize();
        void usePersonalLibraryStore.getState().initialize();
        return db;
      })
      .catch((err) => {
        console.error('[App] database open failed:', err);
        setError(
          'Could not open the journal database. Please restart the app.'
        );
      });
  }, [fontsLoaded, setLoading, setReady, setError]);

  // Keep downloads, catalog syncs, personal batch imports, and embeddings resilient
  // across backgrounding / foregrounding.
  useEffect(() => {
    if (status !== 'ready') return;
    const sub = AppState.addEventListener('change', (nextState) => {
      useOfflineEngineStore.getState().handleAppStateChange(nextState);
      if (nextState === 'active') {
        void usePersonalLibraryStore.getState().resumeBackgroundWork();
      }
    });
    return () => sub.remove();
  }, [status]);

  useEffect(() => {
    if (fontsLoaded && status !== 'loading') {
      void SplashScreen.hideAsync();
    }
  }, [fontsLoaded, status]);

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

/**
 * Root: gesture-handler + safe-area providers wrap everything (issue
 * #53, P1-08). Android 16 (API 36) is edge-to-edge mandatory — without
 * SafeAreaProvider, headers/tabs overlap system bars and cutouts.
 */
export default function App(): ReactNode {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AppContent />
      </SafeAreaProvider>
    </GestureHandlerRootView>
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
