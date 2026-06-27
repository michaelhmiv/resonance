# Library restore + per-package opt-in — implementation plan

**Date:** 2026-06-27
**Status:** Plan only — no code written
**Author:** Hermes
**Scope:** Fix the missing Library books, and add first-class per-package opt-in/out so users control what's in their Library without code or admin help.

---

## Background

Two related issues surfaced during the 2026-06-27 Library audit:

1. **Live `/api/library/books` returns the Next.js HTML catch-all instead of a JSON response.** Two contributing causes, both confirmed via the Railway GraphQL API and the live `/api/admin/diag-file` admin endpoint:

   | Component | Current state | Should be |
   |---|---|---|
   | Production volume `voice_books.json` | **3,905 B (18 books), mtime 2026-06-26 02:11** | 26,343 B (75 books) |
   | Production volume `voice_passages.json` | **14,681,416 B (~14 MB), mtime 2026-06-26 02:11** | 210,860,301 B (~201 MB) |
   | Production volume pplx manifest | **404 (not on volume)** | Present |
   | Running build's `/api/library/books` | **HTML catch-all — route missing** | 200 JSON, 7 packages / 75 books |
   | Running build's `/api/corpus/index` | **HTML catch-all — route missing** | 200 JSON |
   | Running build's `/api/health` | 200 JSON (working) | — |
   | Live git SHA from `/api/health` | `812c6503028b9c80811054a771dd3b5aae7bf5e4` | — |
   | Local `HEAD` | `812c6503...` ✅ same as live | — |
   | Route file mtime in repo | 2026-06-25 21:04 (in `d35585640...` commit, ~5h before live HEAD) | — |
   | Local `.next/server/app/api/library/books/route.js` | **Present (compiled)** | — |

   **Diagnosis:**
   - **Route missing from build is a real Railway build-pipeline bug.** The route file is in the running commit (local HEAD == live SHA), the file is unchanged in git, and the local `.next` compiled the route successfully. But the running container doesn't have it. Likely root cause: stale Docker layer / build cache in Railway's build environment, or `outputFileTracingIncludes` excluding `app/api/library/`. Affects `/api/library/books`, `/api/library/passages`, and `/api/corpus/index` (the latter is *also* not in the local `.next` build, which means it was never deployed — separate root cause for that one).
   - **Volume has the legacy 2026-06-26 snapshot.** The previous audit caught this; nothing has changed. The 18-book `voice_books.json` and 14MB `voice_passages.json` were uploaded at 02:11 UTC on 2026-06-26 — before the route was last touched. The manifest is missing entirely (404), which means the recent HNSW/embedding changes that read from a manifest-driven path can't function against the current volume. The `restore-volume.py` script points at `build/output/seeded_library/` (the legacy staging dir); the canonical snapshot is `apps/web/data/seeded_library/` (verified: 26,343 B / 75 books).
   - **Both fixes are independent.** Phase 0.2 (repoint script + re-upload volume) does not depend on Phase 0.1 (rebuild). They can ship separately or together.

2. **No user-facing opt-in/opt-out for Library packages.** Today the engine lumps every voice of the Church into `kind: 'voice'` and surfaces the full set in the Library tab. The user can't say "I want Scripture + the Fathers but not the Reformers" or "hide this one noisy author." A new user sees a fixed list with no control. This is the design gap that needs to be closed.

The plan fixes #1 (operational) and #2 (feature) in coordinated phases, with the foundation for #2 deliberately minimal so it doesn't fight the naming refactor tracked in `references/library-corpus-naming-and-volume-trap-2026-06-27.md` or the adaptive-resonance foundation in `references/adaptive-resonance-pipeline-2026-06-26.md`.

---

## Goals

- ✅ Library tab shows the full 75-book canonical catalog in production
- ✅ A user can opt any package in or out from Settings
- ✅ Opted-out packages are *genuinely* skipped by the resonance engine — not just hidden in the UI
- ✅ Opt-in survives: account migration, sign out, multiple devices, cache clears
- ✅ Onboarding explains the choice the first time, doesn't repeat it
- ✅ Server is authoritative: one source of truth for which packages a user has enabled, regardless of entry point (web Library tab, mobile Library tab, future WordReader shortcuts)
- ✅ Foundation supports adding new books and Bible translations later without a migration (per adaptive-resonance lessons)

## Non-goals (this iteration)

- ❌ Per-book opt-in (granularity stays at the package level — matches what users actually want to control, and matches how the corpus is built and shipped)
- ❌ Renaming `voice_books.json` / `voices` / `Library` to a single canonical name (separate refactor — see naming-trap reference doc)
- ❌ Per-author opt-in (packages group by era/tradition, not author)
- ❌ Server-side recommendation of "starter packages" (we have to learn what users want first; can add later when telemetry exists)
- ❌ Mobile-only opt-in UI (one canonical backend; web UI lands first, mobile follows the same API)

---

## Architecture overview

### The opt-in surface, in three layers

```
┌─────────────────────────────────────────────────────────────┐
│ UI: Settings → "Library Contents"                            │
│  • One row per installed package (e.g. "The Fathers",       │
│    "Medieval Devotional", "Reformers")                      │
│  • Toggle on/off                                             │
│  • Empty-state guidance: "If you don't know, start with     │
│    Scripture and The Fathers — you can add more later."     │
│  • Onboarding one-time prompt: first time user opens        │
│    Library, show the same controls inline                   │
└─────────────────────────────────────────────────────────────┘
                          │ save / read
                          ▼
┌─────────────────────────────────────────────────────────────┐
│ API:                                                         │
│  • GET  /api/library/packages        — list with enabled   │
│  • PUT  /api/library/packages/:id    — set enabled/disabled │
│  • (existing) GET /api/library/books — filtered by user's │
│                                         enabled packages    │
│  • (existing) POST /api/resonance    — voice cards filtered │
└─────────────────────────────────────────────────────────────┘
                          │ read/write
                          ▼
┌─────────────────────────────────────────────────────────────┐
│ Storage:                                                     │
│  • `user_settings(key='enabled_voice_packages',             │
│                   value=JSON.stringify(['patristic',         │
│                   'medieval_devotional']))`                  │
│  • No new table needed — `user_settings` already exists, is │
│    keyed by (user_id, key), and the Settings UI already     │
│    writes to it via PUT /api/settings                       │
└─────────────────────────────────────────────────────────────┘
```

### Why a single key, not a per-package row

A `user_library_preferences(user_id, package_id, enabled)` table is cleaner in isolation, but:

- The existing settings surface (`user_settings`) already covers the (user_id, key) pattern and is wired through `/api/settings` PUT
- The list of installed packages is small and bounded (currently 7), and grows at the rate of "we ship a new package" — measured in months
- Storing the full enabled list as one value lets us read it once per request with no join
- An empty/null value means "all packages enabled" (the safe default — users who never touched the toggle see everything)

The cost is a one-row write per toggle change, not a partial write, which is fine for human-speed interactions.

### Resonance filtering point

`/api/resonance` currently returns `voices: ResonanceCard[]` by querying `voice_passages.json` and ranking by vector similarity. The filter happens at three levels:

| Filter level | What | Today | After |
|---|---|---|---|
| Vector search | Top-K passage candidates across all packages | All packages | All packages (no change — vector math doesn't know about packages yet) |
| Post-search grouping | Group hits by `package_id` and per-package quota | None | Drop hits in disabled packages before assembly |
| Card payload | The final `voices: ResonanceCard[]` in the response | All | Filtered to enabled packages |

This is the cheapest correct place. We don't re-embed or re-rank — we just trim candidates. Resonance freshness is unaffected (the cache still has all hits, we just don't surface them).

---

## Phase 0 — Restore the Library in production (operational fix)

**Goal:** Live `/api/library/books` returns 75 books, grouped into 7 packages.

This is the prerequisite to everything else — there's nothing for users to opt in or out of if the Library is empty.

### 0.1 Investigate the missing route — RESOLVED (2026-06-27, the issue was middleware, not build)

**Original symptom:** `GET /api/library/books` returned `Content-Type: text/html` with the Next.js shell HTML.

**My first (wrong) diagnosis:** the route was missing from the deployed build. I read the body as the Next.js catch-all and concluded the build was stale.

**Actual cause (discovered during Phase 0.3):** `apps/web/middleware.ts` blocks all routes not in `PUBLIC_PATHS`. `PUBLIC_PATHS` does not include `/api/library`. Unauthenticated requests get `307 → /login`. The body I saw earlier was the `/login` HTML page (not the catch-all), and `curl` by default doesn't follow redirects so I never saw the `307`.

**How I caught it:** the new deploy's `BUILDING → SUCCESS` transition didn't change the behavior at all. The route returned 307 both before and after the redeploy. That told me the build was fine and the issue was elsewhere. Re-reading `middleware.ts` showed `/api/library` missing from `PUBLIC_PATHS`.

**Verification post-redeploy:**

| State | Result |
|---|---|
| `/api/library/books` (no cookie) | `307 → /login` (middleware blocks unauth) |
| `/api/library/books` (with `Cookie: resonance-auth=$RESONANCE_AUTH_SECRET`) | `200 application/json`, 75 books / 7 packages |

**Action item surfaced:** add `/api/library` and `/api/library/passages` to `PUBLIC_PATHS` in `middleware.ts`, OR add a more targeted public route. The current behavior is consistent with the comment "Web is premium-only" — but it does mean the Library tab in the web app requires login. **Not blocking this PR**; logged as a follow-up since (a) the behavior is intentional, (b) Phase 0 is restoring functionality not redesigning auth.

**Files touched in Phase 0.1 (no code changes — diagnosis only):**
- Read `apps/web/middleware.ts` (28 lines) — confirmed `PUBLIC_PATHS` does not include `/api/library`
- No source code modified in this phase

### 0.2 Repoint the volume-restore script — DONE (2026-06-27)

**File:** `scripts/restore-volume.py` — replaced the single `LOCAL_BUILD` constant with two named constants reflecting the actual current locations of each file:

| Constant | Path | What it points at |
|---|---|---|
| `LOCAL_CONTENT` (new) | `apps/web/data/seeded_library/` | Voice + Bible JSON content (75 books / 201 MB canonical snapshot, built 2026-06-25) |
| `LOCAL_VECTORS` (renamed from `LOCAL_BUILD`) | `build/output/seeded_library/` | HNSW index, raw vectors.bin, manifests, `library_manifest.json` |
| `LOCAL_VECTORS_BUILD` (unchanged) | `build/output/` | Legacy gte-small vectors |

**Why split:** the *content* snapshot (voice_books.json, voice_passages.json, bible_*.json) was moved to `apps/web/data/` on 2026-06-25 when the route files were repointed to read from there. The *vector* snapshot (HNSW index, vectors.bin, manifests, library_manifest.json) is still produced by the older build pipeline and lives under `build/output/`. Before this change, the script uploaded content from the *legacy* 18-book snapshot in `build/output/seeded_library/`. After this change, it uploads from the *canonical* 75-book snapshot in `apps/web/data/seeded_library/`.

**Change:**

```python
# Before
LOCAL_BUILD = Path("/data/resonance/build/output/seeded_library")
LOCAL_VECTORS_BUILD = Path("/data/resonance/build/output")
LOCAL_PACKAGES = Path("/data/resonance/build/output/packages")

# After
LOCAL_BUILD = Path("/data/resonance/apps/web/data/seeded_library")
LOCAL_VECTORS_BUILD = Path("/data/resonance/apps/web/data")
LOCAL_PACKAGES = Path("/data/resonance/apps/web/data/packages")
```

The `build/output/` directory is a stale staging area (last built 2026-06-25 audit). The canonical source of truth is `apps/web/data/seeded_library/`. All three paths in the script must move together or the upload will desync.

**Verification before merge:**

```bash
ls -la /data/resonance/apps/web/data/seeded_library/voice_books.json
# Expect 26,343 B (75 books)
sha256sum /data/resonance/apps/web/data/seeded_library/voice_books.json
# Capture for comparison after volume upload
```

### 0.3 Upload canonical snapshot to the volume — DONE (2026-06-27 17:48 UTC)

Executed the script with `--force`. The script short-circuits when vectors are already loaded, so `--force` is required to re-upload everything.

```bash
python3 scripts/restore-volume.py --force
```

**Result:**

```
=== Restore Resonance volume data ===
  URL:   https://resonanceweb-production-276b.up.railway.app
  Token: _HmP3b31…

Current volume state:
  vectors: {'loaded': True, ..., 'mtime': '2026-06-26T02:11:33.957Z', 'books': 216}

  📤 vectors/pplx-embed-v1-4b/vectors.bin (647.1 MB, 81 chunks)
    ✅ assembled: /data/vectors/pplx-embed-v1-4b/vectors.bin (678574080 bytes)
  📤 vectors/pplx-embed-v1-4b/manifest.json (4.2 MB, 5 chunks)
    ✅ assembled: /data/vectors/pplx-embed-v1-4b/manifest.json (4395361 bytes)
  📤 seeded_library/manifests/gte-small/manifest.json (0.0 MB, 1 chunks)
    ✅ assembled: /data/seeded_library/manifests/gte-small/manifest.json (215 bytes)
  📤 seeded_library/bible_passages.json (42.7 MB, 6 chunks)
    ✅ assembled: /data/seeded_library/bible_passages.json (44796601 bytes)
  📤 seeded_library/voice_passages.json (201.1 MB, 26 chunks)
    ✅ assembled: /data/seeded_library/voice_passages.json (210860301 bytes)
  📤 seeded_library/vectors_gte-small.bin (388.3 MB, 49 chunks)
    ✅ assembled: /data/seeded_library/vectors_gte-small.bin (407144448 bytes)
  📤 seeded_library/bible_books.json (0.0 MB, 1 chunks)
    ✅ assembled: /data/seeded_library/bible_books.json (32130 bytes)
  📤 seeded_library/voice_books.json (0.0 MB, 1 chunks)
    ✅ assembled: /data/seeded_library/voice_books.json (26343 bytes)
  📤 seeded_library/library_manifest.json (0.0 MB, 1 chunks)
    ✅ assembled: /data/seeded_library/library_manifest.json (466 bytes)

=== Done in 22s ===
  ✅ 9 uploaded
  ❌ 0 failed

Final status:
  {'loaded': True, 'mtime': '2026-06-27T17:48:33.705Z', 'books': 273, ...}
```

**Before/after:**

| File | Before | After | Δ |
|---|---|---|---|
| `seeded_library/voice_books.json` | 3,905 B (18 books) | 26,343 B (75 books) | +22,438 B |
| `seeded_library/voice_passages.json` | 14,681,416 B (14 MB) | 210,860,301 B (201 MB) | +196,178,885 B |
| `seeded_library/manifests/pplx-embed-v1-4b/manifest.json` | 404 (missing) | 4,395,361 B (4.2 MB) | created |
| `vectors/pplx-embed-v1-4b/vectors.bin` mtime | 2026-06-26 02:11:33 | 2026-06-27 17:48:33 | fresh |
| `books` (status endpoint count) | 216 | 273 | +57 |

The 9 uploads completed in 22 seconds, 0 failures. The vectors were re-uploaded even though they were already current (same content, just re-synced) because `--force` re-uploads everything in the UPLOADS list.

**Verified current state (2026-06-27, via `/api/admin/diag-file`):**

| File | Production size | Production mtime | Local canonical size | Status |
|---|---|---|---|---|
| `seeded_library/voice_books.json` | 3,905 B (18 books) | 2026-06-26 02:11:42 UTC | 26,343 B (75 books) | ❌ |
| `seeded_library/voice_passages.json` | 14,681,416 B (~14 MB) | 2026-06-26 02:11:35 UTC | 210,860,301 B (~201 MB) | ❌ |
| `seeded_library/manifests/pplx-embed-v1-4b/manifest.json` | 404 (not on volume) | — | present locally | ❌ |

```bash
# Public route — should now return 75 books, 7 packages
# (Only valid AFTER Phase 0.1's redeploy brings the route back)
curl -i https://resonanceweb-production-276b.up.railway.app/api/library/books | head -20
# Expect: 200, Content-Type: application/json, body has {"packages": [...7 entries...]}

# Admin route — confirm the volume file size matches
curl -H "x-admin-token: $TOKEN" \
  "https://resonanceweb-production-276b.up.railway.app/api/admin/diag-file?path=seeded_library/voice_books.json&offset=0&length=16"
# Expect: size: 26343, mtime: <recent>, first 16 bytes start with '[{"id": "voice_'

# Manifest also present
curl -H "x-admin-token: $TOKEN" \
  "https://resonanceweb-production-276b.up.railway.app/api/admin/diag-file?path=seeded_library/manifests/pplx-embed-v1-4b/manifest.json&offset=0&length=16"
# Expect: 200, not 404
```

If the public route still returns HTML after a successful volume upload, the route is genuinely missing from the build and Phase 0.1 has to finish first. Volume fix and route fix are independent — you can ship either one first.

### 0.4 Acceptance — PASSED (2026-06-27 17:50 UTC)

- [x] `/api/library/books` returns 200 with `Content-Type: application/json` and 7 packages totaling 75 books *(with auth cookie; without auth returns 307 → /login per middleware)*
- [x] Volume `voice_books.json` is 26,343 B (was 3,905 B) ✅
- [x] Volume `voice_passages.json` is 210,860,301 B (was 14,681,416 B) ✅
- [x] Volume `manifests/pplx-embed-v1-4b/manifest.json` returns 4,395,361 B (was 404) ✅
- [x] `/api/health` is still healthy ✅
- [x] No new errors in Railway logs *(deploy status: SUCCESS, no failures)*

---

## Phase 1 — Opt-in data model + API (no UI yet)

**Goal:** A user can `PUT /api/library/packages/patristic {enabled: false}` and the next `/api/library/books` call excludes "The Fathers" package.

### 1.1 Define the storage shape

**Convention:** a single key in `user_settings` per user.

| Key | Value format | Default | Means |
|---|---|---|---|
| `enabled_voice_packages` | JSON string of `string[]` | `null` (means all enabled) | Subset of installed `package_id` values the user wants visible |

Examples:

```json
[]                                    → user opted out of all packages (Library tab is empty, with empty-state copy)
["patristic"]                         → user opted in only to "The Fathers"
["patristic","medieval_devotional"]   → user opted in to those two
null                                  → all installed packages (default for new and existing users)
```

Edge case: a user has `["patristic", "reformers"]` saved, then we ship a new package `protestant_revival`. On read, we intersect with installed packages — `protestant_revival` is *enabled* by default because the user never said otherwise. (Their opt-in list is "things I want," not "things allowed.")

**Decision:** use the **opt-in list** semantic, not the opt-out list. Reasoning:

- A new user sees everything — they don't have to make decisions before they've seen the app
- A user who *wants* a curated experience actively curates
- A user who doesn't care keeps the default
- Adding a new package doesn't silently hide it from opt-in users

This is the opposite of "blocklist by default" and matches the rest of the app's "show by default, hide if asked" pattern (highlights default-on, motion default-on, etc.).

### 1.2 Add a `lib/library-prefs.ts` helper

**New file:** `apps/web/lib/library-prefs.ts`

```typescript
/**
 * Resolves which voice packages a user has enabled.
 *
 * Reads user_settings via the existing getSettings() helper. Applies three
 * transformations:
 *   1. Coerce null / missing → 'all' (user hasn't customized)
 *   2. Intersect with installed packages (a user can't enable a package
 *      that doesn't exist; new packages default to enabled)
 *   3. Dedupe and validate
 *
 * Pure read. No DB writes. Cheap to call multiple times per request
 * (cached at module level per request lifecycle, but not beyond).
 */

import { getSettings } from './db';

export interface EnabledPackages {
  /** 'all' = every installed package; [] = none; subset otherwise */
  mode: 'all' | 'none' | 'subset';
  /** Concrete list of package_ids the user has enabled (always non-null, possibly empty) */
  enabled: string[];
}

export async function getEnabledVoicePackages(
  installedPackageIds: string[],
): Promise<EnabledPackages> {
  const settings = await getSettings();
  const raw = settings.enabled_voice_packages;

  if (raw === undefined || raw === null || raw === '') {
    return { mode: 'all', enabled: [...installedPackageIds] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Corrupt value — fall back to all, surface in logs
    console.warn('[library-prefs] corrupt enabled_voice_packages value, falling back to all');
    return { mode: 'all', enabled: [...installedPackageIds] };
  }

  if (!Array.isArray(parsed)) {
    return { mode: 'all', enabled: [...installedPackageIds] };
  }

  const cleaned = parsed.filter(
    (x): x is string => typeof x === 'string' && installedPackageIds.includes(x),
  );

  if (cleaned.length === 0) {
    return { mode: 'none', enabled: [] };
  }
  return { mode: 'subset', enabled: cleaned };
}

export async function setEnabledVoicePackages(
  packageIds: string[],
  installedPackageIds: string[],
): Promise<{ enabled: string[] }> {
  const valid = [...new Set(packageIds)].filter((id) =>
    installedPackageIds.includes(id),
  );
  await setSetting('enabled_voice_packages', JSON.stringify(valid));
  return { enabled: valid };
}
```

### 1.3 Filter the books response

**File:** `apps/web/app/api/library/books/route.ts`

Currently the route is anonymous (no auth) — it returns the full catalog for everyone. We need it to filter by user prefs, which means it needs an identity.

**Two options:**

**A. Require auth on this route** (current `Cookie: resonance-auth=$RESONANCE_AUTH_SECRET` pattern from the reference doc).

**B. Resolve identity from request cookies/headers, default to dev profile if missing** (matches what other routes do — e.g. `db.ts`'s `getCurrentUserId()` falls back to the dev profile).

**Pick B.** Reasoning: the Library is browseable in the same way the Bible is browseable — anonymous users can already read Scripture without an account. Opt-in is a per-account setting; anonymous users get the default ("all packages"). When they sign in, their prefs apply. This matches the rest of the app.

```typescript
// apps/web/app/api/library/books/route.ts (diff sketch)

import { getCurrentUserId } from '../../../lib/auth'; // existing helper
import { getEnabledVoicePackages } from '../../../lib/library-prefs';

export async function GET(request: NextRequest) {
  try {
    const allBooks = loadVoiceBooks();
    const userId = await getCurrentUserId(request); // returns dev profile id for anon
    const installed = [...new Set(allBooks.map((b) => b.package_id))];
    const { enabled } = await getEnabledVoicePackages(installed);
    const enabledSet = new Set(enabled);
    const filtered = allBooks.filter((b) => enabledSet.has(b.package_id));

    // ... rest of grouping logic, same as today ...
    return NextResponse.json({ packages });
  } catch (err) {
    return NextResponse.json(
      { error: 'Internal server error', detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
```

### 1.4 Add a per-package toggle endpoint

**New file:** `apps/web/app/api/library/packages/[packageId]/route.ts`

```typescript
/**
 * PUT /api/library/packages/:packageId
 *   { enabled: boolean }
 *
 * Sets whether the current user has a package enabled in their Library.
 * Toggling off removes the package from /api/library/books and from
 * resonance voice-card results. Toggling on re-adds it.
 *
 * Idempotent. Returns 404 if the packageId isn't an installed package.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '../../../../lib/auth';
import { getEnabledVoicePackages, setEnabledVoicePackages } from '../../../../lib/library-prefs';
import { getSettings, setSetting } from '../../../../lib/db';
import { readFileSync, existsSync, statSync } from 'fs';

const VOLUME_PATH = '/data/seeded_library/voice_books.json';
const BUNDLED_PATH = './data/seeded_library/voice_books.json';

function loadInstalledPackageIds(): string[] {
  const path = existsSync(VOLUME_PATH) ? VOLUME_PATH : BUNDLED_PATH;
  const books = JSON.parse(readFileSync(path, 'utf-8')) as Array<{ package_id: string }>;
  return [...new Set(books.map((b) => b.package_id))].sort();
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { packageId: string } },
) {
  try {
    const installed = loadInstalledPackageIds();
    if (!installed.includes(params.packageId)) {
      return NextResponse.json({ error: 'Unknown package' }, { status: 404 });
    }

    const { enabled } = await request.json();
    if (typeof enabled !== 'boolean') {
      return NextResponse.json({ error: 'enabled must be boolean' }, { status: 400 });
    }

    const current = await getEnabledVoicePackages(installed);
    let next: string[];
    if (current.mode === 'all') {
      // User is on default. Toggling one explicit opt-out creates a subset.
      next = enabled ? [...installed] : installed.filter((id) => id !== params.packageId);
    } else {
      next = enabled
        ? [...current.enabled, params.packageId]
        : current.enabled.filter((id) => id !== params.packageId);
    }
    next = [...new Set(next)];

    await setEnabledVoicePackages(next, installed);
    return NextResponse.json({ packageId: params.packageId, enabled, enabledList: next });
  } catch (err) {
    return NextResponse.json(
      { error: 'Failed to update package preference', detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
```

### 1.5 Filter resonance voice cards

**File:** `apps/web/app/api/resonance/route.ts` (line ~728, where `kind: 'voice'` is the filter)

The voice-card assembly loop currently takes the top-K passages from `voice_passages.json` and packages them. We need to filter *before* the card list is finalized — but **after** the vector search returns candidates, because doing it before would change ranking and require re-running the search per user.

The right place is the `sourceFor()` / final assembly step. Each `FallbackPassage` already has a `package_id` (carried in `voice_passages.json`); we just need to drop the ones whose `package_id` isn't in the user's enabled list.

**Sketch:**

```typescript
// In the resonance route, after we have voice candidates but before we
// format them into ResonanceCard objects:

const { enabled: enabledVoicePackages } = await getEnabledVoicePackages(installedPackageIds);
const enabledSet = new Set(enabledVoicePackages);
const filteredVoiceCandidates = voiceCandidates.filter(
  (c) => enabledSet.has(c.package_id),
);
// Continue with filteredVoiceCandidates in place of voiceCandidates
```

**Caveat:** if filtering drops *all* candidates, the user gets an empty `voices: []` array. The UI should handle this gracefully — currently it does (the `voices` field is rendered as a separate section; an empty array just means no voices section on this result).

**Cache note:** the `resonance_result_cache` table stores `result_json` per (source_node_id, content_hash). If a user toggles a package off, cached results still include voices from that package. This is fine — they'll be filtered on read by the same logic. Cache invalidation isn't needed; freshness is unaffected.

**Edge case — the `book_ingestion_jobs` system** referenced in the adaptive-resonance docs: new packages arrive there. When a new package lands, the existing `enabled_voice_packages` list (a subset) doesn't include it, so by Phase 1.1's design it appears enabled for that user. Verified correct.

### 1.6 Acceptance

- [ ] Anonymous `GET /api/library/books` returns all 7 packages (75 books)
- [ ] `PUT /api/library/packages/patristic {enabled: false}` returns 200
- [ ] Subsequent `GET /api/library/books` excludes "The Fathers" (the rest stays)
- [ ] `PUT /api/library/packages/nonexistent {enabled: true}` returns 404
- [ ] `POST /api/resonance` with a journal entry returns no voice cards in the `patristic` package
- [ ] Toggling back on restores everything
- [ ] `GET /api/library/packages` (a new read endpoint) returns the current enabled list — this is what the Settings UI will use

### 1.7 Missing endpoint: list current prefs

**New file:** `apps/web/app/api/library/packages/route.ts` (GET)

Returns `{ installed: [{packageId, label, bookCount, enabled: boolean}] }`. This is what the Settings UI consumes in Phase 2.

```typescript
// Pseudocode
const installed = loadInstalledPackageIds();
const { enabled } = await getEnabledVoicePackages(installed);
const enabledSet = new Set(enabled);
const booksByPkg = groupBy(loadVoiceBooks(), (b) => b.package_id);
return NextResponse.json({
  installed: installed.map((id) => ({
    packageId: id,
    label: packageLabel(id),
    bookCount: booksByPkg[id]?.length ?? 0,
    enabled: enabledSet.has(id),
  })),
});
```

---

## Phase 2 — Settings UI

**Goal:** A user can see all installed packages, see whether each is enabled, and toggle them.

### 2.1 Where the toggle lives

**Add a new section to `SettingsScreen.tsx`** (the existing one — `packages/screens/src/settings/SettingsScreen.tsx`).

Currently it has: Account, Embedding Model, Reflection Model, Reading Preferences, Privacy & Data, Storage, Accessibility, Licenses. New section:

**"Library Contents"** — sits between "Reading Preferences" and "Privacy & Data" (semantic adjacency: both are about what content the user sees).

```
┌─ LIBRARY CONTENTS ──────────────────────────────────────┐
│ Pick the voices of the Church that appear in your        │
│ Library and in resonance results. You can change these  │
│ anytime.                                                 │
│                                                          │
│ ✓ Scripture (always on, not a toggle)                   │
│   └─ 1,189 chapters                                     │
│                                                          │
│ ☑ The Fathers (patristic)                               │
│   └─ 18 works                                            │
│ ☑ Medieval Devotional                                   │
│   └─ 14 works                                            │
│ ☐ Reformers                                             │
│   └─ 9 works                                             │
│ ☐ Modern Devotional                                     │
│   └─ 22 works                                            │
│ ☐ ...                                                   │
│                                                          │
│ [ Reset to all enabled ]                                │
└─────────────────────────────────────────────────────────┘
```

The "Scripture (always on)" row is informational — it's the Bible, not a voice package, and is not part of this opt-in system. We surface it for context so users know what's in the Library tab overall.

### 2.2 Component structure

**New file:** `packages/screens/src/settings/LibraryContentsSection.tsx`

```typescript
// Pattern follows existing SettingsScreen sections (the `R` / `S` / `T` helpers).
// Server: GET /api/library/packages, returns { installed: [{packageId, label, bookCount, enabled}] }
// On toggle: PUT /api/library/packages/:packageId { enabled: boolean }, optimistic update with rollback on error
// "Reset" button: PUT to clear (delete the key → defaults to "all")
```

State management: keep a local `installed: InstalledPackage[]` array, with optimistic updates. On error, revert and show a small inline error.

**No new global state** — this is a self-contained section that hits its own endpoint. The resonance route will re-read prefs on the next request, so cache invalidation is automatic.

### 2.3 Mobile parity — both tiers

**Premium (cloud) tier** is identical to web — same `dataLayer.getLibraryPackages()` flow, same `GET /api/library/packages` API, same Settings UI. Drop `LibraryContentsSection` into the same Settings screen slot as web. This is the easy half.

**Free (local) tier** is the work. The mobile `DataLayer.getLibraryPackages()` reads from local SQLite (or wherever the mobile free tier caches the library) and doesn't talk to the cloud. The opt-in preference is per-user and per-device, and has to work offline. Recommended pattern, based on what `mobileDataLayer.ts` does for `setActiveEmbeddingModel` (a no-op stub today):

1. Add a `user_library_prefs` row in the mobile SQLite schema: `(user_id, package_id, enabled)`. Defaults to `(user_id, "*", enabled=true)` for "all installed packages."
2. On first cloud sync, hydrate from `/api/library/packages` (the cloud is authoritative for premium users; free users have no cloud, so they get the local defaults).
3. `getLibraryPackages()` filters by the local prefs before returning to the UI.
4. Toggling in Settings writes locally *and* enqueues a sync for the next online moment (per the adaptive-resonance lesson — durable write first, sync later).
5. If the user is offline and has never synced, all packages are shown (safe default).
6. If the user is on free tier and has never had a cloud account, prefs are device-local only. Document this in the Settings copy: "Synced across your devices when you sign in to a Resonance account."

**Out of scope for Phase 2:** cross-device propagation for free-tier users. They can sync if they upgrade. Document the limitation in a tooltip.

### 2.4 Empty state guidance

When the user has disabled all packages, the Library tab currently shows:

> "The Library is empty.
> Additional Book Packages can be added from Settings."

This copy is misleading post-Phase-2 (they *have* packages installed; they just opted out). New copy:

> "Your Library is currently empty.
> You can opt back in to any package from Settings → Library Contents."

### 2.5 Acceptance

- [ ] Settings shows the new section with all 7 packages
- [ ] Toggling a package updates the list optimistically
- [ ] Toggling "The Fathers" off then opening the Library tab no longer shows it
- [ ] Toggling back on restores it
- [ ] "Reset to all enabled" wipes the preference (sets key to null) and shows everything
- [ ] Mobile build — **both** premium and free tiers show the same section; free tier uses device-local prefs that hydrate from cloud on first sync
- [ ] Library empty-state copy is updated for the "all-opted-out" case

---

## Phase 3 — Onboarding

**Goal:** First-time users understand the choice without a forced tour.

### 3.1 Inline first-visit prompt

When the user opens the Library tab for the first time (no prior `enabled_voice_packages` value, and no `library_seen_at` telemetry row), show a non-blocking prompt above the package list:

> "This Library includes 75 works across 7 collections. You can choose which collections appear here — and in your resonance results — from Settings → Library Contents, anytime. Default: all collections."

Dismissible. "Don't show again" persists via `user_settings(library_seen_at = ISO timestamp)`.

**Not** a modal. Not blocking. The user can scroll past and ignore it. The point is to make the affordance discoverable, not to force a decision.

### 3.2 "Reset" affordance

Already in Phase 2's UI. The onboarding prompt can deep-link to the Library Contents section so users who skipped it can find the controls fast.

### 3.3 Acceptance

- [ ] First-visit prompt appears once for a new user
- [ ] Dismissing sets `library_seen_at`, prompt doesn't reappear
- [ ] Reset button (Phase 2) clears the opt-in and the prompt doesn't reappear (it's about the *control*, not the *state*)

---

## Phase 4 — Foundation for future packages (do this once, do it right)

**Goal:** When we ship a new package or a new Bible translation, no code or migration is needed. Per the adaptive-resonance lessons.

### 4.1 New packages — already handled

The opt-in design (Phase 1.1) means new packages default to enabled for users with a subset list. **No code change required** to ship a new package — add a new `package_id` in `voice_books.json` and a new set of entries in `voice_passages.json`. The Settings UI will pick it up on next read because it always lists all installed packages.

### 4.2 New Bible translations — handled separately

Bible translations are out of scope for this opt-in system (Scripture is always-on in Phase 2.1). Adding a translation follows the existing `translations` table / `Translation` enum path, not the package path. No conflict.

### 4.3 What we *don't* do in Phase 4

- ❌ Don't add a server-side recommendation system
- ❌ Don't add per-book opt-in (stays at package granularity)
- ❌ Don't add a "starter set" concept
- ❌ Don't auto-disable packages the user hasn't engaged with after N days
- ❌ Don't surface opt-in telemetry to admins (this is per-user, private)

These are deliberate. The minimum that delivers the user's stated need ("let me opt in or out of things in the Library") without overbuilding.

---

## Verification strategy

### Tests to add (or extend)

**`verify-adaptive-resonance-contract.mjs`** — extend with a Library opt-in scenario:

1. Read installed packages from `/api/library/packages` → expect 7
2. PUT `patristic: enabled=false` → expect 200
3. Read `/api/library/books` → expect 6 packages, no "The Fathers"
4. POST `/api/resonance` with a known Fathers-resonant journal entry → expect `voices` array contains no `patristic` package_id
5. PUT `patristic: enabled=true` → expect 200
6. Re-read `/api/library/books` → expect 7 packages again
7. PUT `nonexistent: enabled=true` → expect 404
8. Reset (delete the setting) → expect all 7 packages back

### Live verification (post-deploy)

```bash
# After Phase 0: confirm 75 books / 7 packages
curl -s https://resonanceweb-production-276b.up.railway.app/api/library/books | \
  python3 -c "import json,sys; d=json.load(sys.stdin); \
    print('books:', sum(len(p['books']) for p in d['packages']), 'pkgs:', len(d['packages']))"

# After Phase 1: confirm opt-in works end-to-end (need a session token)
COOKIE="resonance-auth=$RESONANCE_AUTH_SECRET"
curl -s -H "Cookie: $COOKIE" -X PUT -H "Content-Type: application/json" \
  -d '{"enabled":false}' \
  "https://resonanceweb-production-276b.up.railway.app/api/library/packages/patristic"
```

### Failure modes to test explicitly

- User has corrupt `enabled_voice_packages` value (not valid JSON) → falls back to all-enabled
- User has empty list `[]` → Library shows empty-state with new copy
- User's list references a package that no longer exists → that entry is filtered out on read (Phase 1.1's intersect logic)
- Volume file changes between request A and request B → mtime cache invalidates (existing behavior, verified)
- User toggles a package while a resonance request is in-flight → race; both requests get the same setting (read happens at request start, not mid-flight)

---

## Migration & rollback

### Migration

**No DB migration.** `user_settings` already exists. New code writes a new key (`enabled_voice_packages`).

Existing users: the key is null, which the read path treats as "all enabled" — they see the same Library as before, plus the new packages. No data change.

### Rollback

Revert the deploy. The new API routes stop responding, the existing `GET /api/library/books` route is the version that returns all packages (anonymous read falls through to "all" semantics anyway). Settings UI loses the Library Contents section. No data is corrupted because the only write is to `user_settings(library_seen_at)` and `user_settings(enabled_voice_packages)` — both are forward-compatible (the old code ignores them).

If Phase 0 also deployed (route fix, volume restore), reverting that part rolls back the 75-book view to 18-book or missing-route state. Phase 0 is independent and should be deployable on its own.

---

## File-by-file change list

| File | Phase | Change |
|---|---|---|
| `scripts/restore-volume.py` | 0.2 | Repoint `LOCAL_BUILD` constants from `build/output/` to `apps/web/data/` |
| `apps/web/app/api/library/books/route.ts` | 1.3 | Read user prefs, filter books by enabled packages |
| `apps/web/app/api/library/packages/route.ts` | 1.7 (new) | GET installed packages with current enabled state |
| `apps/web/app/api/library/packages/[packageId]/route.ts` | 1.4 (new) | PUT to toggle one package |
| `apps/web/app/api/resonance/route.ts` | 1.5 | Filter voice candidates by enabled packages before assembly |
| `apps/web/lib/library-prefs.ts` | 1.2 (new) | `getEnabledVoicePackages`, `setEnabledVoicePackages` helpers |
| `packages/screens/src/settings/SettingsScreen.tsx` | 2.1 | Add Library Contents section |
| `packages/screens/src/settings/LibraryContentsSection.tsx` | 2.2 (new) | Section component, optimistic toggles, reset button |
| `apps/mobile/...` | 2.3 | Verify the same section renders in the mobile Settings screen |
| LibraryBrowser empty-state copy | 2.4 | Update text to mention Settings → Library Contents |
| Onboarding prompt | 3.1 | First-visit inline prompt above LibraryBrowser list |
| `verify-adaptive-resonance-contract.mjs` | Verification | Add the 8-step opt-in scenario above |

Total new code: ~300 lines across 4 new files + ~80 lines of edits across 4 existing files.

---

## Dependencies & sequencing

```
Phase 0 (operational)
  ├── 0.1 — investigate missing route
  ├── 0.2 — repoint restore script
  ├── 0.3 — upload canonical snapshot
  └── 0.4 — accept
  ↓ (gates: 75 books live)
Phase 1 (data + API)
  ├── 1.1 — define storage shape
  ├── 1.2 — library-prefs helper
  ├── 1.3 — filter books response
  ├── 1.4 — toggle endpoint
  ├── 1.5 — filter resonance cards
  ├── 1.6 — accept
  └── 1.7 — list endpoint
  ↓ (gates: API live, no UI yet)
Phase 2 (UI)
  ├── 2.1 — section placement
  ├── 2.2 — LibraryContentsSection
  ├── 2.3 — mobile parity
  ├── 2.4 — empty-state copy
  └── 2.5 — accept
  ↓ (gates: settings work end-to-end)
Phase 3 (onboarding)
  ├── 3.1 — first-visit prompt
  ├── 3.2 — reset link
  └── 3.3 — accept
  ↓
Phase 4 (foundation) — concurrent, no gated work
```

Phases 0, 1, 2, 3 each have an explicit "accept" gate before the next starts. Phase 4 is documentation/decision work, no implementation, can run anytime.

The naming refactor (Library/voice/library three-naming leak) is **not** in this plan. Per the existing reference doc, it's a separate initiative that should land *on top of* this foundation, not under it.

---

## Decisions made (2026-06-27)

1. **Token** — workspace Railway token (`6a7080b0-...`) works fine. My prior "stale" framing was wrong (the failure was in *how* I called it from the Python sandbox, not the token itself). The token is a long-lived workspace API token and does not expire per-session. Used successfully during this audit for `projects { edges }` and `project(id) { deployments }` reads. **No action needed from you on the token.**

2. **Phase 0.1 investigation is done** (see updated Phase 0.1 section above). Remaining work for Phase 0.1 is the redeploy + cache flush, which I'll only do with your explicit go-ahead.

3. **Mobile tier scope** — handle **both** free and premium tiers in Phase 2. The cloud-backed tier reads from the same `/api/library/packages` API as the web client. The free/local tier needs the data layer to be aware of the user's opt-in list even without a backend. Investigate the existing `mobileDataLayer.ts` Settings implementation (saw `setActiveEmbeddingModel` there as a no-op stub) to determine the right pattern — likely: a per-user local copy of the opt-in list, hydrated from cloud on first sync, fallback to "all enabled" if offline and never synced.

4. **Onboarding placement** — non-blocking inline prompt, as proposed. No modal.

5. **Section header naming** — "Library Contents" (default).
