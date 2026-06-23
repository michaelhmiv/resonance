/**
 * Model manager — embedding model selection, switching, and vector
 * re-download coordination.
 *
 * When the user switches embedding models, all vectors for installed
 * packages must be re-downloaded (or re-computed) for the new model.
 * This module orchestrates that transition.
 *
 * (design spec §7.1: model switching triggers re-download of all vectors)
 */

import { getDatabase } from '../db/database';
import {
  type EmbeddingModelId,
  EMBEDDING_MODELS,
  type EmbeddingModelInfo,
} from '../embedding/embeddingService';

// ── Active model ─────────────────────────────────────────────────────────────

/** Read the active embedding model from app_settings. Returns 'gte-small' by default. */
export async function getActiveModel(): Promise<EmbeddingModelId> {
  const db = getDatabase();
  if (!db) return 'gte-small';

  try {
    const row = await db.getFirstAsync<{ value: string }>(
      `SELECT value FROM app_settings WHERE key = 'embedding_model';`
    );
    if (row?.value) {
      return row.value as EmbeddingModelId;
    }
  } catch {
    // ignore
  }
  return 'gte-small';
}

/**
 * Switch the active embedding model. Updates app_settings and flags all
 * installed packages as needing new vectors for the new model.
 *
 * In production, this triggers background re-download of vector files
 * for all installed packages. The old vectors are kept until new ones
 * are downloaded (no gap in resonance functionality).
 */
export async function setActiveModel(modelId: EmbeddingModelId): Promise<boolean> {
  const db = getDatabase();
  if (!db) return false;

  try {
    await db.runAsync(
      `INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?);`,
      'embedding_model',
      modelId
    );

    // Update installed_packages to reflect the new model ID (vectors
    // need re-downloading).
    await db.runAsync(
      `UPDATE installed_packages SET model_id = ?;`,
      modelId
    );

    // In production: trigger async download of new vector files for
    // each installed package. The old vectors remain valid until the
    // new ones are loaded.

    return true;
  } catch {
    return false;
  }
}

// ── Model catalog ───────────────────────────────────────────────────────────

/** List all supported embedding models with metadata. */
export function listAvailableModels(): EmbeddingModelInfo[] {
  return [...EMBEDDING_MODELS];
}

// ── Vector download ─────────────────────────────────────────────────────────

export interface VectorDownloadStatus {
  packageId: string;
  modelId: EmbeddingModelId;
  status: 'pending' | 'downloading' | 'complete' | 'error';
  progress: number; // 0..1
}

/**
 * Download the pre-computed vector set for a specific model + package.
 * In production, this downloads a binary file from the CDN. For now,
 * it's a stub that returns immediately.
 */
export async function downloadModelVectors(
  modelId: EmbeddingModelId,
  packageId: string
): Promise<boolean> {
  // In production:
  // 1. Construct URL: cdn.resonance.app/vectors/{modelId}/{packageId}.bin
  // 2. Download to: {documentDirectory}packages/{packageId}/vectors_{modelId}.bin
  // 3. Verify hash against manifest
  // 4. Load into the in-memory vector store
  // 5. Update installed_packages.model_id

  // Stub: just update the database record.
  const db = getDatabase();
  if (!db) return false;

  try {
    await db.runAsync(
      `UPDATE installed_packages SET model_id = ? WHERE package_id = ?;`,
      modelId,
      packageId
    );
    return true;
  } catch {
    return false;
  }
}

// ── LLM model ───────────────────────────────────────────────────────────────

/** Read whether LLM features are enabled. Off by default. */
export async function isLlmEnabled(): Promise<boolean> {
  const db = getDatabase();
  if (!db) return false;

  try {
    const row = await db.getFirstAsync<{ value: string }>(
      `SELECT value FROM app_settings WHERE key = 'llm_enabled';`
    );
    return row?.value === 'true';
  } catch {
    return false;
  }
}

/** Enable or disable LLM features. */
export async function setLlmEnabled(enabled: boolean): Promise<void> {
  const db = getDatabase();
  if (!db) return;

  try {
    await db.runAsync(
      `INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?);`,
      'llm_enabled',
      enabled ? 'true' : 'false'
    );
  } catch {
    // ignore
  }
}
