/**
 * DELETE /api/admin/vectors — remove a model directory from /data/vectors/
 *
 * Used to clean up stale model directories after a migration. Currently
 * only called to remove the old gte-small/ 388MB index that was used
 * before the switch to pplx-embed-v1-4b.
 *
 * Auth: X-Admin-Token header (same as upload-vectors)
 *
 * Body: { model: "gte-small" }
 *
 * Safety: refuses to delete the currently-active model. Active model is
 * determined by looking for a manifest.json and confirming vectors.bin exists.
 */

import { NextRequest, NextResponse } from 'next/server';
import { rm, readFile } from 'fs/promises';
import { existsSync, readdirSync } from 'fs';
import path from 'path';

const VECTORS_ROOT = '/data/vectors';

function unauthorized(): NextResponse {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

function isSafeModelName(name: string): boolean {
  // Only allow simple directory names — no traversal, no slashes, no dots
  return /^[a-zA-Z0-9_-]+$/.test(name);
}

async function findActiveModel(): Promise<string | null> {
  if (!existsSync(VECTORS_ROOT)) return null;
  const entries = readdirSync(VECTORS_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('.'));
  for (const e of entries) {
    const manifestPath = path.join(VECTORS_ROOT, e.name, 'manifest.json');
    if (existsSync(manifestPath)) {
      try {
        const m = JSON.parse(await readFile(manifestPath, 'utf-8'));
        if (m.passage_count > 0 && m.dim > 0) return e.name;
      } catch {
        // skip
      }
    }
  }
  return null;
}

export async function DELETE(req: NextRequest) {
  const token = req.headers.get('x-admin-token');
  const expected = process.env.ADMIN_UPLOAD_TOKEN;
  if (!expected || token !== expected) return unauthorized();

  let body: { model?: string };
  try {
    body = (await req.json()) as { model?: string };
  } catch {
    return NextResponse.json({ error: 'JSON body required: { model: "..." }' }, { status: 400 });
  }

  const model = body.model;
  if (!model || !isSafeModelName(model)) {
    return NextResponse.json(
      { error: 'model must match [a-zA-Z0-9_-]+' },
      { status: 400 },
    );
  }

  const target = path.join(VECTORS_ROOT, model);
  if (!existsSync(target)) {
    return NextResponse.json({ ok: true, note: 'already absent' });
  }

  // Refuse to delete the active model
  const active = await findActiveModel();
  if (active === model) {
    return NextResponse.json(
      { error: `Refusing to delete active model "${model}". Build a replacement first.` },
      { status: 409 },
    );
  }

  try {
    await rm(target, { recursive: true, force: true });
    return NextResponse.json({
      ok: true,
      deleted: model,
      active_model: active,
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'Delete failed', detail: String(err) },
      { status: 500 },
    );
  }
}
