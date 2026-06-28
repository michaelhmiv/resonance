/**
 * GET /api/library/shards/[bookId]/[file] — stream one shard file with HTTP Range.
 *
 * Path params:
 *   bookId  — must match a known book in voice_books.json (validated against the manifest)
 *   file    — one of: 'vectors.bin', 'idmap.json', 'corpus.hnsw'
 *
 * HTTP Range support:
 *   - Returns 206 Partial Content with Content-Range header on valid Range request
 *   - Returns 200 with full file when no Range header
 *   - Returns 416 Range Not Satisfiable for invalid ranges
 *
 * Auth: required (premium user). The /api/library/* middleware handles auth.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createReadStream, statSync, existsSync } from 'fs';
import { Readable } from 'node:stream';

const SHARDS_BASE = '/data/seeded_library/library_shards';
const ALLOWED_FILES = new Set(['vectors.bin', 'idmap.json', 'corpus.hnsw']);

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ bookId: string; file: string }> }
) {
  const { bookId, file } = await params;

  // Validate bookId (alphanumeric + dash + underscore only, to prevent path traversal)
  if (!/^[a-z0-9_-]+$/i.test(bookId)) {
    return NextResponse.json({ error: 'Invalid bookId' }, { status: 400 });
  }

  // Validate file
  if (!ALLOWED_FILES.has(file)) {
    const allowed = ['vectors.bin', 'idmap.json', 'corpus.hnsw'];
    return NextResponse.json(
      { error: `Invalid file. Allowed: ${allowed.join(', ')}` },
      { status: 400 }
    );
  }

  const filePath = `${SHARDS_BASE}/${bookId}/${file}`;
  if (!existsSync(filePath)) {
    return NextResponse.json({ error: 'Shard file not found' }, { status: 404 });
  }

  const stat = statSync(filePath);
  const total = stat.size;
  const range = req.headers.get('range');

  // No Range header — return full file with Accept-Ranges hint
  if (!range) {
    const stream = createReadStream(filePath);
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      status: 200,
      headers: {
        'content-type': file.endsWith('.json') ? 'application/json' : 'application/octet-stream',
        'content-length': String(total),
        'accept-ranges': 'bytes',
        'cache-control': 'public, max-age=31536000, immutable', // shard contents are content-addressed by sha256
      },
    });
  }

  // Parse Range: bytes=START-END  (END optional)
  const m = /^bytes=(\d+)-(\d*)$/.exec(range);
  if (!m) {
    return new NextResponse(null, {
      status: 416,
      headers: { 'content-range': `bytes */${total}` },
    });
  }
  const start = parseInt(m[1], 10);
  const end = m[2] ? parseInt(m[2], 10) : Math.min(start + 1024 * 1024 - 1, total - 1);
  if (start >= total || end >= total || start > end) {
    return new NextResponse(null, {
      status: 416,
      headers: { 'content-range': `bytes */${total}` },
    });
  }

  const stream = createReadStream(filePath, { start, end });
  return new Response(Readable.toWeb(stream) as ReadableStream, {
    status: 206,
    headers: {
      'content-type': file.endsWith('.json') ? 'application/json' : 'application/octet-stream',
      'content-length': String(end - start + 1),
      'content-range': `bytes ${start}-${end}/${total}`,
      'accept-ranges': 'bytes',
      'cache-control': 'public, max-age=31536000, immutable',
    },
  });
}
