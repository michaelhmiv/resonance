#!/usr/bin/env node
/**
 * build-hnsw-index.mjs — Build a serialised HNSW index from the Resonance
 * int8 vector corpus for model pplx-embed-v1-4b.
 *
 * Inputs (defaults, overridable via env vars):
 *   VECTORS_PATH    — path to the int8 vectors.bin
 *   MANIFEST_PATH   — path to the model manifest JSON
 *   SIDECAR_PATH    — path to the alignment manifest (passage_ids + passage_sources)
 *   OUTPUT_DIR      — directory for corpus.hnsw + corpus.idmap
 *   M               — HNSW connectivity (default: 32)
 *   EF_CONSTRUCTION — HNSW build-time search width (default: 200)
 *   BATCH_LOG       — log progress every N vectors (default: 10000)
 *
 * Outputs:
 *   corpus.hnsw   — serialised hnswlib-node index (cosine space)
 *   corpus.idmap  — JSON: { passageKeys[], passageIds[], passageSources[], ... }
 *                    Node i in corpus.hnsw = passageKeys[i] = vector row i.
 *
 * Runtime: ~3-6 min for 265k rows x 2560 dims (single-threaded addPoint loop).
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
import hnswlib from 'hnswlib-node';

// -- Config -------------------------------------------------------------------
const VECTORS_PATH    = process.env.VECTORS_PATH    || resolve(__dirname, '../build/output/seeded_library/vectors_pplx/vectors_pplx-embed-v1-4b.bin');
const MANIFEST_PATH   = process.env.MANIFEST_PATH   || resolve(__dirname, '../build/output/seeded_library/manifests/pplx-embed-v1-4b/manifest.json');
const SIDECAR_PATH    = process.env.SIDECAR_PATH    || resolve(__dirname, '../build/output/seeded_library/vectors_gte-small_manifest.json');
const OUTPUT_DIR      = process.env.OUTPUT_DIR      || resolve(__dirname, '../build/output/seeded_library/vectors_pplx/');
const M               = parseInt(process.env.M               || '32', 10);
const EF_CONSTRUCTION = parseInt(process.env.EF_CONSTRUCTION || '200', 10);
const BATCH_LOG       = parseInt(process.env.BATCH_LOG       || '10000', 10);

// -- Validate inputs ----------------------------------------------------------
if (!existsSync(VECTORS_PATH)) {
  console.error(`[build-hnsw] vectors file not found: ${VECTORS_PATH}`);
  process.exit(1);
}
if (!existsSync(MANIFEST_PATH)) {
  console.error(`[build-hnsw] manifest not found: ${MANIFEST_PATH}`);
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'));

// -- Source fingerprint for staleness detection (Phase 5) --------------------
const vectorsStat = statSync(VECTORS_PATH);
const manifestStat = statSync(MANIFEST_PATH);
const sourceFingerprint = {
  vectorsSize: vectorsStat.size,
  vectorsMtime: vectorsStat.mtimeMs,
  manifestSize: manifestStat.size,
  manifestMtime: manifestStat.mtimeMs,
  passageCount: manifest.passage_count,
};
if (manifest.dtype !== 'int8') {
  console.error(`[build-hnsw] unsupported dtype: ${manifest.dtype} (expected int8)`);
  process.exit(1);
}

const DIM = manifest.dim;
const PASSAGE_COUNT = manifest.passage_count;
console.log(`[build-hnsw] model: ${manifest.model}, dim: ${DIM}, count: ${PASSAGE_COUNT}, dtype: int8`);
console.log(`[build-hnsw] M=${M}, efConstruction=${EF_CONSTRUCTION}`);

// -- Load alignment data (passage IDs + sources) ------------------------------
let alignmentIds;
let alignmentSources;

if (
  Array.isArray(manifest.passage_ids) &&
  manifest.passage_ids.length === PASSAGE_COUNT &&
  Array.isArray(manifest.passage_sources) &&
  manifest.passage_sources.length === PASSAGE_COUNT
) {
  alignmentIds = manifest.passage_ids;
  alignmentSources = manifest.passage_sources;
  console.log('[build-hnsw] using alignment from pplx manifest');
} else if (existsSync(SIDECAR_PATH)) {
  const sidecar = JSON.parse(readFileSync(SIDECAR_PATH, 'utf-8'));
  if (
    Array.isArray(sidecar.passage_ids) &&
    sidecar.passage_ids.length === PASSAGE_COUNT &&
    Array.isArray(sidecar.passage_sources) &&
    sidecar.passage_sources.length === PASSAGE_COUNT
  ) {
    alignmentIds = sidecar.passage_ids;
    alignmentSources = sidecar.passage_sources;
    console.log('[build-hnsw] using alignment from sidecar manifest');
  } else {
    console.error('[build-hnsw] sidecar alignment mismatch');
    process.exit(1);
  }
} else {
  // Fallback: generate alignment from bible_passages.json + voice_passages.json
  // These are checked in git and available on Railway at /app/apps/web/data/seeded_library/
  // or /data/seeded_library/
  const BIBLE_PATH = process.env.BIBLE_PASSAGES_PATH || resolve(__dirname, '../apps/web/data/seeded_library/bible_passages.json');
  const VOICE_PATH = process.env.VOICE_PASSAGES_PATH || resolve(__dirname, '../apps/web/data/seeded_library/voice_passages.json');
  // Also check alt paths (Railway cwd is /app/apps/web)
  const BIBLE_ALT = '/data/seeded_library/bible_passages.json';
  const VOICE_ALT = '/data/seeded_library/voice_passages.json';
  const BIBLE_ALT2 = resolve(__dirname, '../../data/seeded_library/bible_passages.json');
  const VOICE_ALT2 = resolve(__dirname, '../../data/seeded_library/voice_passages.json');

  const bPath = [BIBLE_PATH, BIBLE_ALT, BIBLE_ALT2].find(p => existsSync(p));
  const vPath = [VOICE_PATH, VOICE_ALT, VOICE_ALT2].find(p => existsSync(p));

  if (bPath && vPath) {
    console.log(`[build-hnsw] loading passages from ${bPath} + ${vPath}`);
    const biblePassages = JSON.parse(readFileSync(bPath, 'utf-8'));
    const voicePassages = JSON.parse(readFileSync(vPath, 'utf-8'));
    biblePassages.sort((a, b) => a.id - b.id);
    voicePassages.sort((a, b) => a.id - b.id);

    if (biblePassages.length + voicePassages.length === PASSAGE_COUNT) {
      alignmentIds = [
        ...biblePassages.map(p => p.id),
        ...voicePassages.map(p => p.id),
      ];
      alignmentSources = [
        ...biblePassages.map(() => 'bible'),
        ...voicePassages.map(() => 'voice'),
      ];
      console.log(`[build-hnsw] using alignment from passage JSON files (${biblePassages.length} bible + ${voicePassages.length} voice = ${PASSAGE_COUNT})`);
    } else {
      console.error(`[build-hnsw] passage JSON count mismatch: ${biblePassages.length} bible + ${voicePassages.length} voice = ${biblePassages.length + voicePassages.length}, expected ${PASSAGE_COUNT}`);
      process.exit(1);
    }
  } else {
    console.error(`[build-hnsw] no alignment data available (tried manifest, sidecar, passage JSONs)`);
    process.exit(1);
  }
}

// Build passageKeys: "source:id" for each vector row
const passageKeys = new Array(PASSAGE_COUNT);
for (let i = 0; i < PASSAGE_COUNT; i++) {
  passageKeys[i] = `${alignmentSources[i]}:${alignmentIds[i]}`;
}
console.log(`[build-hnsw] passageKeys built. Sample: [${passageKeys.slice(0, 3).join(', ')}]`);

// -- Read int8 vectors from disk ----------------------------------------------
console.log('[build-hnsw] reading vectors file...');
const vectorBuf = readFileSync(VECTORS_PATH);
if (vectorBuf.length !== PASSAGE_COUNT * DIM) {
  console.error(`[build-hnsw] file size mismatch: expected ${PASSAGE_COUNT * DIM}, got ${vectorBuf.length}`);
  process.exit(1);
}
console.log(`[build-hnsw] read ${vectorBuf.length} bytes (${(vectorBuf.length / 1024 / 1024).toFixed(0)} MB)`);

// -- Build HNSW index ---------------------------------------------------------
const index = new hnswlib.HierarchicalNSW('cosine', DIM);
index.initIndex(PASSAGE_COUNT, M, EF_CONSTRUCTION, 42);

console.log('[build-hnsw] building index (single-threaded addPoint loop)...');
const t0 = Date.now();

// Reuse a single Array for dequantisation to avoid GC pressure
const vec = new Array(DIM);

for (let row = 0; row < PASSAGE_COUNT; row++) {
  const srcBase = row * DIM;

  // Dequantise int8 -> float32: signed_byte / 127.0 yields [-1, 1]
  for (let d = 0; d < DIM; d++) {
    const byte = vectorBuf[srcBase + d];
    const signed = byte > 127 ? byte - 256 : byte;
    vec[d] = signed / 127.0;
  }

  index.addPoint(vec, row);

  if ((row + 1) % BATCH_LOG === 0) {
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    const rate = ((row + 1) / ((Date.now() - t0) / 1000)).toFixed(0);
    console.log(`[build-hnsw] ${row + 1}/${PASSAGE_COUNT} (${elapsed}s, ${rate} vec/s)`);
  }
}

const buildTime = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`[build-hnsw] index built in ${buildTime}s (${PASSAGE_COUNT} vectors)`);

// -- Save index + idmap -------------------------------------------------------
mkdirSync(OUTPUT_DIR, { recursive: true });

const indexPath = resolve(OUTPUT_DIR, 'corpus.hnsw');
const idmapPath = resolve(OUTPUT_DIR, 'corpus.idmap');

index.writeIndexSync(indexPath);
console.log(`[build-hnsw] index saved to ${indexPath}`);

const idmap = {
  passageKeys,
  passageIds: alignmentIds,
  passageSources: alignmentSources,
  model: manifest.model,
  dim: DIM,
  passageCount: PASSAGE_COUNT,
  m: M,
  efConstruction: EF_CONSTRUCTION,
  builtAt: new Date().toISOString(),
  builtFrom: sourceFingerprint, // Phase 5: staleness detection
};
writeFileSync(idmapPath, JSON.stringify(idmap));
console.log(`[build-hnsw] idmap saved to ${idmapPath} (${(JSON.stringify(idmap).length / 1024 / 1024).toFixed(1)} MB)`);

// -- Verify: reload + identity query ------------------------------------------
console.log('[build-hnsw] verifying index (reload + identity query)...');
const index2 = new hnswlib.HierarchicalNSW('cosine', DIM);
index2.readIndexSync(indexPath, true);
index2.setEf(50);

// Re-dequantise row 0 as query
for (let d = 0; d < DIM; d++) {
  const byte = vectorBuf[d];
  const signed = byte > 127 ? byte - 256 : byte;
  vec[d] = signed / 127.0;
}

const result = index2.searchKnn(vec, 5);
console.log(`[build-hnsw] identity query top-5: neighbors=${result.neighbors}, distances=${result.distances.map(d => d.toFixed(6))}`);

const topId = result.neighbors[0];
console.log(`[build-hnsw] top result: node ${topId}, passageKey "${passageKeys[topId]}" (expected "${passageKeys[0]}")`);

if (topId === 0) {
  console.log('[build-hnsw] PASSED - row 0 finds itself as top result');
} else {
  console.warn('[build-hnsw] NOTE - top result is not row 0 (may be a near-duplicate passage, not a bug)');
}

console.log('[build-hnsw] done.');
