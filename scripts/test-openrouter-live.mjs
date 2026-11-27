#!/usr/bin/env node
/**
 * Live Authenticated OpenRouter E2E Verification Suite for Resonance.
 *
 * Sends the EXACT request payloads, headers, and Zero Data Retention routing
 * (`provider: { data_collection: 'deny' }`) used by
 * `apps/mobile/src/openrouter/openrouterClient.ts` against live OpenRouter APIs:
 *
 *   1. GET  /api/v1/key                          (key verification & limits)
 *   2. POST /api/v1/embeddings                   (mongodb/voyage-4-large 512d)
 *   3. POST /api/v1/embeddings                   (qwen/qwen3-embedding-8b 1024d)
 *   4. POST /api/v1/embeddings                   (cohere/embed-5-pro multimodal image+text)
 *   5. POST /api/v1/rerank                       (qwen/qwen3-reranker-8b)
 *   6. POST /api/v1/audio/transcriptions         (openai/whisper-large-v3-turbo, real m4a/wav)
 *   7. POST /api/v1/chat/completions             (google/gemini-2.5-flash photo vision + OCR JSON)
 *   8. POST /api/v1/chat/completions             (google/gemini-2.5-flash direct MP4 video_url + keyframes)
 *   9. POST /api/v1/chat/completions             (google/gemini-2.5-flash scanned PDF OCR file_data)
 *
 * Requires `OPENROUTER_API_KEY` env var (never printed).
 * Optional fixture dir: `FIXTURE_DIR` (defaults to `/tmp/or-fixtures`).
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const API_KEY = (process.env.OPENROUTER_API_KEY ?? '').trim();
if (!API_KEY) {
  console.error('OPENROUTER_API_KEY is not set. Run this in GitHub Actions or set OPENROUTER_API_KEY.');
  process.exit(1);
}

const BASE = 'https://openrouter.ai/api/v1';
const FIXTURE_DIR = process.env.FIXTURE_DIR || '/tmp/or-fixtures';

const QWEN3_RERANKER_INSTRUCTION =
  'Given a personal journal reflection, determine whether the historical or biblical passage is a faithful, resonant pastoral echo rather than merely sharing a surface keyword.';

const FACTUAL_MEMORY_SYSTEM_PROMPT =
  'You are a quiet, factual archivist indexing a private life diary. ' +
  'Describe ONLY what is visibly or audibly present in plain, grounded language. ' +
  'Extract any visible handwritten or printed text verbatim into visible_text_ocr. ' +
  "NEVER guess people's real names, NEVER diagnose emotions, and NEVER generate " +
  'spiritual advice, sermons, or reflection prompts. ' +
  'Return strictly valid JSON with keys: scene_summary (string, 1-2 factual sentences), ' +
  'visible_text_ocr (string, verbatim text or empty string), ' +
  'spoken_transcript (string, verbatim speech for video or empty string), ' +
  'suggested_tags (array of 2-5 short lowercase keywords), ' +
  'moment_type (one of: "people", "handwritten_note", "book_page", "nature", "place", "everyday", "gathering").';

function l2Normalize(vec) {
  let sumSq = 0;
  for (let i = 0; i < vec.length; i++) sumSq += vec[i] * vec[i];
  const norm = Math.sqrt(sumSq) || 1;
  const out = new Float32Array(vec.length);
  for (let i = 0; i < vec.length; i++) out[i] = vec[i] / norm;
  return out;
}

function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

async function orRequest(endpoint, { method = 'POST', body, zdr = true } = {}) {
  const headers = {
    Authorization: `Bearer ${API_KEY}`,
    'HTTP-Referer': 'https://resonance.app',
    'X-Title': 'Resonance Live E2E',
  };
  let payload;
  if (method === 'POST' && body) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify({
      ...body,
      ...(zdr && !('provider' in body) ? { provider: { data_collection: 'deny' } } : {}),
    });
  }
  const t0 = Date.now();
  const res = await fetch(`${BASE}${endpoint}`, {
    method,
    headers,
    body: payload,
  });
  const ms = Date.now() - t0;
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // non-json response
  }
  return { status: res.status, ok: res.ok, ms, json, raw: text.slice(0, 500) };
}

let passed = 0;
let failed = 0;
const findings = [];

async function test(name, fn) {
  try {
    const info = await fn();
    console.log(`  PASS  ${name}${info ? ` — ${info}` : ''}`);
    passed++;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  FAIL  ${name}`);
    console.error(`        ${msg}`);
    findings.push({ name, msg });
    failed++;
  }
}

console.log('\n=== Resonance Live Authenticated OpenRouter E2E Suite ===\n');

// ── 1. Key Verification ─────────────────────────────────────────────────────
await test('GET /api/v1/key verifies OpenRouter API key', async () => {
  const r = await orRequest('/key', { method: 'GET', zdr: false });
  assert.equal(r.status, 200, `HTTP ${r.status}: ${r.raw}`);
  assert.ok(r.json?.data, `Missing data object: ${r.raw}`);
  const d = r.json.data;
  const rem = d.limit_remaining != null ? `$${Number(d.limit_remaining).toFixed(4)} remaining` : 'unlimited';
  return `${r.ms}ms (${d.label || 'key'}, ${rem})`;
});

// ── 2. Default Voyage-4-Large 512d Embedding (ZDR=deny) ─────────────────────
await test('POST /api/v1/embeddings — mongodb/voyage-4-large (512d, ZDR=deny)', async () => {
  const qRes = await orRequest('/embeddings', {
    body: {
      model: 'mongodb/voyage-4-large',
      input: ['Feeling weary and anxious about tomorrow, needing quiet trust and rest.'],
      encoding_format: 'float',
      dimensions: 512,
      input_type: 'query',
    },
  });
  assert.equal(qRes.status, 200, `Query HTTP ${qRes.status}: ${qRes.raw}`);
  const qVec = l2Normalize(qRes.json.data[0].embedding);
  assert.equal(qVec.length, 512, `Expected 512d, got ${qVec.length}d`);

  const dRes = await orRequest('/embeddings', {
    body: {
      model: 'mongodb/voyage-4-large',
      input: [
        'Yahweh is my shepherd: I shall lack nothing. He makes me lie down in green pastures. He leads me beside still waters.',
        'Matrix multiplication of two square matrices is associative but not generally commutative.',
      ],
      encoding_format: 'float',
      dimensions: 512,
      input_type: 'document',
    },
  });
  assert.equal(dRes.status, 200, `Doc HTTP ${dRes.status}: ${dRes.raw}`);
  const items = [...dRes.json.data].sort((a, b) => a.index - b.index);
  const vPs = l2Normalize(items[0].embedding);
  const vMath = l2Normalize(items[1].embedding);
  const simPs = dot(qVec, vPs);
  const simMath = dot(qVec, vMath);
  assert.ok(
    simPs > simMath + 0.1,
    `Expected Psalm sim (${simPs.toFixed(3)}) >> Math sim (${simMath.toFixed(3)})`
  );
  return `${qRes.ms + dRes.ms}ms, 512d, Psalm=${simPs.toFixed(3)} vs Math=${simMath.toFixed(3)}`;
});

// ── 3. Custom Embedding Model: qwen/qwen3-embedding-8b (1024d, ZDR=deny) ────
await test('POST /api/v1/embeddings — qwen/qwen3-embedding-8b (1024d, ZDR=deny)', async () => {
  const res = await orRequest('/embeddings', {
    body: {
      model: 'qwen/qwen3-embedding-8b',
      input: [
        'Instruct: Given a personal journal reflection or question, retrieve faithfully resonant Scripture passages, Christian writings, or personal diary memories.\nQuery: Longing for stillness in a noisy season.',
      ],
      encoding_format: 'float',
      dimensions: 1024,
    },
  });
  assert.equal(res.status, 200, `HTTP ${res.status}: ${res.raw}`);
  const emb = res.json?.data?.[0]?.embedding;
  assert.ok(Array.isArray(emb) && emb.length >= 512, `Unexpected embedding length: ${emb?.length}`);
  return `${res.ms}ms, dim=${emb.length}`;
});

// ── 4. Multimodal Embedding: cohere/embed-5-pro (image + text) ──────────────
await test('POST /api/v1/embeddings — cohere/embed-5-pro multimodal (image_url + text)', async () => {
  const pngPath = path.join(FIXTURE_DIR, 'diary_note.png');
  assert.ok(fs.existsSync(pngPath), `Missing fixture ${pngPath}`);
  const b64 = fs.readFileSync(pngPath).toString('base64');
  const payload = {
    model: 'cohere/embed-5-pro',
    input: [
      {
        content: [
          { type: 'text', text: 'Handwritten Psalm 23 card on morning desk' },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } },
        ],
      },
    ],
    encoding_format: 'float',
    dimensions: 1024,
    input_type: 'document',
  };
  let res = await orRequest('/embeddings', { body: payload, zdr: true });
  let zdrNote = 'ZDR=deny';
  if (res.status === 404) {
    // Check whether ZDR=deny caused a 404 so we know if our app needs ZDR fallback/guidance!
    const retry = await orRequest('/embeddings', { body: payload, zdr: false });
    assert.equal(
      retry.status,
      200,
      `Failed BOTH with ZDR (404: ${res.raw}) and without ZDR (${retry.status}: ${retry.raw})`
    );
    res = retry;
    zdrNote = 'WARN: required ZDR=allow (404 with ZDR=deny!)';
  } else {
    assert.equal(res.status, 200, `HTTP ${res.status}: ${res.raw}`);
  }
  const emb = res.json?.data?.[0]?.embedding;
  assert.ok(Array.isArray(emb) && emb.length >= 256, `Unexpected dim: ${emb?.length}`);
  return `${res.ms}ms, dim=${emb.length} (${zdrNote})`;
});

// ── 5. Cloud Neural Reranking: qwen/qwen3-reranker-8b ───────────────────────
await test('POST /api/v1/rerank — qwen/qwen3-reranker-8b (ZDR=deny)', async () => {
  const body = {
    model: 'qwen/qwen3-reranker-8b',
    query: `Instruct: ${QWEN3_RERANKER_INSTRUCTION}\nQuery: I feel exhausted carrying everyone else's expectations and need rest for my soul.`,
    documents: [
      '[Algebra Textbook] A polynomial of degree n has at most n distinct roots over a field.',
      '[Matthew 11:28 (WEB)] Come to me, all you who labor and are heavily burdened, and I will give you rest.',
      '[Weather Log] Barometric pressure fell steadily throughout Tuesday afternoon.',
    ],
    top_n: 3,
  };
  let res = await orRequest('/rerank', { body, zdr: true });
  let zdrNote = 'ZDR=deny';
  if (res.status === 404) {
    const retry = await orRequest('/rerank', { body, zdr: false });
    assert.equal(
      retry.status,
      200,
      `Rerank failed with ZDR (404: ${res.raw}) and without ZDR (${retry.status}: ${retry.raw})`
    );
    res = retry;
    zdrNote = 'WARN: required ZDR=allow (404 with ZDR=deny!)';
  } else {
    assert.equal(res.status, 200, `HTTP ${res.status}: ${res.raw}`);
  }
  const results = res.json?.results ?? [];
  assert.ok(results.length >= 2, `Expected >=2 results: ${res.raw}`);
  results.sort((a, b) => b.relevance_score - a.relevance_score);
  assert.equal(
    results[0].index,
    1,
    `Expected Matthew 11:28 (index 1) ranked #1, got index ${results[0].index} (${JSON.stringify(results)})`
  );
  return `${res.ms}ms, top=#1 score=${results[0].relevance_score.toFixed(3)} vs #2=${results[1].relevance_score.toFixed(3)} (${zdrNote})`;
});

// ── 6. Speech-to-Text Voice Diary: openai/whisper-large-v3-turbo (real M4A) ─
await test('POST /api/v1/audio/transcriptions — openai/whisper-large-v3-turbo (real m4a)', async () => {
  const m4aPath = path.join(FIXTURE_DIR, 'voice_note.m4a');
  assert.ok(fs.existsSync(m4aPath), `Missing fixture ${m4aPath}`);
  const b64 = fs.readFileSync(m4aPath).toString('base64');
  const body = {
    model: 'openai/whisper-large-v3-turbo',
    input_audio: {
      data: b64,
      format: 'm4a',
    },
  };
  let res = await orRequest('/audio/transcriptions', { body, zdr: true });
  let zdrNote = 'ZDR=deny';
  if (res.status === 404) {
    const retry = await orRequest('/audio/transcriptions', { body, zdr: false });
    assert.equal(
      retry.status,
      200,
      `STT failed with ZDR (404: ${res.raw}) and without ZDR (${retry.status}: ${retry.raw})`
    );
    res = retry;
    zdrNote = 'WARN: required ZDR=allow (404 with ZDR=deny!)';
  } else {
    assert.equal(res.status, 200, `HTTP ${res.status}: ${res.raw}`);
  }
  const transcript = (res.json?.text ?? '').trim();
  assert.ok(transcript.length >= 5, `Empty/short transcript: ${res.raw}`);
  assert.ok(
    /shepherd|lord|psalm|rest|morning/i.test(transcript),
    `Transcript did not match spoken audio: "${transcript}"`
  );
  return `${res.ms}ms, "${transcript}" (${zdrNote})`;
});

// ── 7. Photo Vision + OCR: google/gemini-2.5-flash ──────────────────────────
await test('POST /api/v1/chat/completions — Photo Vision + OCR JSON (google/gemini-2.5-flash)', async () => {
  const pngPath = path.join(FIXTURE_DIR, 'diary_note.png');
  assert.ok(fs.existsSync(pngPath), `Missing fixture ${pngPath}`);
  const b64 = fs.readFileSync(pngPath).toString('base64');
  const body = {
    model: 'google/gemini-2.5-flash',
    temperature: 0.1,
    max_tokens: 600,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: FACTUAL_MEMORY_SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Index this diary photo factually as JSON.\nUser caption: "Morning note at desk"',
          },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } },
        ],
      },
    ],
  };
  let res = await orRequest('/chat/completions', { body, zdr: true });
  let zdrNote = 'ZDR=deny';
  if (res.status === 404) {
    const retry = await orRequest('/chat/completions', { body, zdr: false });
    assert.equal(retry.status, 200, `Vision failed: ZDR=${res.raw} | nonZDR=${retry.raw}`);
    res = retry;
    zdrNote = 'WARN: required ZDR=allow';
  } else {
    assert.equal(res.status, 200, `HTTP ${res.status}: ${res.raw}`);
  }
  const rawContent = res.json?.choices?.[0]?.message?.content ?? '';
  const cleaned = rawContent
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();
  const parsed = JSON.parse(cleaned);
  assert.ok(typeof parsed.scene_summary === 'string' && parsed.scene_summary.length > 5, `Bad scene_summary: ${cleaned}`);
  assert.ok(
    /psalm|shepherd|23/i.test(parsed.visible_text_ocr || ''),
    `OCR missed text in image: ${JSON.stringify(parsed)}`
  );
  return `${res.ms}ms, ocr="${parsed.visible_text_ocr.slice(0, 60)}" (${zdrNote})`;
});

// ── 8. Video Analysis: Direct video_url MP4 (google/gemini-2.5-flash) ───────
await test('POST /api/v1/chat/completions — Direct Video MP4 analysis (google/gemini-2.5-flash)', async () => {
  const mp4Path = path.join(FIXTURE_DIR, 'diary_clip.mp4');
  assert.ok(fs.existsSync(mp4Path), `Missing fixture ${mp4Path}`);
  const b64 = fs.readFileSync(mp4Path).toString('base64');
  const body = {
    model: 'google/gemini-2.5-flash',
    temperature: 0.1,
    max_tokens: 900,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: FACTUAL_MEMORY_SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Index this short diary video factually as JSON, including any spoken words in spoken_transcript.',
          },
          { type: 'video_url', video_url: { url: `data:video/mp4;base64,${b64}` } },
        ],
      },
    ],
  };
  const res = await orRequest('/chat/completions', { body, zdr: true });
  assert.equal(res.status, 200, `HTTP ${res.status}: ${res.raw}`);
  const rawContent = res.json?.choices?.[0]?.message?.content ?? '';
  const cleaned = rawContent
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();
  const parsed = JSON.parse(cleaned);
  assert.ok(typeof parsed.scene_summary === 'string' && parsed.scene_summary.length > 5, `Bad video JSON: ${cleaned}`);
  return `${res.ms}ms, summary="${parsed.scene_summary.slice(0, 60)}"`;
});

// ── 9. Scanned PDF OCR: native file_data (google/gemini-2.5-flash) ──────────
await test('POST /api/v1/chat/completions — Scanned PDF OCR file_data (google/gemini-2.5-flash)', async () => {
  const pdfPath = path.join(FIXTURE_DIR, 'scanned_page.pdf');
  assert.ok(fs.existsSync(pdfPath), `Missing fixture ${pdfPath}`);
  const b64 = fs.readFileSync(pdfPath).toString('base64');
  const body = {
    model: 'google/gemini-2.5-flash',
    temperature: 0,
    max_tokens: 1024,
    messages: [
      {
        role: 'system',
        content:
          'You are an exact document transcriber. Output ONLY the clean verbatim text from the PDF pages, preserving paragraph breaks and chapter headings. Do not add commentary, summaries, or markdown wrappers.',
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Transcribe all readable text from "scanned_page.pdf" verbatim.' },
          {
            type: 'file',
            file: {
              filename: 'scanned_page.pdf',
              file_data: `data:application/pdf;base64,${b64}`,
            },
          },
        ],
      },
    ],
  };
  const res = await orRequest('/chat/completions', { body, zdr: true });
  assert.equal(res.status, 200, `HTTP ${res.status}: ${res.raw}`);
  const content = (res.json?.choices?.[0]?.message?.content ?? '').trim();
  assert.ok(
    /beginning.*word|grace.*peace/i.test(content),
    `PDF OCR missed expected text: "${content.slice(0, 200)}"`
  );
  return `${res.ms}ms, "${content.slice(0, 65).replace(/\s+/g, ' ')}"`;
});

console.log(`\nLive OpenRouter Summary: ${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  process.exit(1);
}
