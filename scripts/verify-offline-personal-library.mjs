#!/usr/bin/env node
/**
 * End-to-end verification suite for Resonance's offline 512d int8 vector stack
 * and pure-TS Personal Library document extraction & chunking pipeline.
 *
 * Run with: node --experimental-strip-types scripts/verify-offline-personal-library.mjs
 */

import assert from 'node:assert/strict';
import zlib from 'node:zlib';

import {
  gunzipBytes,
  extractDocumentFromBytes,
  computeContentFingerprint,
} from '../packages/core/src/document-parsers.ts';
import {
  processPersonalDocument,
  isFurnitureBlock,
  isQuarantinedGarbage,
} from '../packages/core/src/corpus-pipeline.ts';
import {
  EMBEDDING_DIM,
  OFFLINE_ENGINE_MANIFEST,
  quantizeVectorInt8,
  encodeRvec,
  parseRvec,
  dotProductFloat32Int8,
  perLibraryZScoreFuse,
} from '../packages/core/src/embedding.ts';

function makeZip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data, deflate } of files) {
    const nameBuf = Buffer.from(name, 'utf8');
    const rawBuf = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
    const compBuf = deflate ? zlib.deflateRawSync(rawBuf) : rawBuf;
    const method = deflate ? 8 : 0;

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(method, 8);
    lh.writeUInt32LE(compBuf.length, 18);
    lh.writeUInt32LE(rawBuf.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    locals.push(lh, nameBuf, compBuf);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(method, 10);
    ch.writeUInt32LE(compBuf.length, 20);
    ch.writeUInt32LE(rawBuf.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt32LE(offset, 42);
    centrals.push(ch, nameBuf);

    offset += lh.length + nameBuf.length + compBuf.length;
  }
  const cdBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, cdBuf, eocd]));
}

// 1. Manifest invariants
assert.equal(EMBEDDING_DIM, 512);
assert.equal(OFFLINE_ENGINE_MANIFEST.embeddingModelId, 'voyage-4-nano');
assert.equal(OFFLINE_ENGINE_MANIFEST.rerankerModelId, 'qwen3-reranker-0.6b');
assert.equal(OFFLINE_ENGINE_MANIFEST.modelArtifacts.length, 7);
for (const art of OFFLINE_ENGINE_MANIFEST.modelArtifacts) {
  assert.ok(art.sha256 && art.sha256.length === 64, `Missing SHA-256 on ${art.id}`);
  assert.ok(art.sizeBytes > 0, `Missing sizeBytes on ${art.id}`);
}

// 2. GZIP corpus pack decompression
const jsonl = '{"work_id":"kempis","text":"In silence and quiet the devout soul advances."}\n';
const gz = new Uint8Array(zlib.gzipSync(Buffer.from(jsonl, 'utf8')));
assert.equal(new TextDecoder().decode(gunzipBytes(gz)), jsonl);

// 3. Deflated EPUB with Dublin Core metadata & multi-chapter spine
const epubBytes = makeZip([
  { name: 'mimetype', data: 'application/epub+zip', deflate: false },
  {
    name: 'META-INF/container.xml',
    deflate: true,
    data: `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
  },
  {
    name: 'OEBPS/content.opf',
    deflate: true,
    data: `<package xmlns="http://www.idpf.org/2007/opf"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>The Practice of the Presence of God</dc:title><dc:creator>Brother Lawrence</dc:creator><dc:date>1692</dc:date><dc:subject>prayer</dc:subject><dc:subject>peace</dc:subject></metadata><manifest><item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/><item id="c2" href="ch2.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>`,
  },
  {
    name: 'OEBPS/ch1.xhtml',
    deflate: true,
    data: `<html><body><h1>First Conversation</h1><p>${'We ought to act with God in the greatest simplicity, speaking to Him frankly and plainly, and imploring His assistance in our affairs just as they happen. '.repeat(6)}</p></body></html>`,
  },
  {
    name: 'OEBPS/ch2.xhtml',
    deflate: true,
    data: `<html><body><h1>Second Conversation</h1><p>${'The time of business does not with me differ from the time of prayer; and in the noise and clatter of my kitchen, I possess God in as great tranquility as if I were upon my knees. '.repeat(5)}</p></body></html>`,
  },
]);
const epubProc = processPersonalDocument(extractDocumentFromBytes(epubBytes, 'brother_lawrence.epub'));
assert.equal(epubProc.suggestedTitle, 'The Practice of the Presence of God');
assert.equal(epubProc.suggestedAuthor, 'Brother Lawrence');
assert.equal(epubProc.suggestedEra, 'Reformation');
assert.deepEqual(epubProc.divisions, ['First Conversation', 'Second Conversation']);
assert.ok(epubProc.chunks.length >= 2);
assert.ok(computeContentFingerprint(epubBytes).includes(`-${epubBytes.length}`));

// 4. FlateDecode PDF with /Info metadata
const pdfStreamRaw = Buffer.from(
  `BT /F1 12 Tf 72 720 Td (CHAPTER I: ON QUIET TRUST) Tj 0 -30 Td (${'Peace is not the absence of storm, but the quiet assurance that the Shepherd walks beside you through every valley and shadow of anxiety. '.repeat(4)}) Tj ET`,
  'latin1'
);
const pdfStreamFlate = zlib.deflateSync(pdfStreamRaw);
const pdfBytes = new Uint8Array(
  Buffer.concat([
    Buffer.from(
      `%PDF-1.4\n1 0 obj << /Title (Letters on Peace) /Author (Francois Fenelon) >> endobj\n2 0 obj << /Type /Page >> endobj\n3 0 obj << /Filter /FlateDecode /Length ${pdfStreamFlate.length} >>\nstream\n`,
      'latin1'
    ),
    pdfStreamFlate,
    Buffer.from('\nendstream\nendobj\n%%EOF', 'latin1'),
  ])
);
const pdfProc = processPersonalDocument(extractDocumentFromBytes(pdfBytes, 'fenelon_letters.pdf'));
assert.equal(pdfProc.ocrRequired, false);
assert.equal(pdfProc.suggestedTitle, 'Letters on Peace');
assert.equal(pdfProc.suggestedAuthor, 'Francois Fenelon');
assert.ok(pdfProc.chunks.length >= 1);

// 5. Scanned PDF OCR detection
const scannedPdf = new Uint8Array(
  Buffer.from(
    '%PDF-1.4\n1 0 obj << /Type /Page >> endobj\n2 0 obj << /Subtype /Image /Filter /DCTDecode >> stream\nIMGDATA\nendstream endobj\n%%EOF',
    'latin1'
  )
);
const scannedProc = processPersonalDocument(extractDocumentFromBytes(scannedPdf, 'scan.pdf'));
assert.equal(scannedProc.ocrRequired, true);
assert.ok(scannedProc.warnings.length > 0);

// 6. DOCX with core.xml + Heading1
const docxBytes = makeZip([
  {
    name: 'docProps/core.xml',
    deflate: true,
    data: `<cp:coreProperties xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Parish Homilies</dc:title><dc:creator>Fr. Thomas</dc:creator></cp:coreProperties>`,
  },
  {
    name: 'word/document.xml',
    deflate: true,
    data: `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Third Sunday of Lent</w:t></w:r></w:p><w:p><w:r><w:t>${'When we bring our honest fears before God, we discover mercy waiting where we expected judgment. '.repeat(5)}</w:t></w:r></w:p></w:body></w:document>`,
  },
]);
const docxProc = processPersonalDocument(extractDocumentFromBytes(docxBytes, 'homilies.docx'));
assert.equal(docxProc.suggestedTitle, 'Parish Homilies');
assert.equal(docxProc.suggestedAuthor, 'Fr. Thomas');
assert.deepEqual(docxProc.divisions, ['Third Sunday of Lent']);

// 7. Markdown YAML frontmatter + furniture & OCR garbage filters
const mdText = `---
title: Morning Notes
author: Michael
era: Contemporary
tags: [prayer, psalms]
---

# Psalm 23 Reflection

${'Even when the numbers do not add up at midnight, the shepherd does not ask us to solve tomorrow before dawn. '.repeat(4)}
`;
const mdProc = processPersonalDocument(
  extractDocumentFromBytes(new TextEncoder().encode(mdText), 'morning.md')
);
assert.equal(mdProc.suggestedTitle, 'Morning Notes');
assert.deepEqual(mdProc.suggestedTags, ['prayer', 'psalms']);
assert.equal(isFurnitureBlock('Gen. 1:1, 14, 22, 108, 214\nExod. 3:14, 45, 99\nPs. 23:1, 12, 88'), true);
assert.equal(isQuarantinedGarbage('@@@###$$$%%%^^^&&&***((()))~~~|||\\\\//'), true);

// 8. RVEC v1 int8 quantization + fidelity + Per-Library Z-Score Fusion
const v1 = new Float32Array(EMBEDDING_DIM).map((_, i) => Math.sin(i * 0.13 + 0.4));
const v2 = new Float32Array(EMBEDDING_DIM).map((_, i) => Math.cos(i * 0.17 - 0.2));
const q1 = quantizeVectorInt8(v1, EMBEDDING_DIM);
const q2 = quantizeVectorInt8(v2, EMBEDDING_DIM);
const mat = new Int8Array(EMBEDDING_DIM * 2);
mat.set(q1.quantized, 0);
mat.set(q2.quantized, EMBEDDING_DIM);
const rvec = parseRvec(encodeRvec(mat, new Float32Array([q1.scale, q2.scale]), EMBEDDING_DIM));
assert.equal(rvec.count, 2);
assert.equal(rvec.dim, EMBEDDING_DIM);

const normV1 = Math.hypot(...v1);
const selfDot = dotProductFloat32Int8(
  v1.map((x) => x / normV1),
  rvec.vectors,
  0,
  rvec.scales[0],
  EMBEDDING_DIM
);
assert.ok(selfDot >= 0.995, `Expected int8 self-dot >= 0.995, got ${selfDot}`);

const fused = perLibraryZScoreFuse([
  { id: 's1', workId: 'web', library: 'scripture', denseScore: 0.72, rerankProb: 0.88, rerankLogit: 2.0 },
  { id: 's2', workId: 'web', library: 'scripture', denseScore: 0.69, rerankProb: 0.65, rerankLogit: 0.6 },
  { id: 's3', workId: 'web', library: 'scripture', denseScore: 0.67, rerankProb: 0.55, rerankLogit: 0.2 },
  { id: 'w1', workId: 'kempis', library: 'witness', denseScore: 0.68, rerankProb: 0.81, rerankLogit: 1.45 },
  { id: 'p1', workId: 'personal_notes', library: 'personal', denseScore: 0.61, rerankProb: 0.74, rerankLogit: 1.05 },
]);
assert.equal(fused.silent, false);
// Per-work cap = 2 enforces at most 2 passages from `web`
assert.equal(fused.results.filter((r) => r.workId === 'web').length, 2);

const silent = perLibraryZScoreFuse([
  { id: 's1', workId: 'web', library: 'scripture', denseScore: 0.45, rerankProb: 0.03, rerankLogit: -3.5 },
]);
assert.equal(silent.silent, true);
assert.equal(silent.results.length, 0);

console.log('✓ All offline 512d int8 & Personal Library verification checks passed.');
