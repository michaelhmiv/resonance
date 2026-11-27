/**
 * Scanned PDF OCR Service via OpenRouter Vision.
 *
 * Unlocks `ocr_required = 1` PDFs imported into the Personal Library by sending
 * the local PDF file to the user's configured OpenRouter Vision model, splitting
 * the clean verbatim transcription into readable passages, and feeding the work
 * straight into Resonance's auto-embedding queue.
 */

import * as FileSystem from 'expo-file-system/legacy';
import { estimateTokenCostUsd } from '@resonance/core';
import { getDatabase } from '../db/database';
import { getKnownModelPricing, ocrPdfViaOpenRouter } from './openrouterClient';
import { useOpenRouterStore } from './openrouterStore';

/** Max PDF size supported cleanly via mobile base64 JSON upload (12 MB). */
export const MAX_PDF_OCR_BYTES = 12 * 1024 * 1024;

export interface PdfOcrEstimate {
  byteSize: number;
  estimatedPages: number;
  estimatedTokens: number;
  estimatedCostUsd: number;
  modelId: string;
  tooLarge: boolean;
}

export function estimatePdfOcrCost(byteSize: number): PdfOcrEstimate {
  const modelId = useOpenRouterStore.getState().visionModel;
  const pricing = getKnownModelPricing(modelId);
  const safeBytes = Math.max(0, byteSize);
  const estimatedPages = Math.max(1, Math.round(safeBytes / 180_000));
  const promptTokens = estimatedPages * 1200;
  const completionTokens = estimatedPages * 450;
  const estimatedCostUsd =
    estimateTokenCostUsd(promptTokens, pricing.prompt) +
    estimateTokenCostUsd(completionTokens, pricing.completion);
  return {
    byteSize: safeBytes,
    estimatedPages,
    estimatedTokens: promptTokens + completionTokens,
    estimatedCostUsd,
    modelId,
    tooLarge: safeBytes > MAX_PDF_OCR_BYTES,
  };
}

function splitTranscribedTextIntoChunks(rawText: string): string[] {
  const blocks = rawText
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((b) => b.replace(/\s+/g, ' ').trim())
    .filter((b) => b.length >= 20);

  const chunks: string[] = [];
  let buffer = '';
  for (const block of blocks) {
    if (buffer.length + block.length + 2 <= 900) {
      buffer = buffer ? `${buffer}\n\n${block}` : block;
    } else {
      if (buffer) chunks.push(buffer);
      buffer = block.length > 1400 ? block.slice(0, 1400) : block;
    }
  }
  if (buffer) chunks.push(buffer);
  return chunks;
}

/**
 * Transcribe a scanned Personal Library PDF via OpenRouter, replace its
 * passages in SQLite, clear `ocr_required`, and queue it for embedding.
 */
export async function transcribeScannedPersonalPdf(bookId: string): Promise<{
  chunkCount: number;
  modelUsed: string;
}> {
  const db = getDatabase();
  if (!db) throw new Error('Database not ready.');

  const row = await db.getFirstAsync<{
    book_id: string;
    file_name: string;
    file_uri: string;
    file_size_bytes: number;
  }>(
    `SELECT book_id, file_name, file_uri, file_size_bytes
     FROM personal_books WHERE book_id = ?;`,
    [bookId]
  );

  if (!row) throw new Error('Personal library book not found.');

  const info = await FileSystem.getInfoAsync(row.file_uri);
  if (!info.exists) {
    throw new Error('Original PDF file is no longer accessible on device.');
  }
  const actualSize =
    'size' in info && typeof info.size === 'number'
      ? info.size
      : row.file_size_bytes;

  if (actualSize > MAX_PDF_OCR_BYTES) {
    throw new Error(
      `PDF is ${(actualSize / (1024 * 1024)).toFixed(1)} MB (limit is 12 MB for mobile OCR). Split or compress the PDF first.`
    );
  }

  const pdfBase64 = await FileSystem.readAsStringAsync(row.file_uri, {
    encoding: FileSystem.EncodingType.Base64,
  });

  const { text, modelUsed } = await ocrPdfViaOpenRouter({
    pdfBase64,
    filename: row.file_name,
  });

  const chunks = splitTranscribedTextIntoChunks(text);
  if (chunks.length === 0) {
    throw new Error('OpenRouter OCR returned no readable text for this PDF.');
  }

  // Replace existing passages and mark ready for embedding
  await db.runAsync(`DELETE FROM passage_vectors WHERE book_id = ?;`, [bookId]);
  await db.runAsync(`DELETE FROM passages WHERE book_id = ?;`, [bookId]);

  for (let i = 0; i < chunks.length; i++) {
    await db.runAsync(
      `INSERT INTO passages
         (book_id, chapter, verse_start, verse_end, text, translation, chunk_id, division)
       VALUES (?, ?, ?, ?, ?, NULL, ?, ?);`,
      [bookId, 1, i + 1, i + 1, chunks[i], `ocr_${i + 1}`, 'OCR Transcription']
    );
  }

  await db.runAsync(
    `UPDATE personal_books
     SET ocr_required = 0,
         total_chunks = ?,
         embedded_chunks = 0,
         embedding_status = 'pending',
         embedding_error = NULL,
         updated_at = ?
     WHERE book_id = ?;`,
    [chunks.length, Date.now(), bookId]
  );

  return { chunkCount: chunks.length, modelUsed };
}
