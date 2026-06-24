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
import { SearchIcon, SettingsIcon } from '@resonance/ui';

import { colors, fontFamilies, screenContainer, spacing } from '@resonance/theme';
import { type Translation } from '@resonance/core';
import { useDataLayer } from '@resonance/core/data-layer-context';
import { ScriptureBrowser } from './ScriptureBrowser';
import { LibraryBrowser } from './LibraryBrowser';
import { ReadingView, type ReadingMode } from './ReadingView';
import { SearchScreen } from './SearchScreen';
import { TranslationSelector } from '@resonance/ui';

type ScreenView =
  | { name: 'browse' }
  | { name: 'reading'; mode: ReadingMode }
  | { name: 'search' };

interface WordScreenProps {
  onOpenSettings?: () => void;
}

export function WordScreen({ onOpenSettings }: WordScreenProps): ReactNode {
  const [surface, setSurface] = useState<'scripture' | 'library'>('scripture');
  const [translation, setTranslation] = useState<Translation>('WEB');
  const [view, setView] = useState<ScreenView>({ name: 'browse' });
  const [totalChapters, setTotalChapters] = useState(1);
  const dataLayer = useDataLayer();

  // Load saved translation preference on mount
  useEffect(() => {
    dataLayer.getSettings().then((settings) => {
      const savedTranslation = settings?.translation;
      if (savedTranslation === 'kjv' || savedTranslation === 'web') {
        setTranslation(savedTranslation.toUpperCase() as Translation);
      }
    }).catch(() => {});
  }, [dataLayer]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const openScriptureChapter = useCallback(
    async (bookName: string, chapter: number) => {
      const chapters = await dataLayer.getChapters(bookName, translation);
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
    [dataLayer, translation]
  );

  const openLibraryBook = useCallback((bookId: string) => {
    setView({
      name: 'reading',
      mode: { kind: 'library', bookId },
    });
  }, []);

  const navigateChapter = useCallback(
    async (bookName: string, chapter: number) => {
      const chapters = await dataLayer.getChapters(bookName, translation);
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
    [dataLayer, translation]
  );

  // ── Render ────────────────────────────────────────────────────────────────

  // Search screen renders over everything.
  if (view.name === 'search') {
    return (
      <SearchScreen
        onCancel={() => setView({ name: 'browse' })}
        onOpenScripture={openScriptureChapter}
        onOpenLibrary={openLibraryBook}
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

        <View style={styles.headerRight}>
          {surface === 'scripture' && (
            <TranslationSelector value={translation} onChange={setTranslation} />
          )}
          <Pressable
            onPress={() => setView({ name: 'search' })}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Search"
          >
            <SearchIcon size={20} color={colors.textSecondary} />
          </Pressable>
          {onOpenSettings ? (
            <Pressable
              onPress={onOpenSettings}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Settings"
            >
              <SettingsIcon size={20} color={colors.textSecondary} />
            </Pressable>
          ) : null}
        </View>
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
