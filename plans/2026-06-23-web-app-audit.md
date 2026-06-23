# Resonance Web App — Audit Report

**Date:** 2026-06-23  
**Auditor:** Hermes Agent  
**Live URL:** https://resonance-production-fce2.up.railway.app  
**Repo:** /data/resonance (monorepo: apps/web, apps/mobile, packages/core, packages/theme, packages/ui)

---

## Executive Summary

The web app deploys and renders, but **every screen is a static mock**. None of the 5 API routes are called from the frontend. The Bible reader has 6 hardcoded verses total. The Patterns tab is decorative circles and placeholder text. The Settings page has zero interactivity. There is no auth or premium gating. The shared `@resonance/ui` components that require `@expo/vector-icons` would crash if rendered on web.

The mobile app (8 phases, 44 files) is substantially more complete. The web app was a Phase 2 rewrite that never got past scaffolding.

---

## CRITICAL Issues

### C1. Frontend is completely disconnected from API routes

The 5 API routes exist and are deployed, but **zero frontend components call them**. No `fetch()` calls anywhere in the web pages:

| API Route | Purpose | Called by frontend? |
|---|---|---|
| `POST /api/reflect` | LLM reflection prompts (OpenRouter) | ❌ No |
| `POST /api/embed` | Embed journal text to vector | ❌ No |
| `POST /api/resonance` | Vector search against 265K passages | ❌ No |
| `GET /api/packages` | Book Package catalog | ❌ No |
| `GET /api/health` | Health check | ❌ Only by Railway/dashboard |

- **Journal:** entries stored in `useState` — lost on refresh
- **Word:** uses `SAMPLE_PASSAGES` constant (6 verses total: Gen 1:1-3, John 1:1-3)
- **Patterns:** 100% static placeholder
- **Settings:** all read-only rows

### C2. No auth / premium gating

User requirement: **if someone is on the web, they are a premium user. No non-premium user should ever be on the web.**

Currently: zero authentication. The app is completely open. No login screen, no auth check, no premium tier verification, no Supabase Auth integration.

### C3. Shared UI components broken on web

4 of 6 `@resonance/ui` components import `@expo/vector-icons` (Feather icons), which does not exist in the web context:

| Component | `@expo/vector-icons` import | Used on web? |
|---|---|---|
| `ResonanceCardGroup.tsx` | `Feather name="wind"` | Not imported (would crash) |
| `BookmarkButton.tsx` | `Feather` icons | Not imported (would crash) |
| `TranslationSelector.tsx` | `Feather` icons | Not imported (would crash) |
| `HighlightToolbar.tsx` | `Feather` icons | Not imported (would crash) |
| `PassageCard.tsx` | No expo import | ✅ Imported, works |
| `CrossReferenceLinks.tsx` | No expo import | Not imported, would work |

The web pages bypass `@resonance/ui` almost entirely and inline their own `.tsx` markup with `react-native-web` directly.

---

## MAJOR Issues

### M1. Word tab is non-functional

| Feature | Expected | Actual |
|---|---|---|
| Chapter count | Per-book (Obadiah=1, Psalms=150, etc.) | Hardcoded `50` for ALL 66 books |
| Verse content | Real Bible text from seeded library | 6 hardcoded verses (Gen 1:1-3, John 1:1-3) |
| Fallback for other books | Real text | Falls back to `SAMPLE_PASSAGES[0]` (Genesis) |
| Translation selector in reading view | WEB/KJV toggle | Only on book list, not reading view |
| Prev/next chapter nav | Yes | ❌ Missing |
| Bookmarks | Yes | ❌ Missing |
| Highlights | Long-press → 3-tone palette | ❌ Missing |
| Annotations | Margin notes | ❌ Missing |
| Cross-references | Marginal links | ❌ Missing |
| Search | Scripture/Library scope toggle | ❌ Missing |
| Library browser | Browse by Book Package → author/work | ❌ Missing |

### M2. Journal tab is barely functional

- **No persistence:** entries stored in React `useState`, lost on refresh
- **No resonance cards:** API route exists but is never called
- **Verse of the day:** hardcoded to Psalm 46:10 (always the same verse)
- **No segment model:** no journal document structure, no date dividers beyond today
- **No focus manager:** no continuous FlashList-style renderer
- **No "Send to Journal"** from Word tab
- **`KeyboardAvoidingView` import** from `react-native-web` — this component doesn't exist in web and would throw at runtime if rendered

### M3. Patterns tab is 100% placeholder

- **Calendar:** 30 arbitrary circles, not a real calendar. No month/year labels, no day headers, no dates, no interactivity, no entry indicators based on real data
- **"This Week":** static text "No entries yet this week."
- **"Recurring Themes":** static text "Themes will cluster here as your journal grows."
- **"A Quiet Question":** static text "What are you noticing these days?"
- No entry clustering, no TF-IDF, no weekly roundup, no shift narratives

### M4. Settings page has zero interactivity

All 7 sections are read-only display rows:

| Section | Rows | Interactive? |
|---|---|---|
| Embedding Model | 3 models listed | ❌ No selection |
| Reflection Model | 1 model listed | ❌ No selection |
| Reading Preferences | Translation, Font Size, Theme | ❌ All static |
| Privacy & Data | Export, Clear, App Lock | ❌ All static, no actions |
| Storage | Total used: 0 MB | ❌ Static |
| Accessibility | Text Scale, Reduce Motion | ❌ Static |
| Licenses | 20+ items | ❌ Reference only |

Cannot change any setting. Cannot export journal. Cannot toggle anything.

Also: "All data is stored locally. Nothing leaves this device." is misleading on web — there is no local storage; data would need to go to Supabase.

---

## MODERATE Issues

### R1. Fonts not loaded

Design spec: Cormorant Garamond (serif body), Inter (UI chrome).  
Reality: `layout.tsx` doesn't load any Google Fonts. Pages use `fontFamily: 'Georgia, serif'` and `'Inter, sans-serif'` as browser fallbacks. The `@resonance/theme` exports `fontFamilies.serif = 'Cormorant Garamond'` but web pages don't use the theme imports — they hardcode font names inline.

Fix: Add `<link>` to Google Fonts in `layout.tsx` or `globals.css`, and import from `@resonance/theme`.

### R2. Responsive design gaps

- Container: `maxWidth: 720` — fine for tablet/desktop, but no mobile breakpoints
- Header: title + 3 tabs in a `flexDirection: 'row'` — on narrow phones, tabs will be cramped. No hamburger menu, no responsive collapse
- Chapter grid: fixed 44×44px tiles — works but no adaptive sizing
- Using `react-native-web` `StyleSheet.create` → inline styles → no CSS media queries
- No `@media` rules in `globals.css`

### R3. `/api/resonance` will timeout on first request

The route loads a **388MB binary file synchronously** (`readFileSync`) on first request. Railway's default request timeout is 30s. Loading 388MB + parsing 265K JSON metadata entries will almost certainly exceed that.

Also: `passageMetadata` array is built by pushing objects one at a time in a loop — no pre-allocation, likely slow for 265K entries.

### R4. `/api/embed` produces garbage vectors

Hash-based embedding (word → hash → dimensional index) is not semantically meaningful. Cosine similarity against real GTE-small vectors will produce random results. The resonance endpoint will return irrelevant passages.

This is acknowledged in the code comments but means the full resonance pipeline is non-functional end-to-end.

### R5. `/api/health` doesn't report real state

`vectorsLoaded: false` is hardcoded — doesn't check the actual module-level state in the resonance route.

### R6. `/api/reflect` sends system prompt as user message

The `REFLECTION_SYSTEM_PROMPT` is concatenated into the user message content rather than sent as a separate `system` role message. Models follow system prompts more reliably when they're in the proper role.

```typescript
// Current (suboptimal):
messages: [{ role: 'user', content: prompt }]

// Should be:
messages: [
  { role: 'system', content: REFLECTION_SYSTEM_PROMPT },
  { role: 'user', content: `Journal excerpts:\n${texts.join('\n---\n')}\n\nReflection question:` }
]
```

### R7. No rate limiting or auth on API routes

Any of the 5 endpoints can be called by anyone. The reflect route calls OpenRouter (costs money per call). No rate limiting, no auth check, no CORS protection.

---

## MINOR Issues

### N1. No SEO / meta tags
Missing OpenGraph tags, favicons, apple-touch-icons, theme-color meta tag.

### N2. No error boundaries
If any component throws, the whole app white-screens. No React error boundary wrapping the tab content.

### N3. No loading states
No skeleton screens, spinners, or loading indicators anywhere. If API calls were added, the UI would freeze during fetches.

### N4. No 404 page
Next.js default 404 — doesn't match the app's design language.

### N5. `word.ts` in core not exported
`packages/core/src/word.ts` exists but is not re-exported from `index.ts`. May contain useful utilities.

---

## What IS Working

✅ Deployment pipeline — Railway builds and serves the app  
✅ Base layout — cream background, centered container, tab navigation  
✅ Color palette matches design spec  
✅ 66-book Bible canon correct (39 OT + 27 NT)  
✅ `npx tsc --noEmit` passes for both web and mobile  
✅ Monorepo structure is sound (core, theme, ui packages)  
✅ `PassageCard` shared component works on web  
✅ `/api/reflect` correctly calls OpenRouter with the right system prompt constraints  
✅ `/api/resonance` has the right architecture (lazy load, module-level caching)  

---

## Recommended Priority Fix Order

1. **Auth + premium gating** (C2) — block everything until user is signed in + premium
2. **Wire API routes to frontend** (C1) — journal persistence, real Bible text, resonance cards
3. **Fix shared UI components for web** (C3) — replace `@expo/vector-icons` with web-safe alternative
4. **Real Bible data in Word tab** (M1) — query seeded library, per-book chapter counts, real verses
5. **Real Patterns** (M3) — calendar, clustering, summaries
6. **Interactive Settings** (M4) — working toggles, selectors, actions
7. **Responsive design** (R2) — mobile breakpoints, adaptive layout  
8. **Load real fonts** (R1) — Cormorant Garamond + Inter
9. **Fix API issues** (R3-R7) — async loading, real embeddings, system messages, rate limiting
