#!/usr/bin/env node
/* Phase 6/7: Full system verification — localhost smoke test */
/* Runs against a local Next.js server or production */

const base = processHrtime(0.001);
const verbose = process.env.VERBOSE === '1';
const failFast = process.env.FAIL_FAST === '1';

async function api(path, opts = {}) {
  const url = `${base}${path}`;
  const res = await fetch(url, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(process.env.RESONANCE_AUTH_SECRET ? { Cookie: `resonance-auth=${process.env.RESONANCE_AUTH_SECRET}` } : {}),
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  if (!res.ok) throw new Error(`${opts.method || 'GET'} ${path} -> ${res.status}: ${text.slice(0, 500)}`);
  return json;
}

let failures = 0;
let tests = 0;
async function test(name, fn) {
  tests++;
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (err) {
    failures++;
    console.error(`✗ ${name}: ${err.message}`);
    if (failFast) process.exit(1);
  }
}

/* ──────── Phase 1: Health ──────── */
await test('GET /api/health', async () => {
  const r = await api('/api/health');
  if (!r.ok) throw new Error('health not ok');
});

/* ──────── Phase 2: Highlights via adaptive resonance ──────── */
let hlId;
await test('POST /api/reading/highlights (adaptive)', async () => {
  const r = await api('/api/reading/highlights', {
    method: 'POST',
    body: JSON.stringify({ verseRef: 'Genesis 1:1', color: 'amber', startOffset: 0, endOffset: 10, selectedText: 'In the beginning', noteText: 'Creation start' }),
  });
  if (!r.id || !r.resonance_job_id) throw new Error('missing id or resonance_job_id');
  hlId = r.id;
});

await test('PATCH /api/reading/highlights/id (adaptive)', async () => {
  const r = await api(`/api/reading/highlights/${hlId}`, {
    method: 'PATCH',
    body: JSON.stringify({ color: 'emerald' }),
  });
  if (!r.resonance_job_id) throw new Error('missing resonance_job_id');
});

await test('GET /api/reading/highlights', async () => {
  const r = await api('/api/reading/highlights');
  if (!Array.isArray(r.highlights)) throw new Error('highlights not array');
});

/* ──────── Phase 3: Theme snapshots ──────── */
await test('GET /api/patterns/themes', async () => {
  const r = await api('/api/patterns/themes');
  if (!Array.isArray(r.themes)) throw new Error('themes not array');
});

/* ──────── Phase 4: Jobs (secured) ──────── */
await test('POST /api/resonance/jobs (unauthorized)', async () => {
  try {
    await api('/api/resonance/jobs', { method: 'POST', body: JSON.stringify({ limit: 1 }) });
    throw new Error('should have been unauthorized');
  } catch (err) {
    if (!err.message.includes('401')) throw err;
  }
});

await test('POST /api/resonance/jobs (authorized)', async () => {
  if (!process.env.RESONANCE_JOB_SECRET) { console.log('  (skipped — no RESONANCE_JOB_SECRET)'); return; }
  const r = await api('/api/resonance/jobs', {
    method: 'POST',
    body: JSON.stringify({ limit: 1 }),
    headers: { 'x-resonance-job-secret': process.env.RESONANCE_JOB_SECRET },
  });
  if (typeof r.processed_count !== 'number') throw new Error('missing processed_count');
});

/* ──────── Phase 5: Cache ──────── */
await test('GET /api/resonance/cache (highlight)', async () => {
  const r = await api(`/api/resonance/cache?sourceId=${hlId}&sourceType=highlight`);
  if (typeof r.cached !== 'boolean') throw new Error('missing cached flag');
});

/* ──────── Cleanup ──────── */
if (hlId) {
  await test('DELETE /api/reading/highlights/id', async () => {
    await api(`/api/reading/highlights/${hlId}`, { method: 'DELETE' });
  });
}

/* ──────── Result ──────── */
console.log(`\n${failures === 0 ? 'ALL PASSED' : `${failures}/${tests} FAILED`}`);
process.exit(failures > 0 ? 1 : 0);
