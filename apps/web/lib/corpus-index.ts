/**
 * corpus-index.ts — Zone A HNSW index loader + search singleton.
 *
 * Loads the pre-built HNSW index (corpus.hnsw + corpus.idmap) once at
 * server startup and provides O(log N) searchKnn queries. Replaces the
 * brute-force scoreAllRows streaming path in route.ts.
 *
 * Memory: ~2.6 GB (float32 embeddings stored by hnswlib internally).
 * This replaces the old 648 MB int8 vectorBuf + rowNorms.
 *
 * Lifecycle:
 *   - ensureIndex() called on first resonance request or at server boot
 *   - Index + idmap loaded once, cached at module level
 *   - search(queryVec, k, efSearch) returns ranked passage keys + similarities
 *   - Graceful fallback: if index files missing, returns null (caller should
 *     fall back to lexical or brute-force)
 */
import { existsSync, statSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { execFile } from 'child_process';
import { incCounter, observeLatencyMs, recordEvent, setGauge } from './resonance-metrics';

// hnswlib-node is a C++ addon; lazy-import so the module doesn't crash at
// import time if the native addon is missing (e.g. in local dev without it).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let hnswlibModule: any = null;
let lastLoadError: string | null = null;

async function getHnswlib() {
  if (!hnswlibModule) {
    hnswlibModule = await import('hnswlib-node');
  }
  return hnswlibModule;
}

/** Expose last HNSW load error for diagnostics */
export function getLastLoadError(): string | null { return lastLoadError; }

// ── Types ───────────────────────────────────────────────────────────────────

export interface CorpusSearchResult {
  /** passage key: "bible:123" or "voice:456" */
  key: string;
  /** cosine similarity score (higher = more similar) */
  similarity: number;
}

export interface CorpusIndex {
  search(queryVec: number[], k: number, efSearch?: number): CorpusSearchResult[];
  readonly passageCount: number;
  readonly dim: number;
  readonly model: string;
}

// ── Module-level state ──────────────────────────────────────────────────────

let cachedIndex: CorpusIndex | null = null;
let loadPromise: Promise<CorpusIndex | null> | null = null;
let buildTriggered = false; // only auto-build once per process lifetime
let stalenessChecked = false; // check source fingerprint once per process

const VECTORS_BASE = process.env.VECTORS_PATH || '/data/vectors';
const DEFAULT_MODEL = 'pplx-embed-v1-4b';

// ── Self-sustaining: staleness detection (Phase 5) ──────────────────────────
// Compare source vectors.bin + manifest fingerprint against the builtFrom
// field in corpus.idmap. If they differ, the corpus has changed and needs
// a rebuild. The current index keeps serving while the rebuild runs in the
// background — zero-downtime.

interface SourceFingerprint {
  vectorsSize: number;
  vectorsMtime: number;
  manifestSize: number;
  manifestMtime: number;
  passageCount: number;
}

function computeSourceFingerprint(model: string): SourceFingerprint | null {
  try {
    const vectorsPath = resolve(VECTORS_BASE, model, `vectors_${model.replace(/-/g, '_')}.bin`);
    const manifestPath = resolve(VECTORS_BASE, model, 'manifest.json');
    if (!existsSync(vectorsPath) || !existsSync(manifestPath)) return null;
    const vs = statSync(vectorsPath);
    const ms = statSync(manifestPath);
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    return {
      vectorsSize: vs.size,
      vectorsMtime: vs.mtimeMs,
      manifestSize: ms.size,
      manifestMtime: ms.mtimeMs,
      passageCount: manifest.passage_count,
    };
  } catch {
    return null;
  }
}

function isIndexStale(idmap: Record<string, unknown>, model: string): boolean {
  const builtFrom = idmap.builtFrom as SourceFingerprint | undefined;
  // Check idmap.passageCount against the current manifest. If they differ,
  // the index is definitely stale regardless of builtFrom (e.g. someone
  // re-uploaded a new vectors.bin with a different passage count).
  try {
    const mf = JSON.parse(readFileSync(resolve(VECTORS_BASE, model, 'manifest.json'), 'utf-8'));
    const idmapCount = idmap.passageCount as number | undefined;
    if (typeof idmapCount === 'number' && typeof mf.passage_count === 'number'
        && idmapCount !== mf.passage_count) {
      console.warn(
        `[corpus-index] idmap.passageCount=${idmapCount} != ` +
        `manifest.passage_count=${mf.passage_count} — marking stale for rebuild`
      );
      return true;
    }
  } catch { /* manifest unreadable; fall through to other checks */ }
  if (!builtFrom) {
    // Old-format idmap without builtFrom — can't detect staleness via fingerprint.
    // If passageCount matched (above), assume fresh. If not, the count check
    // already triggered the rebuild.
    return false;
  }
  // Check if idmap has voice keys — if not, it was built with broken alignment
  const passageKeys = idmap.passageKeys as string[] | undefined;
  if (Array.isArray(passageKeys) && passageKeys.length > 0) {
    const hasVoices = passageKeys.some(k => k.startsWith('voice:'));
    if (!hasVoices) {
      console.warn('[corpus-index] idmap has no voice keys — marking stale for rebuild');
      return true;
    }
  }
  const current = computeSourceFingerprint(model);
  if (!current) return false; // can't check if source files gone
  const stale = (
    current.vectorsSize !== builtFrom.vectorsSize ||
    current.vectorsMtime !== builtFrom.vectorsMtime ||
    current.manifestSize !== builtFrom.manifestSize ||
    current.manifestMtime !== builtFrom.manifestMtime ||
    current.passageCount !== builtFrom.passageCount
  );
  if (stale) {
    incCounter('resonance.index_stale');
    recordEvent('index_stale', `model=${model}`);
  }
  return stale;
}

// ── Self-sustaining: background build on cold boot ─────────────────────────
// When no HNSW index exists (fresh deploy / volume wipe), we spawn the
// build script as a detached child process.  It takes ~20-30 min for 265k
// vectors.  During that window, the server falls back to lexical search.
// On success the child touches a ".ready" sentinel; next request picks it up.

function triggerBackgroundBuild(model: string): void {
  buildTriggered = true;
  incCounter('resonance.build_triggered');
  recordEvent('build_triggered', `model=${model}`);
  const buildT0 = Date.now();
  // Resolve from project root, not cwd — on Railway, cwd is apps/web but scripts/ lives at project root
  const projectRoot = resolve(process.cwd(), '..', '..');
  const script = resolve(projectRoot, 'scripts/build-hnsw-index.mjs');
  const outDir = resolve(VECTORS_BASE, model);

  // Read shard filename from manifest (actual binary name, e.g. "vectors.bin")
  let shardFile = 'vectors.bin'; // sensible default
  try {
    const mf = JSON.parse(readFileSync(resolve(VECTORS_BASE, model, 'manifest.json'), 'utf-8'));
    if (mf.shards?.[0]?.file) shardFile = mf.shards[0].file;
  } catch { /* use default */ }

  console.log(`[corpus-index] Spawning background HNSW build: node ${script}`);
  console.log(`[corpus-index] Output dir: ${outDir}, vectors shard: ${shardFile}`);
  console.log(`[corpus-index] Semantic search will be unavailable until build completes (~20-30 min).`);

  const child = execFile(
    'node',
    [script],
    {
      env: {
        ...process.env,
        OUTPUT_DIR: outDir,
        // Tell the build script where to find the production vectors + manifest.
        // These env vars override the build script's local-dev defaults.
        // Use the actual shard filename from the manifest, not a guessed name.
        VECTORS_PATH: resolve(VECTORS_BASE, model, shardFile || 'vectors.bin'),
        MANIFEST_PATH: resolve(VECTORS_BASE, model, 'manifest.json'),
        // Passage alignment fallback — these are git-tracked so always available
        BIBLE_PASSAGES_PATH: resolve(process.cwd(), 'data/seeded_library/bible_passages.json'),
        VOICE_PASSAGES_PATH: resolve(process.cwd(), 'data/seeded_library/voice_passages.json'),
      },
      timeout: 30 * 60 * 1000, // 30 min hard cap
    },
    (err, stdout, stderr) => {
      if (err) {
        console.error('[corpus-index] Background HNSW build FAILED:', err.message);
        if (stderr) console.error(stderr);
        buildTriggered = false; // allow retry on next request
        incCounter('resonance.build_failure');
        recordEvent('build_failure', `model=${model} err=${err.message}`);
        return;
      }
      observeLatencyMs('resonance.build_ms', Date.now() - buildT0);
      incCounter('resonance.build_success');
      recordEvent('build_success', `model=${model} duration_ms=${Date.now() - buildT0}`);
      console.log('[corpus-index] Background HNSW build COMPLETED.');
      if (stdout) console.log(stdout.slice(-2000)); // last 2k of build output

      // Hot-reload: clear cache so next request loads the new index
      resetCorpusIndex();
      console.log('[corpus-index] Index cache cleared; next request will load the new index.');
    },
  );

  // Detach so the build survives if the parent crashes mid-request
  if (child.pid) {
    child.unref();
    console.log(`[corpus-index] Build process PID: ${child.pid}`);
  }
}

// ── Implementation ──────────────────────────────────────────────────────────

class HnswCorpusIndex implements CorpusIndex {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private index: any;
  private idmap: {
    passageKeys: string[];
    passageIds: number[];
    passageSources: string[];
    model: string;
    dim: number;
    passageCount: number;
    m: number;
    efConstruction: number;
    builtAt: string;
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(index: any, idmap: HnswCorpusIndex['idmap']) {
    this.index = index;
    this.idmap = idmap;
  }

  get passageCount(): number { return this.idmap.passageCount; }
  get dim(): number { return this.idmap.dim; }
  get model(): string { return this.idmap.model; }

  search(queryVec: number[], k: number, efSearch = 200): CorpusSearchResult[] {
    // Set ef for this query — higher = more accurate but slower
    this.index.setEf(efSearch);

    const raw = this.index.searchKnn(queryVec, k);
    const results: CorpusSearchResult[] = [];

    // raw = { distances: number[], neighbors: number[] }
    // In cosine space, distance = 1 - similarity, so similarity = 1 - distance
    // BUT: hnswlib cosine space reports L2-squared distance on normalised vectors
    // which equals 2(1 - cosine_similarity). So similarity = 1 - distance/2.
    // However, we've observed that for nearby vectors, distance ≈ 0, so
    // similarity ≈ 1 - distance/2 is correct.
    const len = Math.min(raw.neighbors.length, raw.distances.length);
    for (let i = 0; i < len; i++) {
      const node = raw.neighbors[i];
      const dist = raw.distances[i];
      const key = this.idmap.passageKeys[node];
      if (key === undefined) continue;

      // Convert hnswlib cosine distance to similarity
      // cosine distance = 1 - cos_sim ⇒ similarity = 1 - dist
      results.push({ key, similarity: 1 - dist });
    }
    return results;
  }
}

/**
 * Load the HNSW corpus index. Returns null if index files are missing
 * (caller should fall back to lexical/brute-force).
 *
 * Concurrent calls are de-duped: only one load happens, all await the same
 * Promise.
 */
export async function ensureCorpusIndex(
  model = DEFAULT_MODEL,
): Promise<CorpusIndex | null> {
  if (cachedIndex) {
    incCounter('resonance.corpus_index_cache_hits');
    return cachedIndex;
  }
  if (loadPromise) {
    incCounter('resonance.corpus_index_load_pending');
    return loadPromise;
  }

  loadPromise = (async () => {
    incCounter('resonance.corpus_index_loads');
    try {
      const modelDir = resolve(VECTORS_BASE, model);
      // Index may live at VECTORS_BASE/MODEL/corpus.hnsw (structured) or
      // VECTORS_BASE/corpus.hnsw (flat).  The build script uses flat layout.
      const indexPaths = [
        resolve(modelDir, 'corpus.hnsw'),
        resolve(VECTORS_BASE, 'corpus.hnsw'),
      ];
      const idmapPaths = [
        resolve(modelDir, 'corpus.idmap'),
        resolve(VECTORS_BASE, 'corpus.idmap'),
      ];

      let indexPath = '';
      let idmapPath = '';
      for (let i = 0; i < indexPaths.length; i++) {
        if (existsSync(indexPaths[i]) && existsSync(idmapPaths[i])) {
          indexPath = indexPaths[i];
          idmapPath = idmapPaths[i];
          break;
        }
      }

      if (!indexPath || !idmapPath) {
        console.warn(
          `[corpus-index] HNSW files not found at ${modelDir}; ` +
          `falling back to lexical. ${buildTriggered ? 'Build already triggered.' : 'Triggering background build...'}`,
        );

        // ── Self-sustaining: auto-build on first boot if no index exists ──
        // This runs once per process lifetime. Subsequent requests fall back
        // to lexical until the build finishes and the index is loaded.
        if (!buildTriggered) {
          triggerBackgroundBuild(model);
        }

        return null;
      }

      const lib = await getHnswlib();
      const idmap = JSON.parse(readFileSync(idmapPath, 'utf-8'));

      console.log(
        `[corpus-index] loading ${indexPath} ` +
        `(${idmap.passageCount} passages, dim ${idmap.dim})...`,
      );

      const t0 = Date.now();
      const index = new lib.HierarchicalNSW('cosine', idmap.dim);
      index.readIndexSync(indexPath, true);
      index.setEf(200); // default query-time ef

      const loadMs = Date.now() - t0;
      console.log(
        `[corpus-index] loaded in ${loadMs}ms ` +
        `(${idmap.passageCount} vectors, M=${idmap.m}, efC=${idmap.efConstruction})`,
      );

      observeLatencyMs('resonance.index_load_ms', loadMs);
      setGauge('resonance.corpus_passages', idmap.passageCount);
      recordEvent('index_loaded', `model=${model} passages=${idmap.passageCount} load_ms=${loadMs}`);

      cachedIndex = new HnswCorpusIndex(index, idmap);

      // ── Phase 5: staleness check ──────────────────────────────────────────
      // After loading, compare source fingerprint against builtFrom.
      // If stale → trigger background rebuild; current index keeps serving
      // until the new one is ready (zero-downtime).
      if (!stalenessChecked) {
        stalenessChecked = true;
        if (isIndexStale(idmap, model)) {
          console.log(
            `[corpus-index] source data changed since last build — ` +
            `triggering background rebuild. Current index keeps serving.`,
          );
          // Reset buildTriggered so triggerBackgroundBuild actually fires
          buildTriggered = false;
          triggerBackgroundBuild(model);
        }
      }

      return cachedIndex;
    } catch (err) {
      const errMsg = String(err instanceof Error ? err.stack || err.message : err);
      console.error('[corpus-index] failed to load HNSW index:', errMsg);
      lastLoadError = errMsg.slice(0, 800);
      recordEvent('index_load_failed', errMsg.slice(0, 300));
      return null;
    }
  })();

  return loadPromise;
}

/**
 * Reset the cached index (used when a new index is deployed at runtime).
 */
export function resetCorpusIndex(): void {
  cachedIndex = null;
  loadPromise = null;
  stalenessChecked = false; // re-check fingerprint after reset
}
