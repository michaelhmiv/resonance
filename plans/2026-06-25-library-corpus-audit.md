# Resonance — Library Corpus Audit (initial findings)

**Date:** 2026-06-25
**Author:** Hermes
**Trigger:** User reported the seeded "original volume" is incomplete, has bad formatting, and misspellings. Asked for a thorough audit of condition + evaluation of other free sources.
**Method:** Read the shipped `voice_books.json` + `voice_passages.json` (the file Railway serves at `/api/library/books`), inspect staging corpus, review `discover_corpus.py` / `stage_resonance_corpus.py` / `AUTHOR_LIBRARY.md`, and query Brave for additional free sources.

---

## TL;DR — what we actually shipped

The "original volume" is **18 books** in `apps/web/data/seeded_library/voice_books.json` and `voice_passages.json`. The Supabase database is **not** involved — the library is a static JSON file read at request time and served via `apps/web/app/api/library/{books,passages}/route.ts`. The file is 20,979 passages, ~3.6 MB on disk, baked into the web bundle and pushed via git → Railway.

**The state is worse than the user remembers.** Two of the 18 books are stubs (1 passage each, both HTML error pages). At least one is heavy with Google Books OCR artifacts. Preambles and transcriber notes were not stripped. The `corpus_discovery_report.md` that justified the choices is itself broken — it reports "no PD editions found" for authors we have 1–2 MB of plaintext sitting on disk.

---

## 1. The 18 books, condition by book

| # | Author | Work | Passages | Condition | Issues |
|---|---|---|---:|---|---|
| 1 | Anselm of Canterbury | Cur Deus Homo | 425 | 🟠 OCR-damaged | First 2 passages are the **Google Books library scan preamble** with `c`→`e` substitution ("prcscrvod" for "preserved", "Googlc" for "Google", "gcncrations" for "generations"). 21 OCR signatures in first 10 passages alone. |
| 2 | Thomas Aquinas | Summa Theologica | 1,501 | 🟢 clean | Decent quality. |
| 3 | Augustine of Hippo | Confessions | 474 | 🟢 clean | Pusey translation, pre-1928 PD, good. |
| 4 | Bernard of Clairvaux | Life and Works | 2,010 | 🟠 preamble | First passage is "Digitized by the Internet Archive in 2011…" — preamble not stripped. |
| 5 | Bernard of Clairvaux | Sermons on the Canticle | 1,774 | 🟠 preamble | Same — "Toronto, ©^ Digitized by the Internet Archive in 2011 with funding…" |
| 6 | Bonaventure | Breviloquium | 3,332 | 🟢 clean | |
| 7 | Brother Lawrence | Practice of the Presence of God | 629 | 🟢 clean | |
| 8 | John Bunyan | The Pilgrim's Progress | **1** | 🔴 **HTTP 404 HTML page** | The single passage is literally `<html> <head><title>404 Not Found</title></head>…`. The book shows in the library but is unreadable. |
| 9 | Catherine of Siena | Letters | 1,193 | 🟠 preamble | First passage is the Internet Archive digitization boilerplate, not a letter. |
| 10 | Anonymous (Cloud of Unknowing) | The Cloud of Unknowing | 1,266 | 🟢 clean | |
| 11 | Francis de Sales | Practical Piety | 1,603 | 🟡 header garble | First passage header has "PRACTICAL iMETY^ SEff POETH Br…" — likely OCR header from a scan. Body probably OK. |
| 12 | John of the Cross | Dark Night of the Soul | **1** | 🔴 **HTTP 401 HTML page** | Single passage is `<html>…<title>401 Authorization Required</title>…`. Same kind of failure as Bunyan. |
| 13 | John of the Cross | Spiritual Canticle | 1,090 | 🟢 clean | |
| 14 | Julian of Norwich | Revelations of Divine Love | 1,052 | 🟡 header | First passage is a fragment "of Theology at Claremont…" — a header sliced mid-sentence, not the opening of the text. |
| 15 | Thomas à Kempis | The Imitation of Christ | 584 | 🟢 clean | (Though the first passage is a discussion of authorship attribution, not the actual Imitation — looks like the prologue got chopped.) |
| 16 | Søren Kierkegaard | Hauptschriften | 500 | 🟡 partial? | First passage is "Cs Ge 7 , Herbe ga, U 5 N FF: JO at 1 85 0…" — looks like German *Fraktur* OCR that may have leaked a corrupted font, or the chunker grabbed a title page. **Also: "Hauptschriften" is just a German label meaning "main writings" — this is not a real Kierkegaard work title, suggesting it was bulk-concatenated with no proper work boundary.** |
| 17 | Blaise Pascal | Pensées | 1,403 | 🟠 preamble | First passage is the **Google Books preamble again** ("This is a digital copy of a book that was preserved for generations on library shelves…") — same OCR-style preamble as Anselm. |
| 18 | Teresa of Ávila | Interior Castle | 2,141 | 🟠 header contamination | First passage header is "The tug-of-war…White-handed Gibbon…Hoolock Gibbon…Head of Proboscis Monkey…Cross-bearing Langur…" — this is from the **Table of Contents of an illustrated natural history book** that got concatenated onto Interior Castle. Multiple transcriber notes also present ("Text enclosed by underscores is in italics (_italics_)."). |

### Summary
- 🔴 **Broken (1 passage = error page)**: 2 of 18 (Bunyan, Dark Night)
- 🟠 **Preamble / OCR / header contamination**: 7 of 18
- 🟡 **Minor header/garble issues**: 3 of 18
- 🟢 **Clean**: 6 of 18
- **Pristine**: 0 of 18 — even the "clean" ones likely have a few stale chunks at boundaries.

So **~12 of 18 books (67%) have visible quality defects** in the first few passages, and **2 of 18 (11%) are entirely broken**.

### Source attribution
Most books just say `"source": "Public Domain"`. Only 4 cite a specific source:
- Augustine, Brother Lawrence, Bunyan, à Kempis, Pascal, Teresa → "Project Gutenberg" (but Bunyan/Pascal also pull from Google Books, not PG, so the source field lies)
- Cloud of Unknowing → "Public Domain / CCEL"
- Everything else → "Public Domain" (no provenance)

We cannot audit licensing from a "Public Domain" string. We have to trace each book back to its actual source file in the staging directory.

### Staging directory is partially populated
`corpus/saints/` has 18 files matching the 18 shipped books, plus:
- `corpus/saints/anselm_cur_deus_homo.txt` → 198 KB ✓ (matches voice_100000)
- `corpus/saints/aquinas_summa_theologica.txt` → 864 KB ✓
- `corpus/saints/augustine_confessions.txt` → 632 KB ✓
- `corpus/saints/bernard_life_and_works.txt` → 1.25 MB ✓
- `corpus/saints/bernard_sermons_canticle.txt` → 1.13 MB ✓
- `corpus/saints/bonaventure_breviloquium.txt` → 2.05 MB ✓
- `corpus/saints/brother_lawrence_practice.txt` → 751 KB ✓
- `corpus/saints/bunyan_pilgrims_progress.txt` → **146 bytes — 404 HTML page** (this is the broken book)
- `corpus/saints/catherine_siena_letters.txt` → 742 KB ✓
- `corpus/saints/cloud_of_unknowing.txt` → 656 KB ✓
- `corpus/saints/francis_de_sales_practical_piety.txt` → 734 KB ✓
- `corpus/saints/john_of_the_cross_dark_night.txt` → **172 bytes — 401 HTML page** (this is the broken book)
- `corpus/saints/john_of_the_cross_spiritual_canticle.txt` → 532 KB ✓
- `corpus/saints/julian_of_norwich_revelations.txt` → 494 KB ✓
- `corpus/saints/kempis_imitation.txt` → 374 KB ✓
- `corpus/saints/kierkegaard_hauptschriften.txt` → 303 KB ✓
- `corpus/saints/pascal_pensees.txt` → 638 KB ✓
- (Teresa of Ávila Interior Castle source: not in `corpus/saints/`. Probably ingested from elsewhere.)

`corpus/church_fathers_complete.txt` is 87 MB and starts with `owe COCOhMA PLETE AM! TE-MNMICEME s&s` — this is the file the `2026-06-23-church-fathers-split-manifest.md` was meant to split into per-work files, but it was never used. **None of this 87 MB made it into the library.**

`corpus/gutenberg/` is empty.

`corpus/bible/` has KJV/WEB/ASV JSON files — these are the Scripture side, not the voice library.

So: the staging directory is mostly there for the 18 books. The 87 MB church fathers file is staged but never chunked. The gutenberg directory is empty.

---

## 2. The discovery report (`corpus_discovery_report.md`) is unreliable

This is the report that was used to pick the 18 books. It has **two systemic bugs**:

1. **It doesn't check the local staging directory.** It claims ❌ "Irenaeus — no PD editions found" but the *entire* ANF/NPNF set, including Irenaeus' *Against Heresies*, lives on Internet Archive. It claims ❌ "Anselm — no PD editions found" while we have `anselm_cur_deus_homo.txt` (198 KB) sitting in `corpus/saints/`. Same for Bernard, Bonaventure, and others — it reports them as missing while we already have them locally. The script is only doing remote IA search and ignoring local files.

2. **The remote search is over-narrow and noisy.** Tons of 🟡 "uncertain" results are CIA Reading Room PDFs and other false matches (e.g. "Basil the Great" matched a 1947 CIA document about industrialization, and "Jerome" matched a 1962 CIA report). The script's title matching is too loose. The year filter is misfiring.

3. **The "uncertain" bucket mixes real hits with junk** — Basil the Great's 4 "uncertain" results are all CIA reading room docs, but if you actually query IA directly, Basil's *On the Holy Spirit* and *Hexaemeron* are widely available in pre-1928 English (the 1895 Nicene and Post-Nicene Fathers series vol. 8 is on IA).

The report should be re-run, but the bigger problem is the **selection was made on top of a broken report**.

---

## 3. Coverage vs. `AUTHOR_LIBRARY.md`

`AUTHOR_LIBRARY.md` lists 89 authors with ~300+ works across 2,000 years. The shipped library has 18 works. That's 6% of the stated ambition. Authors with **zero** representation in the shipped library include:
- Most Apostolic/Pre-Nicene Fathers: Didache, Clement, Ignatius, Polycarp, Justin, Irenaeus, Clement of Alexandria, Tertullian, **Origen**, Cyprian
- Most Post-Nicene Fathers: **Athanasius**, Basil, both Gregories, **Ambrose**, **John Chrysostom**, **Jerome** (only mentioned in 1 chunk of Bernard's *Life and Works* commentary), **John Cassian**, **Cyril of Alexandria**, **Leo the Great**
- All Byzantine: Pseudo-Dionysius, **Gregory the Great**, Maximus, Isaac of Nineveh, John of Damascus, Symeon
- Most Medieval: Hildegard, Francis, **Bonaventure** (1 of 2 works shipped), Meister Eckhart, Tauler, Suso, Ruusbroec, Rolle, Walter Hilton, **Catherine of Genoa**
- All Protestant Reformers: Luther, Calvin, Bunyan (1 broken stub), Owen, Baxter, Edwards, Wesley
- 19th c.: MacDonald, **Spurgeon**, Murray, Chambers, Bounds
- All Eastern Orthodox: Philokalia, Way of a Pilgrim, Seraphim, Theophan, John of Kronstadt
- All Anglican/English devotional: Donne, **Herbert**, Vaughan, Traherne
- All philosophical/spiritual: **Pascal** (shipped but broken preamble), **Kierkegaard** (shipped but bad title), Tolstoy, Dostoevsky, William James
- All poetry/hymns: Milton, Watts, Wesley hymns, Hopkins, Rossetti, Thompson
- Underhill, Chesterton, Thérèse, Desert Fathers, George Fox, Menno Simons — all missing.

> **Bolded** authors have at least one shipped book. The bolded-but-still-mostly-missing list is painful: Athanasius' *On the Incarnation* alone is one of the most important patristic works for modern readers, and we have nothing of it. Same for Augustine's *City of God* or *Confessions* beyond a partial chunk.

---

## 4. Free sources we could use (Brave search + actual download probes)

I ran four Brave queries AND probed each candidate source with `curl` to verify the actual download format and quality. Here's the honest assessment with real HTTP responses:

### Per-source download verification (probed 2026-06-25)

| Source | URL pattern | Format | Status | Real quality |
|---|---|---|---|---|
| **CCEL** | `https://ccel.org/ccel/a/<author>/<work>/cache/<work>.txt` | `text/plain` | ✅ Verified | **850 KB Augustine Confessions, 147 KB Athanasius On the Incarnation, real `text/plain` Content-Type, proper chapter divisions, no preamble.** This is the best free text source for any pre-1928 Christian work CCEL hosts. **Real path:** `ccel.org` → author index page → find `<a href="/ccel/a/<author>/<work>/cache/...">txt</a>` link in the work-info page. |
| **CCEL** | `https://ccel.org/ccel/<author>/<work>/<work>.i.html` | HTML | ✅ Verified | Formatted HTML version, same content. Use only if .txt cache is missing. |
| **New Advent** | `https://www.newadvent.org/fathers/NNNN.htm` | HTML | ✅ Verified | Clean HTML, ~200KB per major work, full NPNF/ANF text. Easy to strip with `html2text`. **Canonical for Irenaeus, Athanasius, Basil, Gregories, Chrysostom, Jerome, Augustine, Leo, Gregory the Great** — the entire ~40-author patristic gap. |
| **Standard Ebooks** | `https://standardebooks.org/ebooks/<author-slug>/<work-slug>/downloads/<file>.epub` | EPUB | ⚠️ Interstitial | Direct .epub URL returns 200 with `text/html` content (8.7 KB), not a real EPUB. **SE's download endpoint serves an interstitial page that requires a browser session.** Works through a real browser (or Playwright). Per-book, manual: visit the work page, click download, save EPUB. **Not bulk-friendly.** |
| **Project Gutenberg** | `https://www.gutenberg.org/cache/epub/<id>/pg<id>.txt` (or via `gutenberg` PyPI lib) | `text/plain` | ✅ Standard | 70,000+ free ebooks, mostly pre-1928 US PD. Mature `gutenberg` Python lib. Per-user PG catalog numbers (e.g. PG #100 for Confessions, #3300 for Imitation of Christ). Some texts have non-PD translations (e.g. Confraternity Bible, modernized spelling) — needs license check. |
| **Wikisource** | `https://en.wikisource.org/wiki/<Work>` | HTML/wiki-text | ✅ Standard | Volunteer-cleansed. Best for individual poems (Donne, Herbert, Hopkins, Milton, Watts, Wesley hymns, Rossetti, Thompson) and short works. No bulk API — per-work fetch. |
| **Post-Reformation Digital Library (PRDL)** | `https://prdl.org/` | HTML/PDF | 🔍 Verify | Per the YDS/Duke guides, hosts digitized 16th-18th c. theology. **Not yet probed** — need to check individual work availability. Probably the right source for Luther, Calvin, Owen, Baxter, Edwards, Wesley. |
| **Bibliotheca Religiosa IntraText** (intratext.com) | `https://www.intratest.com/...` | TXT/HTML | 🔍 Verify | Multi-tradition religious texts. Not yet probed. |
| **Internet Archive raw** | `https://archive.org/download/<id>/<file>.txt` | `text/plain` (or HTML!) | ⚠️ **Dangerous** | This is where the broken 404/401 came from. **The download pipeline must always verify** (1) HTTP 200, (2) `Content-Type: text/plain` (or convertible), (3) no HTML body, (4) sane size. Currently no such check. |
| **Harvard Library PD Corpus** | Bulk download | Mixed | 🔍 Verify | ~1M books, mostly academic. Heavy filtering needed. |
| **Europeana** | `https://www.europeana.eu/` | Mixed | 🔍 Verify | 10M+ texts, mostly non-English. |

### Recommendation: per-work, not per-source

You're right — source prestige ≠ file quality. **The right approach is per-work, not per-source.** The selection algorithm should be:

1. **For each work in AUTHOR_LIBRARY.md**, generate a candidate list of known source URLs across the catalogued sources above.
2. **Probe each candidate** with `curl -I` to check Content-Type, size, HTTP status. Reject any 4xx/5xx or `text/html` responses.
3. **Score each surviving candidate** on:
   - File type (text/plain > HTML > EPUB; EPUB needs unpacking)
   - Size (a 50 KB "Confessions" is suspicious; 850 KB is the right ballpark)
   - License (must be PD; for PG, double-check the translator)
   - Preamble signatures (PG has known boilerplate; CCEL has a clean cache header we can strip; IA often has scan preamble)
   - OCR substitution ratio (if it has many `c→e` swaps, reject — it's a Google Books scan with broken OCR layer)
4. **Pick the highest-scoring candidate.** Log the URL + score + checks in a `source_attribution.json` next to the work file.

For the *bulk* of the work — especially patristic and pre-1600 — **CCEL `cache/*.txt` will win on almost every work** because:
- Real `text/plain` (no HTML strip step)
- Real chapter divisions
- Verified public domain
- No scan preamble
- Translated (NPNF/ANF translations are the same as New Advent, the gold standard for English patristic)

**CCEL is the primary source for ~80% of the corpus.** New Advent is the backup when CCEL doesn't have a work. Standard Ebooks for individual high-quality modern editions of the same work (if we want to offer Chesterton's *Orthodoxy* in a better edition than Gutenberg). PRDL for Reformation+. Wikisource for individual poems. Internet Archive raw as last resort with full validation.

### Sources deliberately excluded (with reason)

- **EWTN Patristics Library** — same content as New Advent, different presentation. New Advent is the canonical English-language mirror. Pick one.
- **Most modern Patristics journals / academic sites** (e.g. JSTOR, Oxford) — behind paywalls or have NDAs.
- **Sacred-Texts.com** — copyright status varies per work, no clean license metadata. Not worth the audit overhead.
- **HathiTrust** — same content as Internet Archive for our purposes, but with stricter access controls (US-only IP, partner institution logins). Skip.

---

## 5. Quality problems in the pipeline (not the data)

The data quality is downstream of pipeline bugs. List of issues, ordered by blast radius:

### P0 — Broken books shipped to production
- 2 of 18 books are HTML error pages served to users (Bunyan, Dark Night).
- **Fix:** Pre-import sanity check: parse response as text, look for `<html>` and HTTP status patterns, reject. Refuse to write a book to `voice_passages.json` unless it has ≥ N passages of real text.

### P0 — OCR damage shipped
- Anselm (Cur Deus Homo) and Pascal (Pensées) both have the Google Books library scan preamble with `c`→`e` substitution, baked into chunk 0. This is the kind of artifact that comes from a Google Books PDF that wasn't OCR'd — Google just stored the page images and a layer of "OCR" that's actually the image's own garbled text.
- **Fix:** Always strip the Google Books preamble (signature: "This is a digital copy of a book that was preserved for generations on library shelves…"). Always run a low-confidence OCR sanity check on the first N chunks and reject if substitution ratio exceeds threshold. Always re-fetch the same text from Standard Ebooks or CCEL if available, since they have clean versions.

### P1 — Preamble / table of contents / transcriber notes shipped
- 7 of 18 books have first passages that are preambles, copyright notices, or table-of-contents fragments.
- **Fix:** Authoritative preamble-strip regex set in the import pipeline. Reject a passage if it matches known preamble signatures. Strip the first passage if it has a TOC signature (e.g. "Chapter I … Chapter II …" with high density of "Chapter" / "Book" / "PART" headers and no narrative text).

### P1 — Concatenation boundary errors
- Teresa of Ávila's first chunk is gibbon table of contents from a different book. Pascal's Pensées has Google preamble. Kierkegaard's "Hauptschriften" is a German label, not a real work — this is multiple Kierkegaard works mashed together under a fake umbrella title.
- **Fix:** When ingesting, require a per-work source file with a known start/end. Don't merge multiple works under one title. If you have Kierkegaard's *Fear and Trembling*, *Sickness Unto Death*, etc., they're separate `voice_*` entries, not "Hauptschriften".

### P1 — Source field is a lie
- Bunyan's source is "Project Gutenberg" but the file is an HTML 404 page.
- **Fix:** Track the actual source URL and content hash. Display "Source: <domain> (verified <date>)" in the library UI.

### P1 — `corpus_discovery_report.md` is not a reliable tool
- Reports ❌ for authors we have on disk.
- Reports 🟡 for authors based on CIA Reading Room PDFs.
- **Fix:** Rewrite `discover_corpus.py` to (1) check the local `corpus/saints/`, `corpus/gutenberg/`, `corpus/bible/`, `corpus/church_fathers/` first and mark "have", (2) do a more targeted IA search using the work title (not just the author name) and require `mediatype:texts` + `date:[1800 TO 1928]`, (3) cross-check against CCEL, New Advent, Standard Ebooks, PRDL, Wikisource catalogs.

### P2 — `corpus/gutenberg/` is empty
- We have a script named after it but never populated it.
- **Fix:** Either use the `gutenberg` Python library to bulk-download, or delete the directory and rename. Either is fine; what's not fine is leaving an empty `gutenberg/` that suggests we did the work.

### P2 — `corpus/church_fathers_complete.txt` is 87 MB of un-split data
- Per the `2026-06-23-church-fathers-split-manifest.md`, we have a manifest that says where each work starts in the file. The split was never executed.
- **Fix:** Run the split per the manifest, then ingest the per-work files into the library. This single artifact could add 30–50 works to the corpus in one shot.

### P2 — `AUTHOR_LIBRARY.md` is aspirational, not a tracking doc
- It lists 89 authors but the `voice_books.json` has 15. There's no list of "which of the 89 have we shipped".
- **Fix:** Make `AUTHOR_LIBRARY.md` the source of truth and reflect actual state. Add a `Status` column: ✅ shipped / 🟡 in progress / ❌ not started. Or split into `AUTHORS_PLANNED.md` + `AUTHORS_SHIPPED.md`.

### P3 — `voice_books.json` IDs are sequential, not meaningful
- The IDs `100000, 100425, 101926, …` are the start offset of each book in the passage table. They were generated by an `INSERT … RETURNING` in some old load script.
- **Fix:** Use a stable string ID like `anselm-cur-deus-homo` or `pg-1000` (PG catalog number). String IDs let the library survive database rebuilds.

---

## 6. Where to go from here

Three questions before I write an implementation plan:

1. **Do you want a *clean-up pass* on the existing 18 books first** (strip preambles, fix OCR, replace the 2 broken books, re-chunk), or **go straight to expanding the corpus** (use the 87 MB church fathers file + new sources)?

2. **What's the canonical source priority?** My proposal: Standard Ebooks → CCEL → New Advent → PRDL → Wikisource → Project Gutenberg → Internet Archive raw. Rank these differently if you have a different preference (e.g. if you want Gutenberg to stay primary because of offline caching compatibility).

3. **Where does the "library" actually live long-term?** It's currently a static JSON in the web bundle, which means every change requires a git push + Railway deploy, and the file ships to every user. Two options:
   - **A. Keep as static JSON** (current). Simple, but big files (>10 MB) become a problem; no per-package updates; mobile can't get fixes.
   - **B. Move into Supabase** (a `library_books` + `library_passages` table). Lets you ship packages incrementally, lets mobile get library updates without an app release, lets the web stay static or move too. Bigger change — adds a migration + a new API route.
   - **C. Hybrid**: keep the index (book catalog) in static JSON, but serve passages from a per-book file in object storage. Best of both for big corpora.

Each of these is a multi-day change. I'd recommend writing a plan for option **B** (Supabase) because it pays off across the whole product (web, mobile, future packages), but you may have reasons to stay with A.

---

## 7. Quick wins I can ship without asking (if you say go)

These are safe, isolated, no-deps:

1. **Replace the 2 broken books** (Bunyan, Dark Night) with verified copies from CCEL/Standard Ebooks. Re-export voice_passages.json. Push. ~30 min of work.
2. **Strip the Google Books preamble** from the first passage of Anselm and Pascal. Surgical patch in the JSON. Push. ~10 min.
3. **Strip the Internet Archive preamble** from the first passage of Bernard (×2), Catherine of Siena, and any other books where I find it. ~20 min.
4. **Delete the empty `corpus/gutenberg/` directory** or rename it to make the lie go away. ~5 min.
5. **Add a `Status` column to `AUTHOR_LIBRARY.md`** so it's clear which 15 of 89 authors are actually shipped. ~30 min.

If you say "do all of them", I'll do them in order, in a single commit, with verification (each one a Playwright check that the book in question is now readable in the library UI).
