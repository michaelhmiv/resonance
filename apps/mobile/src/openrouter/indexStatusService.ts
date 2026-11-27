/**
 * Unified Index & Engine Status Service — single source of truth answering:
 *   1. What engine & model is actively running right now for Books, Journal,
 *      Reranking, and Life Diary (On-Device vs OpenRouter vs Hybrid)?
 *   2. Which vector space is active (Shared Voyage-4 512d vs Custom OpenRouter)?
 *   3. Exactly what is ALREADY embedded in the active space (combining
 *      pre-embedded `.rvec` packs on disk + SQLite vectors) vs what still needs
 *      embedding, and whether each item was embedded Locally or via OpenRouter.
 */

import * as FileSystem from 'expo-file-system/legacy';
import {
  DEFAULT_LOCAL_EMBEDDING_MODEL,
  VOYAGE4_SHARED_SPACE_MODELS,
  isVoyage4SharedSpace,
} from '@resonance/core';
import { getDatabase } from '../db/database';
import {
  getPackLocalPaths,
  getWorkLocalPaths,
  useOfflineEngineStore,
} from '../packages/offlineEngineManager';
import {
  getActiveEmbeddingModelId,
  isOpenRouterEnabledForFeature,
  useOpenRouterStore,
} from './openrouterStore';

export type EngineBadgeKind = 'cloud' | 'local' | 'hybrid' | 'preembedded' | 'off';

export interface ActivePipelineSummary {
  overallMode: 'cloud' | 'hybrid' | 'local';
  overallLabel: string;
  booksEngine: EngineBadgeKind;
  booksModel: string;
  journalEngine: EngineBadgeKind;
  journalModel: string;
  rerankerEngine: EngineBadgeKind;
  rerankerModel: string;
  diaryEngine: EngineBadgeKind;
  diaryDetail: string;
  activeSearchModel: string;
  isVoyage4Space: boolean;
  localEmbedderInstalled: boolean;
  localRerankerInstalled: boolean;
}

export type ScopeCoverageStatus = 'ready' | 'partial' | 'missing' | 'empty';

export interface ScopeIndexCoverage {
  scope: 'bible' | 'church' | 'personal' | 'journal' | 'highlights';
  label: string;
  status: ScopeCoverageStatus;
  embeddedCount: number;
  totalCount: number;
  /** Short human count, e.g. "31,102 verses", "12 books", "4 / 5 books" */
  countLabel: string;
  /** Where the active embeddings came from */
  sourceBadge: string;
  sourceKind: EngineBadgeKind;
  /** Optional guidance when missing or partial */
  detail: string;
  /** True when user can re-embed this scope in the active OpenRouter model */
  needsReembed: boolean;
}

export interface IndexCoverageReport {
  pipeline: ActivePipelineSummary;
  scopes: ScopeIndexCoverage[];
  totalMissingInActiveSpace: number;
  /** True when on a custom non-Voyage-4 model and Bible/Church/Personal have 0 indexed rows */
  customSpaceNeedsInitialReembed: boolean;
  biblePreembeddedReady: boolean;
  checkedAt: number;
}

/** Compact model display name (strips org prefix for tight badges). */
export function formatShortModelName(modelId: string): string {
  if (modelId === DEFAULT_LOCAL_EMBEDDING_MODEL) return 'Voyage-4-Nano (Local)';
  const parts = modelId.split('/');
  return parts.length > 1 ? parts[1] : modelId;
}

/** Synchronous snapshot of what engines/models are currently active across Resonance. */
export function getActivePipelineSummary(): ActivePipelineSummary {
  const or = useOpenRouterStore.getState();
  const offline = useOfflineEngineStore.getState();
  const localEmbedderInstalled =
    offline.phase === 'ready' || offline.groups.embedder.ready;
  const localRerankerInstalled =
    offline.rerankerPhase === 'ready' || offline.groups.reranker.ready;

  const booksCloud = isOpenRouterEnabledForFeature('embeddings', 'books');
  const journalCloud = isOpenRouterEnabledForFeature('embeddings', 'journal');
  const rerankCloud = isOpenRouterEnabledForFeature('reranking', 'journal');
  const diaryCloud =
    or.hasKey &&
    or.routingMode === 'cloud_with_fallback' &&
    !or.creditsExhausted &&
    (or.features.voice || or.features.photosAndVideos);

  const booksModel = getActiveEmbeddingModelId('books');
  const journalModel = getActiveEmbeddingModelId('journal');
  const activeSearchModel = getActiveEmbeddingModelId('search');
  const isVoyage4Space = isVoyage4SharedSpace(activeSearchModel);

  let overallMode: 'cloud' | 'hybrid' | 'local' = 'local';
  let overallLabel = '100% On-Device';
  if (or.hasKey && or.routingMode === 'cloud_with_fallback' && !or.creditsExhausted) {
    overallMode = 'cloud';
    overallLabel = 'OpenRouter Cloud';
  } else if (or.hasKey && or.routingMode === 'hybrid_books_only' && !or.creditsExhausted) {
    overallMode = 'hybrid';
    overallLabel = 'Hybrid (Cloud Books · Local Journal)';
  }

  let rerankerEngine: EngineBadgeKind = 'off';
  let rerankerModel = 'Dense search only';
  if (rerankCloud) {
    rerankerEngine = 'cloud';
    rerankerModel = or.rerankerModel;
  } else if (localRerankerInstalled) {
    rerankerEngine = 'local';
    rerankerModel = 'qwen3-reranker-0.6b';
  }

  const diaryParts: string[] = [];
  if (diaryCloud) {
    if (or.features.voice) diaryParts.push(formatShortModelName(or.transcriptionModel));
    if (or.features.photosAndVideos) diaryParts.push(formatShortModelName(or.visionModel));
  }

  return {
    overallMode,
    overallLabel,
    booksEngine: booksCloud ? 'cloud' : localEmbedderInstalled ? 'local' : 'off',
    booksModel: booksCloud
      ? booksModel
      : localEmbedderInstalled
        ? DEFAULT_LOCAL_EMBEDDING_MODEL
        : 'Not downloaded',
    journalEngine: journalCloud ? 'cloud' : localEmbedderInstalled ? 'local' : 'off',
    journalModel: journalCloud
      ? journalModel
      : localEmbedderInstalled
        ? DEFAULT_LOCAL_EMBEDDING_MODEL
        : 'Not downloaded',
    rerankerEngine,
    rerankerModel,
    diaryEngine: diaryCloud ? 'cloud' : 'off',
    diaryDetail: diaryCloud
      ? diaryParts.join(' + ')
      : or.hasKey && or.routingMode === 'hybrid_books_only'
        ? 'Paused in Hybrid mode'
        : 'Off (Local-only)',
    activeSearchModel,
    isVoyage4Space,
    localEmbedderInstalled,
    localRerankerInstalled,
  };
}

function describeLocalCloudBreakdown(
  localCount: number,
  cloudCount: number,
  fallbackCloudModel: string
): { badge: string; kind: EngineBadgeKind } {
  if (cloudCount > 0 && localCount > 0) {
    return { badge: 'Local + OpenRouter (compatible)', kind: 'hybrid' };
  }
  if (cloudCount > 0) {
    return { badge: `OpenRouter · ${formatShortModelName(fallbackCloudModel)}`, kind: 'cloud' };
  }
  if (localCount > 0) {
    return { badge: 'On-Device · Voyage-4-Nano', kind: 'local' };
  }
  return { badge: 'Not indexed', kind: 'off' };
}

/**
 * Computes real-time coverage across all 5 corpora (Bible, Church Library,
 * Personal Library, Journal/Diary, Highlights) for the CURRENTLY ACTIVE vector space.
 */
export async function getIndexCoverageReport(): Promise<IndexCoverageReport> {
  const pipeline = getActivePipelineSummary();
  const db = getDatabase();
  const offline = useOfflineEngineStore.getState();

  const compatModels = pipeline.isVoyage4Space
    ? [...VOYAGE4_SHARED_SPACE_MODELS]
    : [pipeline.activeSearchModel];
  const placeholders = compatModels.map(() => '?').join(',');

  // Check pre-embedded `.rvec` files on disk (only valid in Voyage-4 512d space)
  let bibleRvecReady = false;
  for (const pack of offline.corpusManifest.packs ?? []) {
    if (pack.kind !== 'bible') continue;
    try {
      const info = await FileSystem.getInfoAsync(getPackLocalPaths(pack.id).vectorsPath);
      if (info.exists && ((info as { size?: number }).size ?? 0) > 0) {
        bibleRvecReady = true;
        break;
      }
    } catch {
      // ignore
    }
  }

  let churchRvecWorkCount = 0;
  for (const work of offline.corpusManifest.works ?? []) {
    try {
      const info = await FileSystem.getInfoAsync(getWorkLocalPaths(work.slug).vectorsPath);
      if (info.exists && ((info as { size?: number }).size ?? 0) > 0) {
        churchRvecWorkCount++;
      }
    } catch {
      // ignore
    }
  }

  const scopes: ScopeIndexCoverage[] = [];

  if (!db) {
    return {
      pipeline,
      scopes,
      totalMissingInActiveSpace: 0,
      customSpaceNeedsInitialReembed: false,
      biblePreembeddedReady: bibleRvecReady,
      checkedAt: Date.now(),
    };
  }

  // ── 1. Scripture (WEB Bible) ──────────────────────────────────────────────
  const bibleRow = await db
    .getFirstAsync<{ total: number; sql_done: number; cloud_done: number; local_done: number }>(
      `SELECT
         COUNT(DISTINCT p.id) AS total,
         COUNT(DISTINCT CASE WHEN pv.passage_id IS NOT NULL THEN p.id END) AS sql_done,
         COUNT(DISTINCT CASE WHEN pv.model_id IS NOT NULL AND pv.model_id != ? THEN p.id END) AS cloud_done,
         COUNT(DISTINCT CASE WHEN pv.model_id = ? THEN p.id END) AS local_done
       FROM passages p
       LEFT JOIN passage_vectors pv
         ON pv.passage_id = p.id AND pv.model_id IN (${placeholders})
       WHERE p.translation = 'WEB';`,
      [DEFAULT_LOCAL_EMBEDDING_MODEL, DEFAULT_LOCAL_EMBEDDING_MODEL, ...compatModels]
    )
    .catch(() => null);

  const bibleTotal = bibleRow?.total ?? 0;
  const bibleSqlDone = bibleRow?.sql_done ?? 0;
  if (pipeline.isVoyage4Space && bibleRvecReady && bibleTotal > 0) {
    scopes.push({
      scope: 'bible',
      label: 'Scripture (WEB Bible)',
      status: 'ready',
      embeddedCount: bibleTotal,
      totalCount: bibleTotal,
      countLabel: `${bibleTotal.toLocaleString()} verses ready`,
      sourceBadge: 'Pre-embedded pack · Voyage-4',
      sourceKind: 'preembedded',
      detail: 'Already pre-embedded in Voyage-4 512d — zero API cost, works offline & with OpenRouter Voyage-4.',
      needsReembed: false,
    });
  } else if (bibleTotal > 0) {
    const done = bibleSqlDone;
    const status: ScopeCoverageStatus =
      done >= bibleTotal ? 'ready' : done > 0 ? 'partial' : 'missing';
    const breakdown = describeLocalCloudBreakdown(
      bibleRow?.local_done ?? 0,
      bibleRow?.cloud_done ?? 0,
      pipeline.activeSearchModel
    );
    scopes.push({
      scope: 'bible',
      label: 'Scripture (WEB Bible)',
      status,
      embeddedCount: done,
      totalCount: bibleTotal,
      countLabel: `${done.toLocaleString()} / ${bibleTotal.toLocaleString()} verses`,
      sourceBadge: done > 0 ? breakdown.badge : 'Not indexed for active model',
      sourceKind: done > 0 ? breakdown.kind : 'off',
      detail: pipeline.isVoyage4Space
        ? 'Download the ~4 MB pre-embedded Bible pack in Offline Engine (free, no API calls).'
        : `Pre-embedded Voyage-4 Bible pack cannot mix with ${formatShortModelName(pipeline.activeSearchModel)} — tap Re-embed below.`,
      needsReembed: !pipeline.isVoyage4Space && done < bibleTotal,
    });
  }

  // ── 2. Downloaded Church Library ──────────────────────────────────────────
  const churchRow = await db
    .getFirstAsync<{
      total: number;
      book_cnt: number;
      sql_done: number;
      cloud_done: number;
      local_done: number;
    }>(
      `SELECT
         COUNT(DISTINCT p.id) AS total,
         COUNT(DISTINCT p.book_id) AS book_cnt,
         COUNT(DISTINCT CASE WHEN pv.passage_id IS NOT NULL THEN p.id END) AS sql_done,
         COUNT(DISTINCT CASE WHEN pv.model_id IS NOT NULL AND pv.model_id != ? THEN p.id END) AS cloud_done,
         COUNT(DISTINCT CASE WHEN pv.model_id = ? THEN p.id END) AS local_done
       FROM passages p
       LEFT JOIN personal_books pb ON pb.book_id = p.book_id
       LEFT JOIN passage_vectors pv
         ON pv.passage_id = p.id AND pv.model_id IN (${placeholders})
       WHERE p.translation IS NULL AND pb.book_id IS NULL;`,
      [DEFAULT_LOCAL_EMBEDDING_MODEL, DEFAULT_LOCAL_EMBEDDING_MODEL, ...compatModels]
    )
    .catch(() => null);

  const churchTotal = churchRow?.total ?? 0;
  const churchBooks = churchRow?.book_cnt ?? 0;
  if (churchTotal === 0 && churchRvecWorkCount === 0) {
    scopes.push({
      scope: 'church',
      label: 'Church Library',
      status: 'empty',
      embeddedCount: 0,
      totalCount: 0,
      countLabel: 'No books downloaded yet',
      sourceBadge: 'Optional catalog',
      sourceKind: 'off',
      detail: 'Browse & download classics in Word → Library (they ship pre-embedded in Voyage-4 512d).',
      needsReembed: false,
    });
  } else if (pipeline.isVoyage4Space && churchRvecWorkCount > 0) {
    scopes.push({
      scope: 'church',
      label: 'Church Library',
      status: 'ready',
      embeddedCount: churchTotal || churchRvecWorkCount,
      totalCount: churchTotal || churchRvecWorkCount,
      countLabel: `${churchRvecWorkCount} ${churchRvecWorkCount === 1 ? 'book' : 'books'} ready`,
      sourceBadge: 'Pre-embedded packs · Voyage-4',
      sourceKind: 'preembedded',
      detail: 'Downloaded books include pre-embedded Voyage-4 vectors — zero API cost.',
      needsReembed: false,
    });
  } else {
    const done = churchRow?.sql_done ?? 0;
    const status: ScopeCoverageStatus =
      done >= churchTotal ? 'ready' : done > 0 ? 'partial' : 'missing';
    const breakdown = describeLocalCloudBreakdown(
      churchRow?.local_done ?? 0,
      churchRow?.cloud_done ?? 0,
      pipeline.activeSearchModel
    );
    scopes.push({
      scope: 'church',
      label: 'Church Library',
      status,
      embeddedCount: done,
      totalCount: churchTotal,
      countLabel: `${done.toLocaleString()} / ${churchTotal.toLocaleString()} passages (${churchBooks} ${churchBooks === 1 ? 'book' : 'books'})`,
      sourceBadge: done > 0 ? breakdown.badge : 'Needs re-embed for active model',
      sourceKind: done > 0 ? breakdown.kind : 'off',
      detail: `Re-embed your downloaded Church books to include them in ${formatShortModelName(pipeline.activeSearchModel)} echoes.`,
      needsReembed: !pipeline.isVoyage4Space && done < churchTotal,
    });
  }

  // ── 3. Personal Library ───────────────────────────────────────────────────
  const persRow = await db
    .getFirstAsync<{
      total: number;
      book_cnt: number;
      sql_done: number;
      cloud_done: number;
      local_done: number;
    }>(
      `SELECT
         COUNT(DISTINCT p.id) AS total,
         COUNT(DISTINCT pb.book_id) AS book_cnt,
         COUNT(DISTINCT CASE WHEN pv.passage_id IS NOT NULL THEN p.id END) AS sql_done,
         COUNT(DISTINCT CASE WHEN pv.model_id IS NOT NULL AND pv.model_id != ? THEN p.id END) AS cloud_done,
         COUNT(DISTINCT CASE WHEN pv.model_id = ? THEN p.id END) AS local_done
       FROM passages p
       JOIN personal_books pb ON pb.book_id = p.book_id
       LEFT JOIN passage_vectors pv
         ON pv.passage_id = p.id AND pv.model_id IN (${placeholders})
       WHERE pb.ocr_required = 0;`,
      [DEFAULT_LOCAL_EMBEDDING_MODEL, DEFAULT_LOCAL_EMBEDDING_MODEL, ...compatModels]
    )
    .catch(() => null);

  const persTotal = persRow?.total ?? 0;
  const persBooks = persRow?.book_cnt ?? 0;
  const persDone = persRow?.sql_done ?? 0;
  if (persTotal === 0) {
    scopes.push({
      scope: 'personal',
      label: 'Personal Library',
      status: 'empty',
      embeddedCount: 0,
      totalCount: 0,
      countLabel: 'No books imported yet',
      sourceBadge:
        pipeline.booksEngine === 'cloud'
          ? `Will use OpenRouter (${formatShortModelName(pipeline.booksModel)})`
          : 'Will use On-Device',
      sourceKind: pipeline.booksEngine,
      detail: 'Import EPUB, PDF, DOCX, Markdown, or TXT in Personal Library below.',
      needsReembed: false,
    });
  } else {
    const status: ScopeCoverageStatus =
      persDone >= persTotal ? 'ready' : persDone > 0 ? 'partial' : 'missing';
    const breakdown = describeLocalCloudBreakdown(
      persRow?.local_done ?? 0,
      persRow?.cloud_done ?? 0,
      pipeline.booksModel
    );
    scopes.push({
      scope: 'personal',
      label: 'Personal Library',
      status,
      embeddedCount: persDone,
      totalCount: persTotal,
      countLabel: `${persDone.toLocaleString()} / ${persTotal.toLocaleString()} passages (${persBooks} ${persBooks === 1 ? 'book' : 'books'})`,
      sourceBadge: persDone > 0 ? breakdown.badge : 'Not indexed for active model',
      sourceKind: persDone > 0 ? breakdown.kind : 'off',
      detail:
        status === 'ready'
          ? 'All imported passages are indexed in your active vector space.'
          : pipeline.isVoyage4Space
            ? 'Pending passages embed automatically using your active embedder.'
            : `Re-embed your personal books for ${formatShortModelName(pipeline.activeSearchModel)}.`,
      needsReembed: !pipeline.isVoyage4Space && persDone < persTotal,
    });
  }

  // ── 4. Journal & Life Diary ───────────────────────────────────────────────
  const journalRow = await db
    .getFirstAsync<{
      total: number;
      sql_done: number;
      cloud_done: number;
      local_done: number;
    }>(
      `SELECT
         COUNT(DISTINCT js.id) AS total,
         COUNT(DISTINCT CASE WHEN jsv.segment_id IS NOT NULL THEN js.id END) AS sql_done,
         COUNT(DISTINCT CASE WHEN jsv.model_id IS NOT NULL AND jsv.model_id != ? THEN js.id END) AS cloud_done,
         COUNT(DISTINCT CASE WHEN jsv.model_id = ? THEN js.id END) AS local_done
       FROM journal_segments js
       LEFT JOIN journal_segment_vectors jsv
         ON jsv.segment_id = js.id AND jsv.model_id IN (${placeholders})
       WHERE js.segment_type IN ('text', 'voice', 'photo', 'video')
         AND LENGTH(TRIM(COALESCE(js.text, ''))) >= 12;`,
      [DEFAULT_LOCAL_EMBEDDING_MODEL, DEFAULT_LOCAL_EMBEDDING_MODEL, ...compatModels]
    )
    .catch(() => null);

  const jTotal = journalRow?.total ?? 0;
  const jDone = journalRow?.sql_done ?? 0;
  if (jTotal === 0) {
    scopes.push({
      scope: 'journal',
      label: 'Journal & Diary Memories',
      status: 'empty',
      embeddedCount: 0,
      totalCount: 0,
      countLabel: 'No entries indexed yet',
      sourceBadge:
        pipeline.journalEngine === 'cloud'
          ? `Will use OpenRouter (${formatShortModelName(pipeline.journalModel)})`
          : 'Will use On-Device',
      sourceKind: pipeline.journalEngine,
      detail: 'Entries, voice transcripts, and photo notes embed automatically as you capture them.',
      needsReembed: false,
    });
  } else {
    const status: ScopeCoverageStatus =
      jDone >= jTotal ? 'ready' : jDone > 0 ? 'partial' : 'missing';
    const breakdown = describeLocalCloudBreakdown(
      journalRow?.local_done ?? 0,
      journalRow?.cloud_done ?? 0,
      pipeline.journalModel
    );
    scopes.push({
      scope: 'journal',
      label: 'Journal & Diary Memories',
      status,
      embeddedCount: jDone,
      totalCount: jTotal,
      countLabel: `${jDone.toLocaleString()} / ${jTotal.toLocaleString()} entries`,
      sourceBadge: jDone > 0 ? breakdown.badge : 'Not indexed for active model',
      sourceKind: jDone > 0 ? breakdown.kind : 'off',
      detail:
        status === 'ready'
          ? 'Past entries & diary memories are searchable semantically.'
          : 'Unindexed entries can be embedded via Re-embed Libraries.',
      needsReembed: jDone < jTotal,
    });
  }

  // ── 5. Highlights & Margin Notes ──────────────────────────────────────────
  const hlRow = await db
    .getFirstAsync<{
      total: number;
      sql_done: number;
      cloud_done: number;
      local_done: number;
    }>(
      `SELECT
         COUNT(DISTINCT h.id) AS total,
         COUNT(DISTINCT CASE WHEN hv.highlight_id IS NOT NULL THEN h.id END) AS sql_done,
         COUNT(DISTINCT CASE WHEN hv.model_id IS NOT NULL AND hv.model_id != ? THEN h.id END) AS cloud_done,
         COUNT(DISTINCT CASE WHEN hv.model_id = ? THEN h.id END) AS local_done
       FROM highlights h
       LEFT JOIN highlight_vectors hv
         ON hv.highlight_id = h.id AND hv.kind = 'highlight' AND hv.model_id IN (${placeholders})
       WHERE LENGTH(TRIM(COALESCE(h.selected_text, ''))) >= 4;`,
      [DEFAULT_LOCAL_EMBEDDING_MODEL, DEFAULT_LOCAL_EMBEDDING_MODEL, ...compatModels]
    )
    .catch(() => null);

  const hlTotal = hlRow?.total ?? 0;
  const hlDone = hlRow?.sql_done ?? 0;
  if (hlTotal > 0) {
    const status: ScopeCoverageStatus =
      hlDone >= hlTotal ? 'ready' : hlDone > 0 ? 'partial' : 'missing';
    const breakdown = describeLocalCloudBreakdown(
      hlRow?.local_done ?? 0,
      hlRow?.cloud_done ?? 0,
      pipeline.journalModel
    );
    scopes.push({
      scope: 'highlights',
      label: 'Highlights & Notes',
      status,
      embeddedCount: hlDone,
      totalCount: hlTotal,
      countLabel: `${hlDone.toLocaleString()} / ${hlTotal.toLocaleString()} highlights`,
      sourceBadge: hlDone > 0 ? breakdown.badge : 'Not indexed for active model',
      sourceKind: hlDone > 0 ? breakdown.kind : 'off',
      detail:
        status === 'ready'
          ? 'Your reading highlights & margin notes surface in Echoes.'
          : 'Unindexed highlights can be embedded automatically or via Re-embed.',
      needsReembed: hlDone < hlTotal,
    });
  }

  const totalMissingInActiveSpace = scopes.reduce(
    (sum, s) => sum + Math.max(0, s.totalCount - s.embeddedCount),
    0
  );

  const bibleScope = scopes.find((s) => s.scope === 'bible');
  const churchScope = scopes.find((s) => s.scope === 'church');
  const customSpaceNeedsInitialReembed =
    !pipeline.isVoyage4Space &&
    (bibleScope?.embeddedCount ?? 0) === 0 &&
    (churchScope?.embeddedCount ?? 0) === 0 &&
    ((bibleScope?.totalCount ?? 0) > 0 || (churchScope?.totalCount ?? 0) > 0);

  return {
    pipeline,
    scopes,
    totalMissingInActiveSpace,
    customSpaceNeedsInitialReembed,
    biblePreembeddedReady: bibleRvecReady,
    checkedAt: Date.now(),
  };
}
