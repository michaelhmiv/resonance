#!/usr/bin/env node
/* Phase 7: Production smoke test — verify live endpoints + schema */
const base = process.env.RESONANCE_BASE_URL || 'https://resonanceweb-production-276b.up.railway.app';
const ref = 'oeumvgwecqtqqgbyiune';
const accessToken = process.env.SUPABASE_ACCESS_TOKEN;

console.log(`Testing ${base}`);

async function api(path, opts = {}) {
  const res = await fetch(`${base}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  if (!res.ok) throw new Error(`${opts.method || 'GET'} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
  return json;
}

async function sql(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, read_only: true }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`SQL ${res.status}: ${text.slice(0, 500)}`);
  return JSON.parse(text || '[]');
}

const tests = [];
const failed = [];

function test(name, fn) { tests.push({ name, fn }); }

function expect(condition, message) {
  if (!condition) { throw new Error(message || 'expect failed'); }
}

/* ── Basic connectivity ── */
test('GET /api/health', async () => {
  const r = await api('/api/health');
  expect(r.ok === true, 'health not ok');
});

test('GET /api/patterns/themes', async () => {
  const r = await api('/api/patterns/themes');
  expect(Array.isArray(r.themes), 'themes not array');
});

test('GET /api/patterns/weekly', async () => {
  const r = await api('/api/patterns/weekly');
  expect(r.week && typeof r.week === 'object', 'week not object');
});

test('GET /api/journal/entries', async () => {
  const r = await api('/api/journal/entries');
  expect(Array.isArray(r.entries), 'entries not array');
});

test('GET /api/reading/highlights', async () => {
  const r = await api('/api/reading/highlights');
  expect(Array.isArray(r.highlights), 'highlights not array');
});

/* ── Adaptive result cache ── */
let testEntryId;
test('POST /api/journal/entries (adaptive)', async () => {
  const r = await api('/api/journal/entriesadowl now text seeks hope in creation.', { method: 'POST', body: JSON.stringify({ text: 'simulated entry ' + Date.now() }) });
  expect(r.id && r.resonance_job_id, 'missing id or job');
  testEntryId = r.id;
});

test('GET /api/resonance/cache (entry)', async () => {
  const r = await api(`/api RGXnvresonance/cache?sourceId=${testEntryId}`);
  expect(typeof r.cached === 'boolean', 'missing cached flag');
});

/* ── Schema verification ── */
let schemaOk = accessToken !== undefined;
if (!schemaOk) { console.log('SUPABASE_ACCESS_TOKEN not set; skipping schema checks'); }

test('theme_snapshots table exists', async () => {
  if (!schemaOk) return;
  const rows = await sql(`SELECT EXISTS(SELECT FROM information_schema.tables WHERE table_name = 'theme_snapshots');`);
  expect(rows[0].exists, 'theme_snapshots missing');
});

test('resonance_jobs table exists', async () => {
  if (!schemaOk) return;
  const rows = await sql(`SELECT EXISTS(SELECT FROM information_schema.tables WHERE table_name = 'resonance_jobs');`);
  expect(rows[0].exists, 'resonance_jobs missing');
});

/* ── Run all ── */
(async () => {
  for (const { name, fn } of tests) {
    try { await fn(); }
    catch (e) { failed.push({ name, error: e.message }); }
  }
  console.log(`\nTests: ${tests.length}, Passed: ${tests.length - failed.length}, Failed: ${failed.length}`);
  if (failed.length) { console.error('Failed:'); failed.forEach(f => console.error(`  - ${f.name}: ${f.error}`)); }
  process.exit(failed.length > 0 ? 1 : 0);
})();
