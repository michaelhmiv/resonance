#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const failures = [];
function read(path) { return readFileSync(path, 'utf8'); }
function fail(path, message) { failures.push(`${path}: ${message}`); }

const journalPath = 'packages/screens/src/journal/JournalScreen.tsx';
const clientPath = 'apps/web/lib/client-data-layer.ts';
const resonanceRoutePath = 'apps/web/app/api/resonance/route.ts';
const dbPath = 'apps/web/lib/db.ts';

const journal = read(journalPath);
const client = read(clientPath);
const resonanceRoute = read(resonanceRoutePath);
const db = read(dbPath);

// Contract 1: /journal must not start resonance work on initial paint.
// ✦ should remain visible, but resonance computation must be user-triggered.
if (/autoExpandArmed/.test(journal)) {
  fail(journalPath, 'must not keep an autoExpandArmed first-paint resonance loader.');
}
if (/useEffect\s*\([\s\S]{0,900}?loadResonance\s*\(/.test(journal)) {
  fail(journalPath, 'must not call loadResonance from a mount/data-load effect; only explicit ✦ expansion should call it.');
}
if (!/onPress=\{\(\) => toggleFootnote\(seg\.id, seg\.text!\)\}/.test(journal)) {
  fail(journalPath, 'must keep explicit ✦ tap as the trigger for loading resonance.');
}

// Contract 2: API returns journal entries newest-first; web adapter must preserve that order.
const loadSegmentsMatch = client.match(/async\s+loadSegments\(\):\s*Promise<JournalSegment\[]>\s*\{[\s\S]*?\n\s*\}/);
if (!loadSegmentsMatch) {
  fail(clientPath, 'must define WebDataLayer.loadSegments().');
} else if (/\.reverse\s*\(/.test(loadSegmentsMatch[0])) {
  fail(clientPath, 'loadSegments must not reverse /api/journal/entries; API already returns newest-first.');
}

// Contract 3: /api/resonance must be able to persist/cache when the client only knows sourceId.
if (!/export\s+async\s+function\s+getOrCreateResonanceNodeForSource\b/.test(db)) {
  fail(dbPath, 'must export getOrCreateResonanceNodeForSource so existing entries can self-heal adaptive nodes.');
}
if (!/getOrCreateResonanceNodeForSource/.test(resonanceRoute)) {
  fail(resonanceRoutePath, 'must call getOrCreateResonanceNodeForSource before cache lookup/persistence.');
}
if (/if \(!resolvedSourceId \|\| !sourceNodeId \|\| !text\?\.trim\(\)\) return;/.test(resonanceRoute)) {
  fail(resonanceRoutePath, 'must not require the client to provide sourceNodeId before persisting cache.');
}
if (!/resolvedSourceNodeId/.test(resonanceRoute)) {
  fail(resonanceRoutePath, 'must use a resolvedSourceNodeId internally for cache persistence.');
}

if (failures.length) {
  console.error('Journal loading contract verification failed:');
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log('Journal loading contract verification passed.');
