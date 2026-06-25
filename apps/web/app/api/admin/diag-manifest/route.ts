/**
 * GET /api/admin/diag-manifest — diagnostic endpoint to check what's on the volume
 * Returns the actual file size, mtime, and first 200 bytes of the manifest.
 */
import { NextRequest, NextResponse } from 'next/server';
import { readFile, stat } from 'fs/promises';
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
  const s = await stat(manifestPath);
  const data = await readFile(manifestPath, 'utf-8');
  let parsed: any = null;
  let parseError: string | null = null;
  try { parsed = JSON.parse(data); } catch (e) { parseError = String(e); }
  return NextResponse.json({
    path: manifestPath,
    size: s.size,
    mtime: s.mtime.toISOString(),
    has_passage_ids: Array.isArray(parsed?.passage_ids),
    passage_ids_count: parsed?.passage_ids?.length ?? 0,
    passage_count: parsed?.passage_count ?? null,
    model: parsed?.model ?? null,
    keys: parsed ? Object.keys(parsed) : null,
    parse_error: parseError,
    first_200_bytes: data.slice(0, 200),
  });
}
