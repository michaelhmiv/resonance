# Resonance — Implementation Plan

> **For implementer:** This is a feature-level plan. It describes what to build and why,
> not line-by-line code. You are expected to make implementation decisions within
> each task. The user wants a conversation-style spiritual resonance app — not a
> journal, not a chatbot, not a study tool. Everything runs locally. Nothing leaves
> the device.

**Goal:** A private, offline-first app where users write what's on their heart and receive Scripture, voices from Christian history, and their own past entries that resonate with what they wrote.

**Architecture:** Local SQLite + embedding model for retrieval + optional small LLM for generation. The Bible and saint/mystic corpus are pre-vectorized in a build pipeline and shipped with the app. The phone only embeds the user's own words at runtime.

**Tech Stack:** React Native or Flutter (mobile), SQLite, sentence-transformers (or ONNX runtime for embedding), llama.cpp or equivalent for optional LLM.

**Three Tabs:** Chat · Patterns · Past. That's it.

---

## Phase 1: Skeleton — App Shell + Chat Interface

### Task 1: Project scaffold with navigation

**Objective:** Create the app with three-tab navigation (Chat, Patterns, Past). Chat tab is the default. Navigation bar at the bottom.

**What to build:**
- Tab navigator with 3 tabs
- Chat tab: scrollable message list + fixed text input at bottom
- Patterns tab: placeholder text
- Past tab: placeholder text
- The text input has placeholder text: "Whatever is real."
- Sending a message appends it to the chat list (right-aligned bubble)
- No backend yet. Messages stored in local state only.

**Acceptance:** App launches, tabs switch, text input works, messages appear in chat.

---

### Task 2: Persistent message store

**Objective:** Messages survive app restart. Store every message with timestamp in local SQLite.

**What to build:**
- SQLite database with a `messages` table: `id, content, timestamp, conversation_id`
- On send, insert a row. On app launch, load messages ordered by timestamp.
- Messages display with timestamps.
- Time gaps > 3 hours get a soft divider ("── 2 HOURS LATER ──").

**Acceptance:** Send messages, close app, reopen — messages still there with dividers.

---

### Task 3: Conversation detection

**Objective:** Group messages into conversations automatically.

**What to build:**
- When a message is sent, check time gap from previous message
- If gap > 3 hours → new `conversation_id`
- If gap ≤ 3 hours → same `conversation_id`
- Store `conversation_id` on each message row
- The Past tab shows a list of conversations (first message preview + date + message count), not individual messages

**Acceptance:** Send messages, wait (simulate time gap), send more. Past tab shows grouped conversations.

---

## Phase 2: Embedding Pipeline — The Build Step

### Task 4: Build script for pre-vectorizing the corpus

**Objective:** A Python script that runs ONCE on a build machine, not on the phone. It takes raw text files (Bible translations + saint/mystic passages) and produces vector files shipped with the app.

**What to build:**
- Script takes JSON files as input: `[{id, author, work, text}, ...]`
- Runs the embedding model (EmbeddingGemma-300M or GTE-small)
- Outputs: `corpus_vectors.npy` (384-dim vectors) + `corpus_meta.json` (id, author, work, text for each entry)
- Also produces a separate file for Bible verses: `bible_vectors.npy` + `bible_meta.json`
- These files are bundled into the app as assets

**Corpus sources (all public domain):**
- KJV, WEB, ASV Bible translations
- Augustine, John of the Cross, Teresa of Ávila, Julian of Norwich, Thomas à Kempis, Brother Lawrence, The Cloud of Unknowing, Francis de Sales, and others
- Matthew Henry's Commentary (abridged)
- Treasury of Scripture Knowledge cross-references

**Acceptance:** Script runs, produces `.npy` and `.json` files, files load correctly in a test script.

---

### Task 5: Ship the embedding model with the app

**Objective:** The embedding model runs on the phone. It only embeds user text — never the corpus (that's pre-computed).

**What to build:**
- Bundle the embedding model (ONNX format for cross-platform) in the app
- On send, the user's message text → embedding model → 384-dim vector
- Store the vector alongside the message in SQLite
- Load pre-computed corpus vectors from bundled assets
- Cosine similarity function: user vector vs all corpus vectors → top N results

**Acceptance:** Type a message. Behind the scenes, a vector is computed and stored. Similarity search returns results.

---

## Phase 3: Resonance Cards — The Core Feature

### Task 6: Resonance retrieval on send

**Objective:** When the user sends a message, find matching Scripture, saints, and past entries. Display them as cards below the message.

**What to build:**
- On send: embed user text → vector
- Cosine similarity vs Bible vectors → top 2 verses
- Cosine similarity vs saint/mystic vectors → top 2-3 passages
- Cosine similarity vs user's own past entries → top 1-2
- Display results as inline cards in the chat, below the user's message
- **Selection algorithm** to prevent repetition:
  - Recency penalty: if a verse/voice was shown in the last 7 days, score × 0.3
  - Category diversity: ensure at least one Psalm + one Gospel + one Epistle when possible
  - Weighted random: pick from top 15, not always top 3
  - Seed with entry hash for reproducibility

**Card visual design:**
- Scripture card: reference + quote, beige left-border
- Saint card: author + work + passage, olive left-border
- Past entry card: date + snippet, brown left-border
- Each card labeled: 📖 Scripture / 🕯️ Voice / ↺ You, Before

**Acceptance:** Type a message about exhaustion → see Matthew 11:28, John of the Cross, and your past entry about feeling tired. Type about gratitude → different verses, different voices.

---

### Task 7: Card interaction — expand and connect

**Objective:** Optional. User can tap a card to get reflection prompts or connect two entries. Uses the local LLM.

**What to build:**
- Tap a past entry card → "Expand" button appears
- Tapping Expand feeds context to the LLM: today's entry + past entry + relevant verse → 3 reflection questions
- LLM prompt: "This person wrote X two weeks ago and Y today. A verse that surfaced is Z. Write 3 reflection questions."
- LLM never writes prayers. LLM never interprets. LLM only writes questions.
- Settings toggle: "Generation: On / Off." When Off, Expand button hidden.

**Acceptance:** Tap Expand on a past entry card. Three questions appear. Questions are specific to the two entries, not generic.

---

## Phase 4: Patterns Tab — The Insights Surface

### Task 8: Mood calendar

**Objective:** Show a monthly calendar where each day is color-coded by emotional register of that day's entries.

**What to build:**
- Sentiment classifier (DistilBERT-level, ~80MB) runs on each entry
- Labels: heavy / mixed / light (or similar three-tier)
- Calendar grid for current month. Days with entries show colored dots.
- Days without entries appear empty
- Arrow navigation to previous/next months
- Legend at bottom

**Acceptance:** Write entries over several days. Calendar reflects the emotional tone. Navigate months.

---

### Task 9: Topic clusters

**Objective:** Group entries by semantic similarity and show what the user keeps talking about.

**What to build:**
- Cluster entries by cosine distance (DBSCAN or K-means on entry vectors)
- Re-cluster weekly (background task)
- Display clusters as ranked cards: cluster name, # of conversations, progress bar, snippet, trend vs last month
- Cluster name derived from TF-IDF keywords or a single 2-3 word LLM label (weekly, not real-time)

**Acceptance:** After 2+ weeks of use, topic clusters appear with meaningful labels. "Exhaustion & burnout" shows 8 conversations with a snippet from the most central entry.

---

### Task 10: Voices and Scripture frequency

**Objective:** Show which authors and Bible books keep surfacing in resonance.

**What to build:**
- Count which author IDs appear in cosine similarity top-20s over time
- Display ranked list: author name, work, frequency count, progress bar
- Count which Bible books host the verses that surfaced
- Display as grid of chips: book name + verse count, with top books highlighted

**Acceptance:** After regular use, John of the Cross shows 7×, Psalms shows 12 verses. Matches actual resonance history.

---

### Task 11: Writing rhythm and streaks

**Objective:** Show when the user writes — day of week, time of day, conversation count.

**What to build:**
- Bar chart: one row per day of week, bar width = conversation count, right label = average time
- Today's row highlighted
- Total conversation count for the month at top

**Acceptance:** Tuesday bar is widest with "7:32 AM." Sunday bar is thin. Accurate to actual usage.

---

### Task 12: Answered prayer timeline

**Objective:** Detect when a prayer was answered and show the timeline.

**What to build:**
- Answered prayer classifier runs on each entry (fine-tuned DistilBERT or similar)
- When an entry scores high on "resolution detected," find the closest past entry by cosine similarity
- If similarity > threshold and the past entry sounds like a petition, suggest "Mark as answered?"
- Display answered prayers as timeline cards: asked date → answered date, with the text and a connecting line
- Display still-waiting prayers as muted cards with only the asked date
- User can manually mark/unmark

**Acceptance:** Write "I got the job." App suggests linking to "I've been praying about this job" from 3 months ago. User confirms. Timeline shows both entries connected.

---

### Task 13: Month-over-month comparison

**Objective:** Show this month vs last month side by side.

**What to build:**
- Two-column card: June vs May
- Conversation count, top topic, most active day for each month
- Simple, visual. No charts needed.

**Acceptance:** June shows 17 conversations, top topic exhaustion. May shows 12, top topic work stress.

---

## Phase 5: Past Tab — Conversation History

### Task 14: Conversation list with search

**Objective:** Browse past conversations, search by keyword or tag.

**What to build:**
- List of conversation groups: date/date range, first message preview, message count, resonance count
- Search bar filters by text content or auto-detected tags
- Tap a conversation to expand and read the full thread with its resonance cards
- Tags shown as small pills on each conversation card (auto-detected from TF-IDF keywords)

**Acceptance:** Scroll through conversations. Search "exhaustion" → only relevant conversations appear.

---

## Phase 6: About + Settings

### Task 15: About screen

**Objective:** Explain what the app is and show data stats.

**What to build:**
- Accessible from a small icon in the header (not a tab)
- Description: "Write what's on your heart. Scripture and voices across Christian history respond — not with advice, but with resonance."
- Stats: total conversations, corpus size, app size, network access status (None), privacy status (100% on-device)
- No settings to configure. No account. No social. No notifications toggle.

**Acceptance:** About screen shows accurate stats. No settings. No account creation flow.

---

### Task 16: Model settings (power user)

**Objective:** Let advanced users swap models.

**What to build:**
- Model settings panel accessible from About
- Retrieval model: dropdown with 3-4 options, download size shown
- Generation model: dropdown with 3-4 options + "None"
- Storage used and free space displayed
- "Restore defaults" button
- Download progress bar when switching
- Default: EmbeddingGemma-300M + Qwen2.5 1.5B

**Acceptance:** Switch to GTE-small → model downloads → resonance still works. Set generation to None → Expand disappears.

---

## Phase 7: Polish

### Task 17: Weekly roundup

**Objective:** Sunday evening, surface a card in the chat with the week's patterns.

**What to build:**
- Background task: checks if today is Sunday and user hasn't received this week's roundup
- Compiles: conversation count, top topics, mood trajectory, new answered prayers, voice of the week
- Inserts a special card into the chat. Not a push notification. Not an email. Just a card in the conversation.

**Acceptance:** Sunday evening, a roundup card appears in chat. User scrolls past it like any other message.

---

### Task 18: Privacy hardening

**Objective:** Make it verifiable that nothing leaves the device.

**What to build:**
- App requests zero network permissions at the OS level
- All data stored in app-local SQLite (no cloud sync, no analytics, no crash reporting)
- Export: encrypted JSON export of all entries to file
- Import: load a previous export
- Biometric lock option (FaceID / fingerprint to open app)

**Acceptance:** Phone settings show zero network data used by the app. Export produces a readable file. Reimport restores entries.

---

## Data Flow Summary

```
User types → Embedding model (50ms) → Vector stored in SQLite
                                         │
                    ┌────────────────────┼────────────────────┐
                    ▼                    ▼                    ▼
            Cosine vs Bible      Cosine vs Saints     Cosine vs Past
            (pre-computed)       (pre-computed)       (stored vectors)
                    │                    │                    │
                    ▼                    ▼                    ▼
              Top 2 verses        Top 2-3 voices        Top 1-2 entries
                    │                    │                    │
                    └────────────────────┼────────────────────┘
                                         │
                                    Selection Algorithm
                                    (recency penalty + diversity + weighted random)
                                         │
                                         ▼
                                    Resonance Cards
                                    (rendered inline in chat)

[Weekly background task]
All vectors → clustering → topic labels → mood calendar → Patterns tab refreshed
```

## What the LLM Does (Optional)

- Classification: mood label per entry, answered prayer detection (DistilBERT, ~80MB, deterministic)
- Generation: reflection questions on Expand tap (Qwen2.5 1.5B, ~3 seconds, user-initiated)
- Weekly cluster labeling (4-8 clusters, one LLM call per week)

## What the LLM Does NOT Do

- Write prayers
- Generate resonance cards
- Run in real-time on every send
- Interpret Scripture
- Give advice
- Have a conversation with the user
