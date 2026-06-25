/**
 * GET /api/admin/diag-vectors — check that loaded vectors match the manifest
 * Returns sample vectors with their norms and the first 3 dimensions.
 * If the route is loading from the right file with the right alignment,
 * the norms should be ~1.0 (after renormalization) and the bytes should
 * match what's on the volume.
 */
import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';

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

  // Read sample vectors using signed Int8Array view
  const sample: any[] = [];
  const sampleIndices = [0, 1, 2, 3, 4, 881, 13635, 100000, 200000, 237403];
  for (const i of sampleIndices) {
    if (i >= manifest.passage_count) continue;
    const buf = Buffer.alloc(dim);
    await fd.read(buf, 0, dim, i * dim);
    // Read as signed Int8 (so -59 stays -59, not 197)
    const signed = new Int8Array(buf.buffer, buf.byteOffset, dim);
    // Dequantize and renormalize
    const floats = new Float32Array(dim);
    let normBefore = 0;
    for (let d = 0; d < dim; d++) {
      floats[d] = signed[d] / 127.0;
      normBefore += floats[d] * floats[d];
    }
    normBefore = Math.sqrt(normBefore);
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
      raw_bytes_first3: [buf[0], buf[1], buf[2]],
      signed_first3: [signed[0], signed[1], signed[2]],
      dequant_first3: [floats[0], floats[1], floats[2]],
      norm_after_dequant: normBefore,
      norm_after_renormalize: normAfter,
    });
  }
  await fd.close();

  return NextResponse.json({
    manifest_passage_count: manifest.passage_count,
    manifest_dim: manifest.dim,
    manifest_dtype: manifest.dtype,
    vectors_file_size: stat1.size,
    vectors_file_mtime: stat1.mtime.toISOString(),
    sample,
  });
}
