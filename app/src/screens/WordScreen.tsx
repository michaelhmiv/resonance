/**
 * Word screen — dedicated reading surface for Scripture and Library texts.
 *
 * Entry point for the Word tab: shows a Scripture/Library toggle in the
 * header, a search icon, and renders either the Scripture browser,
 * Library browser, reading view, or search screen depending on state.
 *
 * (design spec §6: Word tab — browse, search, highlight, annotate, bookmark)
 */

import {
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';

import { colors, fontFamilies, screenContainer, spacing } from '../theme';
import { getChapters } from '../db/queries/bibleQueries';
import type { Translation } from '../db/types/word';
import { ScriptureBrowser } from './word/ScriptureBrowser';
import { LibraryBrowser } from './word/LibraryBrowser';
import { ReadingView, type ReadingMode } from './word/ReadingView';
import { SearchScreen } from './word/SearchScreen';
import { TranslationSelector } from '../components/word/TranslationSelector';

type ScreenView =
  | { name: 'browse' }
  | { name: 'reading'; mode: ReadingMode }
  | { name: 'search' };

export function WordScreen(): ReactNode {
  const [surface, setSurface] = useState<'scripture' | 'library'>('scripture');
  const [translation, setTranslation] = useState<Translation>('WEB');
  const [view, setView] = useState<ScreenView>({ name: 'browse' });
  const [totalChapters, setTotalChapters] = useState(1);
  const navigation = useNavigation();

  // Wire the settings gear into the header when on browse view.
  useEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <View style={styles.headerRight}>
          <Pressable
            onPress={() => setView({ name: 'search' })}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Search"
          >
            <Feather name="search" size={20} color={colors.textSecondary} />
          </Pressable>
          <Pressable
            onPress={() => navigation.navigate('Settings' as never)}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Settings"
          >
            <Feather name="settings" size={20} color={colors.textSecondary} />
          </Pressable>
        </View>
      ),
    });
  }, [navigation]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const openScriptureChapter = useCallback(
    async (bookName: string, chapter: number) => {
      const chapters = await getChapters(bookName, translation);
      setTotalChapters(chapters.length || 1);
      setView({
        name: 'reading',
        mode: {
          kind: 'scripture',
          bookName,
          chapter,
          translation,
          totalChapters: chapters.length || 1,
        },
      });
    },
    [translation]
  );

  const openLibraryBook = useCallback((bookId: string) => {
    setView({
      name: 'reading',
      mode: { kind: 'library', bookId },
    });
  }, []);

  const navigateChapter = useCallback(
    async (bookName: string, chapter: number) => {
      const chapters = await getChapters(bookName, translation);
      setTotalChapters(chapters.length || 1);
      setView({
        name: 'reading',
        mode: {
          kind: 'scripture',
          bookName,
          chapter,
          translation,
          totalChapters: chapters.length || 1,
        },
      });
    },
    [translation]
  );

  // ── Render ────────────────────────────────────────────────────────────────

  // Search screen renders over everything.
  if (view.name === 'search') {
    return (
      <SearchScreen
        onCancel={() => setView({ name: 'browse' })}
        onOpenScripture={openScriptureChapter}
      />
    );
  }

  // Reading view.
  if (view.name === 'reading') {
    return (
      <ReadingView
        mode={view.mode}
        onNavigateChapter={navigateChapter}
        onBack={() => setView({ name: 'browse' })}
      />
    );
  }

  // Browse view with Scripture/Library toggle.
  return (
    <View style={screenContainer}>
      <View style={styles.subHeader}>
        {/* eslint-disable-next-line react-native-a11y */}
        <View style={styles.toggle}>
          {(['scripture', 'library'] as const).map((s) => {
            const active = surface === s;
            const label = s === 'scripture' ? 'Scripture' : 'Library';
            return (
              <Pressable
                key={s}
                onPress={() => setSurface(s)}
                style={[styles.toggleItem, active && styles.toggleItemActive]}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
              >
                <Text
                  style={[
                    styles.toggleText,
                    active && styles.toggleTextActive,
                  ]}
                >
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {surface === 'scripture' && (
          <TranslationSelector value={translation} onChange={setTranslation} />
        )}
      </View>

      {surface === 'scripture' ? (
        <ScriptureBrowser
          translation={translation}
          onOpenChapter={openScriptureChapter}
        />
      ) : (
        <LibraryBrowser onOpenBook={openLibraryBook} />
      )}
    </View>
  );
}

// ── Settings gear (exported for possible reuse) ──────────────────────────────
// The gear is wired above via navigation.setOptions. This component is
// available if the parent navigator prefers a declarative approach.

function SettingsGear({ onPress }: { onPress: () => void }): ReactNode {
  return (
    <Pressable onPress={onPress} hitSlop={12} style={{ marginRight: 16 }}>
      <Feather name="settings" size={20} color={colors.textSecondary} />
    </Pressable>
  );
}

export { SettingsGear };

const styles = StyleSheet.create({
  subHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  toggle: {
    flexDirection: 'row',
    gap: 0,
  },
  toggleItem: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  toggleItemActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  toggleText: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 14,
    color: colors.textSecondary,
  },
  toggleTextActive: {
    color: colors.surface,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    marginRight: spacing.md,
  },
});
