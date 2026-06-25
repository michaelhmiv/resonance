/**
 * POST /api/admin/upload-file — generic chunked file upload to Railway volume
 *
 * Use for any file under /data/ that needs to ship from local to production.
 * For voice_passages.json (200MB), per-work staging files, etc.
 *
 * Headers:
 *   X-Admin-Token:  shared secret
 *   X-Path:        destination path under /data/ (e.g. "seeded_library/voice_passages.json")
 *                  Must not contain ".." or start with "/"
 *   X-Chunk-Index: 0-based chunk number
 *   X-Total-Chunks: total number of chunks
 *   Content-Type:  application/octet-stream
 *
 * Chunks land in /data/.uploads/.tmp/<basename>/ — auto-assembled when
 * the final chunk arrives.
 */

import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir, readFile, unlink, readdir, rename } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

const DATA_ROOT = '/data';
const TMP_DIR = path.join(DATA_ROOT, '.uploads', '.tmp');

function unauthorized(): NextResponse {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

function isSafeRelativePath(p: string): boolean {
  // No absolute paths, no traversal, no leading slashes
  if (!p || p.startsWith('/') || p.includes('..')) return false;
  // No null bytes
  if (p.includes('\0')) return false;
  return true;
}

export async function POST(req: NextRequest) {
  const token = req.headers.get('x-admin-token');
  const expected = process.env.ADMIN_UPLOAD_TOKEN;
  if (!expected || token !== expected) return unauthorized();

  const relPath = req.headers.get('x-path');
  const chunkIdxStr = req.headers.get('x-chunk-index');
  const totalChunksStr = req.headers.get('x-total-chunks');

  if (!relPath || chunkIdxStr == null || totalChunksStr == null) {
    return NextResponse.json(
      { error: 'Missing required headers: X-Path, X-Chunk-Index, X-Total-Chunks' },
      { status: 400 },
    );
  }
  if (!isSafeRelativePath(relPath)) {
    return NextResponse.json(
      { error: 'X-Path must be a relative path under /data/ with no traversal' },
      { status: 400 },
    );
  }

  const chunkIdx = parseInt(chunkIdxStr, 10);
  const totalChunks = parseInt(totalChunksStr, 10);
  if (isNaN(chunkIdx) || isNaN(totalChunks) || chunkIdx < 0 || totalChunks < 1) {
    return NextResponse.json({ error: 'Invalid chunk index or total chunks' }, { status: 400 });
  }

  // Use a hash of the destination path for the tmp dir name
  // (allows concurrent uploads of different files)
  const pathHash = Buffer.from(relPath).toString('base64').replace(/[/+=]/g, '_');

  try {
    const buffer = Buffer.from(await req.arrayBuffer());
    const chunkDir = path.join(TMP_DIR, pathHash);
    const chunkPath = path.join(chunkDir, `chunk_${chunkIdx}`);
    const destPath = path.join(DATA_ROOT, relPath);

    await mkdir(chunkDir, { recursive: true });
    await writeFile(chunkPath, buffer);

    // If this is the last chunk, assemble
    if (chunkIdx === totalChunks - 1) {
      // Verify all chunks present
      for (let i = 0; i < totalChunks; i++) {
        const p = path.join(chunkDir, `chunk_${i}`);
        if (!existsSync(p)) {
          return NextResponse.json(
            { error: `Missing chunk ${i}`, received: chunkIdx },
            { status: 400 },
          );
        }
      }

      // Assemble
      await mkdir(path.dirname(destPath), { recursive: true });
      const chunks: Buffer[] = [];
      for (let i = 0; i < totalChunks; i++) {
        const p = path.join(chunkDir, `chunk_${i}`);
        chunks.push(await readFile(p));
      }
      const assembled = Buffer.concat(chunks);

      // Write atomically: write to .tmp first, then rename
      const finalTmp = destPath + '.upload';
      await writeFile(finalTmp, assembled);
      await rename(finalTmp, destPath);

      // Clean up chunks
      for (let i = 0; i < totalChunks; i++) {
        const p = path.join(chunkDir, `chunk_${i}`);
        await unlink(p).catch(() => {});
      }
      try {
        await readdir(chunkDir);
        // rmdir if empty
      } catch {}

      return NextResponse.json({
        ok: true,
        path: destPath,
        rel_path: relPath,
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
 * GET /api/admin/upload-file?path=... — check upload status
 */
export async function GET(req: NextRequest) {
  const token = req.headers.get('x-admin-token');
  const expected = process.env.ADMIN_UPLOAD_TOKEN;
  if (!expected || token !== expected) return unauthorized();

  const url = new URL(req.url);
  const relPath = url.searchParams.get('path');
  if (!relPath || !isSafeRelativePath(relPath)) {
    return NextResponse.json({ error: '?path=<rel> required (no traversal)' }, { status: 400 });
  }

  const pathHash = Buffer.from(relPath).toString('base64').replace(/[/+=]/g, '_');
  const chunkDir = path.join(TMP_DIR, pathHash);
  if (!existsSync(chunkDir)) {
    return NextResponse.json({ chunks_received: [] });
  }

  try {
    const files = await readdir(chunkDir);
    const chunks = files
      .filter((f) => f.startsWith('chunk_'))
      .map((f) => parseInt(f.replace('chunk_', ''), 10))
      .sort((a, b) => a - b);

    const destPath = path.join(DATA_ROOT, relPath);
    const assembled = existsSync(destPath);
    let size = 0;
    if (assembled) {
      const { stat } = await import('fs/promises');
      const s = await stat(destPath);
      size = s.size;
    }

    return NextResponse.json({
      path: destPath,
      rel_path: relPath,
      chunks_received: chunks,
      assembled,
      size,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
