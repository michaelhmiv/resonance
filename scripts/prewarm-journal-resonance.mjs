#!/usr/bin/env node
const baseUrl = process.env.RESONANCE_BASE_URL || process.env.BASE_URL || 'http://localhost:3000';
const secret = process.env.RESONANCE_JOB_SECRET || process.env.ADMIN_UPLOAD_TOKEN;

if (!secret) {
  console.error('RESONANCE_JOB_SECRET or ADMIN_UPLOAD_TOKEN is required');
  process.exit(1);
}

const limitArg = process.argv.find((arg) => arg.startsWith('--limit='));
const force = process.argv.includes('--force');
const limit = limitArg ? Number(limitArg.split('=')[1]) : 100;

const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/resonance/prewarm`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-resonance-job-secret': secret,
  },
  body: JSON.stringify({ limit, force, origin: baseUrl }),
});

const text = await res.text();
let json;
try { json = JSON.parse(text); } catch { json = null; }

if (!res.ok || !json?.ok) {
  console.error('Journal resonance prewarm failed:');
  console.error(text);
  process.exit(1);
}

console.log(JSON.stringify(json, null, 2));
