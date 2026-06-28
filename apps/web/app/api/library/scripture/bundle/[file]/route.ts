/**
 * GET /api/library/scripture/bundle/[file] — stream one scripture bundle file with HTTP Range.
 *
 * Path params:
 *   file — one of: 'bible_passages.json', 'vectors.bin', 'idmap.json', 'corpus.hnsw'
 *
 * HTTP Range support: same as the shard file route.
 * Mobile fetches the 4 files in order (smallest first to verify integrity early).
 */

import { NextRequest } from 'next/server';
import { createReadStream, statSync, existsSync } from 'fs';
import { Readable } from 'node:stream';

const BUNDLE_BASE = '/data/seeded_library/scripture_bundle';
const ALLOWED_FILES = ['bible_passages.json', 'vectors.bin', 'idmap.json', 'corpus.hnsw'];

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ file: string }> }
) {
  const { file } = await params;

  if (!ALLOWED_FILES.includes(file)) {
    return new Response(
      JSON.stringify({ error: `Invalid file. Allowed: ${ALLOWED_FILES.join(', ')}` }),
      { status: 400, headers: { 'content-type': 'application/json' } }
    );
  }

  const filePath = `${BUNDLE_BASE}/${file}`;
  if (!existsSync(filePath)) {
    return new Response(
      JSON.stringify({ error: 'Scripture bundle file not found' }),
      { status: 404, headers: { 'content-type': 'application/json' } }
    );
  }

  const stat = statSync(filePath);
  const total = stat.size;
  const range = req.headers.get('range');

  if (!range) {
    const stream = createReadStream(filePath);
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      status: 200,
      headers: {
        'content-type': file.endsWith('.json') ? 'application/json' : 'application/octet-stream',
        'content-length': String(total),
        'accept-ranges': 'bytes',
        'cache-control': 'public, max-age=31536000, immutable',
      },
    });
  }

  const m = /^bytes=(\d+)-(\d*)$/.exec(range);
  if (!m) {
    return new Response(null, {
      status: 416,
      headers: { 'content-range': `bytes */${total}` },
    });
  }
  const start = parseInt(m[1], 10);
  const end = m[2] ? parseInt(m[2], 10) : Math.min(start + 1024 * 1024 - 1, total - 1);
  if (start >= total || end >= total || start > end) {
    return new Response(null, {
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
