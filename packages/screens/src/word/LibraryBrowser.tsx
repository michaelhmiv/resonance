/**
 * Library browser — browse voice-of-the-Church texts by Book Package.
 *
 * Shows installed Book Packages (Seed Library, The Fathers, etc.),
 * each expandable to reveal the works it contains. Tapping a work
 * calls `onOpenBook`, which the parent renders as a ReadingView.
 *
 * (design spec §6.2: Library = full content collection; Book Packages
 * are downloadable bundles.)
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  Text,
  View,
  StyleSheet,
} from 'react-native';
import { ChevronRightIcon } from '@resonance/ui';

import {
  cardSurface,
  colors,
  fontFamilies,
  layout,
  listContentContainer,
  radii,
  serifText,
  spacing,
} from '@resonance/theme';
import { type LibraryPackage, type LibraryBook } from '@resonance/core';
import { useDataLayer } from '@resonance/core/data-layer-context';

interface LibraryBrowserProps {
  onOpenBook: (bookId: string) => void;
}

export function LibraryBrowser({ onOpenBook }: LibraryBrowserProps): ReactNode {
  const [packages, setPackages] = useState<LibraryPackage[] | null>(null);
  const dataLayer = useDataLayer();
  const [expandedPkg, setExpandedPkg] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // First-visit onboarding prompt. Persisted via user_settings('library_seen_at').
  // null = still loading the check, false = show prompt, true = hide.
  const [showOnboarding, setShowOnboarding] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    dataLayer.getLibraryPackages().then((pkgs) => {
      if (!cancelled) {
        setPackages(pkgs);
        setLoadError(null);
        // Auto-expand the first package on initial load.
        if (pkgs.length > 0) {
          setExpandedPkg((prev) => prev ?? pkgs[0].package_id);
        }
      }
    }).catch((err) => {
      if (!cancelled) {
        setLoadError(err instanceof Error ? err.message : 'Unable to load Library.');
        setPackages([]);
      }
    });
    // Check whether the onboarding prompt has been dismissed in the past.
    // The /api/settings endpoint returns defaults for missing keys, so we
    // check the raw key. If 'library_seen_at' is set, the user has seen
    // (and dismissed) the prompt before.
    fetch('/api/settings')
      .then((r) => (r.ok ? r.json() : null))
      .then((settings) => {
        if (cancelled) return;
        setShowOnboarding(!settings?.library_seen_at);
      })
      .catch(() => {
        if (!cancelled) setShowOnboarding(false);
      });
    return () => {
      cancelled = true;
    };
  }, [dataLayer]);

  const dismissOnboarding = useCallback(async () => {
    setShowOnboarding(false);
    try {
      await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'library_seen_at', value: new Date().toISOString() }),
      });
    } catch { /* best-effort */ }
  }, []);

  const togglePackage = useCallback((pkgId: string) => {
    setExpandedPkg((prev) => (prev === pkgId ? null : pkgId));
  }, []);

  if (packages === null) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator color={colors.accentMuted} />
      </View>
    );
  }

  if (packages.length === 0) {
    return (
      <View style={[styles.container, styles.center]}>
        <Text style={styles.emptyTitle}>{loadError ? 'Unable to load Library.' : 'The Library is empty.'}</Text>
        <Text style={styles.emptyDescription}>
          {loadError ?? 'You can opt back in to any package from Settings → Library Contents.'}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {showOnboarding && (
        <View style={styles.onboardingCard}>
          <Text style={styles.onboardingTitle}>Customize your Library</Text>
          <Text style={styles.onboardingBody}>
            You can choose which collections of voices appear here and in
            resonance results — from Settings → Library Contents, anytime.
            For now, everything is enabled.
          </Text>
          <Pressable
            onPress={dismissOnboarding}
            style={styles.onboardingDismiss}
            accessibilityRole="button"
            accessibilityLabel="Dismiss"
          >
            <Text style={styles.onboardingDismissText}>Got it</Text>
          </Pressable>
        </View>
      )}
      <FlatList
        data={packages}
        keyExtractor={(item) => item.package_id}
        contentContainerStyle={listContentContainer}
        renderItem={({ item: pkg }) => {
          const expanded = expandedPkg === pkg.package_id;
          return (
            <View style={styles.packageSection}>
              <Pressable
                onPress={() => togglePackage(pkg.package_id)}
                style={({ pressed }) => [
                  cardSurface,
                  styles.packageHeader,
                  pressed && styles.packageHeaderPressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel={`${pkg.label} — ${pkg.books.length} works`}
              >
                {/* eslint-disable-next-line react-native-a11y */}
                <View style={styles.packageHeaderRow}>
                  <Text style={styles.packageLabel}>{pkg.label}</Text>
                  <Text style={styles.bookCount}>{pkg.books.length}</Text>
                </View>
              </Pressable>

              {expanded && (
                <View style={styles.booksList}>
                  {pkg.books.map((book: LibraryBook) => (
                    <Pressable
                      key={book.id}
                      onPress={() => onOpenBook(book.id)}
                      style={({ pressed }) => [
                        styles.bookRow,
                        pressed && styles.bookRowPressed,
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel={book.title ?? book.id}
                    >
                      <View>
                        <Text style={styles.bookTitle}>
                          {book.title ?? book.id}
                        </Text>
                        {book.author ? (
                          <Text style={styles.bookAuthor}>{book.author}</Text>
                        ) : null}
                      </View>
                      <ChevronRightIcon size={18} color={colors.textTertiary} />
                    </Pressable>
                  ))}
                </View>
              )}
            </View>
          );
        }}
        ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  center: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyTitle: {
    fontFamily: fontFamilies.serifSemibold,
    fontSize: 20,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  emptyDescription: {
    ...serifText,
    fontSize: 15,
    color: colors.textTertiary,
    textAlign: 'center',
    paddingHorizontal: layout.screenPaddingX,
  },
  packageSection: {
    borderRadius: radii.md,
    overflow: 'hidden',
  },
  packageHeader: {
    paddingHorizontal: layout.cardPadding,
    paddingVertical: spacing.lg,
    borderRadius: radii.md,
  },
  packageHeaderPressed: {
    backgroundColor: colors.background,
  },
  packageHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  packageLabel: {
    fontFamily: fontFamilies.serifSemibold,
    fontSize: 19,
    color: colors.textPrimary,
  },
  bookCount: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 14,
    color: colors.textTertiary,
  },
  booksList: {
    paddingLeft: spacing.lg,
    paddingTop: spacing.sm,
  },
  bookRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    paddingLeft: spacing.md,
    paddingRight: spacing.xs,
  },
  bookRowPressed: {
    opacity: 0.6,
  },
  bookTitle: {
    ...serifText,
    fontSize: 16,
    color: colors.textPrimary,
  },
  bookAuthor: {
    fontFamily: fontFamilies.sans,
    fontSize: 13,
    color: colors.textTertiary,
    marginTop: spacing.xs,
  },
  // First-visit onboarding prompt
  onboardingCard: {
    margin: layout.cardPadding,
    marginBottom: 0,
    padding: layout.cardPadding,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  onboardingTitle: {
    fontFamily: fontFamilies.serifSemibold,
    fontSize: 17,
    color: colors.textPrimary,
  },
  onboardingBody: {
    ...serifText,
    fontSize: 15,
    lineHeight: 22,
    color: colors.textSecondary,
  },
  onboardingDismiss: {
    alignSelf: 'flex-end',
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  onboardingDismissText: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 14,
    color: colors.accent,
  },
});
