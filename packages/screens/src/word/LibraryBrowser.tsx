/**
 * Library browser — browse voice-of-the-Church and Personal Library texts
 * grouped by Book Package / Collection shelf.
 */

import {
  useCallback,
  useEffect,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { ChevronDownIcon, ChevronRightIcon } from '@resonance/ui';

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
import {
  getCachedSync,
  type LibraryBook,
  type LibraryPackage,
} from '@resonance/core';
import { useDataLayer } from '@resonance/core/data-layer-context';

interface LibraryBrowserProps {
  onOpenBook: (bookId: string) => void;
  /** Optional mobile callback to browse & download optional Church Library books/collections. */
  onOpenCatalog?: () => void;
  /** Optional mobile callback to open the device folder / file import modal. */
  onOpenImport?: () => void;
  /** Optional mobile callback to edit metadata for a personal imported work. */
  onEditBookMetadata?: (book: LibraryBook) => void;
  /** Optional revision counter to refresh packages after import/edit/delete. */
  libraryRevision?: number;
  /** Optional header rendered above packages (e.g. Continue Reading / Sync status). */
  ListHeaderComponent?: ReactElement | null;
}

interface CachedWebLibraryResponse {
  books?: Array<{
    id: string;
    title: string | null;
    author: string | null;
    era: string | null;
    packageId: string;
    packageLabel: string;
    enabled?: boolean;
  }>;
}

const PackageSeparator = () => <View style={styles.packageGap} />;

function readCachedPackages(): LibraryPackage[] | null {
  const raw = getCachedSync<CachedWebLibraryResponse>('/api/library/books');
  if (!raw?.books) return null;
  const byPackage = new Map<string, LibraryPackage>();
  for (const book of raw.books) {
    if (book.enabled === false) continue;
    const existing = byPackage.get(book.packageId) ?? {
      package_id: book.packageId,
      label: book.packageLabel,
      books: [],
    };
    existing.books.push({
      id: book.id,
      title: book.title,
      author: book.author,
      era: book.era,
      package_id: book.packageId,
    });
    byPackage.set(book.packageId, existing);
  }
  return Array.from(byPackage.values()).sort((a, b) =>
    a.package_id.localeCompare(b.package_id)
  );
}

function personalStatusLabel(book: LibraryBook): string | null {
  if (!book.isPersonal) return null;
  const parts: string[] = [];
  if (book.sourceFormat) parts.push(book.sourceFormat.toUpperCase());
  if (book.embeddingStatus === 'ready') {
    parts.push(
      book.includeInResonance === false ? 'Library only' : 'Ready for echoes'
    );
  } else if (book.embeddingStatus === 'embedding') {
    parts.push(`Embedding ${book.embeddedChunks ?? 0}/${book.totalChunks ?? 0}`);
  } else if (book.embeddingStatus === 'error') {
    parts.push('Embedding paused');
  } else if (book.ocrRequired) {
    parts.push('Needs OCR');
  } else {
    parts.push('Pending engine');
  }
  return parts.join(' · ');
}

export function LibraryBrowser({
  onOpenBook,
  onOpenCatalog,
  onOpenImport,
  onEditBookMetadata,
  libraryRevision = 0,
  ListHeaderComponent,
}: LibraryBrowserProps): ReactNode {
  const [packages, setPackages] = useState<LibraryPackage[] | null>(() =>
    readCachedPackages()
  );
  const dataLayer = useDataLayer();
  const [expandedPkgs, setExpandedPkgs] = useState<Set<string>>(() => {
    const cached = readCachedPackages();
    return cached && cached.length > 0 ? new Set([cached[0].package_id]) : new Set();
  });
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showOnboarding, setShowOnboarding] = useState<boolean>(false);

  useEffect(() => {
    let cancelled = false;
    dataLayer
      .getLibraryPackages()
      .then((pkgs) => {
        if (cancelled) return;
        setPackages(pkgs);
        setLoadError(null);
        if (pkgs.length > 0) {
          setExpandedPkgs((prev) =>
            prev.size > 0 ? prev : new Set([pkgs[0].package_id])
          );
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setLoadError(
            err instanceof Error ? err.message : 'Unable to load Library.'
          );
          setPackages((prev) => prev ?? []);
        }
      });

    // Only show web per-book Settings onboarding on web (where onOpenCatalog is absent)
    if (!onOpenCatalog && !onOpenImport) {
      dataLayer
        .getSettings()
        .then((settings) => {
          if (!cancelled) {
            setShowOnboarding(!settings?.library_seen_at);
          }
        })
        .catch(() => {
          if (!cancelled) setShowOnboarding(false);
        });
    } else {
      setShowOnboarding(false);
    }

    return () => {
      cancelled = true;
    };
  }, [dataLayer, libraryRevision, onOpenCatalog, onOpenImport]);

  const dismissOnboarding = useCallback(async () => {
    setShowOnboarding(false);
    try {
      await dataLayer.setSetting?.('library_seen_at', new Date().toISOString());
    } catch {
      // best-effort
    }
  }, [dataLayer]);

  const togglePackage = useCallback((pkgId: string) => {
    setExpandedPkgs((prev) => {
      const next = new Set(prev);
      if (next.has(pkgId)) next.delete(pkgId);
      else next.add(pkgId);
      return next;
    });
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
        {ListHeaderComponent ? (
          <View style={styles.emptyHeaderWrap}>{ListHeaderComponent}</View>
        ) : null}
        <Text style={styles.emptyTitle}>
          {loadError ? 'Unable to load Library.' : 'Build your Library.'}
        </Text>
        <Text style={styles.emptyDescription}>
          {loadError ??
            (onOpenCatalog || onOpenImport
              ? 'Browse 72 public-domain Church classics to download individual books or collections, or add your own EPUB, PDF, and text files from your device.'
              : 'You can opt back in to any package from Settings → Library Contents.')}
        </Text>
        <View style={styles.emptyActionsRow}>
          {onOpenCatalog ? (
            <Pressable
              onPress={onOpenCatalog}
              style={styles.importEmptyBtn}
              accessibilityRole="button"
              accessibilityLabel="Browse Library catalog"
            >
              <Text style={styles.importEmptyBtnText}>Browse Catalog</Text>
            </Pressable>
          ) : null}
          {onOpenImport ? (
            <Pressable
              onPress={onOpenImport}
              style={styles.importEmptySecondaryBtn}
              accessibilityRole="button"
              accessibilityLabel="Add books from device folder"
            >
              <Text style={styles.importEmptySecondaryBtnText}>+ Your Files</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    );
  }

  const listHeader = (
    <View style={styles.listHeaderWrap}>
      {ListHeaderComponent ?? null}
      {onOpenCatalog || onOpenImport ? (
        <View style={styles.importBar}>
          {onOpenCatalog ? (
            <Pressable
              onPress={onOpenCatalog}
              style={styles.importBarBtn}
              accessibilityRole="button"
              accessibilityLabel="Browse Library catalog"
            >
              <Text style={styles.importBarBtnText}>Browse Catalog</Text>
            </Pressable>
          ) : null}
          {onOpenImport ? (
            <Pressable
              onPress={onOpenImport}
              style={styles.importBarSecondaryBtn}
              accessibilityRole="button"
              accessibilityLabel="Add books from device folder"
            >
              <Text style={styles.importBarSecondaryBtnText}>+ Your Files</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {showOnboarding ? (
        <View style={styles.onboardingCard}>
          <Text style={styles.onboardingTitle}>Customize your Library</Text>
          <Text style={styles.onboardingBody}>
            You can choose which collections of voices appear here and in
            resonance results — from Settings → Library Contents, anytime.
            For now, everything is enabled.
          </Text>
          <Pressable
            onPress={() => void dismissOnboarding()}
            style={styles.onboardingDismiss}
            accessibilityRole="button"
            accessibilityLabel="Dismiss"
          >
            <Text style={styles.onboardingDismissText}>Got it</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );

  return (
    <View style={styles.container}>
      <FlatList
        data={packages}
        keyExtractor={(item) => item.package_id}
        ListHeaderComponent={listHeader}
        contentContainerStyle={[listContentContainer, styles.listContent]}
        renderItem={({ item: pkg }) => {
          const expanded = expandedPkgs.has(pkg.package_id);
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
                accessibilityState={{ expanded }}
                accessibilityLabel={`${pkg.label} — ${pkg.books.length} works`}
              >
                <View style={styles.packageHeaderRow}>
                  <Text style={styles.packageLabel}>{pkg.label}</Text>
                  <View style={styles.packageHeaderRight}>
                    <Text style={styles.bookCount}>{pkg.books.length}</Text>
                    {expanded ? (
                      <ChevronDownIcon size={16} color={colors.textTertiary} />
                    ) : (
                      <ChevronRightIcon size={16} color={colors.textTertiary} />
                    )}
                  </View>
                </View>
              </Pressable>

              {expanded ? (
                <View style={styles.booksList}>
                  {pkg.books.map((book: LibraryBook) => {
                    const statusText = personalStatusLabel(book);
                    return (
                      <View key={book.id} style={styles.bookRowWrap}>
                        <Pressable
                          onPress={() => onOpenBook(book.id)}
                          style={({ pressed }) => [
                            styles.bookRow,
                            pressed && styles.bookRowPressed,
                          ]}
                          accessibilityRole="button"
                          accessibilityLabel={book.title ?? book.id}
                        >
                          <View style={styles.bookMetaCol}>
                            <Text style={styles.bookTitle}>
                              {book.title ?? book.id}
                            </Text>
                            {book.author ? (
                              <Text style={styles.bookAuthor}>{book.author}</Text>
                            ) : null}
                            {statusText ? (
                              <Text style={styles.bookPersonalMeta}>
                                {statusText}
                              </Text>
                            ) : null}
                          </View>
                          <View style={styles.bookRightActions}>
                            {book.isPersonal && onEditBookMetadata ? (
                              <Pressable
                                onPress={() => onEditBookMetadata(book)}
                                hitSlop={8}
                                style={styles.editMetaBtn}
                                accessibilityRole="button"
                                accessibilityLabel={`Edit metadata for ${book.title ?? book.id}`}
                              >
                                <Text style={styles.editMetaBtnText}>Edit</Text>
                              </Pressable>
                            ) : null}
                            <ChevronRightIcon
                              size={18}
                              color={colors.textTertiary}
                            />
                          </View>
                        </Pressable>
                      </View>
                    );
                  })}
                </View>
              ) : null}
            </View>
          );
        }}
        ItemSeparatorComponent={PackageSeparator}
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
  listContent: {
    paddingTop: spacing.md,
    paddingBottom: spacing.xxl,
  },
  listHeaderWrap: {
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  emptyHeaderWrap: {
    width: '100%',
    paddingHorizontal: layout.screenPaddingX,
    marginBottom: spacing.lg,
  },
  packageGap: {
    height: spacing.md,
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
    gap: spacing.sm,
  },
  packageHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  packageLabel: {
    flex: 1,
    fontFamily: fontFamilies.serifSemibold,
    fontSize: 19,
    color: colors.textPrimary,
  },
  bookCount: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 13.5,
    color: colors.textTertiary,
  },
  booksList: {
    paddingLeft: spacing.md,
    paddingTop: spacing.xs,
  },
  bookRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    paddingLeft: spacing.sm,
    paddingRight: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
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
  onboardingCard: {
    padding: layout.cardPadding,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
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
  emptyActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginTop: spacing.lg,
    flexWrap: 'wrap',
  },
  importEmptyBtn: {
    paddingHorizontal: spacing.xl,
    paddingVertical: 11,
    borderRadius: radii.md,
    backgroundColor: colors.accent,
  },
  importEmptyBtnText: {
    fontFamily: fontFamilies.sansSemibold,
    fontSize: 14,
    color: colors.surface,
  },
  importEmptySecondaryBtn: {
    paddingHorizontal: spacing.xl,
    paddingVertical: 11,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  importEmptySecondaryBtnText: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 14,
    color: colors.accent,
  },
  importBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  importBarBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: radii.md,
    backgroundColor: colors.accent,
    alignItems: 'center',
  },
  importBarBtnText: {
    fontFamily: fontFamilies.sansSemibold,
    fontSize: 13.5,
    color: colors.surface,
  },
  importBarSecondaryBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    alignItems: 'center',
  },
  importBarSecondaryBtnText: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 13.5,
    color: colors.accent,
  },
  bookRowWrap: {
    width: '100%',
  },
  bookMetaCol: {
    flex: 1,
    paddingRight: spacing.sm,
  },
  bookPersonalMeta: {
    fontFamily: fontFamilies.sans,
    fontSize: 11.5,
    color: colors.accent,
    marginTop: 2,
  },
  bookRightActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  editMetaBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  editMetaBtnText: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 11.5,
    color: colors.accent,
  },
});
