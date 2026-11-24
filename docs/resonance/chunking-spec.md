# Resonance — Text & Chunking Specification

Status: **approved by Michael, 2026-11-23.** This is the standing law for how
every text that enters the Resonance library — the bundled Bible, the author
packs, and users' own imported files — is cleaned, structured, chunked, and
presented. It exists because the EmbeddingGemma 2 bake-off (50 journal
entries, results PDF v1) showed the model is sound and the pipeline around it
was the weak link: single verses lost every comparison to prose chunks,
chunks began and ended mid-thought, OCR scars surfaced in results, and a few
"hub" passages scored high against everything.

## 1. Principles

1. **Units first, chunks second.** Every work is stored once as a sequence of
   *units* — the smallest pieces the author wrote as pieces (a paragraph, a
   stanza, a verse group). Chunks are a derived, versioned assembly of units.
   Re-chunking must never require re-cleaning.
2. **One format for everything.** Bundled packs and personal imports land in
   the identical unit schema (§2), so one chunker, one embedder, and one
   query path serve all of it.
3. **Quarantine, never delete.** Anything a stage rejects is logged with its
   reason and kept out of the embed pool, not erased.
4. **Display text is sacred.** What the user reads is the cleaned text
   itself — never a summary, never model output (see `principles.md`).

## 2. Canonical unit format

One JSONL file per work; one JSON object per unit:

```json
{
  "work_id": "john-of-the-cross-dark-night",
  "author": "John of the Cross",
  "source": "ccel | ia | gutenberg | additions | rescue | bible | personal",
  "division": "Book II, Chapter 4",
  "kind": "prose | poetry | scripture",
  "seq": 412,
  "text": "…the cleaned unit text…",
  "words": 87
}
```

- `division` is the deepest heading in force at that point (chapter, sermon,
  letter, section), or `null` when the source gives no structure.
- `seq` is the unit's order in the work. Units are stable: a unit's identity
  is `(work_id, seq)` forever.
- Personal imports use `source: "personal"` and `work_id: "personal:<slug>"`.

## 3. Cleaning rules (text → units)

Applied in order; every change is deterministic and logged in aggregate.

1. **Furniture removal.** Page numbers, running heads, catchwords, footnote
   markers, tables of contents, and title-page debris are stripped. A line
   that is only a number, or mostly digits/punctuation, is not a unit.
2. **De-hyphenation.** A word split across a line break (`suffer-` /
   `ing`) is rejoined.
3. **Long-s repair.** Pre-1800 typography used ſ, which OCR reads as `f`
   ("fhould" for "should", "fuch" for "such"). A token that is not a known
   word is replaced by its f→s variant **only** when that variant is a
   common word in the corpus vocabulary and the original is rare. The
   vocabulary is built from the corpus itself; no external dictionary.
4. **Unit splitting at authorial boundaries.** Paragraphs (blank-line
   breaks), stanza breaks, and letter salutations end units. A paragraph
   shorter than 12 words merges forward into the next unit, except headings.
5. **Headings become divisions, not units.** A short line with no terminal
   punctuation that is title-case, all-caps, or opens with CHAPTER / BOOK /
   PART / SERMON / LETTER / PSALM / SECTION sets the current `division`.
6. **Poetry detection.** A block of ≥4 lines averaging <8 words per line is
   `kind: "poetry"` and keeps its line breaks.
7. **Quality gates.** A unit is quarantined (logged, not embedded) when its
   symbol ratio exceeds 0.05 or its known-word ratio falls below 0.6 after
   repair — the signature of unrecoverable OCR soup.

## 4. Scripture units

Verses are too small to embed fairly alone (≈25 words vs ≈170 for prose).
Scripture units are **verse groups**:

- 3–5 consecutive verses within one chapter; a trailing remainder of 1–2
  verses merges into the previous group (a group may reach 7).
- A psalm is grouped the same way (long psalms such as 119 yield several
  groups); Proverbs group by verse the same as any chapter.
- The unit's reference is the range, e.g. `Psalm 42:1-3`; `kind` is
  `"scripture"`; `work_id` is the translation id (`web`).
- Group size targets ≈60–110 words — close enough to prose-chunk weight
  that Scripture competes fairly.

## 5. Chunk assembly (units → chunks, versioned)

- **Prose:** accumulate consecutive units to **120–200 words**. A single
  unit over 220 words splits at sentence boundaries into ≈150-word pieces.
  A final tail under 40 words merges into the previous chunk. No chunk
  begins or ends mid-sentence.
- **Scripture:** one verse-group unit per chunk.
- **Poetry:** one stanza-unit per chunk; adjacent tiny stanzas merge to
  ≥40 words.
- Every chunk carries `work_id`, `source`, `division`, `kind`, and the
  `seq` range it spans. Bible chunks carry their reference range as
  `chunk_id`.
- The chunk set is versioned (`chunks_v3` is the first under this spec);
  bumping assembly rules produces a new version without touching units.

## 6. Retrieval, reranking & presentation guards (ruled 2026-11-24)

**Adopted local-only stack (Apache 2.0, quantized INT8 ONNX, zero generated prose):**

- **Retriever:** `onnx-community/voyage-4-nano-ONNX` (`onnx/model_quantized.onnx`,
  346M total / 180M backbone, ~411 MB) with `512d` MRL truncation and per-vector
  symmetric **`int8` scalar quantization** (~54.2 MB for the full 111k corpus;
  `0.9952` top-50 overlap vs. float32). Document embedding input prepends a
  structural header `Represent the document for retrieval: [{title}]\n{text}`
  (display text stays untouched); query input prepends
  `Represent the query for retrieving supporting documents: {journal}`.
- **Decider / Reranker:** `n24q02m/Qwen3-Reranker-0.6B-ONNX`
  (`onnx/model_yesno_quantized.onnx`, 572 MB INT8, stripped 2-dim yes/no output)
  evaluating each `(instruction, journal, candidate)` pair under Resonance's
  posture/direction rubric and emitting calibrated `P(yes)` scores.

Query-time ranking applies, in order:

1. **Stratified per-library retrieval:** fetch **top-20 Scripture + top-30
   Witnesses** (+ up to top-10 Past Self / personal imports) independently so
   shorter ~75-word Scripture verse groups are never crowded out by ~160-word
   prose chunks.
2. **Instruction-aware pointwise reranking:** score the candidate pool with
   `Qwen3-Reranker-0.6B` (INT8 ONNX) to judge the writer's actual situation,
   posture, and spiritual direction rather than surface keyword overlap.
3. **Per-library z-score fusion (`scripts/bakeoff/fuse_perlib.py`):** normalize
   dense cosine scores within each library separately (removing register/length
   bias) and blend with z-normalized reranker logits (`α = 0.60` dense / `0.40`
   reranker at 512d; `α = 0.70` at 1024d).
4. **Calibrated silence:** apply a per-library confidence floor on
   `Qwen3-Reranker-0.6B`'s `P(yes)` (recommended starting floor `τ = 0.05–0.08`);
   a library with no candidate clearing its floor renders nothing rather than a
   forced weak pick.
5. **Presentation guards:** at most **2 passages per work** (and prefer at most
   1 per Bible book/chapter), plus **near-duplicate demotion**. With stratified
   per-library retrieval + fusion, Scripture lands naturally in top-5 on 50/50
   golden entries; the legacy blunt Scripture slot is retired (at most a tight
   `Δ = 0.05` fallback margin if ever enabled).

## 7. Personal library imports

A user's own files enter through the same door: **extract → clean (§3) →
units (§2) → chunks (§5) → embed on-device into the same vector space.**
Files never leave the device.

### 7.1 What we accept, and how

| Format | Extraction |
|---|---|
| EPUB | ZIP container → OPF spine order → per-chapter XHTML text. Headings and paragraphs map directly to divisions and units — the best-case format. |
| PDF (text-based) | Embedded text layer, in page order; paragraphs re-inferred from line breaks and spacing. Running heads/page numbers removed by §3.1. |
| PDF (scanned) | No text layer → on-device OCR (ML Kit). Quality varies with the scan; the §3.7 gates quarantine what OCR ruins rather than embedding garbage. |
| TXT / Markdown | Paragraphs from blank lines; `#` headings become divisions (Markdown). |
| HTML | Block elements become units; headings become divisions. |
| DOCX | Paragraph styles: Heading styles become divisions, body styles become units. |

### 7.2 Recommended structure (what we tell users)

Imports work best when the file has real structure. In the app, the import
screen says, in plain words:

- **EPUB is the friendliest format** — chapters and paragraphs carry over.
- A PDF exported from a document (not a scan of pages) imports well;
  scanned books depend on scan quality.
- Headings help: a chapter title on its own line becomes the passage's
  location label.
- One book per file imports more cleanly than a giant combined file.

### 7.3 Messy-file fallbacks

When structure is missing, we do our best rather than refusing the file:
heading detection (§3.5) recovers divisions from typography; paragraph
inference rebuilds units from line-break patterns in flat text; a file with
no recoverable structure at all becomes one work chunked by §5's
sentence-splitting path. The user is shown the result — work title, unit
and chunk counts — and can remove it; nothing imports silently.

### 7.4 On-device honesty

Extraction and embedding happen on the phone. EPUB/TXT/HTML/DOCX are cheap.
Large PDFs are the heavy case: extraction is paged and resumable, and a
scanned book's OCR is offered as an explicit, time-estimated step — never a
silent background surprise. The reference implementation in
`scripts/corpus/import_personal.py` defines the expected unit output for
each format; the app implementation must match it.

## 8. Provenance

- Bake-off v1 findings that motivated this spec: Scripture in top 5 for
  only 5/50 entries despite being ≈55% of the pool; hub passages; fragment
  and OCR-scar chunks in results.
- The bake-off re-run under this spec (units → chunks_v3 → §6 guards) is
  the acceptance test for the pipeline; its PDF is the comparison record.
