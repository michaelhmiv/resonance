# Resonance Library — Per-Book Opt-In

**Date:** 2026-06-27
**Status:** Planned, awaiting go-ahead
**Author:** Hermes (drafted from Michael's locked-in answers)

## Background

The Library tab in the Resonance web/mobile app shows the catalog of 75 voice-of-the-Church books grouped into 7 historical packages (patristic, medieval_devotional, catholic_reform, protestant_devotional, protestant_reform, poetry_hymns, philosophical_spiritual). Current behavior: a single "Library" page that auto-expands the first package and shows a flat list of books under each package header. There is no concept of "what's included in my resonance search" anywhere on the page; inclusion is an invisible consequence of toggling a Settings switch.

User feedback across this session, distilled:

1. The page is grouped fine; what it doesn't do is **convey the goal** — a user looking at it doesn't understand that these are optional collections, not pre-loaded content.
2. The *meaning* of "including" a book differs by tier and is not communicated: web = "include vectors in cloud resonance," mobile free = "download to device," mobile premium = same as web.
3. The opt-in unit should be **per-book**, not per-package. (Earlier work that shipped `enabled_voice_packages` is being superseded.)
4. Categorization is the existing packages under a different label (historical period groupings).
5. The page should have two tabs: **Browse** (the categorized catalog) and **Included** (what's currently opted in).
6. Mobile free-tier "Add to resonance" = a download button (or a checkbox if already downloaded).
7. The Settings → "Library Contents" section built in the earlier Phase 1 work is replaced by the new tabs.

## What this plan does

Rebuild the Library tab around per-book opt-in, with a two-tab UX, while keeping the per-tier semantics explicit (download vs. cloud flag) so users know what they're toggling.

## What this plan does NOT do

- Does not build the mobile per-book **download pipeline** itself (a separate design / build problem; mobile free tier gets a UI placeholder that explains the limitation honestly rather than a stub that pretends to work).
- Does not change the per-tier auth model.
- Does not change the `/api/library` middleware gating.
- Does not touch the resonance engine — only the data feeding it.

## Data model

### New `user_settings` key: `enabled_voice_books`

- **Type:** JSON string array of book IDs (e.g. `["augustine-confessions", "luther-bondage-will"]`).
- **`null` / unset** = "all enabled" (preserves the no-config default).
- **`[]` (empty)** = "none enabled" (the user has explicitly opted out of everything; the Included tab is empty, the Browse tab still shows all 75).
- **Subset** = the user has opted into specific books.

The existing `enabled_voice_packages` key is **deprecated** by this plan. The data model is migrating from package-level to book-level. A one-time migration step (Phase 0.5 below) expands any existing package-level list into the underlying book IDs, so existing users don't lose their opt-in state.

### Per-tier semantics of `enabled_voice_books`

| Tier | What "opt in to a book" means | Where the flag lives |
|---|---|---|
| **Web (premium-only)** | Web resonance search will include that book's vectors when running. | `user_settings.enabled_voice_books` on server. |
| **Mobile premium** | Same as web. The cloud flag is the source of truth; the local index is a cache that re-syncs. | `user_settings.enabled_voice_books` on server. |
| **Mobile free (offline)** | The book must be **downloaded** to the device for the local resonance search to include it. The cloud flag is not relevant (no cloud), but the local on-device checkmark/checkbox reflects whether the book is present. | Local on-device only. The cloud `user_settings` flag is not used for free tier. |

The library page UI shows different affordances per tier:
- **Web / Mobile premium:** the book row has an "Add to resonance" button (or "Remove from resonance" / checkmark if already added). Toggling writes to `user_settings.enabled_voice_books` via the API.
- **Mobile free:** the book row has a download icon (or checkmark if downloaded). Toggling triggers the local download flow.

This is the *only* way the per-tier distinction surfaces in the UI. The data shapes are tier-specific; the catalog is the same.

## API surface

### `GET /api/library/books` (modified)

Returns the full catalog with each book flagged with the current user's inclusion state. **No longer filters** — returns all 75 books always. The client decides what to show.

```
Response:
{
  categories: [
    {
      id: "patristic",
      label: "Patristic",
      books: [
        {
          id: "augustine-confessions",
          title: "Confessions",
          author: "Augustine of Hippo",
          era: "4th-5th c.",
          source: "ccel",
          included: true   // resolved against user_settings.enabled_voice_books
        },
        ...
      ]
    },
    ...
  ]
}
```

### `GET /api/library/included` (new)

Returns only the books the current user has included, in the same grouped shape. Powers the "Included" tab.

```
Response:
{
  categories: [
    { id, label, books: [{ id, title, author, era, source }] }
  ]
}
```

If `enabled_voice_books` is `null` (all-enabled default), this returns all 75. If `[]`, returns empty.

### `PUT /api/library/books/[bookId]` (new, replaces `/api/library/packages/[packageId]`)

Toggles one book's inclusion. Body: `{ "included": true | false }`. Idempotent. 404 on unknown book. 400 on bad body. Response includes the new `enabledList` (current full set of included book IDs).

### `DELETE /api/library/books/included` (new)

Reset to "all enabled" — clears the subset. Equivalent to setting `enabled_voice_books = null`. Used by the "Reset" button in the UI.

### `GET /api/library/packages` (deprecate)

No longer the source of truth. Kept temporarily for backward compatibility during deploy (returns the same shape as before, but derived from `enabled_voice_books` mapped back to packages for legacy clients). Mark deprecated in the route file; remove in a later cleanup.

### `GET /api/library/packages/[packageId]` (deprecate)

Same. Kept during transition. Bulk-toggle the underlying books in the package on PUT.

## Filter changes in `/api/resonance`

Currently filters voice candidates by enabled package via a `book_id → package_id` map. With per-book opt-in, the filter becomes a direct `book_id in enabledSet` check (where `enabledSet` is derived from `enabled_voice_books` rather than from `enabled_voice_packages`). Same code shape, different source list.

## UI

### Library tab — two-tab layout

**Browse tab (default):**
- All 75 books shown, grouped by category (the 7 packages, labeled as the user understands them).
- Each book row: title, author, era, an "Add to resonance" / "Remove from resonance" button (or checkmark if included).
- Per-tier copy: web/mobile-premium show the "resonance" framing; mobile-free shows the "download" framing.
- A short header at the top explaining what the page is ("Choose which collections to include in your resonance search" on web; "Choose which collections to download for offline resonance" on mobile free).

**Included tab:**
- Only the books the user has opted into.
- Same per-book row, but with a "Remove" affordance and a small "no books included" empty state with a link to Browse.

### Replacing Settings → Library Contents

The earlier Phase 1 Settings section is removed in this plan. All opt-in UI lives in the Library tab now. Settings keeps a small "Manage library" link as a deep-link to the Library tab for discoverability, but no toggle surface.

### First-visit onboarding prompt

The inline non-blocking prompt added in Phase 3 is **kept** but its text is updated to match the new model: "Choose which collections to include in your resonance search. Browse to add, Included to see what's active."

## File-by-file changes

### Modified

- `apps/web/app/api/library/books/route.ts` — return full catalog with per-book `included` flag; no longer filters.
- `apps/web/app/api/library/packages/route.ts` — mark deprecated; return derived view from per-book prefs.
- `apps/web/app/api/library/packages/[packageId]/route.ts` — mark deprecated; bulk-toggle underlying books.
- `apps/web/app/api/resonance/route.ts` — change filter from package-map to direct book-id set.
- `apps/web/lib/library-prefs.ts` — new key `enabled_voice_books`; deprecate `enabled_voice_packages`; add migration helper.
- `apps/web/app/api/library/books/[bookId]/route.ts` — **new** (PUT).
- `apps/web/app/api/library/books/included/route.ts` — **new** (GET, DELETE).
- `packages/core/src/types.ts` — `LibraryPackage` gains a `books: Array<{ id, title, author, era, source, included }>` field (or a new `LibraryBook` shape with `included`); new `IncludedBooksResponse` type.
- `packages/core/src/data-layer.ts` — interface updates: `getLibraryBooks()` (returns categorized with flags), `getIncludedBooks()`, `setBookIncluded(bookId, included)`, `resetIncludedBooks()`. Remove `getLibraryPackages()` / `setLibraryPackageEnabled()` / `resetLibraryPackages()` from the interface (mark deprecated in a comment for one release).
- `apps/web/lib/client-data-layer.ts` — implement new methods; map API response to the new types.
- `apps/mobile/lib/local-data-layer.ts` (or equivalent) — implement new methods for the mobile free tier. **Stub the download**: return a "download not yet available in this build" message on toggle, no-op the inclusion flag.
- `packages/screens/src/word/LibraryBrowser.tsx` — rebuild as two-tab layout (Browse | Included). Per-tier copy and affordances. Remove the auto-expand-first-package behavior; collapse all by default with a single tap to expand. Remove the "first-visit onboarding" wording; the new tab copy carries the goal.
- `packages/screens/src/settings/SettingsScreen.tsx` — remove the "Library Contents" section; replace with a single "Manage library" link that deep-links to the Library tab.
- `scripts/verify-adaptive-resonance-contract.mjs` — add contract checks for the new endpoints; deprecate the per-package checks.

### New

- `apps/web/lib/library-prefs.ts:migrateEnabledVoicePackagesToBooks(userId)` — one-time migration: expand any existing `enabled_voice_packages` into the underlying book IDs and write `enabled_voice_books`. Idempotent. Called on first request that reads `enabled_voice_books` and finds the old key still present.
- `apps/web/lib/library-download-status.ts` (mobile only) — abstraction over "is this book on the device?" for mobile free tier. Returns a stub `{ downloaded: false, reason: "not-yet-implemented" }` for now.

## Migration / rollout

1. **Phase A — read-only:** add `enabled_voice_books` getter alongside the existing `enabled_voice_packages` getter. The migration is implicit: when the user next toggles, we write the new key.
2. **Phase B — write new, read both:** new PUT endpoint writes `enabled_voice_books`; old PUT endpoint also writes the new key. UI still uses the old endpoint for one release.
3. **Phase C — read new only, write new only:** the resonance route reads `enabled_voice_books` exclusively. Old endpoints return 410 Gone.
4. **Phase D — cleanup:** remove the deprecated endpoints and the old key entirely.

For this implementation session, we do Phase A + B in one commit, with a one-shot migration helper that runs lazily on the first read of the new key. Phase C ships in the same release because there are no live users on the per-package endpoint yet (the Phase 1 work went out earlier today and no other client calls it).

## Mobile Free-Tier Download Pipeline

The mobile free-tier download pipeline is a real feature, not a stub. Full design, build script, API, schema, and 4-sub-phase rollout live in the companion plan:

> **[`2026-06-27-mobile-download-pipeline.md`](./2026-06-27-mobile-download-pipeline.md)**

Summary of the key decisions (all confirmed by Michael 2026-06-27):
- **Scripture (the 66 Bible books) is bundled on first launch — always included, no opt-in.** The 75 voice-of-the-Church books are the per-book opt-in list.
- The build script produces 75 per-book voice shards (each = vectors.bin + idmap.json + corpus.hnsw) + 1 scripture bundle (bible_passages.json + vectors.bin + idmap.json + corpus.hnsw).
- New API: `GET /api/library/shards/manifest`, `GET /api/library/shards/[bookId]/[file]` (with HTTP Range), `GET /api/library/scripture/manifest`, `GET /api/library/scripture/bundle/[file]` (with HTTP Range).
- Mobile brute-force cosine in JS over downloaded vectors — no on-device HNSW library in v1.
- Phases 0–4 ship as a single batch per Michael's instruction.

## Verification (no-action contract)

Each item is checked read-only before any commit. No Railway deploy until everything is green.

1. `GET /api/library/books` returns all 75 books across all 7 categories, each with `included: true` (default state).
2. `GET /api/library/included` returns the same 75 books (default = all enabled).
3. `PUT /api/library/books/augustine-confessions {included: false}` returns 200, `enabledList` is the other 74.
4. `GET /api/library/books` after the toggle shows `augustine-confessions.included: false`.
5. `GET /api/library/included` after the toggle does NOT include `augustine-confessions`.
6. `PUT /api/library/books/augustine-confessions {included: true}` restores default.
7. `PUT /api/library/books/nonexistent` returns 404 with `Unknown book`.
8. `PUT /api/library/books/x` with body `{included: "yes"}` returns 400.
9. `DELETE /api/library/books/included` clears the subset (back to default).
10. `POST /api/resonance` with text after disabling 5 books runs without errors and the `voices` array never contains a book from the disabled 5 (sample test: disable `aquinas-summa`, send "Thomas discusses the five ways," check no `aquinas-summa` card).
11. The new Library tab UI renders the two tabs and the per-tier copy is correct (manual check via screenshot).
12. The Settings → "Library Contents" section is gone; replaced by a single "Manage library" link.

## Risks and open questions

- **Mobile download pipeline:** full design in [`2026-06-27-mobile-download-pipeline.md`](./2026-06-27-mobile-download-pipeline.md). Single batch with the per-book opt-in work.
- **Bulk operations:** the per-book toggle is fine for 75 books but tedious for a user who wants "everything by Augustine" or "all 36 patristic works." We may want a "Add all from this category" affordance on the category header. Easy to add; flagging in case you want it from the start.
- **Migration of any existing users:** the lazy migration helper runs once per user on first read. If a user has a partial subset, the new key reflects that. If they had `enabled_voice_packages = ["patristic"]` and only some of patristic's books were previously includeable (which is fine — all 36 are included via the package), the new key contains all 36 book IDs.

## Done-when

The Library tab has two tabs (Browse | Included) and two sections in each tab: **Scripture** (66 Bible books, always included, no toggles) and **Books** (75 voice-of-the-Church books grouped by 7 packages, per-book opt-in). On web/mobile-premium, "Add to resonance" persists to `user_settings.enabled_voice_books`. On mobile free, "Download · 35 MB" pulls the per-book shard from the server. Settings → "Library Contents" section is gone; replaced by a single "Manage library" link. On mobile first launch, the Scripture bundle downloads automatically (~84 MB). The Settings → "Manage downloads" entry shows total on-device size and per-book controls. Mobile premium gets opportunistic pre-fetch of their cloud opt-ins.

Shipped as a single batch per Michael's instruction. Mobile download pipeline is in [`2026-06-27-mobile-download-pipeline.md`](./2026-06-27-mobile-download-pipeline.md). No code written yet. Awaiting go-ahead.
