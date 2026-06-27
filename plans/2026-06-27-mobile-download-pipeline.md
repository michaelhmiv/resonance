# Resonance Mobile — Library Download Pipeline

**Date:** 2026-06-27
**Status:** Planned, awaiting go-ahead
**Author:** Hermes
**Parent plan:** [`2026-06-27-library-per-book-opt-in.md`](./2026-06-27-library-per-book-opt-in.md)

## Background

This plan is the implementation companion to the per-book opt-in design. Where the parent plan describes *what* the user sees and *what* the data model is, this plan describes *how* the mobile app actually fetches, stores, and uses the per-book content on a device — and how the server produces the per-book artifacts that get shipped.

Michael's locked-in answers (this session):
- Per-book opt-in (not per-package).
- **Scripture (the 66 Bible books) is bundled on first launch — always included, no opt-in.** All 75 voice-of-the-Church books are the opt-in list.
- The full work ships as one batch.
- HTTP Range support and plan-file layout: agent's call.

## What I found in the codebase

The mobile app is **not** feature-complete in this area. It has scaffolding but no working pipeline:

- `apps/mobile/assets/seeded_library/` is **empty (0 bytes).** No passage data, no vectors, no HNSW index ships with the app. There is nothing for the on-device code to load.
- `apps/mobile/src/embedding/resonanceService.ts:loadLibraryVectors()` is a stub. It reads passage metadata from SQLite, then assigns `new Float32Array(0)` as every vector. The comment is explicit: *"vectors stay empty until the binary file reader is wired."* Resonance returns no matches on mobile today.
- `apps/mobile/src/data/mobileDataLayer.ts` free-tier methods are no-ops (`getLibraryPackagePrefs`, `setLibraryPackageEnabled`, `resetLibraryPackages`). The comments acknowledge this: *"When the user upgrades to premium and signs in, the cloud-backed per-package prefs will take over."*
- The package-manager scaffolding exists (`apps/mobile/src/packages/packageManager.ts`, `apps/mobile/src/packages/modelManager.ts`, the `installed_packages` table in `schema.ts`) but is unused. `getAvailablePackages()` returns a hardcoded 2-item array of demo packages. No download code, no extraction, no progress UI.
- **There is no HNSW library wired for React Native on this project.** The server uses `hnswlib-node`. The mobile codebase has no equivalent; vectors are stored as `Float32Array` in memory and matched by brute-force cosine in `resonanceService.ts:findResonance`. For 75 books / 261k passages, brute-force on a phone is in the 100ms–2s range per query — usable but not great. A real on-device HNSW would be 5-20ms.

## The data on the server (real numbers)

| | |
|---|---|
| Voice passages total | 261,454 (75 books across 7 packages) |
| Bible passages in pplx index | ~3,600 (66 books) |
| pplx index `passage_count` | 265,068 |
| pplx vector dim | 2,560 (int8) |
| pplx `vectors.bin` | 647.1 MB |
| pplx `corpus.hnsw` | 2.66 GB |
| pplx `corpus.idmap` | 7.4 MB (JSON: `passageKeys`, `passageIds`, `passageSources`) |
| gte-small `vectors.bin` | 388 MB (older model, also present) |
| Largest voice book by passages | `aquinas-summa` (33,696 passages, 12.9% of all voice) |
| Smallest voice books | Several 1-100 passage works (`herbert-temple` has 1) |
| `bible_passages.json` | 44.7 MB (all 66 books, 31,221 passages by metadata) |
| `bible_books.json` | 32 KB |

**Vector layout:** vectors are **per-passage**, not per-book. Vector row `i` corresponds to `passageSources[i]:passageIds[i]` (e.g. `"voice:163214000"`). The `book_id` for each passage is in `voice_passages.json` (262 KB) — joined at runtime.

**HNSW layout:** one global graph over all 265k vectors. `corpus.hnsw` is `hnswlib-node`'s serialized format and is **not splittable** — you can't extract a per-book sub-graph for a subset of nodes and have it remain a valid HNSW. Neighbor lists would be empty/incomplete. Slicing the monolithic HNSW is a no-op; we must rebuild per-book.

## Design constraints

1. **One global HNSW, per-passage vectors, no per-book partition today.** To support per-book downloads on mobile we must **build a new partitioning at build time.**
2. **No on-device HNSW library wired today.** Mobile does brute-force cosine in JS over a `Float32Array` of all loaded vectors. v1 keeps brute-force, but only over the shards the user has downloaded.
3. **The mobile package-manager scaffolding is package-granular, not book-granular.** The existing `installed_packages` table has `package_id` as primary key. Per-book opt-in requires replacing this with a per-book table.

## The chosen approach: pre-built per-book shards + bundled Scripture

### Build-time step (server side)

**For the 75 voice books, generate 75 per-book shard files:**

```
build/output/seeded_library/library_shards/
  manifest.json
  augustine-confessions/
    vectors.bin        # int8 rows for this book's passages
    idmap.json         # { passageKeys, passageIds, passageCount, model, dim }
    corpus.hnsw        # per-book HNSW (M=32, efConstruction=200)
  aquinas-summa/
    vectors.bin        # ~135 MB
    idmap.json
    corpus.hnsw        # ~400 MB
  ...
```

**For the 66 Bible books, generate a single bundled "scripture" asset:**

```
build/output/seeded_library/scripture_bundle/
  manifest.json
  bible_passages.json   # same content as canonical 44.7 MB file
  vectors.bin           # int8 rows for the ~3,600 bible passages
  idmap.json
  corpus.hnsw           # per-bible HNSW
```

`library_shards/manifest.json`:

```json
{
  "version": 1,
  "model": "pplx-embed-v1-4b",
  "dim": 2560,
  "dtype": "int8",
  "shards": [
    {
      "bookId": "augustine-confessions",
      "packageId": "patristic",
      "title": "Confessions",
      "author": "Augustine of Hippo",
      "sizeVectors": 3145728,
      "sizeHnsw": 9437184,
      "sizeIdmap": 8192,
      "totalBytes": 12591104,
      "sha256Vectors": "...",
      "sha256Hnsw": "...",
      "sha256Idmap": "..."
    },
    ...
  ]
}
```

`scripture_bundle/manifest.json`:

```json
{
  "version": 1,
  "model": "pplx-embed-v1-4b",
  "dim": 2560,
  "dtype": "int8",
  "passageCount": 3600,
  "sizePassages": 46905173,
  "sizeVectors": 9216000,
  "sizeHnsw": 27648000,
  "sizeIdmap": 524288,
  "totalBytes": 84293461,
  "sha256Passages": "...",
  "sha256Vectors": "...",
  "sha256Hnsw": "...",
  "sha256Idmap": "..."
}
```

**Total size budgets (worst case):**
- All 75 voice shards: ~3-4 GB (typical user wants 10-20 books → 100-500 MB).
- Scripture bundle: ~84 MB (one-time download on first launch).

**Build script:** `scripts/build-library-shards.mjs` (Node, mirrors `build-hnsw-index.mjs`)

For each of the 75 books:

1. Read the global `vectors_pplx-embed-v1-4b.bin` and `corpus.idmap` once.
2. Look up which vector rows belong to this book via the join: `idmap.passageSources[i] === 'voice' && voice_passages[idmap.passageIds[i]].book_id === bookId`.
3. Extract those rows into `<book_id>.vectors.bin`.
4. Build a per-book idmap (subset of the global one).
5. Build a per-book HNSW using the same `hnswlib-node` config (`M=32, efConstruction=200`).
6. Write `<book_id>.hnsw` and compute sha256.
7. Compute total size and update the manifest.

For the 66 Bible books, same process with `idmap.passageSources[i] === 'bible'`. Single bundle, not 66 sub-bundles (bible is much smaller, no need to sub-shard).

**Build is O(75 × 265k reads from the global file) — about 1-2 minutes total, fast.**

Outputs go to `build/output/seeded_library/library_shards/` and `build/output/seeded_library/scripture_bundle/`.

The volume restore script (`scripts/restore-volume.py`) gets new UPLOAD entries for both directories. The admin upload endpoint gets new path prefixes `library_shards/` and `scripture_bundle/`.

## New API surface

All auth-gated (same as `/api/library/*`).

- **`GET /api/library/shards/manifest`** — returns the voice book shard manifest. Mobile fetches on Library open to populate download buttons.
- **`GET /api/library/shards/[bookId]/[file]`** — streams one shard file (`vectors.bin`, `idmap.json`, or `corpus.hnsw`). Supports HTTP Range for resumable downloads.
- **`GET /api/library/scripture/manifest`** — returns the scripture bundle manifest. Mobile fetches on first launch.
- **`GET /api/library/scripture/bundle/[file]`** — streams one scripture bundle file (`bible_passages.json`, `vectors.bin`, `idmap.json`, or `corpus.hnsw`). Supports HTTP Range.

**HTTP Range support is a hard requirement.** The existing volume file-serving infrastructure does not currently support Range requests; I confirmed this is a gap. The new endpoints add Range support via a custom handler that reads the file with `createReadStream(path, { start, end })`. Phase 0 includes verifying Range works end-to-end on Railway.

## Mobile storage schema (additions to `schema.ts`)

```sql
-- Per-book voice shard download tracking
CREATE TABLE IF NOT EXISTS downloaded_shards (
  book_id       TEXT PRIMARY KEY,
  installed_at  INTEGER NOT NULL,
  size_bytes    INTEGER NOT NULL,
  sha256        TEXT NOT NULL,
  model_id      TEXT NOT NULL DEFAULT 'pplx-embed-v1-4b'
);

-- Individual file tracking for each downloaded shard
CREATE TABLE IF NOT EXISTS shard_files (
  book_id       TEXT NOT NULL,
  filename      TEXT NOT NULL,  -- 'vectors.bin' | 'idmap.json' | 'corpus.hnsw'
  size_bytes    INTEGER NOT NULL,
  sha256        TEXT NOT NULL,
  downloaded_at INTEGER NOT NULL,
  PRIMARY KEY (book_id, filename),
  FOREIGN KEY (book_id) REFERENCES downloaded_shards(book_id) ON DELETE CASCADE
);

-- Scripture bundle (one row, since there's only one bundle)
CREATE TABLE IF NOT EXISTS scripture_bundle (
  version       INTEGER PRIMARY KEY,
  installed_at  INTEGER NOT NULL,
  size_bytes    INTEGER NOT NULL,
  sha256        TEXT NOT NULL,
  model_id      TEXT NOT NULL DEFAULT 'pplx-embed-v1-4b'
);
```

The existing `installed_packages` table is dropped in this plan. Its placeholders in code (`packageManager.ts`, `modelManager.ts`) are removed; the per-book state lives in `downloaded_shards` (free tier) and `user_settings` (premium tier).

## Mobile code changes

- **`apps/mobile/src/db/libraryLoader.ts`** — currently loads the (empty) seeded library at first launch. Rewritten: on first launch, downloads the scripture bundle (with progress), stores files under `documentsDirectory/library/scripture/`, inserts into the `scripture_bundle` table, loads passages into the `passages` SQLite table. Voice books are *not* loaded at first launch; they're downloaded on demand from the Library tab.
- **`apps/mobile/src/packages/shardManager.ts` (new)** — the manager for per-book voice shards:
  - `fetchShardManifest()` — calls the API, caches the result in memory + on disk
  - `fetchScriptureManifest()` — calls the API, caches the result
  - `isShardDownloaded(bookId)` — checks the local table
  - `downloadShard(bookId, onProgress)` — streams the 3 files with `expo-file-system`, updates `downloaded_shards` and `shard_files` tables, verifies sha256s
  - `removeShard(bookId)` — deletes the files and rows
  - `loadDownloadedVectors()` — reads all downloaded shards' vectors into the in-memory `libraryVectors` array
  - `loadScriptureVectors()` — reads the scripture bundle vectors into `libraryVectors`
  - `getShardSizeEstimate(bookId)` — returns the manifest size, for "Download (35 MB)" UI labels
- **`apps/mobile/src/embedding/resonanceService.ts`** — `loadLibraryVectors()` is rewritten to call `loadScriptureVectors()` + `loadDownloadedVectors()` from `shardManager`. The brute-force cosine loop in `findResonance` is unchanged; it just iterates over a smaller array. Future v2: wire `hnswlib-node-react-native` or equivalent and replace brute-force with HNSW search; out of scope for v1.
- **`apps/mobile/src/data/mobileDataLayer.ts`** — `getLibraryPackagePrefs()`, `setLibraryPackageEnabled()`, `resetLibraryPackages()` are rewritten to use the new per-book shard state on free tier. The cloud-backed methods on premium tier are unchanged. The `getLibraryPackages()` method now returns a 3-section structure: `scripture: Book[]` (always populated), `booksByCategory: { [pkgId]: Book[] }` (filtered by download state on free / opt-in state on premium), `includedBookIds: string[]`.
- **`apps/mobile/src/packages/packageManager.ts` and `modelManager.ts`** — removed (replaced by `shardManager`). The `installed_packages` table is dropped in the migration.

## Library tab UI

Two tabs (Browse | Included), each with a Scripture section on top and a Books section below.

**Browse tab:**
- **Scripture** section header. Flat list of 66 Bible books, no toggles. Each row has title, testament (OT/NT), and a "Read" affordance. Always populated.
- **Books** section header. 75 voice-of-the-Church books grouped by 7 packages. Each row has title, author, era, and a per-tier affordance:
  - **Web (premium-only):** "Add to resonance" button (or "Remove from resonance" / checkmark if already added)
  - **Mobile premium:** same cloud button
  - **Mobile free:** "Download · 35 MB" button (or green checkmark if downloaded, or progress bar if downloading)

**Included tab:**
- **Scripture** section (always populated — all 66 books)
- **Books** section (only the books the user has opted into on web/premium, or downloaded on free)

A short header above the tabs explains the page (per-tier copy).

## Mobile Settings additions

- **"Manage downloads"** entry in Settings. Shows total on-device library size (scripture + downloaded shards), per-book list, and a "Clear all downloaded books" button.
- **"Download over cellular"** toggle. Default off. Gates all shard downloads to Wi-Fi only.
- **"Auto-delete old shards"** toggle. Default off. When on, deletes shard files for books the user has not opened in 30+ days.

## Build & deploy changes

- **`scripts/build-library-shards.mjs` (new)** — the build script.
- **`scripts/restore-volume.py`** — adds UPLOAD entries for the new `library_shards/` and `scripture_bundle/` directories.
- **`apps/web/app/api/library/shards/manifest/route.ts` (new)**
- **`apps/web/app/api/library/shards/[bookId]/[file]/route.ts` (new)** — supports HTTP Range.
- **`apps/web/app/api/library/scripture/manifest/route.ts` (new)**
- **`apps/web/app/api/library/scripture/bundle/[file]/route.ts` (new)** — supports HTTP Range.
- **Volume:** the new `library_shards/` directory adds ~3-4 GB; the `scripture_bundle/` adds ~84 MB. Disk on the volume goes from ~3.4 GB to ~7 GB after Phase 0.

## Phasing (full sprint, single batch)

This is a 1-2 week feature. All four sub-phases ship together per Michael's instruction.

**Phase 0 — server-side shards + scripture bundle + API.** (1-2 hours)
- Write `scripts/build-library-shards.mjs`.
- Run it locally. Verify shard sizes, HNSW builds, sha256s.
- Build the scripture bundle script (or fold into the same).
- Add UPLOAD entries to `restore-volume.py`. Run the upload to production.
- Add the four new API routes. Deploy. Verify with curl: manifest endpoints return valid JSON, file endpoints serve bytes correctly, Range requests work.
- **Outcome:** the shards + scripture bundle exist on the production volume. The API is live. No mobile changes.

**Phase 1 — mobile: first-launch scripture download.** (1 day)
- Add the SQLite tables (`scripture_bundle`; `downloaded_shards` and `shard_files` are added in Phase 2 but the migration is here).
- Drop `installed_packages` table in a migration.
- Add `shardManager.ts` with `fetchScriptureManifest`, `downloadScriptureBundle`, `loadScriptureVectors`.
- Rewrite `libraryLoader.ts` to call the manager at first launch.
- Rewrite `resonanceService.loadLibraryVectors` to include scripture vectors.
- Update `mobileDataLayer.getLibraryPackages()` to return the new 3-section structure.
- **Outcome:** first launch downloads the scripture bundle. Resonance works for Bible passages. Voice cards still empty (Phase 2).

**Phase 2 — mobile: per-book voice shard download.** (1-2 days)
- Extend `shardManager.ts` with the per-voice-book methods (`fetchShardManifest`, `isShardDownloaded`, `downloadShard`, `removeShard`, `loadDownloadedVectors`).
- Update `resonanceService.loadLibraryVectors` to merge scripture + downloaded voice vectors.
- Hook up one book (`augustine-confessions`, ~13 MB) in the Library tab as a manual test button. Bypass the per-tier UI, hardcode the bookId.
- Manually verify: download → search journal text → see resonance card from Augustine.
- **Outcome:** the on-device pipeline works for one voice book.

**Phase 3 — mobile: full Library tab UI.** (2-3 days)
- Two-tab Library (Browse | Included).
- Scripture section (no toggles) + Books section (per-tier affordance).
- Progress UI for active downloads.
- Per-tier copy: "Add to resonance" (premium) vs. "Download · 35 MB" (free).
- Settings: "Manage downloads" entry, "Download over cellular" toggle, "Auto-delete old shards" toggle.
- **Outcome:** the new Library tab ships in the mobile app.

**Phase 4 — mobile premium: opportunistic pre-fetch.** (1-2 days)
- When the user opens the Library tab on mobile premium, kick off background downloads of the shards corresponding to their cloud `enabled_voice_books`. Pre-fetch via Wi-Fi only.
- On app foreground, sync cloud prefs and reconcile local downloads.
- **Outcome:** mobile premium users get a warm local cache that mirrors their cloud opt-ins.

**Total: 1-2 weeks of focused implementation.**

## Verification (no-action contract)

Each item is checked read-only before any commit. No Railway deploy until everything is green.

**Phase 0 (server):**
1. `scripts/build-library-shards.mjs` runs in <5 minutes, produces 75 shard directories + scripture bundle.
2. Each shard's vectors.bin matches expected size: `passageCount × 2560` bytes.
3. Each shard's HNSW file loads in `hnswlib-node`, identity query (row 0 finds itself) passes.
4. Scripture bundle's HNSW identity query passes.
5. `restore-volume.py --force` uploads all new files in <2 minutes; volume state verified via `diag-file` for at least 3 random shards + the scripture bundle.
6. `GET /api/library/shards/manifest` returns 200 JSON with 75 entries.
7. `GET /api/library/shards/augustine-confessions/vectors.bin` returns 200 with the correct size and `Accept-Ranges: bytes` header.
8. `GET /api/library/shards/augustine-confessions/vectors.bin` with `Range: bytes=0-1023` returns 206 Partial Content.
9. `GET /api/library/scripture/manifest` returns 200 JSON.
10. `GET /api/library/scripture/bundle/vectors.bin` with `Range: bytes=0-1023` returns 206.

**Phase 1 (mobile scripture):**
11. `libraryLoader.ts` triggers on first launch, downloads the bundle (verify file sizes on disk), updates `scripture_bundle` table.
12. After first launch, `resonanceService.findResonance("In the beginning God created the heavens and the earth")` returns at least one `scripture` card from Genesis 1.
13. With a journal entry that matches a Bible verse, the ambient resonance footnote on mobile shows the Bible card.
14. `mobileDataLayer.getLibraryPackages()` returns `{ scripture: [66 books], booksByCategory: {...}, includedBookIds: [] }`.

**Phase 2 (mobile per-book download):**
15. `shardManager.downloadShard("augustine-confessions", onProgress)` writes 3 files to disk, returns when done, sha256s match the manifest.
16. `libraryVectors` after the download contains the 1,400-or-so vectors for Confessions.
17. With a journal entry matching Augustine ("Our hearts are restless until they rest in You"), `findResonance` returns at least one `voice` card from Confessions.
18. `shardManager.removeShard("augustine-confessions")` deletes the files and the row.
19. After removal, `libraryVectors` no longer contains Confessions vectors.
20. A second `downloadShard` for the same book resumes from the manifest (no-op if already downloaded).

**Phase 3 (full UI):**
21. The Library tab shows two sections: Scripture (66 books, no toggles) + Books (75 books grouped by 7 packages).
22. The Included tab on mobile free shows only the books the user has downloaded.
23. The Included tab on web shows only the books the user has opted into via cloud.
24. Toggling a book on web persists to `user_settings.enabled_voice_books` and survives a page refresh.
25. Downloading a book on mobile free persists across app restarts.
26. The "Download over cellular" toggle, when off, prevents downloads on cellular networks.
27. "Manage downloads" in Settings shows accurate size and per-book list.
28. "Clear all downloaded books" deletes all downloaded shards and clears the Included tab (Scripture is unaffected).

**Phase 4 (premium pre-fetch):**
29. On mobile premium, opening the Library tab kicks off background downloads of all books in `user_settings.enabled_voice_books` not already downloaded.
30. On app foreground, `enabled_voice_books` is re-read from the server; if it shrank, removed books are evicted from the device.

## Risks and unknowns

- **HTTP Range support on Railway:** confirmed as a gap in current volume serving. The new endpoints add Range support; the existing `/api/admin/upload-file` does not need to change. If Railway's reverse proxy strips `Range` headers, we'll need to bypass it. Phase 0 verifies end-to-end.
- **`aquinas-summa` is 12.9% of the entire corpus** (33,696 passages, ~135 MB vectors + ~400 MB HNSW). Users who want Aquinas download a third of the library just for him. Options: (a) chunk the largest book into sub-shards per work-section; (b) accept it; (c) drop Aquinas from the per-book model. Deferred until we have data on what users actually want. Ship v1 as-is; revisit if user feedback warrants.
- **No on-device HNSW library wired today.** v1 uses brute-force cosine over the loaded shards. Faster than the current state (no vectors at all), but not as fast as a real HNSW. If we wire `hnswlib-node-react-native` or equivalent, it becomes a v2 follow-up.
- **Background downloads via OS services** (NSURLSession on iOS, DownloadManager on Android) are out of scope for v1. Downloads only happen when the app is in the foreground. Users who background the app mid-download will see the download resume next time the app is foregrounded.
- **Disk usage on the volume goes from ~3.4 GB to ~7 GB after Phase 0.** Railway volume pricing scales with size; the cost increase is small but real. Confirmed acceptable.
- **Multiple embedding models on mobile** are out of scope. v1 is `pplx-embed-v1-4b` only. The `model_id` column on the schema accommodates future model switching.
- **Delta updates:** if a book gets new content, the user re-downloads the full shard. For 75 books with stable content, acceptable. If we update the canon mid-year, all users re-download.
- **No analytics on what people want to download.** The "Manage downloads" page should log a heartbeat event with the list of bookIds the user has, so we can answer "what % of users have at least one book downloaded" without per-user tracking.
- **Compression of vectors in transit** (LZ4/zstd) could cut shard sizes 2-3x. Easy to add later; not in v1.

## Done-when

First launch on mobile downloads the Scripture bundle (84 MB). The Library tab shows Scripture (66 books, always present) and Books (75 voice-of-the-Church books grouped by 7 packages, per-book opt-in). On web/mobile premium, "Add to resonance" toggles a cloud flag. On mobile free, "Download · 35 MB" pulls the per-book shard. Resonance on mobile surfaces Bible cards by default and voice cards for downloaded books. Settings has "Manage downloads" with size and per-book controls. Mobile premium gets opportunistic pre-fetch of their cloud opt-ins.

One batch. No code written yet. Awaiting go-ahead.
