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
import { Feather } from '@expo/vector-icons';

import {
  cardSurface,
  colors,
  fontFamilies,
  layout,
  listContentContainer,
  radii,
  serifText,
  spacing,
} from '../../theme';
import {
  getLibraryPackages,
  type LibraryPackage,
  type LibraryBook,
} from '../../db/queries/libraryQueries';

interface LibraryBrowserProps {
  onOpenBook: (bookId: string) => void;
}

export function LibraryBrowser({ onOpenBook }: LibraryBrowserProps): ReactNode {
  const [packages, setPackages] = useState<LibraryPackage[] | null>(null);
  const [expandedPkg, setExpandedPkg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getLibraryPackages().then((pkgs) => {
      if (!cancelled) {
        setPackages(pkgs);
        // Auto-expand the first package.
        if (pkgs.length > 0) {
          setExpandedPkg(pkgs[0].package_id);
        }
      }
    });
    return () => {
      cancelled = true;
    };
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
        <Text style={styles.emptyTitle}>The Library is empty.</Text>
        <Text style={styles.emptyDescription}>
          Additional Book Packages can be added from Settings.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
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
                      <Feather
                        name="chevron-right"
                        size={18}
                        color={colors.textTertiary}
                      />
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
});
