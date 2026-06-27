#!/usr/bin/env node
/**
 * build-library-shards.mjs — generate 75 per-book voice shards + 1 scripture bundle
 * from the merged pplx index.
 *
 * Input:
 *   - vectors.bin:    flat int8 matrix, n_passages × 2560 bytes, row-major
 *   - manifest.json:  { dim, dtype, passage_count, passage_ids: [n], passage_sources: [n] }
 *                    where each row's source is 'bible' or 'voice'
 *   - voice_passages.json: [{ id, book_id, chapter?, verse_start?, text, translation? }]
 *   - voice_books.json:    [{ id, packageId, title, author, era, source }]
 *   - bible_passages.json: same shape as voice_passages, translation = 'web' etc.
 *
 * Output:
 *   - library_shards/manifest.json
 *   - library_shards/<bookId>/{vectors.bin, idmap.json, corpus.hnsw}
 *   - scripture_bundle/manifest.json
 *   - scripture_bundle/{bible_passages.json, vectors.bin, idmap.json, corpus.hnsw}
 *
 * Usage:
 *   VECTORS_PATH=... MANIFEST_PATH=... VOICE_PASSAGES=... VOICE_BOOKS=... \
 *   BIBLE_PASSAGES=... OUTPUT_DIR=... \
 *   node scripts/build-library-shards.mjs
 *
 * Defaults to the canonical paths under /data/resonance.
 */

import { readFileSync, writeFileSync, mkdirSync, statSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import hnswlib from 'hnswlib-node';
const { HierarchicalNSW } = hnswlib;

const VECTORS_PATH = process.env.VECTORS_PATH
  || '/data/resonance/scripts/library/.reembed/merged/vectors.bin';
const MANIFEST_PATH = process.env.MANIFEST_PATH
  || '/data/resonance/scripts/library/.reembed/merged/manifest.json';
const VOICE_PASSAGES_PATH = process.env.VOICE_PASSAGES_PATH
  || '/data/resonance/apps/web/data/seeded_library/voice_passages.json';
const VOICE_BOOKS_PATH = process.env.VOICE_BOOKS_PATH
  || '/data/resonance/apps/web/data/seeded_library/voice_books.json';
const BIBLE_PASSAGES_PATH = process.env.BIBLE_PASSAGES_PATH
  || '/data/resonance/apps/web/data/seeded_library/bible_passages.json';
const OUTPUT_DIR = process.env.OUTPUT_DIR
  || '/data/resonance/build/output/seeded_library';
const M = parseInt(process.env.HNSW_M || '32', 10);
const EF_CONSTRUCTION = parseInt(process.env.HNSW_EF_CONSTRUCTION || '200', 10);
const DIM = 2560;

const BATCH_LOG = parseInt(process.env.BATCH_LOG || '5000', 10);
const t0 = Date.now();
function log(...args) { console.log(`[build-shards] +${((Date.now() - t0) / 1000).toFixed(1)}s`, ...args); }

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}
function fileSha256(p) {
  return sha256(readFileSync(p));
}
function fileSize(p) {
  return statSync(p).size;
}

// ── Load inputs ────────────────────────────────────────────────────────────
log('loading manifest + vectors...');
const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'));
if (manifest.dim !== DIM) {
  throw new Error(`manifest dim ${manifest.dim} != expected ${DIM}`);
}
const nPassages = manifest.passage_count;
const ids = manifest.passage_ids;
const sources = manifest.passage_sources;
log(`manifest: ${nPassages} passages, ${ids.length} ids, ${sources.length} sources`);

const vecSize = fileSize(VECTORS_PATH);
if (vecSize !== nPassages * DIM) {
  throw new Error(`vectors.bin size ${vecSize} != ${nPassages} * ${DIM} = ${nPassages * DIM}`);
}
log(`vectors.bin: ${(vecSize / 1024 / 1024).toFixed(1)} MB`);

const voicePassages = JSON.parse(readFileSync(VOICE_PASSAGES_PATH, 'utf-8'));
log(`voice_passages: ${voicePassages.length}`);
const voiceBooks = JSON.parse(readFileSync(VOICE_BOOKS_PATH, 'utf-8'));
log(`voice_books: ${voiceBooks.length}`);

// Index voice passages by their passage id
const voiceById = new Map();
for (const p of voicePassages) voiceById.set(p.id, p);

// Book id → book meta
const bookMeta = new Map();
for (const b of voiceBooks) bookMeta.set(b.id, b);

// Find voice vector rows, grouped by book
log('grouping vector rows by book...');
const rowsByBook = new Map();
const bibleRows = [];
for (let i = 0; i < nPassages; i++) {
  if (sources[i] === 'bible') {
    bibleRows.push(i);
  } else if (sources[i] === 'voice') {
    const pid = ids[i];
    const p = voiceById.get(pid);
    if (!p) {
      log(`WARN: voice row ${i} references unknown passage id ${pid} — skipping`);
      continue;
    }
    const bid = p.book_id;
    if (!rowsByBook.has(bid)) rowsByBook.set(bid, []);
    rowsByBook.get(bid).push(i);
  }
}
log(`voice rows: ${[...rowsByBook.values()].reduce((a, b) => a + b.length, 0)} across ${rowsByBook.size} books`);
log(`bible rows: ${bibleRows.length}`);

// ── Stream-read the vectors file once, build shards in order ───────────────
log('opening vectors file for reading...');
const fs = await import('node:fs/promises');
const vecFd = await fs.open(VECTORS_PATH, 'r');

// Helper: read N rows starting at firstRow, return Uint8Array of bytes
async function readRows(firstRow, count) {
  const buf = Buffer.alloc(count * DIM);
  await vecFd.read(buf, 0, buf.length, firstRow * DIM);
  return buf;
}

const shardsDir = join(OUTPUT_DIR, 'library_shards');
const bundleDir = join(OUTPUT_DIR, 'scripture_bundle');
mkdirSync(shardsDir, { recursive: true });
mkdirSync(bundleDir, { recursive: true });

// ── Build voice shards ─────────────────────────────────────────────────────
const shardManifestEntries = [];
const bookIds = [...bookMeta.keys()].sort();
log(`building ${bookIds.length} voice shards...`);

for (const bookId of bookIds) {
  const meta = bookMeta.get(bookId);
  const rows = rowsByBook.get(bookId) || [];
  if (rows.length === 0) {
    log(`  ${bookId}: no voice rows — skipping`);
    continue;
  }
  const tBook = Date.now();
  const bookDir = join(shardsDir, bookId);
  mkdirSync(bookDir, { recursive: true });

  // 1. Write vectors.bin (contiguous slice of the merged file, in row order)
  const vecBuf = await readRows(rows[0], rows.length);
  const vectorsPath = join(bookDir, 'vectors.bin');
  writeFileSync(vectorsPath, vecBuf);

  // 2. Write idmap.json
  const idmap = {
    passageKeys: rows.map((row) => `${sources[row]}:${ids[row]}`),
    passageIds: rows.map((row) => ids[row]),
    passageSources: rows.map((row) => sources[row]),
    passageCount: rows.length,
    model: 'pplx-embed-v1-4b',
    dim: DIM,
    dtype: 'int8',
  };
  const idmapPath = join(bookDir, 'idmap.json');
  writeFileSync(idmapPath, JSON.stringify(idmap));

  // 3. Build HNSW
  const index = new HierarchicalNSW('cosine', DIM);
  index.initIndex({
    maxElements: rows.length,
    m: M,
    efConstruction: EF_CONSTRUCTION,
  });
  index.setEf(50);

  // Dequantize int8 → float32 (hnswlib-node's addPoint expects a regular Array)
  for (let r = 0; r < rows.length; r++) {
    const off = r * DIM;
    const rowArr = new Array(DIM);
    for (let d = 0; d < DIM; d++) {
      // vecBuf is int8; convert to float in [-1, 1] range (hnswlib convention)
      rowArr[d] = vecBuf[off + d] / 127.0;
    }
    index.addPoint(rowArr, r);
    if (BATCH_LOG > 0 && (r + 1) % BATCH_LOG === 0) {
      const elapsed = (Date.now() - tBook) / 1000;
      log(`    ${bookId} ${r + 1}/${rows.length} (${(elapsed).toFixed(1)}s, ${((r + 1) / elapsed).toFixed(0)} vec/s)`);
    }
  }

  const hnswPath = join(bookDir, 'corpus.hnsw');
  index.writeIndexSync(hnswPath);


  // 4. Compute sizes + sha256s
  const sizeVectors = fileSize(vectorsPath);
  const sizeIdmap = fileSize(idmapPath);
  const sizeHnsw = fileSize(hnswPath);
  const shaVectors = fileSha256(vectorsPath);
  const shaIdmap = fileSha256(idmapPath);
  const shaHnsw = fileSha256(hnswPath);
  const totalBytes = sizeVectors + sizeIdmap + sizeHnsw;

  shardManifestEntries.push({
    bookId,
    packageId: meta.packageId || meta.package_id,
    title: meta.title,
    author: meta.author,
    era: meta.era,
    source: meta.source,
    passageCount: rows.length,
    sizeVectors,
    sizeHnsw,
    sizeIdmap,
    totalBytes,
    sha256Vectors: shaVectors,
    sha256Hnsw: shaHnsw,
    sha256Idmap: shaIdmap,
  });

  const elapsed = (Date.now() - tBook) / 1000;
  log(`  ${bookId}: ${rows.length} passages, ${(totalBytes / 1024 / 1024).toFixed(1)} MB, ${elapsed.toFixed(1)}s`);
}

// ── Build scripture bundle ─────────────────────────────────────────────────
if (bibleRows.length > 0) {
  log(`building scripture bundle (${bibleRows.length} passages)...`);
  const tBundle = Date.now();
  const biblePassages = JSON.parse(readFileSync(BIBLE_PASSAGES_PATH, 'utf-8'));
  const bibleById = new Map();
  for (const p of biblePassages) bibleById.set(p.id, p);

  // 1. Write bible_passages.json (subset of canonical, in row order)
  const bundleBiblePassages = bibleRows.map((row) => {
    const p = bibleById.get(ids[row]);
    if (!p) {
      log(`  WARN: bible row ${row} references unknown passage id ${ids[row]}`);
      return { id: ids[row], text: '', translation: null };
    }
    return p;
  });
  const biblePassagesPath = join(bundleDir, 'bible_passages.json');
  writeFileSync(biblePassagesPath, JSON.stringify(bundleBiblePassages));

  // 2. Write vectors.bin
  const vecBuf = await readRows(bibleRows[0], bibleRows.length);
  const vectorsPath = join(bundleDir, 'vectors.bin');
  writeFileSync(vectorsPath, vecBuf);

  // 3. Write idmap.json
  const idmap = {
    passageKeys: bibleRows.map((row) => `${sources[row]}:${ids[row]}`),
    passageIds: bibleRows.map((row) => ids[row]),
    passageSources: bibleRows.map((row) => sources[row]),
    passageCount: bibleRows.length,
    model: 'pplx-embed-v1-4b',
    dim: DIM,
    dtype: 'int8',
  };
  const idmapPath = join(bundleDir, 'idmap.json');
  writeFileSync(idmapPath, JSON.stringify(idmap));

  // 4. Build HNSW
  const index = new HierarchicalNSW('cosine', DIM);
  index.initIndex({
    maxElements: bibleRows.length,
    m: M,
    efConstruction: EF_CONSTRUCTION,
  });
  index.setEf(50);

  for (let r = 0; r < bibleRows.length; r++) {
    const off = r * DIM;
    const rowArr = new Array(DIM);
    for (let d = 0; d < DIM; d++) {
      rowArr[d] = vecBuf[off + d] / 127.0;
    }
    index.addPoint(rowArr, r);
    if (BATCH_LOG > 0 && (r + 1) % BATCH_LOG === 0) {
      const elapsed = (Date.now() - tBundle) / 1000;
      log(`    scripture ${r + 1}/${bibleRows.length} (${(elapsed).toFixed(1)}s, ${((r + 1) / elapsed).toFixed(0)} vec/s)`);
    }
  }

  const hnswPath = join(bundleDir, 'corpus.hnsw');
  index.writeIndexSync(hnswPath);


  // 5. Manifest for the bundle
  const sizePassages = fileSize(biblePassagesPath);
  const sizeVectors = fileSize(vectorsPath);
  const sizeIdmap = fileSize(idmapPath);
  const sizeHnsw = fileSize(hnswPath);
  const bundleManifest = {
    version: 1,
    model: 'pplx-embed-v1-4b',
    dim: DIM,
    dtype: 'int8',
    passageCount: bibleRows.length,
    sizePassages,
    sizeVectors,
    sizeHnsw,
    sizeIdmap,
    totalBytes: sizePassages + sizeVectors + sizeIdmap + sizeHnsw,
    sha256Passages: fileSha256(biblePassagesPath),
    sha256Vectors: fileSha256(vectorsPath),
    sha256Hnsw: fileSha256(hnswPath),
    sha256Idmap: fileSha256(idmapPath),
  };
  writeFileSync(join(bundleDir, 'manifest.json'), JSON.stringify(bundleManifest, null, 2));

  const elapsed = (Date.now() - tBundle) / 1000;
  log(`  scripture bundle: ${bibleRows.length} passages, ${(bundleManifest.totalBytes / 1024 / 1024 / 1024).toFixed(2)} GB, ${elapsed.toFixed(1)}s`);
}

await vecFd.close();

// ── Write shard manifest ───────────────────────────────────────────────────
const shardManifest = {
  version: 1,
  model: 'pplx-embed-v1-4b',
  dim: DIM,
  dtype: 'int8',
  shardCount: shardManifestEntries.length,
  totalBytes: shardManifestEntries.reduce((a, e) => a + e.totalBytes, 0),
  shards: shardManifestEntries.sort((a, b) => a.bookId.localeCompare(b.bookId)),
};
writeFileSync(join(shardsDir, 'manifest.json'), JSON.stringify(shardManifest, null, 2));

const elapsed = (Date.now() - t0) / 1000;
log(`done. ${shardManifestEntries.length} shards, total ${(shardManifest.totalBytes / 1024 / 1024 / 1024).toFixed(2)} GB, ${(elapsed / 60).toFixed(1)} min`);
