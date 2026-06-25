/**
 * POST /api/admin/diag-score — run the exact same scoring as /api/resonance
 * but return the top 10 by similarity so we can see if the route's score
 * function matches our local computation.
 *
 * Body: { vector: number[], exclude_first_n: number? }
 * Returns: { top_10: [{ passageId, similarity, source, text, vector_idx }] }
 */
import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

const VECTORS_BASE = '/data/vectors';
const ONLINE_MODEL = 'pplx-embed-v1-4b';
const DIM = 2560;

interface Manifest {
  dim: number;
  dtype: string;
  passage_count: number;
  passage_ids?: number[];
  shards: { file: string; start: number; count: number }[];
}

let cachedModel: { vectors: Float32Array; manifest: Manifest; passageIds: number[] } | null = null;

async function loadOnce() {
  if (cachedModel) return cachedModel;
  const modelDir = path.join(VECTORS_BASE, ONLINE_MODEL);
  const manifestPath = path.join(modelDir, 'manifest.json');
  if (!existsSync(manifestPath)) throw new Error('manifest not found');
  const manifest: Manifest = JSON.parse(await readFile(manifestPath, 'utf-8'));

  const buffer = new Float32Array(manifest.passage_count * manifest.dim);
  for (const shard of manifest.shards) {
    const shardPath = path.join(modelDir, shard.file);
    if (!existsSync(shardPath)) continue;
    const raw = await readFile(shardPath);
    const offset = shard.start * manifest.dim;
    if (manifest.dtype === 'int8') {
      for (let i = 0; i < raw.length; i++) {
        buffer[offset + i] = raw[i] / 127.0;
      }
    }
  }
  // Renormalize
  for (let row = 0; row < manifest.passage_count; row++) {
    const base = row * manifest.dim;
    let norm = 0;
    for (let d = 0; d < manifest.dim; d++) {
      norm += buffer[base + d] * buffer[base + d];
    }
    norm = Math.sqrt(norm);
    if (norm > 0) {
      const inv = 1 / norm;
      for (let d = 0; d < manifest.dim; d++) {
        buffer[base + d] *= inv;
      }
    }
  }
  const passageIds = manifest.passage_ids ?? [];
  cachedModel = { vectors: buffer, manifest, passageIds };
  return cachedModel;
}

export async function POST(req: NextRequest) {
  const token = req.headers.get('x-admin-token');
  const expected = process.env.ADMIN_UPLOAD_TOKEN;
  if (!expected || token !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { vector, exclude_first_n = 0 } = (await req.json()) as {
    vector: number[]; exclude_first_n?: number;
  };
  if (!vector || vector.length !== DIM) {
    return NextResponse.json({ error: `vector must be ${DIM}-dim` }, { status: 400 });
  }

  const model = await loadOnce();
  const N = model.manifest.passage_count;

  // Score ALL passages (chunked to avoid OOM)
  const CHUNK = 2000;
  const top: { sim: number; idx: number; pid: number }[] = [];
  for (let start = exclude_first_n; start < N; start += CHUNK) {
    const end = Math.min(start + CHUNK, N);
    for (let i = start; i < end; i++) {
      const base = i * DIM;
      let dot = 0;
      for (let d = 0; d < DIM; d++) {
        dot += model.vectors[base + d] * vector[d];
      }
      // Maintain top-20 heap
      if (top.length < 20) {
        top.push({ sim: dot, idx: i, pid: model.passageIds[i] ?? -1 });
        top.sort((a, b) => b.sim - a.sim);
      } else if (dot > top[top.length - 1].sim) {
        top[top.length - 1] = { sim: dot, idx: i, pid: model.passageIds[i] ?? -1 };
        top.sort((a, b) => b.sim - a.sim);
      }
    }
  }

  return NextResponse.json({
    passage_count: N,
    vector_dim: DIM,
    excluded_first_n: exclude_first_n,
    top_20: top.map(t => ({
      vector_idx: t.idx,
      passage_id: t.pid,
      similarity: t.sim,
    })),
  });
}
