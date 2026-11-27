#!/usr/bin/env node
/**
 * Executable End-to-End Test Suite for OpenRouter BYOK & Multimodal Life Diary.
 *
 * Runs REAL SQLite (Node 22 `node:sqlite` with `PRAGMA foreign_keys = ON`) against
 * the actual `MIGRATIONS` from `apps/mobile/src/db/schema.ts`, executes every
 * production SQL query from diary/reembed/resonance/pdfOcr/openrouter stores,
 * verifies math & vector isolation, and tests all 4 live OpenRouter catalog APIs.
 *
 * Run: `node scripts/test-openrouter-diary-e2e.mjs`
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const ROOT = process.cwd();
let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (err) {
    console.error(`  FAIL  ${name}`);
    console.error(`        ${err instanceof Error ? err.stack || err.message : String(err)}`);
    failed++;
  }
}

/** Extract real `{ version, sql }` entries from `apps/mobile/src/db/schema.ts`. */
function loadRealMigrations() {
  const src = fs.readFileSync(
    path.join(ROOT, 'apps/mobile/src/db/schema.ts'),
    'utf8'
  );
  const migrations = [];
  const regex = /version:\s*(\d+),[\s\S]*?sql:\s*`([\s\S]*?)`,/g;
  let m;
  while ((m = regex.exec(src)) !== null) {
    migrations.push({ version: Number(m[1]), sql: m[2] });
  }
  assert.ok(migrations.length >= 6, `Expected >= 6 migrations, found ${migrations.length}`);
  assert.equal(migrations[migrations.length - 1].version, 6, 'Latest schema version must be 6');
  return migrations;
}

const MIGRATIONS = loadRealMigrations();

function applyMigrations(db, fromExclusive, toInclusive) {
  const pending = MIGRATIONS.filter(
    (m) => m.version > fromExclusive && m.version <= toInclusive
  );
  if (pending.length === 0) return;
  db.exec('PRAGMA foreign_keys = OFF;');
  try {
    for (const mig of pending) {
      db.exec('BEGIN;');
      try {
        db.exec(mig.sql);
        db.exec('COMMIT;');
      } catch (err) {
        db.exec('ROLLBACK;');
        throw err;
      }
    }
  } finally {
    db.exec('PRAGMA foreign_keys = ON;');
  }
}

function openFreshDb(maxVersion = 6) {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  applyMigrations(db, 0, maxVersion);
  return db;
}

function makeInt8Vec(dim, seed = 1) {
  const arr = new Int8Array(dim);
  for (let i = 0; i < dim; i++) {
    arr[i] = ((i * 31 + seed * 17) % 200) - 100;
  }
  return new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
}

console.log('\n=== OpenRouter BYOK & Multimodal Life Diary — Real E2E Test Suite ===\n');

// ── 1. Real SQLite Schema Migrations ────────────────────────────────────────

await test('SQLite fresh migration v1 -> v6 with PRAGMA foreign_keys = ON & foreign_key_check', () => {
  const db = openFreshDb(6);
  const tables = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name;`)
    .all()
    .map((r) => r.name);

  for (const expected of [
    'books',
    'passages',
    'personal_books',
    'passage_vectors',
    'journal_segments',
    'journal_segment_vectors',
    'highlights',
    'highlight_vectors',
    'diary_media',
    'diary_people',
    'diary_media_people',
    'journal_segment_people',
    'openrouter_usage_log',
  ]) {
    assert.ok(tables.includes(expected), `Missing table ${expected}`);
  }
  const fkErrors = db.prepare('PRAGMA foreign_key_check;').all();
  assert.deepEqual(fkErrors, [], `Foreign key violations found: ${JSON.stringify(fkErrors)}`);
  db.close();
});

await test('SQLite upgrade v4 -> v6 preserves existing passages, vectors, journal, highlights & FK targets', () => {
  const db = openFreshDb(4);
  const now = Date.now();

  // Seed v4 data across all migrated tables
  db.prepare(`INSERT INTO books (id, title, author, type, source) VALUES (?, ?, ?, 'voice', 'personal');`).run(
    'personal_book_1',
    'Confessions Notes',
    'Augustine'
  );
  db.prepare(
    `INSERT INTO personal_books (book_id, source_format, source_filename, local_file_path, file_size_bytes, file_hash, imported_at, updated_at)
     VALUES ('personal_book_1', 'pdf', 'notes.pdf', 'file:///notes.pdf', 512000, 'hash1', ?, ?);`
  ).run(now, now);
  const pRes = db
    .prepare(
      `INSERT INTO passages (book_id, chapter, verse_start, verse_end, text, translation)
       VALUES ('personal_book_1', 1, 1, 1, 'Thou hast made us for thyself, O Lord, and our heart is restless.', NULL);`
    )
    .run();
  const passageId = Number(pRes.lastInsertRowid);

  db.prepare(
    `INSERT INTO passage_vectors (passage_id, book_id, model_id, dim, scale, vector_int8, updated_at)
     VALUES (?, 'personal_book_1', 'voyage-4-nano', 512, 0.012, ?, ?);`
  ).run(passageId, makeInt8Vec(512, 3), now);

  db.prepare(
    `INSERT INTO journal_segments (id, created_at, updated_at, segment_type, text, position_index, parent_date)
     VALUES ('seg_v4_1', ?, ?, 'text', 'Walking quietly at dawn and reflecting on Psalm 23.', 0, '2026-11-26');`
  ).run(now, now);

  db.prepare(
    `INSERT INTO journal_segment_vectors (segment_id, vector_blob) VALUES ('seg_v4_1', ?);`
  ).run(makeInt8Vec(512, 7));

  db.prepare(
    `INSERT INTO highlights (id, verse_ref, color, created_at, selected_text, note_text)
     VALUES ('hl_v4_1', 'Psalm 23:1', 'gold', ?, 'The Lord is my shepherd', 'Peace in scarcity');`
  ).run(now);

  db.prepare(
    `INSERT INTO highlight_vectors (id, highlight_id, kind, model_id, dim, scale, vector_int8, source_label, updated_at)
     VALUES ('hl_v4_1:highlight', 'hl_v4_1', 'highlight', 'voyage-4-nano', 512, 0.01, ?, 'Psalm 23:1', ?);`
  ).run(makeInt8Vec(512, 9), now);

  // Now run Migrations v5 -> v6!
  applyMigrations(db, 4, 6);

  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM passage_vectors').get().c, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM journal_segments').get().c, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM journal_segment_vectors').get().c, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM highlight_vectors').get().c, 1);

  const jsv = db.prepare('SELECT segment_id, model_id, dim FROM journal_segment_vectors').get();
  assert.equal(jsv.segment_id, 'seg_v4_1');
  assert.equal(jsv.model_id, 'voyage-4-nano');
  assert.equal(jsv.dim, 512);

  // Verify every child FK still points to `journal_segments` (not a dropped temp table!)
  for (const tbl of ['journal_segment_vectors', 'diary_media', 'journal_segment_people']) {
    const fkList = db.prepare(`PRAGMA foreign_key_list(${tbl});`).all();
    const segFk = fkList.find((f) => f.from === 'segment_id');
    assert.ok(segFk, `Missing segment_id FK on ${tbl}`);
    assert.equal(segFk.table, 'journal_segments', `FK on ${tbl} points to ${segFk.table} instead of journal_segments!`);
  }

  const fkErrors = db.prepare('PRAGMA foreign_key_check;').all();
  assert.deepEqual(fkErrors, [], `Foreign key violations found: ${JSON.stringify(fkErrors)}`);
  db.close();
});

await test('SQLite upgrade v5 -> v6 (from PR #71 build) preserves rows and unlocks voice/photo/video', () => {
  const db = openFreshDb(5);
  const now = Date.now();
  db.prepare(
    `INSERT INTO journal_segments (id, created_at, updated_at, segment_type, text, position_index, parent_date)
     VALUES ('seg_v5_text', ?, ?, 'text', 'Existing v5 journal entry', 0, '2026-11-27');`
  ).run(now, now);
  db.prepare(
    `INSERT INTO journal_segment_vectors (segment_id, model_id, dim, scale, vector_int8, updated_at)
     VALUES ('seg_v5_text', 'voyage-4-nano', 512, 0.01, ?, ?);`
  ).run(makeInt8Vec(512, 4), now);

  applyMigrations(db, 5, 6);

  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM journal_segments').get().c, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM journal_segment_vectors').get().c, 1);
  const fkErrors = db.prepare('PRAGMA foreign_key_check;').all();
  assert.deepEqual(fkErrors, [], `Foreign key violations found: ${JSON.stringify(fkErrors)}`);
  db.close();
});

// ── 2. Diary Media FK Persistence, ON CONFLICT Safety & Cascade ─────────────

await test('Diary capture (voice/photo/video) + ON CONFLICT auto-save preserves media, people & vectors', () => {
  const db = openFreshDb(6);
  const now = Date.now();

  for (const [idx, kind] of ['voice', 'photo', 'video'].entries()) {
    const segId = `seg_${kind}_1`;
    const mediaId = `dm_${kind}_1`;

    // Immediate upsert before diary_media insert (fix for Bug #1)
    db.prepare(
      `INSERT INTO journal_segments
         (id, created_at, updated_at, segment_type, text, position_index, parent_date)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         updated_at = excluded.updated_at,
         segment_type = excluded.segment_type,
         text = excluded.text,
         position_index = excluded.position_index,
         parent_date = excluded.parent_date;`
    ).run(segId, now, now, kind, '', idx, '2026-11-27');

    db.prepare(
      `INSERT INTO diary_media (
         id, segment_id, kind, local_uri, thumb_uri, mime_type, byte_size,
         duration_ms, captured_at, processing_status, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, 4096, 12000, ?, 'queued', ?, ?);`
    ).run(
      mediaId,
      segId,
      kind,
      `file:///diary_media/${kind}/${mediaId}.bin`,
      kind === 'photo' ? `file:///diary_media/photos/${mediaId}.jpg` : null,
      kind === 'voice' ? 'audio/m4a' : kind === 'photo' ? 'image/jpeg' : 'video/mp4',
      now,
      now,
      now
    );

    // Store vector for segment
    db.prepare(
      `INSERT OR REPLACE INTO journal_segment_vectors
         (segment_id, model_id, dim, scale, vector_int8, vector_blob, updated_at)
       VALUES (?, 'mongodb/voyage-4-large', 512, 0.015, ?, NULL, ?);`
    ).run(segId, makeInt8Vec(512, idx + 1), now);
  }

  // Tag a person ("Sarah") on the photo memory
  db.prepare(`INSERT INTO diary_people (id, name, relationship, created_at) VALUES ('per_1', 'Sarah', 'Wife', ?);`).run(now);
  db.prepare(`INSERT OR IGNORE INTO diary_media_people (media_id, person_id) VALUES ('dm_photo_1', 'per_1');`).run();
  db.prepare(`INSERT OR IGNORE INTO journal_segment_people (segment_id, person_id) VALUES ('seg_photo_1', 'per_1');`).run();

  // Simulate debounced journalStore auto-save updating seg_photo_1 text (fix for Bug #2)
  db.prepare(
    `INSERT INTO journal_segments
       (id, created_at, updated_at, segment_type, text, position_index, parent_date)
     VALUES ('seg_photo_1', ?, ?, 'photo', 'Sunset walk by the lake with Sarah', 1, '2026-11-27')
     ON CONFLICT(id) DO UPDATE SET
       updated_at = excluded.updated_at,
       segment_type = excluded.segment_type,
       text = excluded.text,
       position_index = excluded.position_index,
       parent_date = excluded.parent_date;`
  ).run(now, now + 500);

  // CRITICAL ASSERTIONS: Nothing was cascade-wiped!
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM diary_media').get().c, 3);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM diary_media_people').get().c, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM journal_segment_people').get().c, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM journal_segment_vectors').get().c, 3);

  // Execute diaryMediaService.ts queryAllDiaryMediaAndPeople SQL
  const peopleQuery = db
    .prepare(
      `SELECT dp.id, dp.name, dp.relationship, dp.created_at,
              (SELECT COUNT(*) FROM diary_media_people dmp WHERE dmp.person_id = dp.id) +
              (SELECT COUNT(*) FROM journal_segment_people jsp WHERE jsp.person_id = dp.id)
                AS memory_count
       FROM diary_people dp
       ORDER BY memory_count DESC, dp.name ASC;`
    )
    .all();
  assert.equal(peopleQuery.length, 1);
  assert.equal(peopleQuery[0].name, 'Sarah');

  // Execute getDiaryStorageStats SQL
  const stats = db
    .prepare(`SELECT kind, COUNT(*) AS cnt, SUM(byte_size) AS bytes FROM diary_media GROUP BY kind;`)
    .all();
  assert.equal(stats.length, 3);

  // Now delete seg_photo_1 and assert clean ON DELETE CASCADE
  db.prepare(`DELETE FROM journal_segments WHERE id = 'seg_photo_1';`).run();
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM diary_media').get().c, 2);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM diary_media_people').get().c, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM journal_segment_people').get().c, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM journal_segment_vectors').get().c, 2);
  // Person record itself stays in directory
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM diary_people').get().c, 1);

  db.close();
});

// ── 3. Multi-Model Vector Isolation & Production SQL Queries ────────────────

await test('Multi-model vectors coexist non-destructively across passage/journal/highlight tables', () => {
  const db = openFreshDb(6);
  const now = Date.now();

  // Bible passage + Church passage + Personal passage
  db.prepare(`INSERT INTO books (id, title, author, type) VALUES ('WEB_Psalms', 'Psalms', NULL, 'bible');`).run();
  db.prepare(`INSERT INTO books (id, title, author, type) VALUES ('augustine_conf', 'Confessions', 'Augustine', 'voice');`).run();
  db.prepare(`INSERT INTO books (id, title, author, type, source) VALUES ('pers_1', 'My Retreat PDF', 'Me', 'voice', 'personal');`).run();
  db.prepare(
    `INSERT INTO personal_books (book_id, source_format, source_filename, local_file_path, file_size_bytes, file_hash, ocr_required, include_in_resonance, imported_at, updated_at)
     VALUES ('pers_1', 'pdf', 'retreat.pdf', 'file:///retreat.pdf', 120000, 'h1', 0, 1, ?, ?);`
  ).run(now, now);

  const bibleId = Number(
    db.prepare(`INSERT INTO passages (book_id, chapter, verse_start, text, translation) VALUES ('WEB_Psalms', 23, 1, 'Yahweh is my shepherd: I shall lack nothing.', 'WEB');`).run().lastInsertRowid
  );
  const churchId = Number(
    db.prepare(`INSERT INTO passages (book_id, chapter, verse_start, text, translation) VALUES ('augustine_conf', 1, 1, 'Our heart is restless until it rests in you.', NULL);`).run().lastInsertRowid
  );
  const persId = Number(
    db.prepare(`INSERT INTO passages (book_id, chapter, verse_start, text, translation) VALUES ('pers_1', 1, 1, 'Silence in the desert opens the ear.', NULL);`).run().lastInsertRowid
  );

  // Insert TWO different models for the SAME passages (512d Voyage-4 + 1024d Qwen3-8B)
  for (const [pid, bid] of [
    [bibleId, 'WEB_Psalms'],
    [churchId, 'augustine_conf'],
    [persId, 'pers_1'],
  ]) {
    db.prepare(
      `INSERT OR REPLACE INTO passage_vectors (passage_id, book_id, model_id, dim, scale, vector_int8, updated_at)
       VALUES (?, ?, 'voyage-4-nano', 512, 0.01, ?, ?);`
    ).run(pid, bid, makeInt8Vec(512, 1), now);
    db.prepare(
      `INSERT OR REPLACE INTO passage_vectors (passage_id, book_id, model_id, dim, scale, vector_int8, updated_at)
       VALUES (?, ?, 'qwen/qwen3-embedding-8b', 1024, 0.02, ?, ?);`
    ).run(pid, bid, makeInt8Vec(1024, 2), now);
  }

  // Journal + Highlight in both models
  db.prepare(
    `INSERT INTO journal_segments (id, created_at, updated_at, segment_type, text, position_index, parent_date)
     VALUES ('seg_multi', ?, ?, 'text', 'Longing for stillness and quiet trust today.', 0, '2026-11-27');`
  ).run(now, now);
  db.prepare(
    `INSERT INTO journal_segment_vectors (segment_id, model_id, dim, scale, vector_int8, updated_at)
     VALUES ('seg_multi', 'voyage-4-nano', 512, 0.01, ?, ?);`
  ).run(makeInt8Vec(512, 5), now);
  db.prepare(
    `INSERT INTO journal_segment_vectors (segment_id, model_id, dim, scale, vector_int8, updated_at)
     VALUES ('seg_multi', 'qwen/qwen3-embedding-8b', 1024, 0.02, ?, ?);`
  ).run(makeInt8Vec(1024, 6), now);

  db.prepare(
    `INSERT INTO highlights (id, verse_ref, color, created_at, selected_text, note_text)
     VALUES ('hl_multi', 'Psalms 23:1', 'gold', ?, 'Yahweh is my shepherd', 'Rest in God');`
  ).run(now);
  db.prepare(
    `INSERT INTO highlight_vectors (id, highlight_id, kind, model_id, dim, scale, vector_int8, source_label, updated_at)
     VALUES ('hl_multi:highlight:voyage-4-nano', 'hl_multi', 'highlight', 'voyage-4-nano', 512, 0.01, ?, 'Psalms 23:1', ?);`
  ).run(makeInt8Vec(512, 8), now);
  db.prepare(
    `INSERT INTO highlight_vectors (id, highlight_id, kind, model_id, dim, scale, vector_int8, source_label, updated_at)
     VALUES ('hl_multi:highlight:qwen/qwen3-embedding-8b', 'hl_multi', 'highlight', 'qwen/qwen3-embedding-8b', 1024, 0.02, ?, 'Psalms 23:1', ?);`
  ).run(makeInt8Vec(1024, 9), now);

  // Execute exact reembedService.ts estimateReembedPlan queries
  const biblePlan = db
    .prepare(
      `SELECT COUNT(*) AS total, SUM(LENGTH(p.text)) AS chars,
              SUM(CASE WHEN pv.passage_id IS NOT NULL THEN 1 ELSE 0 END) AS done
       FROM passages p
       LEFT JOIN passage_vectors pv ON pv.passage_id = p.id AND pv.model_id = ?
       WHERE p.translation = 'WEB';`
    )
    .get('qwen/qwen3-embedding-8b');
  assert.equal(biblePlan.total, 1);
  assert.equal(biblePlan.done, 1);

  const churchPlan = db
    .prepare(
      `SELECT COUNT(*) AS total, SUM(LENGTH(p.text)) AS chars,
              SUM(CASE WHEN pv.passage_id IS NOT NULL THEN 1 ELSE 0 END) AS done
       FROM passages p
       LEFT JOIN personal_books pb ON pb.book_id = p.book_id
       LEFT JOIN passage_vectors pv ON pv.passage_id = p.id AND pv.model_id = ?
       WHERE p.translation IS NULL AND pb.book_id IS NULL;`
    )
    .get('cohere/embed-5-pro');
  assert.equal(churchPlan.total, 1);
  assert.equal(churchPlan.done, 0);

  // Execute exact resonanceService.ts custom-model loadLibraryVectors query
  const customRows = db
    .prepare(
      `SELECT pv.passage_id, pv.book_id, pv.dim, pv.scale, pv.vector_int8,
              p.text, p.chapter, p.verse_start, p.translation, p.division,
              b.title, b.author,
              CASE WHEN pb.book_id IS NOT NULL THEN 1 ELSE 0 END AS is_personal,
              pb.include_in_resonance
       FROM passage_vectors pv
       JOIN passages p ON p.id = pv.passage_id
       LEFT JOIN books b ON b.id = pv.book_id
       LEFT JOIN personal_books pb ON pb.book_id = pv.book_id
       WHERE pv.model_id = ?
       ORDER BY pv.passage_id;`
    )
    .all('qwen/qwen3-embedding-8b');
  assert.equal(customRows.length, 3);
  assert.equal(customRows.filter((r) => r.translation === 'WEB').length, 1);
  assert.equal(customRows.filter((r) => r.translation == null && r.is_personal === 0).length, 1);
  assert.equal(customRows.filter((r) => r.is_personal === 1).length, 1);

  // Execute exact resonanceService.ts findResonantPastEntries SQL
  const pastRows = db
    .prepare(
      `SELECT jsv.segment_id, js.segment_type, jsv.dim, jsv.scale, jsv.vector_int8,
              jsv.vector_blob, js.text, js.created_at,
              dm.kind AS media_kind, dm.caption AS media_caption,
              dm.transcript AS media_transcript, dm.ai_summary AS media_summary
       FROM journal_segment_vectors jsv
       JOIN journal_segments js ON js.id = jsv.segment_id
       LEFT JOIN diary_media dm ON dm.segment_id = js.id
       WHERE js.segment_type IN ('text', 'voice', 'photo', 'video')
         AND jsv.model_id IN (?)
       ORDER BY js.created_at DESC
       LIMIT 600;`
    )
    .all('qwen/qwen3-embedding-8b');
  assert.equal(pastRows.length, 1);
  assert.equal(pastRows[0].dim, 1024);

  // Execute exact pdfOcrService.ts SQL (regression test for Bug #12!)
  const pdfRow = db
    .prepare(
      `SELECT book_id, source_filename, local_file_path, file_size_bytes
       FROM personal_books WHERE book_id = ?;`
    )
    .get('pers_1');
  assert.equal(pdfRow.source_filename, 'retreat.pdf');
  assert.equal(pdfRow.local_file_path, 'file:///retreat.pdf');

  db.prepare(
    `UPDATE personal_books
     SET ocr_required = 0, total_chunks = 5, embedded_chunks = 0,
         embedding_status = 'pending', last_error = NULL, updated_at = ?
     WHERE book_id = ?;`
  ).run(now + 10, 'pers_1');

  // Execute exact openrouterStore.ts usage ledger SQL
  db.prepare(
    `INSERT INTO openrouter_usage_log
       (id, task_kind, model_id, prompt_tokens, completion_tokens, estimated_cost_usd, created_at)
     VALUES ('oru_1', 'embed', 'qwen/qwen3-embedding-8b', 12000, 0, 0.00012, ?);`
  ).run(now);
  const totals = db
    .prepare(
      `SELECT SUM(prompt_tokens) AS pt, SUM(completion_tokens) AS ct,
              SUM(estimated_cost_usd) AS cost, COUNT(*) AS cnt
       FROM openrouter_usage_log;`
    )
    .get();
  assert.equal(totals.pt, 12000);
  assert.equal(totals.cnt, 1);

  // Delete qwen vectors and confirm voyage-4-nano vectors survive 100% untouched!
  db.prepare(`DELETE FROM passage_vectors WHERE model_id = ?;`).run('qwen/qwen3-embedding-8b');
  db.prepare(`DELETE FROM journal_segment_vectors WHERE model_id = ?;`).run('qwen/qwen3-embedding-8b');
  db.prepare(`DELETE FROM highlight_vectors WHERE model_id = ?;`).run('qwen/qwen3-embedding-8b');

  assert.equal(db.prepare(`SELECT COUNT(*) AS c FROM passage_vectors WHERE model_id = 'voyage-4-nano'`).get().c, 3);
  assert.equal(db.prepare(`SELECT COUNT(*) AS c FROM journal_segment_vectors WHERE model_id = 'voyage-4-nano'`).get().c, 1);
  assert.equal(db.prepare(`SELECT COUNT(*) AS c FROM highlight_vectors WHERE model_id = 'voyage-4-nano'`).get().c, 1);

  db.close();
});

// ── 4. Live OpenRouter Public Catalog Endpoints Verification ────────────────

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { 'X-Title': 'Resonance E2E Verification' },
  });
  assert.equal(res.status, 200, `Expected HTTP 200 from ${url}, got ${res.status}`);
  return res.json();
}

await test('Live OpenRouter /embeddings/models returns defaults (voyage-4-large, qwen3-embedding-8b, embed-5-pro)', async () => {
  const json = await fetchJson('https://openrouter.ai/api/v1/embeddings/models');
  const ids = new Set((json.data ?? []).map((m) => m.id));
  assert.ok(ids.size >= 20, `Expected >=20 embedding models, got ${ids.size}`);
  for (const required of [
    'mongodb/voyage-4-large',
    'mongodb/voyage-4',
    'mongodb/voyage-4-lite',
    'qwen/qwen3-embedding-8b',
    'cohere/embed-5-pro',
  ]) {
    assert.ok(ids.has(required), `Missing live embedding model: ${required}`);
  }
});

await test('Live OpenRouter /models?endpoints=/api/v1/rerank returns rerankers including qwen3-reranker-8b', async () => {
  const json = await fetchJson('https://openrouter.ai/api/v1/models?endpoints=/api/v1/rerank');
  const ids = new Set((json.data ?? []).map((m) => m.id));
  assert.ok(ids.size >= 5, `Expected >=5 reranker models, got ${ids.size}`);
  assert.ok(ids.has('qwen/qwen3-reranker-8b'), 'Missing default reranker qwen/qwen3-reranker-8b');
});

await test('Live OpenRouter /models?endpoints=/api/v1/audio/transcriptions returns STT models including whisper-large-v3-turbo', async () => {
  const json = await fetchJson(
    'https://openrouter.ai/api/v1/models?endpoints=/api/v1/audio/transcriptions'
  );
  const ids = new Set((json.data ?? []).map((m) => m.id));
  assert.ok(ids.size >= 10, `Expected >=10 STT models, got ${ids.size}`);
  assert.ok(
    ids.has('openai/whisper-large-v3-turbo'),
    'Missing default STT model openai/whisper-large-v3-turbo'
  );
});

await test('Live OpenRouter /models confirms google/gemini-2.5-flash supports image & video inputs', async () => {
  const json = await fetchJson('https://openrouter.ai/api/v1/models');
  const gemini = (json.data ?? []).find((m) => m.id === 'google/gemini-2.5-flash');
  assert.ok(gemini, 'Missing default vision/video model google/gemini-2.5-flash');
  const mods = gemini.architecture?.input_modalities ?? [];
  assert.ok(mods.includes('image'), 'gemini-2.5-flash must support image input');
  assert.ok(mods.includes('video'), 'gemini-2.5-flash must support video input');
});

console.log(`\nSummary: ${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  process.exit(1);
}
