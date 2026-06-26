#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const journalPath = 'packages/screens/src/journal/JournalScreen.tsx';
const resonanceRoutePath = 'apps/web/app/api/resonance/route.ts';

const journal = readFileSync(journalPath, 'utf8');
const resonanceRoute = readFileSync(resonanceRoutePath, 'utf8');

const failures = [];

const autoFanoutPattern = /for\s*\(\s*const\s+seg\s+of\s+segments\s*\)[\s\S]{0,500}?loadResonance\s*\(/;
if (autoFanoutPattern.test(journal)) {
  failures.push(`${journalPath}: Journal must not auto-call loadResonance for every segment on paint.`);
}

const saveAutoLoadPattern = /handleSave[\s\S]{0,2000}?loadResonance\s*\(\s*serverId/;
if (saveAutoLoadPattern.test(journal)) {
  failures.push(`${journalPath}: Saving an entry must not synchronously auto-load resonance; it should be lazy/queued.`);
}

if (/ensureHighlightVectorsTable/.test(resonanceRoute)) {
  failures.push(`${resonanceRoutePath}: /api/resonance must not import or call ensureHighlightVectorsTable on the hot path.`);
}

if (!/modelLoadPromises\s*=\s*new Map/.test(resonanceRoute)) {
  failures.push(`${resonanceRoutePath}: loadModel must share in-flight model loads via modelLoadPromises Map.`);
}

if (!/modelLoadPromises\.get\(modelId\)/.test(resonanceRoute)) {
  failures.push(`${resonanceRoutePath}: loadModel must check an existing in-flight promise before starting another load.`);
}

if (!/modelLoadPromises\.delete\(modelId\)/.test(resonanceRoute)) {
  failures.push(`${resonanceRoutePath}: loadModel must clear in-flight promise after success/failure.`);
}

if (!/repairManifestAlignment/.test(resonanceRoute) || !/writeFile\(manifestPath/.test(resonanceRoute)) {
  failures.push(`${resonanceRoutePath}: loadModel must repair incomplete pplx manifests with sidecar passage_ids and passage_sources.`);
}

if (!/SIDECAR_ALIGNMENT_PATH/.test(resonanceRoute) || !/vectors_gte-small_manifest\.json/.test(resonanceRoute)) {
  failures.push(`${resonanceRoutePath}: manifest repair must use the seeded-library sidecar alignment path explicitly.`);
}

if (failures.length > 0) {
  console.error('Resonance hot-path verification failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Resonance hot-path verification passed.');
