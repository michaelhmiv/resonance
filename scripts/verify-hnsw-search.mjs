#!/usr/bin/env node
/**
 * verify-hnsw-search.mjs — Compare HNSW search results against brute-force
 * scoring to measure recall quality.
 *
 * Loads the HNSW index (corpus.hnsw + corpus.idmap), re-runs the brute-force
 * scoreAllRows logic on a sample set of query vectors, and reports recall @k
 * (what fraction of the true top-k appears in the HNSW top-k).
 *
 * Usage:
 *   node scripts/verify-hnsw-search.mjs
 *
 * Env overrides:
 *   INDEX_DIR    — directory containing corpus.hnsw + corpus.idmap + vectors (default: build/output/seeded_library/vectors_pplx/)
 *   EF_SEARCH    — HNSW ef at query time (default: 200)
 *   K            — top-k to compare (default: 20)
 *   NUM_QUERIES  — how many random rows to use as queries (default: 50)
 *   RECALL_THRESHOLD — minimum acceptable recall (default: 0.90)
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
import hnswlib from 'hnswlib-node';

// -- Config -------------------------------------------------------------------
const INDEX_DIR       = process.env.INDEX_DIR       || resolve(__dirname, '../build/output/seeded_library/vectors_pplx/');
const MANIFEST_PATH   = process.env.MANIFEST_PATH   || resolve(__dirname, '../build/output/seeded_library/manifests/pplx-embed-v1-4b/manifest.json');
const VECTORS_PATH    = process.env.VECTORS_PATH    || resolve(INDEX_DIR, 'vectors_pplx-embed-v1-4b.bin');
const EF_SEARCH       = parseInt(process.env.EF_SEARCH       || '200', 10);
const K               = parseInt(process.env.K               || '20', 10);
const NUM_QUERIES     = parseInt(process.env.NUM_QUERIES     || '50', 10);
const RECALL_THRESHOLD = parseFloat(process.env.RECALL_THRESHOLD || '0.90');

const indexPath = resolve(INDEX_DIR, 'corpus.hnsw');
const idmapPath = resolve(INDEX_DIR, 'corpus.idmap');

// -- Validate -----------------------------------------------------------------
for (const [label, path] of [['index', indexPath], ['idmap', idmapPath], ['vectors', VECTORS_PATH], ['manifest', MANIFEST_PATH]]) {
  if (!existsSync(path)) {
    console.error(`[verify] ${label} not found: ${path}`);
    process.exit(1);
  }
}

const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'));
const DIM = manifest.dim;
const PASSAGE_COUNT = manifest.passage_count;
const idmap = JSON.parse(readFileSync(idmapPath, 'utf-8'));

console.log(`[verify] model: ${manifest.model}, dim: ${DIM}, count: ${PASSAGE_COUNT}`);
console.log(`[verify] efSearch: ${EF_SEARCH}, k: ${K}, numQueries: ${NUM_QUERIES}`);

// -- Load HNSW index ----------------------------------------------------------
console.log('[verify] loading HNSW index...');
const index = new hnswlib.HierarchicalNSW('cosine', DIM);
index.readIndexSync(indexPath, true);
index.setEf(EF_SEARCH);
console.log(`[verify] index loaded, currentCount: ${index.getCurrentCount()}`);

// -- Load vectors for brute-force comparison ----------------------------------
const vectorBuf = readFileSync(VECTORS_PATH);
if (vectorBuf.length !== PASSAGE_COUNT * DIM) {
  console.error(`[verify] vector file size mismatch`);
  process.exit(1);
}

// -- Brute-force cosine similarity for a query vector -------------------------
function bruteForceTopK(queryVec, k) {
  const scores = new Array(PASSAGE_COUNT);
  for (let row = 0; row < PASSAGE_COUNT; row++) {
    const base = row * DIM;
    let dot = 0, norm2 = 0;
    for (let d = 0; d < DIM; d++) {
      const byte = vectorBuf[base + d];
      const signed = byte > 127 ? byte - 256 : byte;
      const val = signed / 127.0;
      dot += val * queryVec[d];
      norm2 += val * val;
    }
    const norm = Math.sqrt(norm2) || 1;
    scores[row] = { row, sim: dot / norm };
  }
  scores.sort((a, b) => b.sim - a.sim);
  return scores.slice(0, k).map(s => s.row);
}

// -- Run recall test ----------------------------------------------------------
console.log('[verify] running recall test...');
const recallValues = [];
const rng = (seed => () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; })(12345);

for (let qi = 0; qi < NUM_QUERIES; qi++) {
  // Pick a random row as query
  const queryRow = Math.floor(rng() * PASSAGE_COUNT);

  // Dequantise the query vector
  const queryVec = new Array(DIM);
  const qBase = queryRow * DIM;
  for (let d = 0; d < DIM; d++) {
    const byte = vectorBuf[qBase + d];
    const signed = byte > 127 ? byte - 256 : byte;
    queryVec[d] = signed / 127.0;
  }

  // HNSW search
  const hnswResult = index.searchKnn(queryVec, K);
  const hnswTopK = new Set(hnswResult.neighbors);

  // Brute-force top-k
  const bruteTopK = bruteForceTopK(queryVec, K);
  const bruteSet = new Set(bruteTopK);

  // Recall = |HNSW ∩ brute| / |brute|
  let overlap = 0;
  for (const row of bruteSet) {
    if (hnswTopK.has(row)) overlap++;
  }
  const recall = overlap / K;
  recallValues.push(recall);

  if ((qi + 1) % 10 === 0) {
    console.log(`[verify] ${qi + 1}/${NUM_QUERIES}: avg recall so far = ${(recallValues.reduce((a, b) => a + b) / recallValues.length).toFixed(4)}`);
  }
}

const avgRecall = recallValues.reduce((a, b) => a + b) / recallValues.length;
const minRecall = Math.min(...recallValues);
const maxRecall = Math.max(...recallValues);

console.log('\n[verify] ═══════════════════════════════════════════════════');
console.log(`[verify]  Recall@${K}  (efSearch=${EF_SEARCH}, M=${idmap.m}, efC=${idmap.efConstruction})`);
console.log(`[verify]  Average: ${avgRecall.toFixed(4)}`);
console.log(`[verify]  Min:     ${minRecall.toFixed(4)}`);
console.log(`[verify]  Max:     ${maxRecall.toFixed(4)}`);
console.log(`[verify]  Threshold: ${RECALL_THRESHOLD}`);
console.log(`[verify]  PASS: ${avgRecall >= RECALL_THRESHOLD ? 'YES ✓' : 'NO ✗'}`);
console.log('[verify] ═══════════════════════════════════════════════════');

if (avgRecall < RECALL_THRESHOLD) {
  console.warn(`[verify] Recall ${avgRecall.toFixed(4)} below threshold ${RECALL_THRESHOLD}. Consider increasing efSearch or M.`);
  process.exit(1);
}

console.log('[verify] done.');
