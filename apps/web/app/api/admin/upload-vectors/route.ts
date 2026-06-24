/**
 * POST /api/admin/upload-vectors — chunked vector file upload
 *
 * Headers:
 *   X-Admin-Token:  shared secret
 *   X-Model:        model name (e.g. "gte-small")
 *   X-Filename:     destination filename (e.g. "vectors.bin")
 *   X-Chunk-Index:  0-based chunk number
 *   X-Total-Chunks: total number of chunks
 *   Content-Type:   application/octet-stream
 *
 * Chunks land in /data/vectors/.tmp/<model>/ — auto-assembled when
 * the final chunk arrives.
 */

import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir, readFile, rename, unlink, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

const VECTORS_ROOT = '/data/vectors';
const TMP_DIR = path.join(VECTORS_ROOT, '.tmp');

function unauthorized(): NextResponse {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

export async function POST(req: NextRequest) {
  const token = req.headers.get('x-admin-token');
  const expected = process.env.ADMIN_UPLOAD_TOKEN;
  if (!expected || token !== expected) return unauthorized();

  const model = req.headers.get('x-model');
  const filename = req.headers.get('x-filename');
  const chunkIdxStr = req.headers.get('x-chunk-index');
  const totalChunksStr = req.headers.get('x-total-chunks');

  if (!model || !filename || chunkIdxStr == null || totalChunksStr == null) {
    return NextResponse.json(
      { error: 'Missing required headers: X-Model, X-Filename, X-Chunk-Index, X-Total-Chunks' },
      { status: 400 },
    );
  }

  const chunkIdx = parseInt(chunkIdxStr, 10);
  const totalChunks = parseInt(totalChunksStr, 10);

  if (isNaN(chunkIdx) || isNaN(totalChunks) || chunkIdx < 0 || totalChunks < 1) {
    return NextResponse.json({ error: 'Invalid chunk index or total chunks' }, { status: 400 });
  }

  try {
    const buffer = Buffer.from(await req.arrayBuffer());
    const chunkDir = path.join(TMP_DIR, model);
    const chunkPath = path.join(chunkDir, `${filename}_chunk_${chunkIdx}`);
    const destDir = path.join(VECTORS_ROOT, model);
    const destPath = path.join(destDir, filename);

    await mkdir(chunkDir, { recursive: true });
    await writeFile(chunkPath, buffer);

    // If this is the last chunk, assemble
    if (chunkIdx === totalChunks - 1) {
      // Verify all chunks present
      for (let i = 0; i < totalChunks; i++) {
        const p = path.join(chunkDir, `${filename}_chunk_${i}`);
        if (!existsSync(p)) {
          return NextResponse.json(
            { error: `Missing chunk ${i}`, received: chunkIdx },
            { status: 400 },
          );
        }
      }

      // Assemble
      await mkdir(destDir, { recursive: true });
      const chunks: Buffer[] = [];
      for (let i = 0; i < totalChunks; i++) {
        const p = path.join(chunkDir, `${filename}_chunk_${i}`);
        chunks.push(await readFile(p));
      }
      const assembled = Buffer.concat(chunks);
      await writeFile(destPath, assembled);

      // Clean up temp chunks
      for (let i = 0; i < totalChunks; i++) {
        const p = path.join(chunkDir, `${filename}_chunk_${i}`);
        await unlink(p).catch(() => {});
      }

      return NextResponse.json({
        ok: true,
        model,
        filename,
        path: destPath,
        size: assembled.length,
        chunks: totalChunks,
      });
    }

    return NextResponse.json({
      ok: true,
      chunk: chunkIdx,
      received: buffer.length,
      remaining: totalChunks - chunkIdx - 1,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: 'Upload failed',
        detail: err instanceof Error ? err.message.slice(0, 300) : String(err),
      },
      { status: 500 },
    );
  }
}

/**
 * GET /api/admin/upload-vectors — check upload status
 */
export async function GET(req: NextRequest) {
  const token = req.headers.get('x-admin-token');
  const expected = process.env.ADMIN_UPLOAD_TOKEN;
  if (!expected || token !== expected) return unauthorized();

  const url = new URL(req.url);
  const model = url.searchParams.get('model');
  const filename = url.searchParams.get('filename');

  if (!model || !filename) {
    return NextResponse.json({ error: '?model=X&filename=Y required' }, { status: 400 });
  }

  const chunkDir = path.join(TMP_DIR, model);
  if (!existsSync(chunkDir)) {
    return NextResponse.json({ chunks_received: [] });
  }

  try {
    const files = await readdir(chunkDir);
    const prefix = `${filename}_chunk_`;
    const chunks = files
      .filter((f) => f.startsWith(prefix))
      .map((f) => parseInt(f.replace(prefix, ''), 10))
      .sort((a, b) => a - b);

    const destPath = path.join(VECTORS_ROOT, model, filename);
    const assembled = existsSync(destPath);

    return NextResponse.json({
      model,
      filename,
      chunks_received: chunks,
      assembled,
    });
  } catch (err) {
    return NextResponse.json(
      { error: String(err) },
      { status: 500 },
    );
  }
}
