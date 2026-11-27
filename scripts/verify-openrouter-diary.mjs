#!/usr/bin/env node
/**
 * Verification script for OpenRouter BYOK, Multi-Model Vector Isolation,
 * Scanned PDF OCR, and Multimodal Life Diary wiring.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

// 1. Core vector-space & OpenRouter helpers exist
const coreEmb = read('packages/core/src/embedding.ts');
assert.match(coreEmb, /DEFAULT_OPENROUTER_EMBEDDING_MODEL = 'mongodb\/voyage-4-large'/);
assert.match(coreEmb, /DEFAULT_OPENROUTER_RERANKER_MODEL = 'qwen\/qwen3-reranker-8b'/);
assert.match(coreEmb, /DEFAULT_OPENROUTER_TRANSCRIPTION_MODEL = 'openai\/whisper-large-v3-turbo'/);
assert.match(coreEmb, /DEFAULT_OPENROUTER_VISION_MODEL = 'google\/gemini-2\.5-flash'/);
assert.match(coreEmb, /export function isVoyage4SharedSpace/);
assert.match(coreEmb, /export function getVectorSpaceId/);
assert.match(coreEmb, /export function modelSupportsMultimodalEmbeddings/);
assert.match(coreEmb, /export function modelSupportsDirectVideoInput/);
assert.match(coreEmb, /OPENROUTER_DIRECT_VIDEO_MAX_BYTES = 15 \* 1024 \* 1024/);

// 2. Schema migration v5 creates multi-model vector tables + diary_media + diary_people + usage log
const schema = read('apps/mobile/src/db/schema.ts');
assert.match(schema, /version:\s*5/);
assert.match(schema, /PRIMARY KEY \(passage_id, model_id\)/);
assert.match(schema, /PRIMARY KEY \(segment_id, model_id\)/);
assert.match(schema, /UNIQUE \(highlight_id, kind, model_id\)/);
assert.match(schema, /CREATE TABLE IF NOT EXISTS diary_media/);
assert.match(schema, /CREATE TABLE IF NOT EXISTS diary_people/);
assert.match(schema, /CREATE TABLE IF NOT EXISTS diary_media_people/);
assert.match(schema, /CREATE TABLE IF NOT EXISTS openrouter_usage_log/);

// 3. OpenRouter key is stored in expo-secure-store, never SQLite app_settings
const orStore = read('apps/mobile/src/openrouter/openrouterStore.ts');
assert.match(orStore, /from 'expo-secure-store'/);
assert.match(orStore, /SecureStore\.setItemAsync/);
assert.match(orStore, /zeroDataRetention:\s*true/);
assert.doesNotMatch(orStore, /persistSetting\([^)]*apiKey/i);

// 4. OpenRouter client enforces ZDR, 402 credit pause, and factual non-preaching prompt
const orClient = read('apps/mobile/src/openrouter/openrouterClient.ts');
assert.match(orClient, /data_collection:\s*'deny'/);
assert.match(orClient, /resp\.status === 402/);
assert.match(orClient, /\/embeddings/);
assert.match(orClient, /\/rerank/);
assert.match(orClient, /\/audio\/transcriptions/);
assert.match(orClient, /NEVER guess people\\?'s real names/);
assert.match(orClient, /NEVER generate ' \+\s*\n\s*'spiritual advice/);

// 5. DiaryCaptureBar strictly gated behind OpenRouter (returns null when disabled)
const captureBar = read('apps/mobile/src/components/DiaryCaptureBar.tsx');
assert.match(captureBar, /if \(!voiceAllowed && !visualAllowed\) return null;/);

// 6. Smart two-tier video routing (<= 15 MB direct vs keyframe fallback)
const diarySvc = read('apps/mobile/src/diary/diaryMediaService.ts');
assert.match(diarySvc, /OPENROUTER_DIRECT_VIDEO_MAX_BYTES/);
assert.match(diarySvc, /extractVideoKeyframeDataUris/);
assert.match(diarySvc, /embedMultimodalMemory/);

// 7. Journal, Settings, Patterns, App, and PersonalLibraryImportModal are wired
const journal = read('apps/mobile/src/screens/JournalScreen.tsx');
assert.match(journal, /<DiaryCaptureBar/);
assert.match(journal, /<DiaryMediaCard/);
assert.match(journal, /<MemoriesAndPeopleSheet/);
assert.match(journal, /searchDiarySemantic/);

const settings = read('apps/mobile/src/screens/SettingsScreen.tsx');
assert.match(settings, /<ResonanceEngineOverviewCard\b/);
assert.match(settings, /<OpenRouterSettingsSection\b/);

const patterns = read('apps/mobile/src/screens/PatternsScreen.tsx');
assert.match(patterns, /People & Moments/);

const importModal = read('apps/mobile/src/components/PersonalLibraryImportModal.tsx');
assert.match(importModal, /Transcribe Scanned PDF \(OpenRouter\)/);
assert.match(importModal, /transcribeScannedPersonalPdf/);

const appJson = JSON.parse(read('apps/mobile/app.json'));
const pluginNames = appJson.expo.plugins.map((p) => (Array.isArray(p) ? p[0] : p));
for (const expected of ['expo-secure-store', 'expo-audio', 'expo-image-picker', 'expo-video']) {
  assert.ok(pluginNames.includes(expected), `Missing Expo plugin in app.json: ${expected}`);
}

console.log('✓ verify-openrouter-diary.mjs passed all checks');
