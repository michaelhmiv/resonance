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
  const stat1 = await fh.stat(vecPath);
  const fd = await fh.open(vecPath, 'r');
  // Force fresh read by using positional read with explicit position

  // Read first 5 vectors, dequantize, compute norms
  if (manifest.dtype === 'int8') {
    const signed = new Int8Array(raw.buffer, raw.byteOffset, raw.byteLength);
    for (let i = 0; i < raw.length; i++) {
      const buf = Buffer.alloc(dim);
      await fd.read(buf, 0, dim, i * dim);
      const signed = new Int8Array(buf.buffer, buf.byteOffset, dim);
      for (let d = 0; d < 3; d++) {
        floats[d] = signed[d] / 127.0;
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
    vectors_file_size: stat1.size,
    vectors_file_mtime: stat1.mtime.toISOString(),
    sample,
  });
}
