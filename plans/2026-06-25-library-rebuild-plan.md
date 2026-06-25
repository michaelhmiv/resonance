# Resonance Library — Rebuild Plan

**Status:** Draft, awaiting greenlight
**Created:** 2026-06-25
**Trigger:** `plans/2026-06-25-library-corpus-audit.md` (full audit of the seeded library)
**Approach:** Per-work source selection with strict import validation. Ship the cleanest possible version of every work in the canonical corpus.

## North star

**One static JSON per work, validated at build time, never serving an HTML error page or an OCR-damaged preamble again.** The library is the visible face of the corpus. It must be right.

## Architecture decisions (already made)

| Decision | Choice | Why |
|---|---|---|
| Source selection | **Per-work, scored** | User's direction: file quality > source prestige |
| Primary source | **CCEL `cache/*.txt`** (~80% of works) | Verified clean text/plain, proper chapters, no preamble, public domain |
| Backup source | **New Advent `fathers/NNNN.htm`** | When CCEL doesn't have a work; full NPNF/ANF for patristic |
| Long-form works (Reformation) | **PRDL** (when probed) + Gutenberg fallback | Best for Luther, Calvin, Owen, Baxter, Edwards, Wesley |
| Poems + short works | **Wikisource** | Clean, volunteer-cleansed, no boilerplate |
| High-quality modern editions | **Standard Ebooks** (manual fetch via Playwright) | For works that exist on SE; not bulk-friendly so use sparingly |
| Last resort | **Internet Archive raw** (with full validation) | The source of the 404/401 — only use when nothing else has it |
| Storage shape | **Still static JSON in apps/web/data/seeded_library/** for now | Move to Supabase in a follow-up — out of scope here |
| Book IDs | **Stable string slugs** (`anselm-cur-deus-homo`, `pg-1000`) | Replace the sequential `voice_100000` IDs |
| Source attribution | **Every work has a `source_attribution.json`** alongside | URL, fetch date, license, translator, source type, validation results |
| **Package structure** | **Multiple `package_id`s by era/tradition** | User direction: better discoverability. Group as: `patristic`, `medieval_devotional`, `catholic_reform`, `protestant_reform`, `protestant_devotional`, `anglican_devotional`, `poetry_hymns`, `philosophical_spiritual`, `modern_saints` (pre-1928) |

## New import pipeline (the heart of this plan)

A new Python module `scripts/library/ingest.py` (and friends) replaces the ad-hoc download + manual `voice_passages.json` build. It does:

1. **Per-work manifest** at `scripts/library/manifest.json`. Each entry has:
   - `book_id` (stable string slug)
   - `title`, `author`, `era`, `work`
   - `package_id` (default `seeded`; future packages for `church_fathers`, `reformers`, etc.)
   - `candidate_sources[]` — ordered list of source URLs to try, with per-source hints
   - `chunk_strategy` — how to split the work into passages (chapter, paragraph, fixed-size, etc.)
   - `min_passages` (sanity floor)

2. **Fetch + validate** each candidate:
   ```python
   def fetch_and_validate(url: str) -> ValidatedText:
       resp = requests.get(url, timeout=90, headers={'User-Agent': 'Resonance/2.0'})
       resp.raise_for_status()
       ct = resp.headers.get('Content-Type', '')
       if 'text/html' in ct and not url.endswith('.html'):
           raise SourceError('Got HTML when text expected — likely a redirect or 404 page')
       if 'text/html' in ct:
           text = html_to_text(resp.text)
       elif 'epub' in ct or url.endswith('.epub'):
           text = extract_epub_text(resp.content)
       else:
           text = resp.text
       return ValidatedText(
           text=text,
           content_type=ct,
           size=len(text),
           source_url=url,
           fetched_at=datetime.utcnow().isoformat(),
       )
   ```

3. **Quality gate** on the validated text:
   - Must not be empty
   - Must not start with `<html` / `<!DOCTYPE` (the broken-book signature)
   - Must not contain OCR substitution signatures (e.g. ratio of `Googlc` / `prcscrvod` / `bcforc` > 1 in 5KB)
   - Must not match known preamble signatures (Google Books, IA, PG boilerplate in first 2KB)
   - Must be ≥ `min_passages * min_passage_length` (e.g. ≥ 50 * 100 chars = 5KB minimum for a real book)
   - For translations: must mention the translator's name (or "anonymous") in the first 5KB (PG/CCEL do; broken IA scans don't)

4. **Pick highest-scoring candidate**, write to `corpus/staging/<package_id>/<book_id>.txt`, write `source_attribution.json` next to it.

5. **Chunk** the validated text using the strategy in the manifest. Chapter-aware where possible (CCEL uses `Chapter N` markers; New Advent uses `Chapter N.`; PG uses `CHAPTER N`).

6. **Emit** the per-work `passages.json` and a top-level `voice_books.json` + `voice_passages.json` for the API routes to serve.

7. **Lint** the final output:
   - No book has < 50 passages (except genuine short works like poems)
   - No book's first 3 passages match preamble signatures
   - No book contains the HTML error signatures in any passage
   - All book IDs are unique
   - All passage IDs are unique and monotonic per book

8. **Diff** the new output against what's currently in `apps/web/data/seeded_library/`. Print a human-readable report of what's added, removed, replaced, and unchanged. **No silent overwrites** — the operator must approve.

### Reuse existing scaffolding

- `scripts/stage_resonance_corpus.py` has useful download primitives; pull them out and add the validation step.
- `corpus/church_fathers_complete.txt` (87MB) is already on disk and has a `2026-06-23-church-fathers-split-manifest.md` mapping sections to authors. Add a split-executor that uses the manifest to write per-work files, then route those through the new ingest.
- `corpus/saints/*.txt` already has 18 files for the existing 18 books. Most of these can be *replaced* with better sources (CCEL for the patristic ones) but a few (Francis de Sales, Teresa, Bonaventure) are already fine.

## Target corpus — what gets built

This is the first-pass "ideal" library. Authors come from `AUTHOR_LIBRARY.md`. Pick the best free source for each work; default to CCEL.

### Phase 1 — Replace the broken 18 (the 12 defective + 6 clean, all upgraded)

For each of the 18 existing books:
- Re-fetch from CCEL (if available) or New Advent or PRDL
- Validate, chunk, replace
- ~30 min per book if CCEL has it; ~2 hours per book if New Advent requires HTML strip

Books to fix in priority order (worst quality first):
1. **Bunyan, Pilgrim's Progress** — broken. CCEL has it. Replace.
2. **John of the Cross, Dark Night** — broken. CCEL has it. Replace.
3. **Anselm, Cur Deus Homo** — OCR-damaged preamble. CCEL has the *complete* Anselm (Proslogion, Monologion, etc.); for Cur Deus Homo specifically, New Advent or PG.
4. **Pascal, Pensées** — Google Books preamble. CCEL/PG. Reject the current IA source.
5. **Teresa of Ávila, Interior Castle** — gibbon TOC contamination. CCEL has it. Replace.
6. **Catherine of Siena, Letters** — IA preamble. CCEL or NA.
7. **Bernard, Life and Works + Sermons on the Canticle** — IA preamble. CCEL has both. Replace.
8. **Francis de Sales, Practical Piety** — header garble. CCEL has *Introduction to the Devout Life* (better-known); Practical Piety is the same content under a different title.
9. **Julian of Norwich, Revelations** — sliced header. CCEL has the modern spelling-clean version. Replace.
10. **Kierkegaard, "Hauptschriften"** — fake title. Split into real works: *Fear and Trembling*, *Sickness Unto Death*, *Practice in Christianity*. CCEL has all three.
11. **Thomas à Kempis, Imitation** — clean, but prologue is attribution discussion. CCEL has the classic translation. Replace.
12. **Bonaventure, Breviloquium** — clean. Keep unless CCEL has a better edition (it does; replace).
13. **Augustine, Confessions** — clean (Pusey translation). CCEL has Outler translation (more modern). Replace for the better translation.
14. **Aquinas, Summa** — clean. Keep the current Fathers of the English Dominican Province translation unless CCEL has a more recent critical edition.
15. **Brother Lawrence, Practice of the Presence of God** — clean. Keep.
16. **Cloud of Unknowing** — clean. Keep.

### Phase 2 — Add the missing 30+ patristic works (from the 87MB church_fathers_complete.txt + CCEL)

For each author in `AUTHOR_LIBRARY.md` who has a CCEL `cache/*.txt` URL:
- Fetch the URL
- Validate
- Chunk
- Add to a new `package_id: "church_fathers"` (or merge into `seeded` if it makes the UX simpler)

Minimum viable: ~10 authors / ~25 works to close the most embarrassing gap:
- Irenaeus: *Against Heresies* (5 books)
- Athanasius: *On the Incarnation*, *Against the Heathen*, *Life of Antony*
- Basil: *On the Holy Spirit*, *Hexaemeron*
- Gregory of Nazianzus: *Five Theological Orations*
- Gregory of Nyssa: *Life of Moses*, *On the Soul and the Resurrection*
- Ambrose: *On the Duties of the Clergy*, *On the Holy Spirit*
- John Chrysostom: *On the Priesthood*, *Homilies on Matthew* (selection)
- Jerome: *Letters* (selection)
- Leo the Great: *Sermons* (selection)
- Gregory the Great: *Pastoral Care*

These are all on CCEL. The download is one HTTP request per work. The chunking is the slow part (~1 hour per work to set up the chapter-aware split correctly). **Estimated: 1–2 days of focused work.**

### Phase 3 — Reformation + 17th-19th c.

For Luther, Calvin, Owen, Baxter, Edwards, Wesley, Spurgeon, MacDonald, Murray, Bounds, etc., PRDL and PG are the main sources. CCEL has some. Wikisource has individual poems.

Skip for v1 — Phase 1+2 is already a 10× improvement in coverage and quality.

### Phase 4 — Anglican devotional, poetry, hymns

Wikisource. Per-work fetch. Lower priority because the existing 18 already cover the most-cited devotional authors (Thomas à Kempis, Brother Lawrence, Julian, Bernard, Francis de Sales, Teresa, John of the Cross).

Skip for v1.

## Out of scope (deferred)

- **Moving library to Supabase.** Big change with its own plan. The static JSON shape is fine for the next 50 books.
- **Embedding the new corpus.** Once the cleaned library is in place, re-run the embedding pipeline (it already exists in `apps/web/app/api/vectors/status/route.ts`) to embed the new passages. Should be one command.
- **Mobile sync.** The mobile app reads from a baked-in copy; it doesn't get library updates without an app release. Out of scope here.
- **Per-user library collections / "favorites" / "highlights feed."** That's a product feature, not a corpus feature.
- **Localization.** All English pre-1928. Adding German/Latin/French would need a parallel ingestion.

## Rollout

| Step | Estimated time | Risk | Verifies |
|---|---|---|---|
| 1. Build `scripts/library/ingest.py` + validation gates | 0.5 day | Low (no data touched) | Unit tests on known-good/bad fixtures |
| 2. Re-fetch + replace 18 existing books | 0.5–1 day | Low (each book independently verifiable) | Playwright: each book shows clean text, no preamble, no 404 |
| 3. Diff and commit `voice_books.json` + `voice_passages.json` | 0.5 hour | Low (git revert = rollback) | `apps/web/data/seeded_library/` matches manifest |
| 4. Push → Railway auto-deploy → smoke test on prod | 0.5 hour | Low (auth-gated, no schema change) | `curl https://resonance.up.railway.app/api/library/books` shows 18 books with new IDs |
| 5. Add 10 patristic authors / 25 works from CCEL | 1–2 days | Medium (chunking strategies vary per work) | Each new book visible in library, read-test on mobile + web |
| 6. Re-run embedding pipeline on new corpus | 0.5 day | Medium (might surface embedding bugs) | `apps/web/app/api/vectors/status/route.ts` shows new passage vectors |
| 7. Update `AUTHOR_LIBRARY.md` with status column | 0.5 hour | None | Plan file is now source of truth |

**Total: 3–5 days focused work to go from 18 broken books to 43–58 clean books, all with stable IDs, real source attribution, and re-embeddable for resonance retrieval.**

## Acceptance criteria

- **Zero books with HTML error pages in `voice_passages.json`.** Lint check fails the build if any passage matches `<html|404|401 Not Found|Authorization Required`.
- **Zero books with OCR-damaged preambles.** Lint check fails the build if any first 5KB matches Google Books / IA preamble signatures.
- **All book IDs are stable string slugs.** No more `voice_100000` sequential IDs.
- **Every work has a `source_attribution.json` with URL, date, license.** Trackable for license audits.
- **Library covers at least 30 authors** (vs. 15 today), with at least 5 patristic authors from `AUTHOR_LIBRARY.md` that we don't have today.
- **No regressions on the existing API routes.** `/api/library/books` and `/api/library/passages` continue to work with the same shape (just new IDs).
- **Re-embedding keeps working.** The existing `vectors/status` route shows the new passage count.

## Files changed (cumulative)

| File | Why |
|---|---|
| `scripts/library/manifest.json` | NEW — per-work source selection |
| `scripts/library/ingest.py` | NEW — fetch + validate + chunk + emit |
| `scripts/library/validate.py` | NEW — quality gates, lint |
| `scripts/library/quality_checks.py` | NEW — preamble/OCR/HTML detection |
| `apps/web/data/seeded_library/voice_books.json` | REPLACED — new stable IDs, new attribution |
| `apps/web/data/seeded_library/voice_passages.json` | REPLACED — clean text, no preamble/OCR |
| `corpus/saints/*` → `corpus/staging/*` | MOVED + replaced from authoritative sources |
| `AUTHOR_LIBRARY.md` | UPDATED — add `Status` column |
| `corpus_discovery_report.md` | DELETED or REPLACED with new honest report |

**No new dependencies** (uses `requests`, `beautifulsoup4`, `lxml` which are already in the project). No new API routes. No database migrations. No frontend changes.
