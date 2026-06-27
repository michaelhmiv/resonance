# Resonance — Per-Book Opt-In Refactor + Mobile Download Pipeline (Full Batch)

**Date:** 2026-06-27
**Status:** Implementation plan, awaiting go-ahead
**Author:** Hermes
**Parent plans:** `2026-06-27-library-per-book-opt-in.md`, `2026-06-27-mobile-download-pipeline.md`
**Scope:** Both the per-book opt-in web refactor (per-book plan Phase 2) and the full mobile download pipeline (mobile plan Phases 0-4) ship as one batch per Michael's locked-in instruction.

## Why this plan exists

The 2026-06-27 plans above describe the same two pieces of work in two documents. This plan is the **merged, corrected, single-batch** version. Key corrections vs. the source plans:

| What the older plan said | What's actually true on 2026-06-27 |
|---|---|
| Bible passages ~3,600; scripture bundle ~84 MB | Bible passages = **244,089**; scripture bundle is **~3.0 GB** (596 MB vectors + 2.39 GB HNSW) |
| Voice shards total 3-4 GB | Voice shards total **~2.7 GB** (all 75 books, sizes scale with passage count) |
| "Download · 35 MB" copy | Per-book size varies 1.4 MB (110 passages) → 420 MB (aquinas-summa 33,696 passages). The UI must read size from the manifest, not a hardcoded string |
| `aquinas-summa` is "12.9% of corpus" | 12.9% of voice corpus (33,696 / 261,454), but only 6.7% of the full pplx index (33,696 / 504,621). Sub-sharding remains deferred |
| 265,068 passages total | **504,621** passages (bible 244,089 + voice 260,532) — merged index from 2026-06-27 work |
| "largest shard ~400 MB" for aquinas-summa | **~420 MB** (82.3 MB vectors + 337.9 MB HNSW) |

These numbers come from a direct re-measurement of the merged index: `1,291,829,760 B vectors.bin / 504,621 passages / 2560 dim = 1.000× expected`, `5,306,709,960 B corpus.hnsw / 504,621 passages = 10,516 bytes/vector`. The HNSW-to-vectors ratio is 4.11×.

## Goal (done-when)

The Library tab on web and mobile has two tabs (Browse | Included) and two sections in each tab: **Scripture** (66 Bible books, always present) and **Books** (75 voice-of-the-Church books, per-book opt-in). Web/mobile-premium toggle a cloud flag (`user_settings.enabled_voice_books`); mobile-free downloads a per-book shard. The mobile free tier's first launch downloads the scripture bundle (~3 GB) and shows it in the Library. Mobile Settings has a "Manage downloads" page with size and per-book controls. Mobile premium opportunistically pre-fetches shards for its cloud opt-ins.

The system is **self-sustaining**: zero manual steps when adding content/users. New books ship via build pipeline, mobile auto-discovers them, server-authoritative throughout.

## Architecture (unchanged from parent plans)

| Tier | "Opt in to a book" means | State location | Toggle action |
|---|---|---|---|
| **Web (premium-only)** | Book's vectors included in cloud resonance search | Server `user_settings.enabled_voice_books` | `PUT /api/library/books/[bookId]`. Server's monolithic HNSW filters by book set |
| **Mobile premium** | Same as web | Server `user_settings.enabled_voice_books` (source of truth); local cache mirrors it | Cloud toggle. Mobile opportunistically pre-fetches the corresponding shard |
| **Mobile free (offline)** | Book's vectors and passages must be on the device | Local `downloaded_shards` SQLite table (per-device) | Triggers 3-file shard download (HTTP Range, sha256-verified) |

**v1 uses brute-force cosine** in JS over a `Float32Array` of downloaded shards — no on-device HNSW library in React Native. v2 will wire `hnswlib-node-react-native` or equivalent.

**One global HNSW** on the server, **per-passage** vectors, **not splittable** — per-book shards require a build-time rebuild from the vectors.bin.

## Volume budget (real numbers)

| Path | Size on volume | Notes |
|---|---|---|
| `/data/vectors/pplx-embed-v1-4b/vectors.bin` | 1.29 GB | Current (bible + voice merged) |
| `/data/vectors/pplx-embed-v1-4b/corpus.hnsw` | 5.31 GB | Current |
| `/data/vectors/pplx-embed-v1-4b/corpus.idmap` | 16.4 MB | Current |
| `/data/vectors/pplx-embed-v1-4b/manifest.json` | 13.2 MB | Current |
| **+** `seeded_library/library_shards/manifest.json` | ~25 KB | 75 entries with sizes + sha256s |
| **+** `seeded_library/library_shards/<bookId>/{vectors.bin,idmap.json,corpus.hnsw}` | **~2.7 GB total** | All 75 books. Per-book range: 1.4 MB (110-passage book) to 420 MB (aquinas-summa) |
| **+** `seeded_library/scripture_bundle/manifest.json` | ~1 KB | 1 entry with size + sha256s |
| **+** `seeded_library/scripture_bundle/{bible_passages.json,vectors.bin,idmap.json,corpus.hnsw}` | **~3.0 GB** | One bundle: 44.7 MB passages + 596 MB vectors + 2.39 GB HNSW + 16 MB idmap |
| **= Total volume usage after Phase 0** | **~12.3 GB** | From ~6.6 GB today. **Volume must be sized to at least 16 GB to leave headroom for re-uploads during deploys.** |

If the volume can't grow to 16 GB, the **scripture bundle is optional** — mobile free could still work with per-book voice shards only, losing the "Scripture always present on first launch" guarantee. We get a smaller feature footprint in exchange for not growing the volume. **The decision needs to be made before Phase 0 ships.**

## Phase 0 — Server-side shards + scripture bundle + API (1-2 hours)

Pre-requisite: confirm with Michael whether the volume can grow to 16 GB. If not, scripture bundle is cut and Phase 0 ships voice-only shards.

### 0.1 Build script: `scripts/build-library-shards.mjs` (new)

Mirrors `scripts/build-hnsw-index.mjs`. Reads:
- `/data/resonance/scripts/library/.reembed/merged/vectors.bin` (the merged bible+voice vectors)
- `/data/resonance/scripts/library/.reembed/merged/manifest.json` (with `passage_ids` and `passage_sources`)
- `apps/web/data/seeded_library/voice_passages.json` (to map voice IDs → book_ids)
- `apps/web/data/seeded_library/voice_books.json` (75 books with package_id, title, author)
- `apps/web/data/seeded_library/bible_passages.json` (for scripture bundle text)

For each of the 75 books:
1. Find vector rows where `manifest.passageSources[i] === 'voice'` and `voice_passages[manifest.passageIds[i]].book_id === bookId`.
2. Extract those rows contiguously into `<bookId>/vectors.bin` (sized `passageCount × 2560`).
3. Build a per-book idmap (subset of global one, same shape: `passageKeys`, `passageIds`, `passageSources`, `passageCount`, `model`, `dim`, `dtype`).
4. Build a per-book HNSW using the same `hnswlib-node` config: `M=32, efConstruction=200`, cosine metric.
5. Write `<bookId>/corpus.hnsw`, compute sha256.
6. Compute file sizes, sha256s, add to `library_shards/manifest.json`.

For the scripture bundle (one row, not 66 sub-bundles):
1. Find vector rows where `manifest.passageSources[i] === 'bible'`.
2. Write `scripture_bundle/{bible_passages.json, vectors.bin, idmap.json, corpus.hnsw}`.
3. Compute sha256s, write `scripture_bundle/manifest.json`.

**Performance estimate:** 75 + 1 = 76 HNSW builds. The previous merged build (504,621 vectors) took 2,668 sec = 44.5 min on local hardware. Per-book builds scale with passage count. Total estimated Phase 0 build time: **~80-120 min** on Railway hardware (which was 1.7x faster than local). The build runs **offline** (writes only to local disk); it's then uploaded.

Output: `/data/resonance/build/output/seeded_library/library_shards/{manifest.json, <bookId>/{vectors.bin,idmap.json,corpus.hnsw}}` and `/data/resonance/build/output/seeded_library/scripture_bundle/{manifest.json, bible_passages.json, vectors.bin, idmap.json, corpus.hnsw}`.

### 0.2 Upload: `scripts/restore-volume.py` updates

Add UPLOAD entries for `library_shards/` and `scripture_bundle/` directories. Chunked upload with the now-stream-assembling `/api/admin/upload-file` (the Buffer.concat OOM was fixed in `5515bdc` this session). Expected upload time: **20-40 min** for 2.7 GB + 3.0 GB at ~5-10 MB/s observed.

### 0.3 API: four new routes

| Route | Purpose | Auth | Notes |
|---|---|---|---|
| `GET /api/library/shards/manifest` | List 75 voice shards with sizes + sha256s | Premium required | Cacheable; manifest is small (~25 KB) |
| `GET /api/library/shards/[bookId]/[file]` | Stream one shard file (vectors.bin / idmap.json / corpus.hnsw) | Premium required | **HTTP Range required** for resumable + parallel |
| `GET /api/library/scripture/manifest` | Scripture bundle metadata | Premium required (yes, even on free tier — free gets a stub) | |
| `GET /api/library/scripture/bundle/[file]` | Stream one scripture bundle file | Premium required | **HTTP Range required** |

**HTTP Range implementation:** The existing volume file-serving doesn't support Range. The new routes implement it manually:
```ts
const stat = statSync(filePath);
const total = stat.size;
const range = req.headers.get('range');
if (range) {
  const m = /bytes=(\d+)-(\d+)?/.exec(range);
  const start = parseInt(m[1], 10);
  const end = m[2] ? parseInt(m[2], 10) : Math.min(start + 1024 * 1024 - 1, total - 1);
  res.headers.set('content-range', `bytes ${start}-${end}/${total}`);
  res.headers.set('accept-ranges', 'bytes');
  res.headers.set('content-length', String(end - start + 1));
  return new Response(createReadStream(filePath, { start, end }) as any, { status: 206 });
}
// else: full file
```
**Railway edge caveat:** Railway's reverse proxy may strip `Range` headers. Phase 0 verifies end-to-end; if Range is stripped, the routes still work for small files but mobile must fall back to single-shot downloads (defeats the resumable benefit, but the 2-3 GB downloads still work).

### 0.4 Volume-side safety: refuse to delete the `pplx-embed-v1-4b` model directory

The existing `DELETE /api/admin/vectors` already refuses to delete the active model. **No changes needed** — the new `library_shards/` and `scripture_bundle/` directories are under `/data/seeded_library/`, not `/data/vectors/`, so they're not even reachable from the delete endpoint. Confirmed by reading the route.

### 0.5 Verification (no deploy until green)

1. Build script runs in <2 hours, produces 75 shard directories + 1 scripture bundle.
2. Each shard's `vectors.bin` size = `passageCount × 2560` (exact match, no padding).
3. Each shard's HNSW loads in `hnswlib-node` and identity query (row 0 finds itself) passes.
4. Scripture bundle's HNSW identity query passes.
5. `restore-volume.py --force` uploads all new files; volume state verified via `diag-file` for 3 random shards + the scripture bundle (compare size + sha256 to local).
6. `GET /api/library/shards/manifest` returns 200 JSON with 75 entries, each with `totalBytes` and `sha256*` fields.
7. `GET /api/library/shards/augustine-confessions/vectors.bin` returns 200 with correct size and `Accept-Ranges: bytes`.
8. `GET /api/library/shards/augustine-confessions/vectors.bin` with `Range: bytes=0-1023` returns 206 Partial Content with `Content-Range: bytes 0-1023/...`.
9. Same Range tests for `scripture/bundle/vectors.bin`.
10. New `library_shards/` and `scripture_bundle/` directories appear in `ls /data/seeded_library/` via the diag-file route.

## Phase 1 — Web per-book opt-in (4-6 hours)

Replaces the per-package toggle shipped earlier this session with per-book toggles. No mobile changes.

### 1.1 Data layer

`apps/web/lib/library-prefs.ts`:
- Add new key `enabled_voice_books` (string[] of book IDs).
- `getEnabledVoiceBooks(installedBookIds)` — same logic as `getEnabledVoicePackages` but against `enabled_voice_books`.
- `setEnabledVoiceBooks(bookIds, installedBookIds)` — validate + dedupe + sort.
- `toggleEnabledVoiceBook(bookId, enabled, installedBookIds)` — same all/none/subset semantics as the per-package version.
- `clearEnabledVoiceBooks()` — reset to all-enabled.
- **Keep** the per-package functions as deprecated wrappers that delegate to the per-book version (mapping packageId → bookIds via the `voice_books.json` join). Mark deprecated in JSDoc.
- **Migration helper:** `migrateEnabledVoicePackagesToBooks()` — runs lazily on first read of `enabled_voice_books` if `enabled_voice_packages` is still set; expands the package list to the underlying book IDs and writes `enabled_voice_books`. Idempotent.

### 1.2 API surface

New routes:
- `GET /api/library/books` — return **all 75 books** (no longer filters), each with `included: bool` flag resolved against `enabled_voice_books`.
- `GET /api/library/included` — return only the included books (in the same categorized shape).
- `PUT /api/library/books/[bookId]` — toggle one book's inclusion. 404 on unknown, 400 on bad body. Response: `{ bookId, included, enabledList }`.
- `DELETE /api/library/books/included` — reset to all-enabled.

Deprecated routes (return 410 Gone, mapped to per-book for one release):
- `GET /api/library/packages` → 410 with `Link: /api/library/books`
- `PUT /api/library/packages/[packageId]` → 410

### 1.3 Resonance filter change

`apps/web/app/api/resonance/route.ts` — the existing filter at line 614 (`isVoicePackageEnabled(meta[m].book_id, enabledPackages)`) becomes `isVoiceBookEnabled(meta[m].book_id, enabledBooks)`. The helper moves from per-package set membership to per-book set membership. Same code shape, different data source.

### 1.4 UI

- `packages/screens/src/word/LibraryBrowser.tsx` — rebuild as two-tab layout (Browse | Included). Per-tier copy: web shows "Add to resonance" / "Remove from resonance"; mobile-free shows "Download · {size}" (placeholder for now, wired in Phase 3). Each book row uses the new `included` flag.
- `packages/screens/src/settings/SettingsScreen.tsx` — remove the "Library Contents" section (lines 177-306). Replace with a single "Manage library" link that deep-links to the Library tab.
- `packages/core/src/data-layer.ts` — add `getLibraryBooks()` (returns categorized with flags), `getIncludedBooks()`, `setBookIncluded(bookId, included)`, `resetIncludedBooks()`. Mark `getLibraryPackages()` etc. as deprecated in JSDoc but keep the interface signatures.
- `apps/web/lib/client-data-layer.ts` — implement the new methods.
- `apps/mobile/lib/local-data-layer.ts` — implement the new methods for the free tier as a stub that returns "download not yet available in this build" for setBookIncluded.

### 1.5 Verification (no deploy until green)

1. `GET /api/library/books` returns all 75 books with `included: true` (default).
2. `GET /api/library/included` returns the same 75.
3. `PUT /api/library/books/augustine-confessions {included: false}` returns 200, `enabledList` has 74 books.
4. `GET /api/library/books` shows `augustine-confessions.included: false`.
5. `GET /api/library/included` no longer includes `augustine-confessions`.
6. `DELETE /api/library/books/included` clears the subset.
7. `POST /api/resonance` with a query that would match Aquinas, after disabling `aquinas-summa`, returns 0 voice cards.
8. The old `/api/library/packages` route returns 410 Gone.
9. Library tab UI has two tabs; Settings has no "Library Contents" section.

## Phase 2 — Mobile SQLite schema + first-launch scripture download (1 day)

### 2.1 New tables (in a new migration in `apps/mobile/src/db/migrations.ts`)

```sql
-- Per-book voice shard download tracking
CREATE TABLE downloaded_shards (
  book_id       TEXT PRIMARY KEY,
  installed_at  INTEGER NOT NULL,
  size_bytes    INTEGER NOT NULL,
  sha256        TEXT NOT NULL,
  model_id      TEXT NOT NULL DEFAULT 'pplx-embed-v1-4b'
);

-- Per-file integrity for each downloaded shard
CREATE TABLE shard_files (
  book_id       TEXT NOT NULL,
  filename      TEXT NOT NULL,  -- 'vectors.bin' | 'idmap.json' | 'corpus.hnsw'
  size_bytes    INTEGER NOT NULL,
  sha256        TEXT NOT NULL,
  downloaded_at INTEGER NOT NULL,
  PRIMARY KEY (book_id, filename),
  FOREIGN KEY (book_id) REFERENCES downloaded_shards(book_id) ON DELETE CASCADE
);

-- Scripture bundle (one row, since there's only one bundle)
CREATE TABLE scripture_bundle (
  version       INTEGER PRIMARY KEY,
  installed_at  INTEGER NOT NULL,
  size_bytes    INTEGER NOT NULL,
  sha256        TEXT NOT NULL,
  model_id      TEXT NOT NULL DEFAULT 'pplx-embed-v1-4b'
);
```

The `installed_packages` table is **dropped** in the same migration. `packageManager.ts` and `modelManager.ts` are deleted.

### 2.2 New manager: `apps/mobile/src/packages/shardManager.ts`

```ts
// Core surface
export async function fetchShardManifest(): Promise<ShardManifest>;
export async function fetchScriptureManifest(): Promise<ScriptureManifest>;

export async function isShardDownloaded(bookId: string): Promise<boolean>;
export async function isScriptureInstalled(): Promise<boolean>;

export async function downloadShard(
  bookId: string,
  onProgress?: (pct: number) => void,
): Promise<void>;  // Streams 3 files with HTTP Range, sha256-verifies, writes to disk + DB
export async function removeShard(bookId: string): Promise<void>;

export async function downloadScriptureBundle(
  onProgress?: (pct: number) => void,
): Promise<void>;  // Same pattern, 4 files

export async function loadScriptureVectors(): Promise<PassageVector[]>;
export async function loadDownloadedShardVectors(): Promise<PassageVector[]>;  // All downloaded books, merged

export function getShardSizeBytes(bookId: string): number | null;  // From manifest, for UI
```

**HTTP Range support:** `expo-file-system` has `createDownloadResumable(url, fileUri, options, callback, resumeData)` — supports Range via the `Range` header. For first-shot, use a single `FileSystem.downloadAsync(url, fileUri, { headers: { Range: 'bytes=0-' } })` which the server answers with 206 Partial Content; the file is written to disk. For resumability across app restarts, `createDownloadResumable` persists `resumeData` to disk.

**Storage path:** `FileSystem.documentDirectory + 'library/' + bookId + '/' + filename` for shards; `... + 'scripture/' + filename` for the bundle.

**Memory budget:** `loadScriptureVectors` + `loadDownloadedShardVectors` together hold the in-memory Float32Array. Total budget is the sum of downloaded shards' vectors.bin sizes. For typical users (10-20 books): 100-500 MB of in-memory vectors. For "all books downloaded": ~2.7 GB. **We must surface this in the UI as a warning** before the user downloads too many.

### 2.3 Rewrite: `apps/mobile/src/embedding/resonanceService.ts:loadLibraryVectors()`

Replace the stub (lines 63-114) with:
```ts
export async function loadLibraryVectors(): Promise<void> {
  if (libraryVectors !== null) return;
  const db = getDatabase();
  if (!db) return;
  try {
    const scripture = await isScriptureInstalled() ? await loadScriptureVectors() : [];
    const downloaded = await loadDownloadedShardVectors();
    libraryVectors = [...scripture, ...downloaded];
  } catch { libraryVectors = []; }
}
```

The `findResonance` brute-force loop (lines 153-160) is unchanged — it just iterates over a smaller array.

### 2.4 Rewrite: `apps/mobile/src/db/libraryLoader.ts`

Replace the empty-asset-load stub with: at first launch, if `scripture_bundle` table is empty, call `downloadScriptureBundle()` (with progress reported to the loading screen), then `loadScriptureVectors()`. Voice books are not loaded at first launch.

### 2.5 Remove: `apps/mobile/src/packages/{packageManager,modelManager}.ts`

Delete the files. The `installed_packages` table is dropped in the migration (2.1).

### 2.6 Data layer mobile: `apps/mobile/src/data/mobileDataLayer.ts`

`getLibraryPackagePrefs`, `setLibraryPackageEnabled`, `resetLibraryPackages` are rewritten:
- `getLibraryPackagePrefs` returns the 3-section structure: `{ scripture: Book[], booksByCategory: { [pkgId]: Book[] }, includedBookIds: string[] }`.
- `setLibraryPackageEnabled` is replaced by `setBookIncluded(bookId, included)` which calls `shardManager.downloadShard` (free) or the cloud API (premium) depending on tier.
- `resetLibraryPackages` is replaced by `resetIncludedBooks` which calls `shardManager.removeShard` for each downloaded book.

### 2.7 Verification

1. First launch downloads the scripture bundle (verify file sizes on disk match the manifest).
2. After first launch, `resonanceService.findResonance("In the beginning God created the heavens")` returns at least one `scripture` card from Genesis 1.
3. With a journal entry that matches a Bible verse, the ambient resonance footnote on mobile shows the Bible card.
4. `mobileDataLayer.getLibraryPackages()` returns the new 3-section structure.
5. The `installed_packages` table no longer exists in the schema.
6. `packageManager.ts` and `modelManager.ts` are deleted (and the imports are gone).
7. Bundle install survives an app restart (the `scripture_bundle` table row is there).

## Phase 3 — Mobile per-book voice shard download (1-2 days)

`shardManager.downloadShard` already exists from Phase 2. This phase wires the UI.

### 3.1 Library tab UI: two-tab layout

`apps/mobile/src/screens/word/LibraryBrowser.tsx` (or wherever it lives — check `apps/mobile/src/screens/word/`):

**Browse tab (default):**
- **Scripture** section header. 66 Bible books, flat list, no toggles. Each row: title, testament (OT/NT), "Read" affordance. Always populated (from the bundled scripture table).
- **Books** section header. 75 voice books grouped by 7 packages. Each row: title, author, era, per-tier affordance:
  - **Web (premium-only):** "Add to resonance" button (or checkmark if included).
  - **Mobile premium:** same cloud button. Triggers `shardManager.downloadShard` opportunistically.
  - **Mobile free:** "Download · {size}" button (or progress bar while downloading, or checkmark if downloaded).

**Included tab:**
- **Scripture** section (always populated — all 66 books).
- **Books** section (only the books the user has opted into on web/premium, or downloaded on free).

A short header above the tabs explains the per-tier copy.

### 3.2 Per-book progress UI

A row's button shows a progress bar (0-100%) while `shardManager.downloadShard` is in flight. Errors show a red "Download failed · Tap to retry" affordance. Already-downloaded books show a green checkmark and a "Remove" affordance (long-press or kebab menu).

### 3.3 Mobile Settings additions

- **"Manage downloads"** entry in Settings. Shows total on-device library size (scripture + downloaded shards), per-book list, and a "Clear all downloaded books" button.
- **"Download over cellular"** toggle. Default off. Gates all shard downloads to Wi-Fi only.
- **"Auto-delete old shards"** toggle. Default off. When on, deletes shard files for books the user has not opened in 30+ days.

### 3.4 Verification

1. Tapping "Download · 35 MB" on `augustine-confessions` writes 3 files to disk, returns when done, sha256s match the manifest.
2. `libraryVectors` after the download contains the ~1,400 Confessions vectors.
3. With a journal entry matching Augustine ("Our hearts are restless until they rest in You"), `findResonance` returns at least one `voice` card from Confessions.
4. `shardManager.removeShard("augustine-confessions")` deletes the files and the row.
5. After removal, `libraryVectors` no longer contains Confessions vectors.
6. A second `downloadShard` for the same book is a no-op (already-downloaded check).
7. The "Download over cellular" toggle, when off, prevents downloads on cellular networks.
8. "Manage downloads" in Settings shows accurate size and per-book list.
9. "Clear all downloaded books" deletes all downloaded shards and clears the Included tab (Scripture is unaffected).

## Phase 4 — Mobile premium opportunistic pre-fetch (1 day)

### 4.1 Sync on app foreground

`apps/mobile/App.tsx` (or wherever the AppState handler lives) — on `AppState` change to `active`, call `dataLayer.syncCloudLibraryPrefs()`. This:

1. GETs `enabled_voice_books` from the server (or `user_settings`).
2. For each book in the cloud enabled set, if it's not already on the device, trigger a background `shardManager.downloadShard` (Wi-Fi only).
3. For each book removed from the cloud set, `shardManager.removeShard` (only if the user is premium — free tier never auto-deletes).

### 4.2 Library tab on open

When the user opens the Library tab, if premium and Wi-Fi: pre-fetch any missing books in `enabled_voice_books`. Sequential (one at a time) to avoid saturating the connection.

### 4.3 Verification

1. On mobile premium, opening the Library tab kicks off background downloads of all books in `enabled_voice_books` not already downloaded.
2. Downloads are sequential (one at a time), not parallel.
3. On app foreground, `enabled_voice_books` is re-read from the server; if it shrank, removed books are evicted from the device.
4. The "Download over cellular" toggle applies to pre-fetches too.

## Loose ends (commit before Phase 0)

These are uncommitted artifacts in the repo from the earlier session work. They should be committed (or pruned) before Phase 0 starts.

- `plans/2026-06-27-library-per-book-opt-in.md` (the source per-book plan — keep, commit)
- `plans/2026-06-27-library-restore-and-opt-in.md` (earlier plan from the start of the session — keep, commit)
- `plans/2026-06-27-mobile-download-pipeline.md` (the source mobile plan — keep, commit)
- `scripts/build-hnsw-chunked.mjs` (script written to chunk the local HNSW build — never used; the background process built it in one shot. **Prune — it adds 0 value**)
- `scripts/library/merge-voice-into-bible.py` (merged bible + voice vectors locally for upload — **commit, it documents the merge shape**)
- `scripts/library/upload-merged-vectors.py` (chunked uploader — **commit, but it can be replaced by the Phase 0.3 manifest endpoints for downloads; it stays relevant for one-off admin uploads**)

## File-by-file change summary

| File | Phase | Change |
|---|---|---|
| `scripts/build-library-shards.mjs` | 0 | NEW |
| `scripts/restore-volume.py` | 0 | Add UPLOAD entries for shards + scripture |
| `apps/web/app/api/library/shards/manifest/route.ts` | 0 | NEW |
| `apps/web/app/api/library/shards/[bookId]/[file]/route.ts` | 0 | NEW (HTTP Range) |
| `apps/web/app/api/library/scripture/manifest/route.ts` | 0 | NEW |
| `apps/web/app/api/library/scripture/bundle/[file]/route.ts` | 0 | NEW (HTTP Range) |
| `apps/web/lib/library-prefs.ts` | 1 | Add per-book helpers; migration helper; keep per-package as deprecated |
| `apps/web/app/api/library/books/route.ts` | 1 | Return all 75 with per-book `included` flag |
| `apps/web/app/api/library/books/[bookId]/route.ts` | 1 | NEW (PUT) |
| `apps/web/app/api/library/books/included/route.ts` | 1 | NEW (GET, DELETE) |
| `apps/web/app/api/library/packages/route.ts` | 1 | Return 410 Gone (deprecated) |
| `apps/web/app/api/library/packages/[packageId]/route.ts` | 1 | Return 410 Gone (deprecated) |
| `apps/web/app/api/resonance/route.ts` | 1 | Change filter to per-book set |
| `packages/core/src/data-layer.ts` | 1, 2 | Add per-book methods; mark per-package deprecated |
| `packages/core/src/types.ts` | 1 | Add `LibraryBook` with `included: bool` |
| `apps/web/lib/client-data-layer.ts` | 1 | Implement per-book methods |
| `apps/mobile/lib/local-data-layer.ts` | 1 | Stub the free-tier per-book methods |
| `packages/screens/src/word/LibraryBrowser.tsx` | 1, 3 | Two-tab layout; per-tier copy |
| `packages/screens/src/settings/SettingsScreen.tsx` | 1 | Remove "Library Contents" section; add "Manage library" link |
| `apps/mobile/src/db/migrations.ts` | 2 | NEW migration: drop installed_packages, add downloaded_shards/shard_files/scripture_bundle |
| `apps/mobile/src/db/libraryLoader.ts` | 2 | First-launch scripture bundle download |
| `apps/mobile/src/packages/shardManager.ts` | 2, 3, 4 | NEW — fetchManifest, downloadShard, removeShard, loadScriptureVectors, loadDownloadedShardVectors, getShardSizeBytes |
| `apps/mobile/src/embedding/resonanceService.ts` | 2 | Replace stub loadLibraryVectors with shardManager calls |
| `apps/mobile/src/packages/packageManager.ts` | 2 | DELETE |
| `apps/mobile/src/packages/modelManager.ts` | 2 | DELETE |
| `apps/mobile/src/data/mobileDataLayer.ts` | 2 | Rewrite per-book methods to use shardManager |
| `apps/mobile/src/screens/word/LibraryBrowser.tsx` | 3 | Two-tab mobile UI; per-tier copy; progress bar |
| `apps/mobile/src/screens/settings/SettingsScreen.tsx` | 3 | "Manage downloads", "Download over cellular", "Auto-delete old shards" |
| `apps/mobile/App.tsx` (or equivalent) | 4 | AppState handler → syncCloudLibraryPrefs |
| `apps/mobile/src/packages/shardManager.ts` | 4 | Add pre-fetch methods |

## Risks and unknowns

- **Volume size:** Phase 0 needs the Railway volume to grow to 16 GB (from current ~7 GB usable). If that's a problem, the scripture bundle ships as a separate "opt-in download" the user triggers from Settings. **Decision needed before Phase 0.**
- **HTTP Range on Railway edge:** If the reverse proxy strips `Range` headers, mobile downloads still work (just not resumable) for files under the proxy's max. Verify in Phase 0.5; if Range is stripped, the plan is still viable, just with longer download times.
- **`aquinas-summa` is 420 MB** (single book). A user who wants Aquinas spends 15% of the entire voice library's disk. Acceptable for v1; flagged for v2 sub-sharding.
- **No on-device HNSW:** brute-force cosine in JS over 100k-500k vectors is in the 100-500ms range per query. Useable but not great. v2 will wire a real HNSW lib if one becomes available for RN.
- **No background downloads:** OS-level background download services (NSURLSession, DownloadManager) are out of scope. Downloads only happen when the app is in the foreground.
- **One embedding model on mobile:** `pplx-embed-v1-4b` only. The `model_id` columns on the schema accommodate future model switching.
- **No delta updates:** if a book gets new content, the user re-downloads the full shard.
- **No analytics:** we don't track what people download.
- **Loose-end scripts:** `scripts/build-hnsw-chunked.mjs` was an early-attempt script never used; the background-process build ran in one shot. Prune it.

## Done-when

The Library tab on web and mobile has two tabs (Browse | Included) and two sections in each tab: **Scripture** (66 Bible books, always present) and **Books** (75 voice-of-the-Church books, per-book opt-in). On web/mobile-premium, "Add to resonance" persists to `user_settings.enabled_voice_books`. On mobile free, "Download · {size}" pulls the per-book shard. Settings → "Library Contents" is gone; replaced by "Manage library" (web) and "Manage downloads" (mobile). On mobile first launch, the Scripture bundle (~3 GB) downloads automatically. Mobile premium opportunistically pre-fetches shards for its cloud opt-ins.

Shipped as one batch. Per Michael's locked-in instruction. No code written yet.
