import { NextRequest, NextResponse } from 'next/server';
import { readFile, stat } from 'fs/promises';
import { existsSync } from 'fs';

export async function GET(req: NextRequest) {
  const token = req.headers.get('x-admin-token');
  const expected = process.env.ADMIN_UPLOAD_TOKEN;
  if (!expected || token !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const url = new URL(req.url);
  const path = url.searchParams.get('path');
  if (!path || path.includes('..') || path.startsWith('/')) {
    return NextResponse.json({ error: 'safe relative path required' }, { status: 400 });
  }
  const fullPath = `/data/${path}`;
  if (!existsSync(fullPath)) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  const s = await stat(fullPath);
  const offset = parseInt(url.searchParams.get('offset') || '0', 10);
  const length = parseInt(url.searchParams.get('length') || '16', 10);
  const fh = await import('fs/promises');
  const fd = await fh.open(fullPath, 'r');
  const buf = Buffer.alloc(length);
  await fd.read(buf, 0, length, offset);
  await fd.close();
  return NextResponse.json({
    path: fullPath,
    size: s.size,
    mtime: s.mtime.toISOString(),
    offset,
    bytes: Array.from(buf),
  });
}
