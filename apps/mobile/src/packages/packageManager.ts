/**
 * Package manager — install, uninstall, and query Book Packages.
 *
 * Book Packages are downloadable content bundles: Bible translations,
 * voice-of-the-Church texts. Each package contains passage texts and
 * pre-computed vectors (per embedding model). The seeded library ships
 * with the app; additional packages arrive as downloads.
 *
 * (design spec §3.5, §8: Library + Book Packages)
 */

import * as FileSystem from 'expo-file-system/legacy';
import type { SQLiteDatabase } from 'expo-sqlite';
import { getDatabase } from '../db/database';

// ── Types ───────────────────────────────────────────────────────────────────

export interface InstalledPackage {
  package_id: string;
  version: string | null;
  model_id: string | null;
  installed_at: number;
}

export interface AvailablePackage {
  id: string;
  label: string;
  description: string;
  size_mb: number;
  type: 'bible' | 'voice' | 'mixed';
  available: boolean;
}

// ── Installed packages ──────────────────────────────────────────────────────

/** Query all installed packages from the database. */
export async function getInstalledPackages(): Promise<InstalledPackage[]> {
  const db = getDatabase();
  if (!db) return [];

  try {
    return await db.getAllAsync<InstalledPackage>(
      `SELECT package_id, version, model_id, installed_at
       FROM installed_packages
       ORDER BY installed_at;`
    );
  } catch {
    return [];
  }
}

/** Check if a specific package is installed. */
export async function isPackageInstalled(packageId: string): Promise<boolean> {
  const db = getDatabase();
  if (!db) return false;

  try {
    const row = await db.getFirstAsync<{ c: number }>(
      `SELECT COUNT(*) as c FROM installed_packages WHERE package_id = ?;`,
      packageId
    );
    return (row?.c ?? 0) > 0;
  } catch {
    return false;
  }
}

// ── Available packages ───────────────────────────────────────────────────────

/** The catalog of packages available to download (beyond the seeded library). */
export async function getAvailablePackages(): Promise<AvailablePackage[]> {
  // In a production build, this reads from a bundled catalog file or
  // fetched from a server. For now, return the known catalog.
  return [
    {
      id: 'additional-translations',
      label: 'Additional Translations',
      description: 'ASV and other public-domain Bible translations.',
      size_mb: 28,
      type: 'bible',
      available: true,
    },
    {
      id: 'church-fathers',
      label: 'The Church Fathers',
      description: 'Writings from the early Church Fathers.',
      size_mb: 45,
      type: 'voice',
      available: true,
    },
    {
      id: 'medieval-mystics',
      label: 'Medieval Mystics',
      description: 'Julian of Norwich, Catherine of Siena, Meister Eckhart.',
      size_mb: 38,
      type: 'voice',
      available: true,
    },
    {
      id: 'reformation',
      label: 'Reformation Voices',
      description: 'Luther, Calvin, Knox, and the Reformers.',
      size_mb: 52,
      type: 'voice',
      available: true,
    },
  ];
}

// ── Install / Uninstall ─────────────────────────────────────────────────────

/**
 * Install a Book Package. In production this downloads the package,
 * extracts it, and inserts passages into the database. For now, it marks
 * the package as installed — the actual download/extraction is wired
 * when a CDN is configured.
 */
export async function installPackage(packageId: string): Promise<boolean> {
  const db = getDatabase();
  if (!db) return false;

  try {
    // In production:
    // 1. Download package archive from CDN
    // 2. Extract to filesystem
    // 3. Read passages JSON
    // 4. Insert into books + passages tables (in a transaction)
    // 5. Download vector file for active embedding model
    // 6. Mark as installed

    // For now, just mark as installed.
    await db.runAsync(
      `INSERT OR REPLACE INTO installed_packages (package_id, version, model_id, installed_at)
       VALUES (?, ?, ?, ?);`,
      packageId,
      '1.0.0',
      'voyage-4-nano',
      Date.now()
    );

    return true;
  } catch {
    return false;
  }
}

/**
 * Uninstall a Book Package. Removes all passages and books associated
 * with the package, then deletes the installed_packages record.
 */
export async function uninstallPackage(packageId: string): Promise<boolean> {
  const db = getDatabase();
  if (!db) return false;

  try {
    await db.withTransactionAsync(async () => {
      // Delete passages for books in this package.
      await db.runAsync(
        `DELETE FROM passages
         WHERE book_id IN (
           SELECT id FROM books WHERE package_id = ?
         );`,
        packageId
      );
      // Delete books.
      await db.runAsync(
        `DELETE FROM books WHERE package_id = ?;`,
        packageId
      );
      // Remove from installed_packages.
      await db.runAsync(
        `DELETE FROM installed_packages WHERE package_id = ?;`,
        packageId
      );
    });

    // Also remove the downloaded vector file if it exists.
    const vectorPath = `${FileSystem.documentDirectory}packages/${packageId}/vectors.bin`;
    try {
      const info = await FileSystem.getInfoAsync(vectorPath);
      if (info.exists) {
        await FileSystem.deleteAsync(vectorPath);
      }
    } catch {
      // non-fatal
    }

    return true;
  } catch {
    return false;
  }
}

// ── Storage info ─────────────────────────────────────────────────────────────

export interface StorageInfo {
  /** Total estimated storage used by the app, in bytes. */
  totalBytes: number;
  /** Per-package breakdown. */
  packages: { packageId: string; passageCount: number }[];
}

/** Calculate storage usage from the database. */
export async function getStorageInfo(): Promise<StorageInfo> {
  const db = getDatabase();
  if (!db) return { totalBytes: 0, packages: [] };

  try {
    const totalRow = await db.getFirstAsync<{ total: number }>(
      `SELECT SUM(LENGTH(text)) as total FROM passages;`
    );
    const totalBytes = totalRow?.total ?? 0;

    const packageRows = await db.getAllAsync<{
      package_id: string;
      count: number;
    }>(
      `SELECT b.package_id as package_id, COUNT(p.id) as count
       FROM books b
       LEFT JOIN passages p ON p.book_id = b.id
       GROUP BY b.package_id
       ORDER BY b.package_id;`
    );

    return {
      totalBytes,
      packages: packageRows.map((r) => ({
        packageId: r.package_id ?? 'unknown',
        passageCount: r.count,
      })),
    };
  } catch {
    return { totalBytes: 0, packages: [] };
  }
}
