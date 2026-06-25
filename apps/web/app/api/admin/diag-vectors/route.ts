/**
 * GET /api/admin/diag-vectors — check that loaded vectors match the manifest
 * Returns the first 5 vectors with their norms and the first 3 dimensions
 * of vector[0]. If the route is loading from the right file with the right
 * alignment, the norms should be ~1.0 (after renormalization) and vector[0]
 * should match the manifest's first passage_ids[0] passage.
 */
import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

export async function GET(_req: NextRequest) {
  const token = _req.headers.get('x-admin-token');
  const expected = process.env.ADMIN_UPLOAD_TOKEN;
  if (!expected || token !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const manifestPath = '/data/vectors/pplx-embed-v1-4b/manifest.json';
  if (!existsSync(manifestPath)) {
    return NextResponse.json({ error: 'manifest not found' }, { status: 404 });
  }
  const manifest = JSON.parse(await readFile(manifestPath, 'utf-8'));
  const dim = manifest.dim;
  const vecPath = '/data/vectors/pplx-embed-v1-4b/vectors.bin';
  if (!existsSync(vecPath)) {
    return NextResponse.json({ error: 'vectors.bin not found' }, { status: 404 });
  }
  const fh = await import('fs/promises');
  const fd = await fh.open(vecPath, 'r');

  // Read first 5 vectors, dequantize, compute norms
  const sample: any[] = [];
  for (let i = 0; i < 5; i++) {
    const buf = Buffer.alloc(dim);
    await fd.read(buf, 0, dim, i * dim);
    const raw = new Int8Array(buf.buffer, buf.byteOffset, dim);
    const floats = new Float32Array(dim);
    let normBefore = 0;
    for (let d = 0; d < dim; d++) {
      floats[d] = raw[d] / 127.0;
      normBefore += floats[d] * floats[d];
    }
    normBefore = Math.sqrt(normBefore);
    // Renormalize
    let normAfter = 0;
    if (normBefore > 0) {
      for (let d = 0; d < dim; d++) {
        floats[d] /= normBefore;
        normAfter += floats[d] * floats[d];
      }
    }
    normAfter = Math.sqrt(normAfter);
    sample.push({
      idx: i,
      passage_id: manifest.passage_ids?.[i],
      raw_bytes_first3: Array.from(buf.slice(0, 3)),
      dequant_first3: [floats[0], floats[1], floats[2]],
      norm_after_dequant: normBefore,
      norm_after_renormalize: normAfter,
    });
  }
  // Sample at suspicious indices
  for (const i of [881, 13635, 100000, 200000, 237403]) {
    if (i < manifest.passage_count) {
      const buf = Buffer.alloc(dim);
      await fd.read(buf, 0, dim, i * dim);
      sample.push({
        idx: i,
        passage_id: manifest.passage_ids?.[i],
        raw_bytes_first3: Array.from(buf.slice(0, 3)),
        dequant_first3: [buf[0] / 127.0, buf[1] / 127.0, buf[2] / 127.0],
        norm_after_dequant: null,
        norm_after_renormalize: null,
      });
    }
  }
  await fd.close();

  return NextResponse.json({
    manifest_passage_count: manifest.passage_count,
    manifest_dim: manifest.dim,
    vectors_file_size: (await fh.stat(vecPath)).size,
    sample,
  });
}
