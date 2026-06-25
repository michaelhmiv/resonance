# Tab-Switch Flicker — Implementation Plan

**Status:** Awaiting greenlight
**Created:** 2026-06-25
**Diagnosis:** `references/tab-switch-flicker-diagnosis.md` (verified via Playwright CDP screencast on prod)

## Problem (verified)

Every tab switch in the Resonance web app fires 2-4 uncached API calls. Tap → last response = 150-260ms. During that window the user sees a brief blank-with-spinner state because Next.js's `app/loading.tsx` Suspense fallback renders while the new page's data loads. CLS=0 and no long tasks, so this is purely a network waterfall problem.

## Fix sequence (smallest-blast-radius first)

Each fix is independently shippable. The full effect is cumulative, but even just #1 is a noticeable improvement.

### Fix 1: `BottomTabBar` → `next/link` with `prefetch={true}`

**Why first:** Highest leverage, smallest change, zero risk of regression.

**File:** `packages/ui/src/BottomTabBar.tsx`

**Change:**
- Import `Link` from `next/link`
- Replace each `Pressable` with `Link` wrapping the same `View` + `Icon` + `Text` children
- Pass `href={tab.href}` and `prefetch={true}` (default behavior, but explicit)
- Keep the existing `onSelect` / `activeOverride` props for the rare case a parent wants to override
- For `accessibilityRole="button"` + `accessibilityLabel` + `accessibilityState={{ selected }}` — these should still apply. `Link` from `next/link` accepts a child element; the `accessibilityRole` is a RN prop, not an HTML one, so it'll pass through to the inner `View`.
- Style: the `style={({pressed}) => [...]}` Pressable callback has no Link equivalent. Move `pressed` styling to `:active` via a regular CSS class on the inner View, OR keep a small `useState` for pressed feedback.

**Risk:**
- `next/link` renders an `<a>` at the DOM root. RN-Web will wrap the child `View` in an `<a>`. This may interact with the existing `accessibilityState.selected` — test on real device.
- The `Pressable` callback style for pressed state needs an alternative. Cleanest: add `active:opacity-60` to a `className` on the inner View. But — RN-Web strips `className` on RN `View`. Workaround: use inline style with a manual `onPressIn`/`onPressOut` `useState` toggle, OR rely on the default Link behavior (no pressed feedback) since the active-state color change is the primary feedback anyway.
- **Decision:** drop the pressed-state opacity. The active tab already has a distinct color/icon treatment; losing the 0.6 opacity on press is a minor regression. If it bothers anyone, we add a `useState` toggle in a follow-up.

**Verify:**
- Push, wait for Railway deploy
- Run `cd /tmp/flicker && PLAYWRIGHT_BROWSERS_PATH=/data/.cache/ms-playwright node capture-all.mjs`
- Compare `out/all-transitions.json` — `apiSpanMs` should drop by 50-150ms per transition (prefetch happens on mount, fetch is in flight by tap time)

### Fix 2: Client-side cache in `WebDataLayer`

**Why second:** Catches the case where the user taps before prefetch finishes, AND the case where they navigate back and forth between two tabs repeatedly (prefetch helps the first switch, cache helps the second+).

**File:** `apps/web/lib/client-data-layer.ts`

**Approach:** Wrap the existing `api()` function (line 27) with a tiny in-memory cache. No new dependencies.

```ts
type CacheEntry<T> = { value: T; expiresAt: number; inflight?: Promise<T> };
const cache = new Map<string, CacheEntry<unknown>>();

// Cached TTL per call site. Hot-path fetches get short TTL, cold ones longer.
const TTL_MS: Record<string, number> = {
  '/api/bible/books':         60_000,  // books don't change
  '/api/bible/verse-of-day':  60_000,  // changes daily, 60s is fine
  '/api/settings':            30_000,  // user prefs, slow-changing
  '/api/reading/events':      15_000,  // recent history
  '/api/embeddings/status':   30_000,
};

async function cachedApi<T>(path: string, init?: RequestInit): Promise<T> {
  // Only cache GETs.
  if (init?.method && init.method !== 'GET') return api<T>(path, init);
  const ttl = TTL_MS[path.split('?')[0]] ?? 0;
  if (ttl === 0) return api<T>(path, init);

  const now = Date.now();
  const cached = cache.get(path);
  if (cached && cached.expiresAt > now) return cached.value as T;
  if (cached?.inflight) return cached.inflight as Promise<T>;

  const inflight = api<T>(path, init).then(value => {
    cache.set(path, { value, expiresAt: Date.now() + ttl });
    return value;
  }).catch(err => {
    cache.delete(path);
    throw err;
  });
  cache.set(path, { value: cached?.value as T ?? null, expiresAt: 0, inflight });
  return inflight;
}
```

Then route the hot-path methods through `cachedApi`:

```ts
async getBooks(translation) { return cachedApi(`/api/bible/books?translation=${translation}`); }
// ... and same for verse-of-day, settings, reading/events
```

**Risk:** Low. Cache invalidation is manual (we don't refetch on mutation, but the only mutation paths are `saveSegment`, `saveHighlight`, `saveBookmark` — none of these affect the tab-switch hot path). If we ever mutate `settings` (e.g. changing translation), we should call `cache.delete('/api/settings')` at the mutation site. **Add a TODO comment** for any future setting-change handlers.

**Out of scope (intentionally):**
- LLM-touching methods (`findResonance`, `clusterEntries`, `generateWeeklyRoundup`, etc.) — these can take 1-3s, do NOT cache
- Anything that mutates (`saveSegment`, `deleteHighlight`, etc.) — never cache
- `getReadingHistory` — could be cached but it's not on the tab-switch hot path

**Verify:**
- Push, wait for Railway deploy
- Repeat the Playwright run
- `apiCount` should drop to 0 for transitions where the data was cached (since the request never leaves the browser)

### Fix 3: Remove `app/loading.tsx`

**Why last:** Most disruptive change. Only safe after fixes 1+2 reduce the wait to near-zero.

**File:** `apps/web/app/loading.tsx` — delete the entire file.

**Effect:** Without the root `loading.tsx`, Next.js has no Suspense fallback at the app level. When the user taps a tab, the new page's server-rendered HTML is still streamed in (it always was — the Suspense fallback just shows while you wait). The visible difference: the cream + spinner is gone. Instead, the new page's chrome appears immediately, and its content area is empty for the brief moment between paint and the first data fetch resolving.

**Why this is fine after fixes 1+2:**
- With prefetch, the JS chunk is already on disk. Tab tap = route change = React renders the new page from the prefetched RSC payload. No network waterfall.
- With cache, the data is in memory. No network roundtrip.
- Total visible blank: ~0-30ms, indistinguishable from a normal repaint.

**Risk:** If a user has a slow connection and the cache expires, removing the loading.tsx means they'd see ~250ms of empty content area with no spinner. That feels worse than the current state, not better. **Mitigation:** keep an *inline* skeleton in the relevant screens (e.g. show "Loading books…" text inside `ScriptureBrowser` instead of relying on the root fallback). This is a separate, larger change — defer to a follow-up if it comes up.

**Verify:**
- Push, wait for Railway deploy
- Repeat the Playwright run
- Frame at +50ms should now show the new page's chrome (Scripture/Library tabs, top bar) with content area showing the *previous* data or an empty state with the screen's own skeleton — not the root loading.tsx spinner

## Files changed (cumulative)

| File | Fix 1 | Fix 2 | Fix 3 |
|---|---|---|---|
| `packages/ui/src/BottomTabBar.tsx` | modified | — | — |
| `apps/web/lib/client-data-layer.ts` | — | modified | — |
| `apps/web/app/loading.tsx` | — | — | deleted |

**3 files, ~80 lines of changes total.** No new dependencies. No new API routes. No database migrations.

## Out of scope (deferred)

- **Inline skeletons per screen** — proper "load more graceful" UX, but bigger change. Defer until after we see what the no-loading.tsx experience looks like in the wild.
- **View Transitions API** — would let us cross-fade the old/new tab. Requires Chromium/Edge/Safari TP. Cool polish, not the core fix.
- **Animated transition on the tab indicator** — also polish, not the core fix.
- **Server-side prefetching via `cache: 'force-cache'`** on the API routes — would help the initial cold load, not the tab-switch flicker specifically. Worth a separate discussion.

## Rollout

1. Implement Fix 1, push, wait for deploy (~90s), run Playwright capture, compare metrics
2. If metrics improve as expected: implement Fix 2, push, wait, run Playwright
3. If metrics improve further: implement Fix 3, push, wait, run Playwright
4. Each step is independent — if any one fails, revert just that commit

## Acceptance criteria

- **Fix 1 done:** `apiSpanMs` for any tab transition < 150ms (down from 150-260ms)
- **Fix 2 done:** `apiCount` for any tab transition = 0 (when data is cached)
- **Fix 3 done:** No frame in the screencast shows the root `loading.tsx` fallback (cream + spinner)
- **All three done:** Tap → new content visible in < 50ms on average, with no visible blank state
