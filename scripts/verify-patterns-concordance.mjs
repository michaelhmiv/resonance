/**
 * Verification script for the shared offline-capable Patterns & Study Bookshelf
 * concordance engine in packages/core/src/patterns-engine.ts.
 *
 * Exercises:
 *   1. resonance_nodes <-> resonance_edges join (1-evidence edges no longer dropped)
 *   2. "What Kept Finding You" aggregation + neverRead flagging
 *   3. Cross-day connections attached inside buildConcordanceDayDetail
 *   4. Study Bookshelf 66-book Scripture + Installed Literature cloth states
 *   5. Unread & visited Book Bridges (traces + stored echoes + cross-refs + passage bridges)
 *   6. Spine auto-fit font sizing for long labels
 */

import assert from 'node:assert/strict';
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import vm from 'node:vm';

const repoRoot = process.cwd();

function loadTsModule(relPath, cache = new Map()) {
  const abs = path.resolve(repoRoot, relPath);
  if (cache.has(abs)) return cache.get(abs).exports;
  const source = readFileSync(abs, 'utf-8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: abs,
  }).outputText;

  const mod = { exports: {} };
  cache.set(abs, mod);
  const localRequire = (spec) => {
    if (spec.startsWith('./') || spec.startsWith('../')) {
      const candidate = path.resolve(path.dirname(abs), `${spec}.ts`);
      return loadTsModule(path.relative(repoRoot, candidate), cache);
    }
    return createRequire(abs)(spec);
  };
  const fn = new vm.Script(`(function(exports, require, module, __filename, __dirname) {\n${transpiled}\n})`, {
    filename: abs,
  }).runInThisContext();
  fn(mod.exports, localRequire, mod, abs, path.dirname(abs));
  return mod.exports;
}

const engine = loadTsModule('packages/core/src/patterns-engine.ts');

const raw = {
  journal: [
    { id: 'j1', text: 'Woke up rehearsing tomorrow meetings and feeling stretched thin over next month.', created_at: '2026-05-04T08:00:00Z' },
    { id: 'j2', text: 'Trying to solve three months ahead instead of carrying only today with steadiness inside friction.', created_at: '2026-05-18T08:00:00Z' },
    { id: 'j3', text: 'Quiet porch morning thinking about daily portion and rejoicing in steadiness.', created_at: '2026-05-21T08:00:00Z' },
  ],
  reading: [
    { id: 'r1', book_id: 'web_Exodus', chapter: 16, verse_ref: 'Exodus 16:4', created_at: '2026-05-09T09:00:00Z' },
  ],
  highlights: [
    {
      id: 'h1',
      verse_ref: 'Exodus 16:4',
      color: '#d4a574',
      selected_text: 'gather a day portion every day',
      note_text: 'Daily portion, not a warehouse for tomorrow.',
      note_updated_at: '2026-05-09T09:05:00Z',
      created_at: '2026-05-09T09:01:00Z',
      updated_at: '2026-05-09T09:05:00Z',
    },
  ],
  bookmarks: [
    { id: 'b1', verse_ref: 'Exodus 16:4', label: 'Daily bread', created_at: '2026-05-09T09:06:00Z' },
  ],
  events: [],
  nodes: [
    { id: 'node-j1', node_type: 'journal_entry', source_id: 'j1', body_text: 'Woke up rehearsing tomorrow meetings', updated_at: '2026-05-04T08:00:00Z' },
    { id: 'node-j2', node_type: 'journal_entry', source_id: 'j2', body_text: 'Trying to solve three months ahead', updated_at: '2026-05-18T08:00:00Z' },
    { id: 'node-h1', node_type: 'note', source_id: 'h1:note', title: 'Note on Exodus 16:4', body_text: 'Daily portion, not a warehouse for tomorrow.', updated_at: '2026-05-09T09:05:00Z' },
  ],
  edges: [
    {
      id: 'e1',
      source_node_id: 'node-j1',
      target_kind: 'scripture',
      target_source: 'web_Matthew',
      target_id: '101',
      target_ref: 'Matthew 6:34 (WEB)',
      score: 0.78,
      confidence: 0.78,
      state: 'candidate',
      evidence: [{ reason: 'semantic_resonance', excerpt: 'Therefore do not be anxious for tomorrow.', seen_at: '2026-05-04T08:01:00Z' }],
      last_seen_at: '2026-05-04T08:01:00Z',
      metadata: { bookId: 'web_Matthew', source: 'Matthew 6:34 (WEB)' },
    },
    {
      id: 'e2',
      source_node_id: 'node-j2',
      target_kind: 'scripture',
      target_source: 'web_Matthew',
      target_id: '101',
      target_ref: 'Matthew 6:34 (WEB)',
      score: 0.82,
      confidence: 0.82,
      state: 'candidate',
      evidence: [{ reason: 'semantic_resonance', excerpt: 'Therefore do not be anxious for tomorrow.', seen_at: '2026-05-18T08:01:00Z' }],
      last_seen_at: '2026-05-18T08:01:00Z',
      metadata: { bookId: 'web_Matthew', source: 'Matthew 6:34 (WEB)' },
    },
    {
      id: 'e3',
      source_node_id: 'node-j2',
      target_kind: 'voice',
      target_source: 'voice_julian',
      target_id: '501',
      target_ref: 'Julian of Norwich — Revelations',
      score: 0.74,
      confidence: 0.74,
      state: 'candidate',
      evidence: [{ reason: 'semantic_resonance', excerpt: 'Thou shalt not be overcome.', seen_at: '2026-05-18T08:02:00Z' }],
      last_seen_at: '2026-05-18T08:02:00Z',
      metadata: { bookId: 'voice_julian', source: 'Julian of Norwich — Revelations' },
    },
  ],
  snapshots: [],
  installedVoices: [
    { id: 'voice_julian', title: 'Revelations of Divine Love', author: 'Julian of Norwich', era: 'Medieval', packageId: 'medieval_devotional' },
    { id: 'voice_lawrence', title: 'The Practice of the Presence of God', author: 'Brother Lawrence', era: '17th c.', packageId: 'catholic_reform' },
  ],
};

// 1. Summary & FindingYou
const summary = engine.buildConcordanceSummary({
  calendarRaw: raw,
  timeframeRaw: raw,
  calendarWindow: { start: '2026-05-01', end: '2026-05-31' },
  timeframe: '30d',
});

assert.equal(summary.echoes.length, 3, '1-evidence resonance_edges must not be dropped');
assert.ok(summary.findingYou && summary.findingYou.length >= 1, 'findingYou must surface repeated targets');
assert.equal(summary.findingYou[0].bookName, 'Matthew');
assert.equal(summary.findingYou[0].count, 2);
assert.equal(summary.findingYou[0].neverRead, true, 'unread Matthew must be flagged neverRead=true');
assert.equal(summary.bookshelf.scripture.length, 66, 'bookshelf must include all 66 Bible books');
assert.equal(summary.bookshelf.literature.length, 2, 'bookshelf must include installed literature');

const exodusVol = summary.bookshelf.scripture.find((v) => v.id === 'Exodus');
const matthewVol = summary.bookshelf.scripture.find((v) => v.id === 'Matthew');
const habakkukVol = summary.bookshelf.scripture.find((v) => v.id === 'Habakkuk');
const julianVol = summary.bookshelf.literature.find((v) => v.id === 'voice_julian');

assert.equal(exodusVol.clothState, 'read');
assert.equal(exodusVol.highlightCount, 1);
assert.equal(exodusVol.noteCount, 1);
assert.equal(matthewVol.clothState, 'echo', 'unread echoing Matthew should be gold echo state');
assert.equal(habakkukVol.clothState, 'unread');
assert.equal(julianVol.clothState, 'echo');

// 2. Cross-day detail: clicking May 18 attaches echoes + multi-day trails
const dayDetail = engine.buildConcordanceDayDetail({
  date: '2026-05-18',
  contextRaw: raw,
  contextStart: '2026-04-18',
  contextEnd: '2026-05-25',
});
assert.equal(dayDetail.journal.length, 1);
assert.ok(dayDetail.journal[0].connections.length >= 2, 'May 18 journal item must attach resolved echoes & cross-day trails');

// 3. Unread book bridge: Habakkuk (0 reads, 0 highlights) still produces grounded bridges!
const habBridge = engine.buildBookBridgesFromData({
  kind: 'bible',
  id: 'Habakkuk',
  bookId: 'web_Habakkuk',
  title: 'Habakkuk',
  subtitle: 'Old Testament · Prophets',
  timeframe: '30d',
  raw,
  bookPassages: [
    { id: 1, ref: 'Habakkuk 3:17', bookId: 'web_Habakkuk', chapter: 3, verse: 17, text: 'For though the fig tree does not flourish, yet I will rejoice in steadiness inside friction.' },
    { id: 2, ref: 'Habakkuk 2:3', bookId: 'web_Habakkuk', chapter: 2, verse: 3, text: 'Though it takes time, wait for it; for it will surely come.' },
  ],
  crossRefPairs: [
    { fromHighlightRef: 'Exodus 16:4', fromExcerpt: 'Daily portion, not a warehouse', targetRef: 'Habakkuk 2:3', targetText: 'Though it takes time, wait for it.' },
  ],
});
assert.equal(habBridge.visited, false);
assert.ok(habBridge.items.some((i) => i.via === 'crossref'), 'unread Habakkuk should include cross-ref bridge');
assert.ok(habBridge.items.some((i) => i.via === 'semantic'), 'unread Habakkuk should include book-scoped bridge');

// 4. Spine auto-fit font scaling
assert.ok(engine.fitSpineFontSize('Devotional', 118, 13.5) < 13.5, 'Devotional should scale down cleanly');
assert.ok(engine.fitSpineFontSize('Bonaventure', 98, 11.5) <= 9, 'Bonaventure should scale down cleanly');
assert.equal(engine.fitSpineFontSize('Law', 118, 13), 13, 'Short labels keep base font size');

console.log('✅ verify-patterns-concordance: all assertions passed');
