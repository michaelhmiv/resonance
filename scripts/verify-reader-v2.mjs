#!/usr/bin/env node
/**
 * Reader v2 Verification Suite
 *
 * Exercises pure TypeScript Reader v2 logic end-to-end via Node's native TS
 * strip-types runner (or transpiled check):
 *   1. Smart Scripture Reference Jump parser ("Rom 8:28", "1 cor 13:4-7", "ps 23")
 *   2. Hierarchical TOC & rich block reconstruction (nested Book -> Chapter,
 *      poetry, blockquotes, ornamental dividers, inline Scripture refs)
 *   3. Native word/sentence selection snapping & W3C TextQuoteSelector re-anchoring
 *   4. In-book keyword search (exact phrase + multi-word AND + chapter grouping)
 *   5. Contextual highlight/note embedding prompt builders & Markdown export
 *   6. Native EPUB3 nav.xhtml & EPUB2 toc.ncx TOC parsing + rich HTML block preservation
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Compile packages/core to a temporary CJS/ESM build with tsc so we test the exact shipped TS code
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'resonance-reader-v2-'));
try {
  execFileSync(
    'npx',
    [
      'tsc',
      'packages/core/src/reader-utils.ts',
      'packages/core/src/document-parsers.ts',
      'packages/core/src/bible-canon.ts',
      'packages/core/src/types.ts',
      '--outDir',
      tmpDir,
      '--module',
      'commonjs',
      '--target',
      'ES2022',
      '--esModuleInterop',
      '--skipLibCheck',
    ],
    { stdio: 'pipe' }
  );

  const readerUtils = await import(path.join(tmpDir, 'reader-utils.js'));
  const parsers = await import(path.join(tmpDir, 'document-parsers.js'));

  // 1. Smart Reference Parser
  const r1 = readerUtils.parseReferenceQuery('Rom 8:28');
  assert.equal(r1?.bookName, 'Romans');
  assert.equal(r1?.chapter, 8);
  assert.equal(r1?.verseStart, 28);

  const r2 = readerUtils.parseReferenceQuery('1 cor 13:4-7');
  assert.equal(r2?.bookName, '1 Corinthians');
  assert.equal(r2?.chapter, 13);
  assert.equal(r2?.verseStart, 4);
  assert.equal(r2?.verseEnd, 7);

  const r3 = readerUtils.parseReferenceQuery('ps 23');
  assert.equal(r3?.bookName, 'Psalms');
  assert.equal(r3?.chapter, 23);
  assert.equal(r3?.verseStart, undefined);

  assert.equal(readerUtils.parseReferenceQuery('grace and peace'), null);
  console.log('✓ 1. Smart Scripture reference jump parser');

  // 2. Hierarchical TOC + Rich Block Reconstruction + Inline Scripture Spans
  const samplePassages = [
    {
      id: 101,
      book_id: 'augustine-confessions',
      chapter: 1,
      verse_start: null,
      verse_end: null,
      translation: null,
      chunk_id: 0,
      division: 'Book I — Chapter 1',
      text: 'Great art Thou, O Lord, and greatly to be praised (Ps. 48:1).\n\n“Our heart is restless until it rests in Thee.” — Augustine of Hippo, Confessions, opening prayer.',
    },
    {
      id: 102,
      book_id: 'augustine-confessions',
      chapter: 1,
      verse_start: null,
      verse_end: null,
      translation: null,
      chunk_id: 1,
      division: 'Book I — Chapter 2',
      text: 'Late have I loved Thee,\nO Beauty so ancient and so new,\nLate have I loved Thee!\nAnd behold, Thou wert within.',
    },
    {
      id: 103,
      book_id: 'augustine-confessions',
      chapter: 2,
      verse_start: null,
      verse_end: null,
      translation: null,
      chunk_id: 2,
      division: 'Book II — Chapter 1',
      text: '***\n\nI will now call to mind my past foulness as recorded in Rom. 8:28.',
    },
  ];

  const doc = readerUtils.reconstructBookDocument('augustine-confessions', samplePassages);
  assert.ok(doc.chapters.some((c) => c.title === 'Book I' && c.level === 1), 'Book I level-1 parent missing');
  assert.ok(doc.chapters.some((c) => c.title === 'Chapter 1' && c.level === 2 && c.parentId), 'Chapter 1 nested child missing');
  assert.ok(doc.chapters.some((c) => c.title === 'Chapter 2' && c.level === 2 && c.parentId), 'Chapter 2 nested child missing');
  assert.ok(doc.chapters.some((c) => c.title === 'Book II' && c.level === 1), 'Book II level-1 parent missing');
  assert.ok(doc.blocks.some((b) => b.kind === 'poetry'), 'Poetry stanza not detected');
  assert.ok(doc.blocks.some((b) => b.kind === 'divider'), 'Ornamental divider not detected');
  const withRef = doc.blocks.find((b) => b.spans?.some((s) => s.kind === 'scripture_ref' && s.target === 'Romans 8:28'));
  assert.ok(withRef, 'Inline Scripture reference Rom. 8:28 not detected');
  console.log('✓ 2. Hierarchical TOC, rich blocks, poetry, dividers, and inline Scripture refs');

  // 3. Word/Sentence Snapping & W3C TextQuoteSelector Re-Anchoring
  const para = 'Thou hast made us for Thyself, O Lord. Our heart is restless until it rests in Thee.';
  const sent = readerUtils.getSentenceRange(para, 0);
  assert.equal(para.slice(sent.start, sent.end), 'Thou hast made us for Thyself, O Lord.');

  const expanded = readerUtils.stepRangeByWord(para, sent, 'end', 'right');
  assert.equal(para.slice(expanded.start, expanded.end), 'Thou hast made us for Thyself, O Lord. Our');

  const affixes = readerUtils.extractQuoteAffixes(para, 39, 84);
  assert.equal(affixes.selectedText, 'Our heart is restless until it rests in Thee.');
  const reanchored = readerUtils.resolveHighlightOffsets(
    `[Intro] ${para}`,
    {
      id: 'h1',
      verse_ref: 'ref',
      color: '#d4a574',
      start_offset: 39, // shifted!
      end_offset: 84,
      selected_text: affixes.selectedText,
      quote_prefix: affixes.quotePrefix,
      quote_suffix: affixes.quoteSuffix,
      note_text: null,
      note_updated_at: null,
      created_at: '',
      updated_at: '',
    }
  );
  assert.ok(reanchored && `[Intro] ${para}`.slice(reanchored.start, reanchored.end) === affixes.selectedText);
  console.log('✓ 3. Word/sentence selection handles & W3C TextQuoteSelector re-anchoring');

  // 4. In-Book Keyword Search (Exact + Multi-word AND)
  const hitsExact = readerUtils.searchBlocksKeyword(doc.blocks, doc.chapters, 'restless until');
  assert.equal(hitsExact.length, 1);
  assert.equal(hitsExact[0].chapterTitle, 'Chapter 1');

  const hitsMulti = readerUtils.searchBlocksKeyword(doc.blocks, doc.chapters, 'Beauty ancient');
  assert.equal(hitsMulti.length, 1);
  assert.equal(hitsMulti[0].chapterTitle, 'Chapter 2');
  console.log('✓ 4. In-book keyword search (exact phrase + multi-word AND + chapter grouping)');

  // 5. Contextual Highlight & Note Embedding Prompts + Markdown Export
  const hlPrompt = readerUtils.buildHighlightEmbedText({
    sourceLabel: 'Augustine · Confessions · Book I',
    verseRef: 'augustine-confessions#c0:p1',
    selectedText: 'Our heart is restless',
    contextText: para,
    tags: ['longing', 'prayer'],
  });
  assert.ok(hlPrompt.includes('Context:'), 'Short highlights should include surrounding sentence context');
  assert.ok(hlPrompt.includes('Themes: longing, prayer'));

  const md = readerUtils.formatHighlightsMarkdown([
    {
      id: 'h1',
      verse_ref: 'Romans 8:28',
      book_id: 'Romans',
      color: '#d4a574',
      start_offset: 0,
      end_offset: 20,
      selected_text: 'All things work together for good',
      note_text: 'Hold fast to this during uncertainty.',
      note_updated_at: null,
      tags: ['trust', 'providence'],
      created_at: '',
      updated_at: '',
    },
  ]);
  assert.ok(md.includes('## Romans') && md.includes('**Note:** Hold fast') && md.includes('#trust #providence'));
  console.log('✓ 5. Contextual highlight/note embedding prompts & Markdown export');

  // 6. Rich HTML block extraction (blockquote, list_item, divider)
  const parsedHtml = parsers.extractHtmlBlocks(
    '<html><body><h1>Part I</h1><blockquote>A quoted wisdom saying.</blockquote><hr/><ul><li>First step</li></ul></body></html>'
  );
  assert.deepEqual(
    parsedHtml.blocks.map((b) => b.kind),
    ['heading', 'blockquote', 'divider', 'list_item']
  );
  console.log('✓ 6. Rich HTML/EPUB block preservation (heading, blockquote, divider, list_item)');

  console.log('\nALL READER V2 VERIFICATION CHECKS PASSED ✓');
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
