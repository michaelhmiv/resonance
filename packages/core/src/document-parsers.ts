/**
 * Pure-TypeScript on-device document & archive parsers for Resonance.
 *
 * Zero external runtime dependencies — runs identically on React Native
 * (Hermes), web, and Node. Supports:
 *   - RFC 1951 Deflate / Zlib / Gzip decompression (also used for .jsonl.gz packs)
 *   - ZIP archive reader (Stored + Deflated entries via Central Directory)
 *   - EPUB (container.xml -> OPF metadata + spine order -> XHTML blocks)
 *   - PDF  (Info/XMP metadata, FlateDecode streams, ToUnicode CMap, BT/ET text
 *           operators, paragraph inference, and scanned-PDF OCR detection)
 *   - DOCX (docProps/core.xml + word/document.xml headings & paragraphs)
 *   - HTML, Markdown (with YAML frontmatter), and Plain Text
 *
 * (chunking-spec.md §7.1–§7.4)
 */

import type {
  DetectedDocumentMetadata,
  ExtractedBlock,
  PersonalSourceFormat,
  RawDocumentExtraction,
} from './types';

// ── UTF-8 & Base64 helpers (Hermes-safe, no Node Buffer required) ───────────

const BASE64_CHARS =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const BASE64_LOOKUP = (() => {
  const table = new Uint8Array(256);
  table.fill(255);
  for (let i = 0; i < BASE64_CHARS.length; i++) {
    table[BASE64_CHARS.charCodeAt(i)] = i;
  }
  return table;
})();

export function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/[^A-Za-z0-9+/=]/g, '');
  const len = clean.length;
  if (len === 0) return new Uint8Array(0);
  let pad = 0;
  if (clean.endsWith('==')) pad = 2;
  else if (clean.endsWith('=')) pad = 1;
  const outLen = (len * 3) / 4 - pad;
  const out = new Uint8Array(outLen);
  let o = 0;
  for (let i = 0; i < len; i += 4) {
    const a = BASE64_LOOKUP[clean.charCodeAt(i)];
    const b = BASE64_LOOKUP[clean.charCodeAt(i + 1)];
    const c = BASE64_LOOKUP[clean.charCodeAt(i + 2)];
    const d = BASE64_LOOKUP[clean.charCodeAt(i + 3)];
    const triple = (a << 18) | (b << 12) | ((c & 63) << 6) | (d & 63);
    if (o < outLen) out[o++] = (triple >> 16) & 0xff;
    if (o < outLen) out[o++] = (triple >> 8) & 0xff;
    if (o < outLen) out[o++] = triple & 0xff;
  }
  return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const triple = (a << 16) | (b << 8) | c;
    out += BASE64_CHARS[(triple >> 18) & 63];
    out += BASE64_CHARS[(triple >> 12) & 63];
    out += i + 1 < bytes.length ? BASE64_CHARS[(triple >> 6) & 63] : '=';
    out += i + 2 < bytes.length ? BASE64_CHARS[triple & 63] : '=';
  }
  return out;
}

export function decodeUtf8(bytes: Uint8Array): string {
  if (typeof TextDecoder !== 'undefined') {
    try {
      return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    } catch {
      // fall through
    }
  }
  // Pure-JS UTF-8 fallback
  const chunks: string[] = [];
  let i = 0;
  let cur = '';
  while (i < bytes.length) {
    const b0 = bytes[i++];
    if (b0 < 0x80) {
      cur += String.fromCharCode(b0);
    } else if ((b0 & 0xe0) === 0xc0 && i < bytes.length) {
      const b1 = bytes[i++];
      cur += String.fromCharCode(((b0 & 0x1f) << 6) | (b1 & 0x3f));
    } else if ((b0 & 0xf0) === 0xe0 && i + 1 < bytes.length) {
      const b1 = bytes[i++];
      const b2 = bytes[i++];
      cur += String.fromCharCode(((b0 & 0x0f) << 12) | ((b1 & 0x3f) << 6) | (b2 & 0x3f));
    } else if ((b0 & 0xf8) === 0xf0 && i + 2 < bytes.length) {
      const b1 = bytes[i++];
      const b2 = bytes[i++];
      const b3 = bytes[i++];
      const cp = (((b0 & 0x07) << 18) | ((b1 & 0x3f) << 12) | ((b2 & 0x3f) << 6) | (b3 & 0x3f)) - 0x10000;
      cur += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
    } else {
      cur += '\uFFFD';
    }
    if (cur.length >= 16384) {
      chunks.push(cur);
      cur = '';
    }
  }
  if (cur) chunks.push(cur);
  return chunks.join('');
}

export function decodeLatin1(bytes: Uint8Array): string {
  const parts: string[] = [];
  const step = 16384;
  for (let i = 0; i < bytes.length; i += step) {
    const slice = bytes.subarray(i, Math.min(i + step, bytes.length));
    let s = '';
    for (let j = 0; j < slice.length; j++) {
      s += String.fromCharCode(slice[j]);
    }
    parts.push(s);
  }
  return parts.join('');
}

/** Fast deterministic content fingerprint (64-bit dual FNV-1a hex) for dedup. */
export function computeContentFingerprint(bytes: Uint8Array): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    h1 ^= b;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= b ^ (i & 0xff);
    h2 = Math.imul(h2, 0x85ebca6b);
  }
  const p1 = (h1 >>> 0).toString(16).padStart(8, '0');
  const p2 = (h2 >>> 0).toString(16).padStart(8, '0');
  return `${p1}${p2}-${bytes.length}`;
}

// ── RFC 1951 Inflate / Zlib / Gzip (Pure TypeScript) ────────────────────────

interface HuffmanTree {
  counts: Int32Array;
  symbols: Int32Array;
}

function buildHuffman(lengths: Uint8Array, offset: number, count: number): HuffmanTree {
  const counts = new Int32Array(16);
  for (let i = 0; i < count; i++) {
    const len = lengths[offset + i];
    if (len > 0 && len < 16) counts[len]++;
  }
  const offsets = new Int32Array(16);
  let total = 0;
  for (let bits = 1; bits <= 15; bits++) {
    offsets[bits] = total;
    total += counts[bits];
  }
  const symbols = new Int32Array(total);
  for (let sym = 0; sym < count; sym++) {
    const len = lengths[offset + sym];
    if (len > 0 && len < 16) {
      symbols[offsets[len]++] = sym;
    }
  }
  return { counts, symbols };
}

const FIXED_LIT_TREE = (() => {
  const lengths = new Uint8Array(288);
  for (let i = 0; i <= 143; i++) lengths[i] = 8;
  for (let i = 144; i <= 255; i++) lengths[i] = 9;
  for (let i = 256; i <= 279; i++) lengths[i] = 7;
  for (let i = 280; i <= 287; i++) lengths[i] = 8;
  return buildHuffman(lengths, 0, 288);
})();

const FIXED_DIST_TREE = (() => {
  const lengths = new Uint8Array(32);
  lengths.fill(5);
  return buildHuffman(lengths, 0, 32);
})();

const LEN_BASE = [
  3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31,
  35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258,
];
const LEN_EXTRA = [
  0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2,
  3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0,
];
const DIST_BASE = [
  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193,
  257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193,
  12289, 16385, 24577,
];
const DIST_EXTRA = [
  0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6,
  7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13,
];
const CODE_LEN_ORDER = [
  16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15,
];

/** Decompress a raw RFC 1951 DEFLATE stream. */
export function inflateRaw(src: Uint8Array, initialCapacity = 4096): Uint8Array {
  let pos = 0;
  let bitBuf = 0;
  let bitCount = 0;

  let out = new Uint8Array(Math.max(initialCapacity, src.length * 2));
  let outPos = 0;

  const ensureOut = (need: number) => {
    if (outPos + need <= out.length) return;
    let nextCap = out.length * 2;
    while (nextCap < outPos + need) nextCap *= 2;
    const grown = new Uint8Array(nextCap);
    grown.set(out.subarray(0, outPos));
    out = grown;
  };

  const readBits = (n: number): number => {
    while (bitCount < n) {
      if (pos >= src.length) throw new Error('Unexpected end of deflate stream');
      bitBuf |= src[pos++] << bitCount;
      bitCount += 8;
    }
    const val = bitBuf & ((1 << n) - 1);
    bitBuf >>>= n;
    bitCount -= n;
    return val;
  };

  const decodeSymbol = (tree: HuffmanTree): number => {
    let code = 0;
    let first = 0;
    let index = 0;
    for (let len = 1; len <= 15; len++) {
      code |= readBits(1);
      const count = tree.counts[len];
      if (code - count < first) {
        return tree.symbols[index + (code - first)];
      }
      index += count;
      first = (first + count) << 1;
      code <<= 1;
    }
    throw new Error('Invalid Huffman code in deflate stream');
  };

  let isFinal = 0;
  while (!isFinal) {
    isFinal = readBits(1);
    const blockType = readBits(2);

    if (blockType === 0) {
      // Stored (uncompressed) block
      bitBuf = 0;
      bitCount = 0;
      if (pos + 4 > src.length) throw new Error('Truncated stored block header');
      const len = src[pos] | (src[pos + 1] << 8);
      pos += 4; // skip len & nlen
      if (pos + len > src.length) throw new Error('Truncated stored block payload');
      ensureOut(len);
      out.set(src.subarray(pos, pos + len), outPos);
      pos += len;
      outPos += len;
    } else if (blockType === 1 || blockType === 2) {
      let litTree = FIXED_LIT_TREE;
      let distTree = FIXED_DIST_TREE;

      if (blockType === 2) {
        const hlit = readBits(5) + 257;
        const hdist = readBits(5) + 1;
        const hclen = readBits(4) + 4;
        const codeLens = new Uint8Array(19);
        for (let i = 0; i < hclen; i++) {
          codeLens[CODE_LEN_ORDER[i]] = readBits(3);
        }
        const codeTree = buildHuffman(codeLens, 0, 19);
        const lengths = new Uint8Array(hlit + hdist);
        let idx = 0;
        while (idx < hlit + hdist) {
          const sym = decodeSymbol(codeTree);
          if (sym < 16) {
            lengths[idx++] = sym;
          } else if (sym === 16) {
            const rep = readBits(2) + 3;
            const prev = idx > 0 ? lengths[idx - 1] : 0;
            for (let r = 0; r < rep && idx < lengths.length; r++) lengths[idx++] = prev;
          } else if (sym === 17) {
            const rep = readBits(3) + 3;
            for (let r = 0; r < rep && idx < lengths.length; r++) lengths[idx++] = 0;
          } else if (sym === 18) {
            const rep = readBits(7) + 11;
            for (let r = 0; r < rep && idx < lengths.length; r++) lengths[idx++] = 0;
          }
        }
        litTree = buildHuffman(lengths, 0, hlit);
        distTree = buildHuffman(lengths, hlit, hdist);
      }

      for (;;) {
        const sym = decodeSymbol(litTree);
        if (sym < 256) {
          ensureOut(1);
          out[outPos++] = sym;
        } else if (sym === 256) {
          break;
        } else {
          const lenIdx = sym - 257;
          if (lenIdx >= LEN_BASE.length) throw new Error('Invalid deflate length symbol');
          const length = LEN_BASE[lenIdx] + (LEN_EXTRA[lenIdx] ? readBits(LEN_EXTRA[lenIdx]) : 0);
          const distSym = decodeSymbol(distTree);
          if (distSym >= DIST_BASE.length) throw new Error('Invalid deflate distance symbol');
          const dist = DIST_BASE[distSym] + (DIST_EXTRA[distSym] ? readBits(DIST_EXTRA[distSym]) : 0);
          ensureOut(length);
          let copySrc = outPos - dist;
          if (copySrc < 0) throw new Error('Invalid deflate back-reference distance');
          for (let k = 0; k < length; k++) {
            out[outPos++] = out[copySrc++];
          }
        }
      }
    } else {
      throw new Error('Reserved deflate block type 3');
    }
  }

  return out.subarray(0, outPos);
}

/** Decompress a zlib (RFC 1950) stream (used by PDF /FlateDecode). */
export function inflateZlib(src: Uint8Array): Uint8Array {
  if (src.length < 6) return inflateRaw(src);
  const cmf = src[0];
  const flg = src[1];
  // Valid zlib header: CM=8 and (CMF*256 + FLG) % 31 === 0
  if ((cmf & 0x0f) === 8 && ((cmf << 8) + flg) % 31 === 0) {
    const hasDict = (flg & 0x20) !== 0;
    const start = hasDict ? 6 : 2;
    return inflateRaw(src.subarray(start));
  }
  return inflateRaw(src);
}

/** Decompress a GZIP (RFC 1952) buffer (used for .passages.jsonl.gz corpus packs). */
export function gunzipBytes(src: Uint8Array): Uint8Array {
  if (src.length < 18 || src[0] !== 0x1f || src[1] !== 0x8b) {
    throw new Error('Invalid GZIP header');
  }
  const flg = src[3];
  let pos = 10;
  if (flg & 0x04) {
    const xlen = src[pos] | (src[pos + 1] << 8);
    pos += 2 + xlen;
  }
  if (flg & 0x08) {
    while (pos < src.length && src[pos] !== 0) pos++;
    pos++;
  }
  if (flg & 0x10) {
    while (pos < src.length && src[pos] !== 0) pos++;
    pos++;
  }
  if (flg & 0x02) {
    pos += 2;
  }
  return inflateRaw(src.subarray(pos, Math.max(pos, src.length - 8)));
}

// ── ZIP Archive Reader (EPUB & DOCX) ────────────────────────────────────────

export interface ZipEntry {
  name: string;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

export interface ZipArchive {
  entries: Map<string, ZipEntry>;
  readEntry(name: string): Uint8Array | null;
  readText(name: string): string | null;
}

export function openZipArchive(bytes: Uint8Array): ZipArchive {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // Find End of Central Directory record (0x06054b50) scanning backward from end
  const minOffset = Math.max(0, bytes.length - 65557);
  let eocdOffset = -1;
  for (let i = bytes.length - 22; i >= minOffset; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) {
    throw new Error('Invalid ZIP/EPUB/DOCX archive: missing End of Central Directory');
  }

  const totalEntries = view.getUint16(eocdOffset + 10, true);
  const cdOffset = view.getUint32(eocdOffset + 16, true);

  const entries = new Map<string, ZipEntry>();
  let p = cdOffset;
  for (let i = 0; i < totalEntries && p + 46 <= bytes.length; i++) {
    if (view.getUint32(p, true) !== 0x02014b50) break;
    const compressionMethod = view.getUint16(p + 10, true);
    const compressedSize = view.getUint32(p + 20, true);
    const uncompressedSize = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localHeaderOffset = view.getUint32(p + 42, true);
    const name = decodeUtf8(bytes.subarray(p + 46, p + 46 + nameLen));
    entries.set(name, {
      name,
      compressionMethod,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
    });
    p += 46 + nameLen + extraLen + commentLen;
  }

  const readEntry = (name: string): Uint8Array | null => {
    const normalized = name.replace(/^\/+/, '');
    let entry = entries.get(normalized);
    if (!entry) {
      // Case-insensitive / URL-decoded fallback
      const decoded = safeDecodeUri(normalized).toLowerCase();
      for (const [k, v] of entries.entries()) {
        if (k.toLowerCase() === decoded || safeDecodeUri(k).toLowerCase() === decoded) {
          entry = v;
          break;
        }
      }
    }
    if (!entry) return null;
    const lh = entry.localHeaderOffset;
    if (lh + 30 > bytes.length || view.getUint32(lh, true) !== 0x04034b50) return null;
    const nameLen = view.getUint16(lh + 26, true);
    const extraLen = view.getUint16(lh + 28, true);
    const dataStart = lh + 30 + nameLen + extraLen;
    const slice = bytes.subarray(dataStart, dataStart + entry.compressedSize);
    if (entry.compressionMethod === 0) {
      return slice;
    }
    if (entry.compressionMethod === 8) {
      return inflateRaw(slice, entry.uncompressedSize || slice.length * 3);
    }
    throw new Error(`Unsupported ZIP compression method ${entry.compressionMethod}`);
  };

  return {
    entries,
    readEntry,
    readText(name: string): string | null {
      const data = readEntry(name);
      return data ? decodeUtf8(data) : null;
    },
  };
}

function safeDecodeUri(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

// ── HTML & XML utilities ────────────────────────────────────────────────────

const HTML_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  mdash: '\u2014',
  ndash: '\u2013',
  lsquo: '\u2018',
  rsquo: '\u2019',
  ldquo: '\u201c',
  rdquo: '\u201d',
  hellip: '\u2026',
  copy: '\u00a9',
  sect: '\u00a7',
  para: '\u00b6',
};

export function decodeHtmlEntities(input: string): string {
  return input.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (_m, ent: string) => {
    if (ent.startsWith('#x') || ent.startsWith('#X')) {
      const cp = parseInt(ent.slice(2), 16);
      return Number.isFinite(cp) ? safeFromCodePoint(cp) : '';
    }
    if (ent.startsWith('#')) {
      const cp = parseInt(ent.slice(1), 10);
      return Number.isFinite(cp) ? safeFromCodePoint(cp) : '';
    }
    return HTML_ENTITIES[ent.toLowerCase()] ?? '';
  });
}

function safeFromCodePoint(cp: number): string {
  if (cp <= 0 || cp > 0x10ffff) return '';
  try {
    return String.fromCodePoint(cp);
  } catch {
    return '';
  }
}

function collapseWs(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function extractXmlTagText(xml: string, tagPattern: string): string[] {
  const re = new RegExp(`<(?:[a-zA-Z0-9_-]+:)?${tagPattern}\\b[^>]*>([\\s\\S]*?)<\\/(?:[a-zA-Z0-9_-]+:)?${tagPattern}>`, 'gi');
  const results: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const text = collapseWs(decodeHtmlEntities(m[1].replace(/<[^>]+>/g, ' ')));
    if (text) results.push(text);
  }
  return results;
}

function parseXmlAttributes(tagAttrs: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([a-zA-Z0-9_:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tagAttrs)) !== null) {
    attrs[m[1].toLowerCase()] = decodeHtmlEntities(m[2] ?? m[3] ?? '');
  }
  return attrs;
}

/** Extract heading and paragraph blocks from an HTML/XHTML document. */
export function extractHtmlBlocks(html: string): {
  blocks: ExtractedBlock[];
  title?: string;
  author?: string;
} {
  const titleMatch = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = titleMatch ? collapseWs(decodeHtmlEntities(titleMatch[1])) : undefined;

  let author: string | undefined;
  const metaRe = /<meta\b([^>]*?)\/?>/gi;
  let metaM: RegExpExecArray | null;
  while ((metaM = metaRe.exec(html)) !== null) {
    const attrs = parseXmlAttributes(metaM[1]);
    if (attrs.name?.toLowerCase() === 'author' && attrs.content) {
      author = collapseWs(attrs.content);
      break;
    }
  }

  // Strip scripts, styles, SVG, head
  let body = html;
  const bodyMatch = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(html);
  if (bodyMatch) body = bodyMatch[1];
  body = body
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<nav\b[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');

  const blocks: ExtractedBlock[] = [];
  // Match leaf-ish headings and block elements sequentially
  const blockRe =
    /<(h[1-6]|p|blockquote|li|pre|dt|dd)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(body)) !== null) {
    const tag = m[1].toLowerCase();
    const inner = m[2]
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '');
    const decoded = decodeHtmlEntities(inner);
    if (tag.startsWith('h')) {
      const text = collapseWs(decoded);
      if (text) {
        blocks.push({ kind: 'heading', text, level: parseInt(tag[1], 10) || 2 });
      }
    } else if (tag === 'pre') {
      const text = decoded.trim();
      if (text) blocks.push({ kind: 'poetry', text });
    } else {
      // Preserve intentional line breaks (poetry inside <p> with <br/>)
      const lines = decoded
        .split('\n')
        .map((l) => collapseWs(l))
        .filter(Boolean);
      if (lines.length >= 3 && lines.every((l) => l.length <= 75)) {
        blocks.push({ kind: 'poetry', text: lines.join('\n') });
      } else {
        const text = collapseWs(lines.join(' '));
        if (text) blocks.push({ kind: 'paragraph', text });
      }
    }
  }

  // Fallback for div-only HTML with no <p> tags
  if (blocks.length === 0) {
    const stripped = decodeHtmlEntities(
      body
        .replace(/<\/(div|section|article|tr|br)>/gi, '\n\n')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
    );
    for (const para of stripped.split(/\n{2,}/)) {
      const clean = collapseWs(para);
      if (clean) blocks.push({ kind: 'paragraph', text: clean });
    }
  }

  return { blocks, title, author };
}

function joinZipPath(baseDir: string, href: string): string {
  const cleanHref = href.split('#')[0].split('?')[0];
  if (!baseDir || baseDir === '.') return cleanHref.replace(/^\/+/, '');
  const parts = `${baseDir}/${cleanHref}`.split('/');
  const resolved: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') resolved.pop();
    else resolved.push(part);
  }
  return resolved.join('/');
}

// ── EPUB Parser ─────────────────────────────────────────────────────────────

export function parseEpubBytes(bytes: Uint8Array, filename: string): RawDocumentExtraction {
  const warnings: string[] = [];
  const zip = openZipArchive(bytes);

  const containerXml = zip.readText('META-INF/container.xml');
  if (!containerXml) {
    throw new Error('Invalid EPUB: missing META-INF/container.xml');
  }

  const rootfileMatch = /<rootfile\b([^>]*?)\/?>/i.exec(containerXml);
  const opfPath = rootfileMatch ? parseXmlAttributes(rootfileMatch[1])['full-path'] : null;
  if (!opfPath) {
    throw new Error('Invalid EPUB: container.xml has no rootfile full-path');
  }

  const opfXml = zip.readText(opfPath);
  if (!opfXml) {
    throw new Error(`Invalid EPUB: missing OPF package at ${opfPath}`);
  }

  const baseDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/')) : '';

  // Extract Dublin Core metadata from OPF
  const titles = extractXmlTagText(opfXml, 'title');
  const creators = extractXmlTagText(opfXml, 'creator');
  const dates = extractXmlTagText(opfXml, 'date');
  const subjects = extractXmlTagText(opfXml, 'subject');
  const descriptions = extractXmlTagText(opfXml, 'description');
  const languages = extractXmlTagText(opfXml, 'language');

  // Build manifest map: id -> { href, mediaType }
  const manifest = new Map<string, { href: string; mediaType: string }>();
  const itemRe = /<item\b([^>]*?)\/?>/gi;
  let im: RegExpExecArray | null;
  while ((im = itemRe.exec(opfXml)) !== null) {
    const attrs = parseXmlAttributes(im[1]);
    if (attrs.id && attrs.href) {
      manifest.set(attrs.id, {
        href: attrs.href,
        mediaType: (attrs['media-type'] ?? '').toLowerCase(),
      });
    }
  }

  // Read spine itemrefs in order
  const spineIds: string[] = [];
  const spineRe = /<itemref\b([^>]*?)\/?>/gi;
  let sm: RegExpExecArray | null;
  while ((sm = spineRe.exec(opfXml)) !== null) {
    const attrs = parseXmlAttributes(sm[1]);
    if (attrs.idref && attrs.linear !== 'no') {
      spineIds.push(attrs.idref);
    }
  }

  const blocks: ExtractedBlock[] = [];
  let chapterCount = 0;

  for (const idref of spineIds) {
    const item = manifest.get(idref);
    if (!item) continue;
    const isHtml =
      item.mediaType.includes('html') ||
      /\.(xhtml|html|htm)$/i.test(item.href);
    if (!isHtml) continue;

    const entryPath = joinZipPath(baseDir, item.href);
    const html = zip.readText(entryPath);
    if (!html) {
      warnings.push(`Skipped missing spine file: ${item.href}`);
      continue;
    }

    const parsed = extractHtmlBlocks(html);
    if (parsed.blocks.length === 0) continue;
    chapterCount++;

    // If a spine chapter has no explicit heading, synthesize one from its <title>
    const hasHeading = parsed.blocks.some((b) => b.kind === 'heading');
    if (
      !hasHeading &&
      parsed.title &&
      parsed.title.toLowerCase() !== (titles[0] ?? '').toLowerCase() &&
      parsed.title.length <= 120
    ) {
      blocks.push({ kind: 'heading', text: parsed.title, level: 2 });
    }
    blocks.push(...parsed.blocks);
  }

  const rawText = blocks.map((b) => b.text).join('\n\n');
  const detectedMetadata: DetectedDocumentMetadata = {
    title: titles[0],
    author: creators[0],
    era: dates[0] ? inferEraFromDate(dates[0]) : undefined,
    language: languages[0],
    description: descriptions[0],
    tags: subjects.slice(0, 8),
    chapterCount,
  };

  if (blocks.length === 0) {
    warnings.push('No readable text blocks found in EPUB spine.');
  }

  return {
    format: 'epub',
    filename,
    blocks,
    rawText,
    detectedMetadata,
    ocrRequired: false,
    warnings,
  };
}

// ── DOCX Parser ─────────────────────────────────────────────────────────────

export function parseDocxBytes(bytes: Uint8Array, filename: string): RawDocumentExtraction {
  const warnings: string[] = [];
  const zip = openZipArchive(bytes);
  const docXml = zip.readText('word/document.xml');
  if (!docXml) {
    throw new Error('Invalid DOCX: missing word/document.xml');
  }

  const coreXml = zip.readText('docProps/core.xml') ?? '';
  const titles = extractXmlTagText(coreXml, 'title');
  const creators = extractXmlTagText(coreXml, 'creator');
  const descriptions = extractXmlTagText(coreXml, 'description');
  const keywords = extractXmlTagText(coreXml, 'keywords');

  const blocks: ExtractedBlock[] = [];
  const paraRe = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g;
  let pm: RegExpExecArray | null;
  while ((pm = paraRe.exec(docXml)) !== null) {
    const inner = pm[1];
    const styleMatch = /<w:pStyle\b[^>]*w:val="([^"]+)"/i.exec(inner);
    const styleVal = (styleMatch?.[1] ?? '').toLowerCase();
    const isHeading = styleVal.includes('heading') || styleVal === 'title' || styleVal === 'subtitle';

    // Collect <w:t> runs and <w:br/> / <w:tab/>
    let text = '';
    const tokenRe = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<w:(br|tab)\b[^>]*\/>/g;
    let tm: RegExpExecArray | null;
    while ((tm = tokenRe.exec(inner)) !== null) {
      if (tm[1] !== undefined) {
        text += decodeHtmlEntities(tm[1]);
      } else if (tm[2] === 'br') {
        text += '\n';
      } else if (tm[2] === 'tab') {
        text += ' ';
      }
    }
    const clean = collapseWs(text);
    if (!clean) continue;

    if (isHeading) {
      const levelNum = parseInt(styleVal.replace(/[^0-9]/g, ''), 10) || 2;
      blocks.push({ kind: 'heading', text: clean, level: levelNum });
    } else {
      blocks.push({ kind: 'paragraph', text: clean });
    }
  }

  const tags = keywords
    .flatMap((k) => k.split(/[,;]/))
    .map((s) => s.trim())
    .filter(Boolean);

  return {
    format: 'docx',
    filename,
    blocks,
    rawText: blocks.map((b) => b.text).join('\n\n'),
    detectedMetadata: {
      title: titles[0],
      author: creators[0],
      description: descriptions[0],
      tags,
    },
    ocrRequired: false,
    warnings,
  };
}

// ── PDF Parser (Pure-TS text-layer + FlateDecode + ToUnicode + OCR check) ──

function decodePdfLiteralString(raw: string): string {
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch !== '\\') {
      out += ch;
      continue;
    }
    i++;
    if (i >= raw.length) break;
    const next = raw[i];
    if (next === 'n') out += '\n';
    else if (next === 'r') out += '\r';
    else if (next === 't') out += '\t';
    else if (next === 'b') out += '\b';
    else if (next === 'f') out += '\f';
    else if (next === '\n') {
      // escaped line continuation
    } else if (next === '\r') {
      if (raw[i + 1] === '\n') i++;
    } else if (next >= '0' && next <= '7') {
      let oct = next;
      if (i + 1 < raw.length && raw[i + 1] >= '0' && raw[i + 1] <= '7') oct += raw[++i];
      if (i + 1 < raw.length && raw[i + 1] >= '0' && raw[i + 1] <= '7') oct += raw[++i];
      out += String.fromCharCode(parseInt(oct, 8));
    } else {
      out += next;
    }
  }
  return decodePdfDocEncoding(out);
}

function decodePdfHexString(hex: string, cmap?: Map<number, string>): string {
  const clean = hex.replace(/\s+/g, '');
  const padded = clean.length % 2 === 1 ? `${clean}0` : clean;
  const bytes = new Uint8Array(padded.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(padded.slice(i * 2, i * 2 + 2), 16) || 0;
  }
  // UTF-16BE BOM (0xFE 0xFF)
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    let s = '';
    for (let i = 2; i + 1 < bytes.length; i += 2) {
      s += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
    }
    return s;
  }
  if (cmap && cmap.size > 0) {
    // Try 2-byte codes first if length is even and keys > 255 exist
    let hasWide = false;
    for (const k of cmap.keys()) {
      if (k > 255) {
        hasWide = true;
        break;
      }
    }
    if (hasWide && bytes.length % 2 === 0) {
      let s = '';
      for (let i = 0; i + 1 < bytes.length; i += 2) {
        const code = (bytes[i] << 8) | bytes[i + 1];
        s += cmap.get(code) ?? (code >= 32 && code < 127 ? String.fromCharCode(code) : '');
      }
      if (s.trim().length > 0) return s;
    }
    let s = '';
    for (let i = 0; i < bytes.length; i++) {
      s += cmap.get(bytes[i]) ?? (bytes[i] >= 32 && bytes[i] < 127 ? String.fromCharCode(bytes[i]) : '');
    }
    return s;
  }
  return decodePdfDocEncoding(decodeLatin1(bytes));
}

function decodePdfDocEncoding(s: string): string {
  // Handle common WinAnsi / PDFDocEncoding smart punctuation bytes
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0x91 || c === 0x92) out += "'";
    else if (c === 0x93 || c === 0x94) out += '"';
    else if (c === 0x96) out += '\u2013';
    else if (c === 0x97) out += '\u2014';
    else if (c === 0x85) out += '\u2026';
    else if (c === 0xa0) out += ' ';
    else out += s[i];
  }
  return out;
}

function parseToUnicodeCMap(text: string): Map<number, string> {
  const map = new Map<number, string>();
  const bfcharRe = /beginbfchar([\s\S]*?)endbfchar/g;
  let m: RegExpExecArray | null;
  while ((m = bfcharRe.exec(text)) !== null) {
    const pairRe = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g;
    let pm: RegExpExecArray | null;
    while ((pm = pairRe.exec(m[1])) !== null) {
      const code = parseInt(pm[1], 16);
      map.set(code, hexToUnicodeString(pm[2]));
    }
  }
  const bfrangeRe = /beginbfrange([\s\S]*?)endbfrange/g;
  while ((m = bfrangeRe.exec(text)) !== null) {
    const lineRe = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g;
    let lm: RegExpExecArray | null;
    while ((lm = lineRe.exec(m[1])) !== null) {
      const start = parseInt(lm[1], 16);
      const end = parseInt(lm[2], 16);
      let dst = parseInt(lm[3], 16);
      const count = Math.min(end - start + 1, 512);
      for (let i = 0; i < count; i++) {
        map.set(start + i, safeFromCodePoint(dst + i));
      }
    }
  }
  return map;
}

function hexToUnicodeString(hex: string): string {
  const clean = hex.replace(/\s+/g, '');
  let out = '';
  for (let i = 0; i + 3 < clean.length; i += 4) {
    const cp = parseInt(clean.slice(i, i + 4), 16);
    if (cp > 0) out += String.fromCharCode(cp);
  }
  if (!out && clean.length >= 2) {
    const cp = parseInt(clean, 16);
    if (cp > 0) out = safeFromCodePoint(cp);
  }
  return out;
}

function extractTextFromPdfContentStream(
  content: string,
  cmap: Map<number, string>
): string {
  const lines: string[] = [];
  let curLine = '';
  let inText = false;
  let prevNumeric = 0;
  let i = 0;
  const len = content.length;

  const flushLine = () => {
    const trimmed = curLine.replace(/\s+/g, ' ').trim();
    if (trimmed) lines.push(trimmed);
    curLine = '';
  };

  const readLiteral = (): string => {
    i++; // skip '('
    let depth = 1;
    let buf = '';
    while (i < len && depth > 0) {
      const c = content[i++];
      if (c === '\\' && i < len) {
        buf += c + content[i++];
      } else if (c === '(') {
        depth++;
        buf += c;
      } else if (c === ')') {
        depth--;
        if (depth > 0) buf += c;
      } else {
        buf += c;
      }
    }
    return decodePdfLiteralString(buf);
  };

  const readHex = (): string => {
    i++; // skip '<'
    let hex = '';
    while (i < len && content[i] !== '>') {
      hex += content[i++];
    }
    if (i < len) i++; // skip '>'
    return decodePdfHexString(hex, cmap);
  };

  while (i < len) {
    const ch = content[i];
    if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
      i++;
      continue;
    }
    // PDF comments run to end of line
    if (ch === '%') {
      while (i < len && content[i] !== '\n' && content[i] !== '\r') i++;
      continue;
    }
    if (ch === '(') {
      const txt = readLiteral();
      if (!inText) continue;
      let j = i;
      while (j < len && /\s/.test(content[j])) j++;
      if (content.slice(j, j + 2) === 'Tj') {
        curLine += txt;
        i = j + 2;
      } else if (content[j] === "'" || content[j] === '"') {
        flushLine();
        curLine += txt;
        i = j + 1;
      } else {
        curLine += txt;
      }
      continue;
    }
    if (ch === '<') {
      if (content[i + 1] === '<') {
        i += 2; // dictionary start <<
        continue;
      }
      const txt = readHex();
      if (!inText) continue;
      let j = i;
      while (j < len && /\s/.test(content[j])) j++;
      if (content.slice(j, j + 2) === 'Tj') {
        curLine += txt;
        i = j + 2;
      } else if (content[j] === "'") {
        flushLine();
        curLine += txt;
        i = j + 1;
      } else {
        curLine += txt;
      }
      continue;
    }
    if (ch === '>' && content[i + 1] === '>') {
      i += 2;
      continue;
    }
    if (ch === '[') {
      i++; // skip '['
      let arrText = '';
      while (i < len && content[i] !== ']') {
        const c = content[i];
        if (c === '(') {
          arrText += readLiteral();
        } else if (c === '<' && content[i + 1] !== '<') {
          arrText += readHex();
        } else if ((c >= '0' && c <= '9') || c === '-' || c === '+' || c === '.') {
          let numStr = '';
          while (i < len && /[0-9.+\-]/.test(content[i])) numStr += content[i++];
          const kerning = parseFloat(numStr);
          if (Number.isFinite(kerning) && kerning <= -150 && !arrText.endsWith(' ')) {
            arrText += ' ';
          }
        } else {
          i++;
        }
      }
      if (i < len && content[i] === ']') i++;
      if (inText) curLine += arrText;
      continue;
    }
    if (ch === '/') {
      // PDF Name object (e.g. /F1)
      i++;
      while (i < len && !/[\s()<>[\]\/%]/.test(content[i])) i++;
      continue;
    }

    // Read keyword / operator / number token
    let tok = '';
    while (i < len && !/[\s()<>[\]\/%]/.test(content[i])) {
      tok += content[i++];
    }
    if (!tok) {
      i++;
      continue;
    }

    if (tok === 'BT') {
      inText = true;
      prevNumeric = 0;
      continue;
    }
    if (tok === 'ET') {
      if (inText) flushLine();
      inText = false;
      continue;
    }
    if (!inText) continue;

    const num = parseFloat(tok);
    if (Number.isFinite(num) && /^-?\d/.test(tok)) {
      prevNumeric = num;
    } else if (tok === 'T*' || tok === 'TD' || tok === 'Td') {
      if (tok === 'T*' || Math.abs(prevNumeric) > 4) {
        flushLine();
        if (Math.abs(prevNumeric) > 22) lines.push('');
      } else if (curLine && !curLine.endsWith(' ')) {
        curLine += ' ';
      }
    } else if (tok === 'Tm') {
      flushLine();
    }
  }

  flushLine();
  return lines.join('\n');
}

export function parsePdfBytes(bytes: Uint8Array, filename: string): RawDocumentExtraction {
  const warnings: string[] = [];
  const rawLatin1 = decodeLatin1(bytes);

  if (!rawLatin1.startsWith('%PDF-')) {
    throw new Error('File does not appear to be a valid PDF (%PDF- header missing).');
  }

  // Extract metadata from /Info dictionary and XMP XML if present
  const detectedMetadata: DetectedDocumentMetadata = {};
  const infoTitle = /\/Title\s*(?:\(([^)]+)\)|<([0-9a-fA-F]+)>)/.exec(rawLatin1);
  if (infoTitle) {
    detectedMetadata.title = collapseWs(
      infoTitle[1] ? decodePdfLiteralString(infoTitle[1]) : decodePdfHexString(infoTitle[2])
    );
  }
  const infoAuthor = /\/Author\s*(?:\(([^)]+)\)|<([0-9a-fA-F]+)>)/.exec(rawLatin1);
  if (infoAuthor) {
    detectedMetadata.author = collapseWs(
      infoAuthor[1] ? decodePdfLiteralString(infoAuthor[1]) : decodePdfHexString(infoAuthor[2])
    );
  }
  const infoSubject = /\/Subject\s*(?:\(([^)]+)\)|<([0-9a-fA-F]+)>)/.exec(rawLatin1);
  if (infoSubject) {
    detectedMetadata.description = collapseWs(
      infoSubject[1] ? decodePdfLiteralString(infoSubject[1]) : decodePdfHexString(infoSubject[2])
    );
  }
  // XMP fallback
  if (!detectedMetadata.title) {
    const xmpTitles = extractXmlTagText(rawLatin1, 'title');
    if (xmpTitles[0]) detectedMetadata.title = xmpTitles[0];
  }
  if (!detectedMetadata.author) {
    const xmpCreators = extractXmlTagText(rawLatin1, 'creator');
    if (xmpCreators[0]) detectedMetadata.author = xmpCreators[0];
  }

  // Count pages roughly
  const pageMatches = rawLatin1.match(/\/Type\s*\/Page\b(?!s)/g);
  const pageCount = pageMatches ? pageMatches.length : 0;
  if (pageCount > 0) detectedMetadata.pageCount = pageCount;

  // Scan all streams: collect ToUnicode CMaps first, then text streams
  const mergedCmap = new Map<number, string>();
  const decodedStreams: string[] = [];

  let cursor = 0;
  const maxStreams = 8000;
  let streamCount = 0;

  while (cursor < rawLatin1.length && streamCount < maxStreams) {
    const sIdx = rawLatin1.indexOf('stream', cursor);
    if (sIdx < 0) break;

    // Look back up to 512 bytes for the object dictionary header
    const dictStart = Math.max(0, sIdx - 512);
    const dictHeader = rawLatin1.slice(dictStart, sIdx);

    // Verify "stream" is followed by \r\n or \n
    let dataStart = sIdx + 6;
    if (rawLatin1[dataStart] === '\r' && rawLatin1[dataStart + 1] === '\n') {
      dataStart += 2;
    } else if (rawLatin1[dataStart] === '\n') {
      dataStart += 1;
    } else {
      cursor = sIdx + 6;
      continue;
    }

    const endIdx = rawLatin1.indexOf('endstream', dataStart);
    if (endIdx < 0) break;
    cursor = endIdx + 9;
    streamCount++;

    // Skip obvious binary image/font/XRef streams quickly
    if (
      /\/Subtype\s*\/Image\b/.test(dictHeader) ||
      /\/DCTDecode\b|\/JPXDecode\b|\/CCITTFaxDecode\b/.test(dictHeader) ||
      /\/Type\s*\/XRef\b/.test(dictHeader)
    ) {
      continue;
    }

    let endData = endIdx;
    if (endData > dataStart && bytes[endData - 1] === 0x0a) endData--;
    if (endData > dataStart && bytes[endData - 1] === 0x0d) endData--;
    const rawSlice = bytes.subarray(dataStart, endData);

    let streamText = '';
    if (/\/FlateDecode\b/.test(dictHeader)) {
      try {
        const inflated = inflateZlib(rawSlice);
        streamText = decodeLatin1(inflated);
      } catch {
        continue;
      }
    } else if (!/\/Filter\b/.test(dictHeader)) {
      streamText = decodeLatin1(rawSlice);
    } else {
      continue;
    }

    if (streamText.includes('begincmap') || streamText.includes('beginbfchar')) {
      const cmap = parseToUnicodeCMap(streamText);
      for (const [k, v] of cmap.entries()) mergedCmap.set(k, v);
    } else if (streamText.includes('BT') && (streamText.includes('Tj') || streamText.includes('TJ'))) {
      decodedStreams.push(streamText);
    }
  }

  const pageTexts: string[] = [];
  for (const st of decodedStreams) {
    const extracted = extractTextFromPdfContentStream(st, mergedCmap).trim();
    if (extracted) pageTexts.push(extracted);
  }

  const rawText = pageTexts.join('\n\n');
  const wordCount = rawText.split(/\s+/).filter(Boolean).length;

  // Detect scanned / image-only PDFs honestly (chunking-spec §7.1, §7.4)
  const ocrRequired =
    wordCount < 25 || (pageCount >= 5 && wordCount / Math.max(1, pageCount) < 12);

  if (ocrRequired) {
    warnings.push(
      'Very little selectable text was found in this PDF. It appears to be a scanned/image PDF — run OCR on it first (or paste the text) before embedding.'
    );
  } else if (pageCount > 0 && pageTexts.length === 0) {
    warnings.push('No readable PDF text streams were decoded.');
  }

  const blocks = inferBlocksFromPlainText(rawText);

  return {
    format: 'pdf',
    filename,
    blocks,
    rawText,
    detectedMetadata,
    ocrRequired,
    warnings,
  };
}

// ── Markdown, HTML, & Plain Text Parsers ────────────────────────────────────

export function parseHtmlBytes(bytes: Uint8Array, filename: string): RawDocumentExtraction {
  const html = decodeUtf8(bytes);
  const parsed = extractHtmlBlocks(html);
  return {
    format: 'html',
    filename,
    blocks: parsed.blocks,
    rawText: parsed.blocks.map((b) => b.text).join('\n\n'),
    detectedMetadata: {
      title: parsed.title,
      author: parsed.author,
    },
    ocrRequired: false,
    warnings: [],
  };
}

export function parseMarkdownText(text: string, filename: string): RawDocumentExtraction {
  const detectedMetadata: DetectedDocumentMetadata = {};
  let body = text.replace(/\r\n?/g, '\n');

  // Parse optional YAML frontmatter (`--- ... ---`)
  if (body.startsWith('---\n')) {
    const endIdx = body.indexOf('\n---', 4);
    if (endIdx > 0) {
      const fm = body.slice(4, endIdx);
      body = body.slice(endIdx + 4).trimStart();
      for (const line of fm.split('\n')) {
        const m = /^([a-zA-Z_-]+)\s*:\s*(.+)$/.exec(line.trim());
        if (!m) continue;
        const key = m[1].toLowerCase();
        const val = m[2].replace(/^['"]|['"]$/g, '').trim();
        if (key === 'title') detectedMetadata.title = val;
        else if (key === 'author') detectedMetadata.author = val;
        else if (key === 'era' || key === 'date') detectedMetadata.era = val;
        else if (key === 'description' || key === 'notes') detectedMetadata.description = val;
        else if (key === 'tags') {
          detectedMetadata.tags = val
            .replace(/^\[|\]$/g, '')
            .split(',')
            .map((t) => t.replace(/^['"]|['"]$/g, '').trim())
            .filter(Boolean);
        }
      }
    }
  }

  const blocks: ExtractedBlock[] = [];
  const paragraphs = body.split(/\n{2,}/);
  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;
    const hMatch = /^(#{1,6})\s+(.+)$/.exec(trimmed);
    if (hMatch) {
      const headingText = collapseWs(hMatch[2].replace(/#+\s*$/, ''));
      if (!detectedMetadata.title && hMatch[1].length === 1) {
        detectedMetadata.title = headingText;
      }
      blocks.push({ kind: 'heading', text: headingText, level: hMatch[1].length });
      continue;
    }
    // Strip light markdown inline formatting
    const cleaned = trimmed
      .replace(/^>\s?/gm, '')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/[*_`~]{1,3}([^*_`~]+)[*_`~]{1,3}/g, '$1');

    const lines = cleaned.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length >= 3 && lines.every((l) => l.length <= 72)) {
      blocks.push({ kind: 'poetry', text: lines.join('\n') });
    } else {
      blocks.push({ kind: 'paragraph', text: collapseWs(lines.join(' ')) });
    }
  }

  return {
    format: 'md',
    filename,
    blocks,
    rawText: body,
    detectedMetadata,
    ocrRequired: false,
    warnings: [],
  };
}

export function parsePlainText(text: string, filename: string): RawDocumentExtraction {
  const normalized = text.replace(/\r\n?/g, '\n');
  const blocks = inferBlocksFromPlainText(normalized);
  return {
    format: 'txt',
    filename,
    blocks,
    rawText: normalized,
    detectedMetadata: {},
    ocrRequired: false,
    warnings: [],
  };
}

const HEADING_PREFIX_RE =
  /^(?:CHAPTER|BOOK|PART|SECTION|SERMON|HOMILY|LETTER|EPISTLE|TRACTATE|DISCOURSE|MEDITATION|PSALM|CANTICLE|PROLOGUE|EPILOGUE|PREFACE|INTRODUCTION)\b/i;

function isLikelyPlainHeading(line: string): boolean {
  const t = line.trim();
  if (!t || t.length > 95) return false;
  if (/[.?!,;]$/.test(t) && !/^CHAPTER\b/i.test(t)) return false;
  if (HEADING_PREFIX_RE.test(t)) return true;
  if (/^[IVXLCDM]+\.\s+[A-Z]/.test(t)) return true;
  // Short ALL-CAPS heading (>= 4 letters, mostly uppercase)
  const letters = t.replace(/[^A-Za-z]/g, '');
  if (letters.length >= 4 && letters.length <= 60 && letters === letters.toUpperCase()) {
    return true;
  }
  return false;
}

function inferBlocksFromPlainText(text: string): ExtractedBlock[] {
  const normalized = text.replace(/\r\n?/g, '\n').trim();
  if (!normalized) return [];

  // Re-join hyphenated line wraps (`love-\nly` -> `lovely`)
  const dehyphenated = normalized.replace(/([a-zA-Z])-\n([a-z])/g, '$1$2');

  let chunks = dehyphenated.split(/\n{2,}/);
  // Flat single-newline PDF/TXT fallback: split on heading lines or sentence-ended short lines
  if (chunks.length <= 2 && dehyphenated.length > 1500) {
    const lines = dehyphenated.split('\n');
    const rebuilt: string[] = [];
    let buf: string[] = [];
    for (const line of lines) {
      const t = line.trim();
      if (!t) {
        if (buf.length) {
          rebuilt.push(buf.join(' '));
          buf = [];
        }
        continue;
      }
      if (isLikelyPlainHeading(t)) {
        if (buf.length) {
          rebuilt.push(buf.join(' '));
          buf = [];
        }
        rebuilt.push(t);
        continue;
      }
      buf.push(t);
      if (/[.?!]["”’']?$/.test(t) && t.length < 58 && buf.join(' ').length > 260) {
        rebuilt.push(buf.join(' '));
        buf = [];
      }
    }
    if (buf.length) rebuilt.push(buf.join(' '));
    chunks = rebuilt;
  }

  const blocks: ExtractedBlock[] = [];
  for (const chunk of chunks) {
    const trimmed = chunk.trim();
    if (!trimmed) continue;
    const lines = trimmed.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length === 1 && isLikelyPlainHeading(lines[0])) {
      blocks.push({ kind: 'heading', text: lines[0], level: 2 });
    } else if (lines.length >= 3 && lines.every((l) => l.length <= 72)) {
      blocks.push({ kind: 'poetry', text: lines.join('\n') });
    } else {
      blocks.push({ kind: 'paragraph', text: collapseWs(lines.join(' ')) });
    }
  }
  return blocks;
}

function inferEraFromDate(dateStr: string): string | undefined {
  const m = /\b(\d{3,4})\b/.exec(dateStr);
  if (!m) return undefined;
  const year = parseInt(m[1], 10);
  if (year < 800) return 'Patristic';
  if (year < 1500) return 'Medieval';
  if (year < 1700) return 'Reformation';
  if (year < 1960) return 'Modern';
  return 'Contemporary';
}

// ── Format Detection & Unified Dispatcher ───────────────────────────────────

export const SUPPORTED_PERSONAL_EXTENSIONS = [
  '.epub',
  '.pdf',
  '.docx',
  '.html',
  '.htm',
  '.md',
  '.markdown',
  '.txt',
] as const;

export function detectPersonalFormat(filename: string): PersonalSourceFormat | null {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.epub')) return 'epub';
  if (lower.endsWith('.pdf')) return 'pdf';
  if (lower.endsWith('.docx')) return 'docx';
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'html';
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'md';
  if (lower.endsWith('.txt')) return 'txt';
  return null;
}

export function extractDocumentFromBytes(
  bytes: Uint8Array,
  filename: string,
  explicitFormat?: PersonalSourceFormat
): RawDocumentExtraction {
  const format = explicitFormat ?? detectPersonalFormat(filename);
  if (!format) {
    throw new Error(
      `Unsupported file type for "${filename}". Supported: EPUB, PDF, DOCX, HTML, Markdown, TXT.`
    );
  }
  switch (format) {
    case 'epub':
      return parseEpubBytes(bytes, filename);
    case 'pdf':
      return parsePdfBytes(bytes, filename);
    case 'docx':
      return parseDocxBytes(bytes, filename);
    case 'html':
      return parseHtmlBytes(bytes, filename);
    case 'md':
      return parseMarkdownText(decodeUtf8(bytes), filename);
    case 'txt':
      return parsePlainText(decodeUtf8(bytes), filename);
  }
}
