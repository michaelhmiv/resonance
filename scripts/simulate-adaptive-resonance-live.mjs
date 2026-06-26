#!/usr/bin/env node
const base = process.env.RESONANCE_BASE_URL || 'http://127.0.0.1:3131';
const ref = 'oeumvgwecqtqqgbyiune';
const accessToken = process.env.SUPABASE_ACCESS_TOKEN;
if (!accessToken) throw new Error('SUPABASE_ACCESS_TOKEN missing');

async function api(path, options = {}) {
  const res = await fetch(`${base}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(process.env.RESONANCE_AUTH_SECRET ? { Cookie: `resonance-auth=${process.env.RESONANCE_AUTH_SECRET}` } : {}), ...(options.headers || {}) },
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  if (!res.ok) throw new Error(`${options.method || 'GET'} ${path} -> ${res.status}: ${text.slice(0, 500)}`);
  return json;
}

async function sql(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, read_only: false }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`SQL ${res.status}: ${text.slice(0, 1000)}`);
  return JSON.parse(text || '[]');
}

const marker = `adaptive-sim-${Date.now()}`;
const text = `Integration simulation ${marker}. I feel weary but hopeful, seeking peace, wisdom, and perseverance in prayer.`;
let entryId;
try {
  console.log('create entry');
  const created = await api('/api/journal/entries', { method: 'POST', body: JSON.stringify({ text }) });
  entryId = created.id;
  if (!entryId || !created.resonance_job_id) throw new Error(`create response missing ids: ${JSON.stringify(created)}`);
  console.log(JSON.stringify({ entryId, jobId: created.resonance_job_id }));

  let rows = await sql(`select n.id as node_id, n.content_hash, e.event_type, j.status as job_status from resonance_nodes n join resonance_events e on e.source_node_id=n.id join resonance_jobs j on j.source_node_id=n.id where n.source_id='${entryId}' order by e.created_at desc limit 1`);
  console.log('after create', JSON.stringify(rows));
  if (rows.length !== 1 || rows[0].event_type !== 'journal.created' || rows[0].job_status !== 'pending') throw new Error('create did not produce node/event/pending job');

  console.log('process job');
  const processed = await api('/api/resonance/jobs', { method: 'POST', body: JSON.stringify({ limit: 1, origin: base }) });
  console.log(JSON.stringify({ processed_count: processed.processed_count, edges: processed.processed?.[0]?.edges, method: processed.processed?.[0]?.result?.method }));
  if (processed.processed_count !== 1) throw new Error('job processor did not process exactly one job');

  rows = await sql(`select (select count(*) from resonance_embeddings where node_id=n.id) as embeddings, (select count(*) from resonance_result_cache where source_node_id=n.id and status='fresh') as caches, (select count(*) from resonance_edges where source_node_id=n.id) as edges, (select status from resonance_jobs where source_node_id=n.id order by updated_at desc limit 1) as job_status from resonance_nodes n where n.source_id='${entryId}'`);
  console.log('after job', JSON.stringify(rows));
  if (!rows[0] || Number(rows[0].embeddings) < 1 || Number(rows[0].caches) < 1 || Number(rows[0].edges) < 1 || rows[0].job_status !== 'completed') throw new Error('job did not write embedding/cache/edges/completed');

  console.log('cache route');
  const cached = await api(`/api/resonance/cache?sourceId=${encodeURIComponent(entryId)}`);
  console.log(JSON.stringify({ cached: cached.cached, scripture: cached.result?.scripture?.length, voices: cached.result?.voices?.length }));
  if (!cached.cached || !cached.result) throw new Error('cache route did not return cached result');

  console.log('update entry');
  await api(`/api/journal/entries/${entryId}`, { method: 'PUT', body: JSON.stringify({ text: `${text} Updated: patience under pressure.` }) });
  rows = await sql(`select event_type from resonance_events where source_id='${entryId}' order by created_at desc limit 1`);
  console.log('after update', JSON.stringify(rows));
  if (rows[0]?.event_type !== 'journal.updated') throw new Error('update did not append journal.updated');

  console.log('delete entry');
  await api(`/api/journal/entries/${entryId}`, { method: 'DELETE' });
  rows = await sql(`select status, (select event_type from resonance_events where source_id='${entryId}' order by created_at desc limit 1) as latest_event from resonance_nodes where source_id='${entryId}'`);
  console.log('after delete', JSON.stringify(rows));
  if (rows[0]?.status !== 'deleted' || rows[0]?.latest_event !== 'journal.deleted') throw new Error('delete did not mark node deleted and append event');

  console.log('SIMULATION PASSED');
} finally {
  if (entryId) {
    await sql(`delete from resonance_jobs where source_id='${entryId}'; delete from resonance_result_cache where source_id='${entryId}'; delete from resonance_edges where source_node_id in (select id from resonance_nodes where source_id='${entryId}'); delete from resonance_embeddings where node_id in (select id from resonance_nodes where source_id='${entryId}'); delete from resonance_events where source_id='${entryId}'; delete from resonance_nodes where source_id='${entryId}'; delete from journal_entries where id='${entryId}';`)
      .catch((err) => console.warn('cleanup failed', err.message));
  }
}
