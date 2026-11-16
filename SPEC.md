# SPEC — Family Language Learning App (Korean · English)

> **What we are building.** This document describes the product: features, data, screens and acceptance criteria.
> For *how* to build it (stack, commands, coding rules) see `CLAUDE.md`.
> Status markers: `[ ]` not started · `[~]` in progress · `[x]` done. Update them as work progresses.

> **Product change (2026-10-08).** Chinese (`zh`) is removed from the product; Korean Hanja + Hán-Việt stay.
> Learning becomes picture-based: every word, phrase and example sentence has an image (AI-drawn or uploaded).
> Phrases become study items of their own, and a new `picture` card type is added.
> `zh` was removed from code and DB in **M1.6**; decisions from M1.1–M1.4 below remain valid except where marked *superseded*.

---

## 1. Overview

A personal, family-only Progressive Web App (PWA) for learning **Korean and English**, focused on:

1. **Vocabulary**: remembering words and phrases long-term with spaced repetition (FSRS).
2. **Pictures**: every word, phrase and example sentence has a simple illustration; learners connect sounds and words to images.
3. **Pronunciation**: hearing native-quality audio, recording yourself and getting an automatic score.

It is visual (images first, large clear typography) and audio-first. It runs in the browser on PC and phone, can be installed to the home screen, and works offline for reviewing.

### Goals
- Daily review takes 10–15 minutes and feels smooth on a phone.
- Every word, phrase and example sentence has audio **and an image**.
- Pronunciation feedback shows *which syllable/word* was wrong, not just a number.
- Links through Hanja (Sino-Korean ↔ Sino-Vietnamese / Hán-Việt) help Vietnamese speakers learn Korean faster.
- Hosting cost stays at **$0** (free tiers); paid API usage stays under a few USD/month.

### Non-goals (for now)
- Chinese as a learning language (removed 2026-10-08).
- Public sign-up, multiple families, monetization.
- Grammar courses, long reading/listening lessons, chat tutor.
- Native mobile apps (the PWA is enough).

---

## 2. Users & profiles

The app is used by **one family** on shared or personal devices.

| Profile type | Example | Needs |
|---|---|---|
| Adult (owner) | Father: Korean TOPIK 3–4 (workplace/IT Korean), English beginner | Full features, word editing, AI enrichment, stats |
| Adult | Mother | Same as above, own progress |
| Kid | Young children | **Kid mode**: big images, audio-first, few buttons, no text-heavy screens, cannot edit/delete shared content |

Requirements:
- [x] Netflix-style **profile picker** (avatar + name). Decision (M1.1): the app opens the last used profile directly; the picker is opened from the top bar or on first run.
- [~] Each profile has its own: learning languages (`ko`, `en`), SRS progress, pronunciation history, settings.
- [x] Per-profile settings: `ui_lang` (vi / ko / en), `gloss_lang` (meaning language shown on cards: vi / ko / en), daily new-card limit, kid mode on/off.
  - The daily new-card limit (`daily_new_limit`) is one profile setting applied **separately to each learning language**, and counts only new recognition cards (see F4).
  - Rationale: kids living in Korea may read Korean better than Vietnamese, so they may learn English with Korean glosses.
- [x] Optional 4-digit PIN on adult profiles (to stop kids from changing settings; not real security).
- [x] Access to the whole app is protected by Cloudflare Access (family email allow-list, One-time PIN, 1-month session). There is no in-app password system. The Worker also verifies the Access JWT on every `/api` request and the email against `ALLOWED_EMAILS` (M2.1, see §7.1).

---

## 3. Languages & content conventions

| | Korean (`ko`) | English (`en`) |
|---|---|---|
| Script | Hangul | Latin |
| Reading | Revised Romanization (optional, can be hidden) | IPA, US English |
| Hanja | Traditional characters for Sino-Korean words | — |
| Sino-Vietnamese | Hán-Việt reading when the word is Sino-Korean | — |
| Default TTS voice | `ko-KR-SunHiNeural` | `en-US-JennyNeural` |
| Pronunciation scoring locale | ko-KR | en-US |

Example of a fully enriched entry:

```
학생  [haksaeng]   學生   Hán-Việt: học sinh   →  student / học sinh      🖼 (student with a school bag)
  phrases: 대학생 (university student) · 학생증 (student ID card)
  example: 저는 학생이에요. → Tôi là học sinh.                             🖼 (child pointing at self, school bag)
```

- AI-generated fields (readings, Hanja, Hán-Việt, glosses, phrases, examples, image prompts) are marked `ai_generated = true` and can be edited by an adult. Hán-Việt and Hanja readings are error-prone, so they show a small "AI" badge until an adult confirms them.
- HTML text in Korean must carry `lang="ko"` so the correct font glyphs (Noto Sans KR) are used; Hanja is shown with `lang="ko"` as well.

---

## 4. Features

Priority: **P0** = MVP, **P1** = next, **P2** = later.

**Study items.** The app has three kinds of content:
- **Word** (`words`): a single vocabulary item. Has cards.
- **Phrase** (`phrases`): a collocation or short expression built on one word (its *root word*), e.g. 학생 → 대학생, 학생증; apple → apple pie. Has cards.
- **Example sentence** (`examples`): belongs to exactly one word **or** one phrase. Has an image and audio, **no cards of its own**.

### F1. Profiles — P0
- [x] Create / edit / delete profile (adult only can delete).
- [x] Profile picker, remember last profile per device.
- [x] Per-profile settings listed in §2.
- [x] **Avatar photo (M2.10):** besides the 16-emoji picker, an adult can upload a real photo ("My photo": resized in the browser ≤ 512 px WebP, the server only re-checks — no AI drawing, no quota). The photo, when set, takes priority over the emoji everywhere the avatar is shown. It is stored content-addressed (same `images/upload/<sha1>.<ext>` R2 scheme as word/phrase/example photos — `storeUploadedImage()` in `worker/services/imageUpload.ts`, shared by both), so an identical upload elsewhere is reused for free. `POST` / `DELETE /api/profiles/:id/avatar-photo` require the calling profile (`profile_id`) to be an adult (`requireAdult`, same as word/phrase/example image uploads); editing is only reachable through the editor page already gated to adults. Removing a photo clears `profiles.avatar_photo` but never deletes the R2 object (it may be shared with a word/phrase/example image). Only available in edit mode (not while creating the very first profile, which has no id yet).

**Done when:** two profiles on the same device have completely separate review queues.
(Verified in M1.4: profiles cannot see or answer each other's cards.)

### F2. Word library, phrases & decks — P0
- [x] Add a word: choose language, type the term → **AI enrich** fills reading, glosses (vi/en/ko), part of speech, Hanja, Hán-Việt, example sentences with translations, an emoji, an **image prompt** for the word and each example, and **1–3 suggested phrases**. *(image prompts and phrases: M1.7–M1.8; from M1.7: **2 examples per word, 1 example per phrase**; M1.2 produced 2–3 per word)*
- [x] Preview and edit before saving.
- [x] **Phrases:** the Add word screen lists the AI-suggested phrases (each with reading, glosses, 1 example); the adult ticks which ones to keep. Phrases that are not ticked are not saved (and never drawn). Kept phrases are saved with the word, linked to it as root word, and get their own cards. Phrases can also be added later from Word detail ("Suggest phrases" with AI, or "Add phrase manually"). (M1.7)
- [~] Words and phrases are a **shared family library**. Decks group words (e.g. "IT Korean", "Animals for kids"). (M1.4: one default deck per language; phrases follow the deck of their root word.)
- [~] Search/filter by language, deck, tag. (M1.2: language + text search done; deck/tag filters later. M1.7: Words / Phrases switch in the library, phrase count per word.)
- [x] Duplicate detection (same language + same term). Phrases: same language + same text.
- [~] Adding a word to a deck creates cards for every profile that studies that deck. (M1.4: automatic for the default decks.)

Decisions (M1.2):
- Only adult profiles can add words or call AI enrichment; kid profiles only browse the library.
- Terms are normalized before saving and duplicate checks (trim, collapse spaces, Unicode NFC). English duplicates are case-insensitive ("Apple" = "apple").
- The duplicate check runs **before** the AI call, so an existing word costs nothing and links to the existing entry.
- Words can also be entered by hand (no AI); then `ai_generated = false`. Saved AI entries keep `ai_generated = true, verified = false` even after edits, until an adult confirms them.
- After saving, the app opens a simple read-only **Word detail** screen (§6 screen 6). Editing a saved word comes later.

Decisions (2026-10-08, product change):
- Phrases are separate study items attached to one root word (`phrases.word_id`). Deleting the root word deletes its phrases.
- Which suggested phrases are kept is chosen at add time by the adult and applies to the **shared family library**; every profile studying the language gets its **own cards** for them (decided 2026-10-08).

Decisions (M1.7):
- Suggested phrases are **unticked by default** and editable before saving; only ticked ones are saved.
- A phrase whose text already exists (as a phrase of another word, or equal to the root word) is skipped with a notice "already exists under word X"; `UNIQUE(lang, text)` is kept.
- Phrases can be edited (text, reading, glosses, example) and deleted by adults on Word detail. Changing the text regenerates its audio.
- Deleting a word asks for confirmation and deletes its phrases, examples and every profile's cards for them; review logs are kept (`card_id` → NULL).
- **Kid profiles get no phrase cards** (and never see phrase cards created earlier).

**Albums (M2.4)** — playlists of words, shared by the family.
- [x] An album belongs to **one language**; a word can be in **many albums**; one level (no nesting). Adults create, rename, delete and change membership; **kid profiles only browse and review**. Deleting an album never deletes its words. Phrases belong to an album through their root word.
- [x] Stored in the existing `decks` / `deck_words` tables: `decks.kind = 'album'` (default decks keep `kind = 'default'` and are hidden from album lists; they alone drive card creation). `deck_words.added_at` orders "recently added" and picks the cover. A trigger keeps a word and its album in the same language (the API checks too). Names: at most 60 characters, unique per language (case-insensitive), the same name in another language is fine.
- [x] Library: tabs **All | Albums**. The Albums tab has a language filter and a grid with a cover (the image of the first-added word with a ready image, else an emoji), name and word count. A virtual **"Unsorted"** entry (words that are in no album, per language, not stored in the database) opens like an album and supports "select many → add to album". It is not offered when choosing an album to review.
- [x] Adding words: choose albums on the Add word screen (saved with the word); **Album** button on Word detail (tick albums); Library / album page **Select many** (Words tab only) → "Add to album" (existing or new) / "Remove from album".
- [x] Review: Home shows, under each language, an album chooser with the album's due + new cards; `/review?lang=ko&album=<id>` queues only that album's cards. The FSRS schedule is shared and `daily_new_limit` still counts the whole language (cards introduced today in any album count). Albums never create cards.
- API: `GET/POST /api/albums`, `PATCH/DELETE /api/albums/:id`, `POST/DELETE /api/albums/:id/words`, `PUT /api/words/:id/albums`, `GET /api/words?album=<id|none>`, `album_ids` on `POST /api/words`, `album` on `/api/review/queue`, `albums` in `/api/review/summary`. Migration `0005_albums` only adds columns and triggers; existing rows were backfilled.

**Focus view (M2.5)** — tap an example sentence or a phrase to see it full screen.
- [x] Opens from **Word detail** (tap the picture or text of an example / phrase), the **back of a review card** (the card's examples) and the **Library** (an enlarge button on each phrase row; tapping the row still opens Word detail).
- [x] Content: large picture (drawn on demand for an example), large text in the right `lang`, the phrase's reading (example sentences have none yet), the **meaning hidden until tapped** (profile's gloss language first, then the others), **Listen** (big), **1.0× / 0.75×**, **Repeat** (plays again 1.5 s after each play until pressed again; stops on a new item or when closed) and an **Auto-play on / off** switch kept per device in localStorage (default on; off = nothing plays by itself, Listen and Repeat still work).
- [x] Moving: swipe left / right, ← / → keys, or the arrow buttons, through the word's examples and phrases (a phrase is followed by its example); dots + "n / total"; the neighbours' picture and sound are preloaded. In a review it moves only through the current card's examples. Esc or ✕ closes.
- [x] History: the view is `?focus=example:<id>` / `?focus=phrase:<id>`. Opening pushes one history entry, so the Android / browser **Back** button closes the view and stays on the screen; moving between items replaces the entry. Closing a view opened by a direct URL removes the parameter. In a review, opening and closing never flips or rates the card (Space and 1–4 are ignored meanwhile) and sound stops when it closes.
- [x] Kid profiles can use it (look and listen only). A hidden slot is reserved for "Record & score" (M3).

**Typed sentences and phrases with AI help; editing examples (M2.6)**
- [x] **AI translate & illustrate** (Add word screen, Word detail): after typing a sentence the adult presses the button; one LLM call (task `enrich-sentence`, cached in `ai_cache`, counted in the daily LLM quota, same retry / fallback as other tasks) returns the three translations (never into the sentence's own language) and an `image_prompt` (`IMAGE_PROMPT_RULES`). Phrases (`enrich-phrase`) get reading, the three meanings and an `image_prompt`. Everything can be edited before saving; saving makes the audio at once and draws the picture in the background (as before).
- [x] **Sentence check** (same call): `suggestion` (a more natural / correct sentence) + `note_vi` (short Vietnamese reason) only when the sentence has a mistake or sounds unnatural, otherwise null. The app offers **Use the suggestion** / **Keep mine**; it never changes the sentence by itself. Choosing the suggestion takes its own translations and image prompt. If the sentence does not seem to contain the root word (or an inflected form; the AI judges that) a light warning shows; saving is still allowed.
- [x] **Edit / delete examples** of a word and of a phrase on Word detail (adults; kids get 403 and no buttons). Changing the text makes new audio (R2 key follows the text, old files stay); only changing translations never calls TTS, AI or the image model. "Update meaning & picture with AI" is on by default when the text changed: the first Save runs the AI so the translations can be reviewed, the second stores them and redraws the picture (new nonce; the old picture stays in R2). Deleting asks for confirmation.
- [x] **Add example**: "+ Add example sentence" on Word detail (a word has at most **5** examples, a phrase **1**; a phrase shows the button only while it has none); "Add phrase by hand" also on the Add word screen. The number of sentences the AI writes when a word is added is unchanged (2 per word, 1 per phrase).
- API: `POST /api/enrich/sentence`, `POST /api/enrich/phrase`, `POST /api/words/:id/examples`, `PATCH /api/examples/:id`, `DELETE /api/examples/:id` (adults only, zod).
- **Decision (2026-10-11): deleting content does not delete practice history.** `pron_attempts.word_id / phrase_id / example_id` are `ON DELETE SET NULL` (migration `0006`, table rebuilt while empty); the history stays readable through `reference_text`. Deleting a profile still deletes its attempts.

**Library scope filter (M2.7)** — the library stays one shared family list; this only filters the view.
- [x] Three chips above the word/phrase list, on the "All" tab, an album page and "Unsorted": **I'm learning** (default; the profile has ≥1 card for the word — a phrase follows its root word's cards), **I added** (`created_by_profile` = the profile; a phrase's own creator, not the root word's), **All** (today's behaviour). Combines with language, search and album filters (all AND). The choice is remembered **per profile, per device** (localStorage). Kid profiles default to "I'm learning" and can switch to the others (view only). An album card's word count in the grid is never filtered (always the true total).
- [x] A friendly empty state for "I'm learning" / "I added" ("You are not learning/have not added any words here yet." + a "View All" button).
- [x] A new word appears in "I'm learning" **immediately**: `POST /api/words` syncs the creator's cards in the same request (`syncProfileCards`), not only on the next Home visit. Other profiles still sync when they open Home. If the word's language is not in the creator's `study_langs`, a light notice says it was saved to the shared library but is not yet in the learning list.
- API: `GET /api/words` and `GET /api/phrases` take `scope` (`learning`\|`mine`\|`all`, default `all`) and `profile_id` (required unless `scope=all`). Migration `0007` only adds indexes (`cards(profile_id, word_id)`, `words(created_by_profile)`) for the `EXISTS` / equality filters.
- `created_by_profile` is set on every creation path (word, phrase saved with a word, phrase added later) — already true before M2.7 (checked, test added); `examples` has no such column.
- One-off `npm run assign-creator -- --profile <id> [--apply]`: content moved from local before M2.7 has `created_by_profile = NULL`; the script lists (dry run) or sets (`--apply`, after a production backup) those rows to one profile, touching only rows still NULL.

**Image quota banner (M2.8)** — raised the daily image limits and made a skipped draw visible.
- [x] Limits raised from 60/profile + 150/family to 100/profile/day, 250/family/day (superseded by M2.9 below).
- [x] When a draw is skipped because either limit is reached (API answers `quota: true`), every place with a draw button shows an amber banner (`ImageQuotaNotice`, same style as `AudioStatus` / `LearningStatusNotice`) naming when the quota resets (UTC midnight, formatted in the viewer's own device time/locale) — word, phrase and example `ImageTools`, and Settings → "Create images for older words". Previously this was a small grey line of text, easy to miss.

**Billing fix + account-wide exhaustion (M2.9)** — on production, Workers AI's own account-wide daily Neuron allocation (10,000/day) ran out ("4006"), and the app was double-charging its own quota for drawings that never produced an image.
- [x] `usage_daily`'s image quota is now billed **only when a drawing actually succeeds** (including a success via the fallback model); a model call that errors refunds its unit at once (`refundImageQuota` in `worker/lib/quota.ts`). The existing atomic check-then-consume step is unchanged, so two concurrent drawings still can never take the same last unit.
- [x] Error 4006 (account-wide Neuron allocation used up) is detected (`isProviderExhaustedError` in `worker/services/imageModels.ts`) and short-circuits: no fallback-model attempt, no further items in the same batch, and the item is left `none` (never `failed`) so it stays retryable once the allocation resets. The result carries a separate `provider_exhausted: true` flag (distinct from `quota`), threaded through `ensure`/`retry`/`redraw`/`backfill` to the `ImageState` / `BackfillResponse` API contracts.
- [x] The UI shows a distinct amber banner (`ProviderExhaustedNotice`, i18n `images.providerExhaustedBanner`) wherever a draw button exists, separate from the per-profile/family `ImageQuotaNotice`.
- [x] While a 4006 was seen recently, drawing new words' images in the background is paused: a module-scoped flag (`isProviderExhausted()` / `markProviderExhausted()` in `worker/services/imageJobs.ts`, 10-minute window) makes `drawAfterSave()` skip starting the background job entirely. This is a best-effort, per-Worker-isolate cache (Cloudflare may recycle the isolate sooner), not a durable guarantee — Workers AI's own error is always the source of truth. New items stay `pending` (claimed at save time) and become claimable again once stale, same as any cut-off `waitUntil` job.
- [x] Limits lowered again to **60/profile/day, 100/family/day** (`IMAGE_DAILY_QUOTA`, `IMAGE_FAMILY_DAILY_CAP` in `shared/image.ts`, the single place both numbers live) after measuring real usage against the account's free Neuron allocation.

**Done when:** typing `학생` and pressing "Add" produces a complete entry like the example in §3 within ~5 seconds, with audio playable; images appear shortly after (background generation).

### F3. Media: audio & images — P0
Audio:
- [~] Audio generated by TTS for every word, phrase and example sentence. Generate once, store in R2, cache on device. (M1.3: words + examples; M1.7: phrases + their examples; browser HTTP cache; offline cache with F11.)
- [x] Audio playback speed: 1.0× and 0.75×.
- [x] Media is **content-addressed**: the same text + voice always maps to the same file (no duplicates).

Images (M1.8):
- [x] Every word, phrase and example sentence has an image. Sources:
  1. **AI drawing** with Cloudflare Workers AI (FLUX) through the `env.AI` binding — the default.
  2. **"My photo"**: the adult uploads a picture; the browser resizes it to ≤ 512 px (WebP) **before** uploading.
  3. While an image is not ready (or failed), the **emoji** is shown as a placeholder.
- [x] Every image has a **"Redraw"** button with an editable prompt, and a **"My photo"** button (adults only).
- [x] The prompt is built from the item's `image_prompt` (from Gemini, see F6) plus a **fixed style**:
  `flat vector illustration, bright colors, simple shapes, plain background, no text, no letters, family-friendly, safe for children` (`IMAGE_STYLE` in `worker/services/imagePrompt.ts`, `style-v1`).
- [x] **When images are drawn:** right after saving, the **word** and its **selected phrases** are drawn. **Example sentence** images are drawn **lazily**, the first time the sentence is displayed. Unselected phrases are never drawn.
- [x] Generation runs **in the background with Workers `waitUntil`** (Cloudflare Queues later). Image status per item: `none` (lazy, not requested yet) → `pending` → `ready` | `failed`. The UI shows the emoji placeholder and updates automatically when the image is ready; `failed` shows a **"Try again"** button (plus "Redraw" with an editable prompt).
- [x] Stored in R2, **content-addressed**; an image that already exists is never drawn again. `image_prompt` and `image_source` (`ai` | `upload`) are stored with the item.
- [x] Daily quota: service `image` in `usage_daily`, default **60 images per profile per day**, plus a **family-wide daily cap** of **100/day** (`IMAGE_DAILY_QUOTA` / `IMAGE_FAMILY_DAILY_CAP` in `shared/image.ts`, the one place to change both; one atomic SQL statement checks both, resets at UTC midnight). Only a drawing that actually succeeds is billed (M2.9: a failed attempt, including one superseded by the fallback model, refunds its unit); R2 hits are free. When our own limit is reached the item keeps its placeholder (`none`) and an amber **quota banner** is shown (M2.8) wherever a draw button exists; when Workers AI's own account-wide allocation is used up (error 4006, M2.9) a separate **provider-exhausted banner** is shown instead, and the background auto-draw on new words pauses for a short while — nothing fails either way.
- [x] Settings → **"Create images for older words"** (adults): draws words / phrases that were never drawn, one word per request, within the quotas; missing prompts come from one LLM call per word. Settings also shows **today's usage**: family images x/100, this profile's images y/60, LLM and TTS calls.

Decisions (M1.3):
- TTS: Azure Speech REST, output `audio-24khz-48kbitrate-mono-mp3` (mp3, mono, 24 kHz).
- Default voices (in code): `ko-KR-SunHiNeural`, `en-US-JennyNeural` (*superseded:* `zh-CN-XiaoxiaoNeural` / `TTS_VOICE_ZH` are removed in M1.6). Override with `vars` in `wrangler.jsonc`: `TTS_VOICE_KO`, `TTS_VOICE_EN`. A different voice gives different files (the voice is part of the key).
- R2 key: `audio/{lang}/{voice}/{sha1(text)}.mp3`, text normalized (NFC, trimmed). If the key already exists, Azure is not called.
- Audio is generated **while saving a word** (the word and each example; phrases and their examples from M1.7). If TTS fails or the quota is reached, the item is still saved without audio, a light notice is shown, and a **"Generate audio"** button on Word detail fills in what is missing.
- Daily quota: **200 Azure TTS calls per profile per day** (`usage_daily`, service `tts`). Existing files in R2 do not count.
- Playback speed (1.0× / 0.75×) uses the browser's `playbackRate`; no extra files. The choice is remembered per device.
- Media is served by `/api/media/...` with immutable cache headers, so the browser keeps it; full offline caching comes with F11 (M2).

Decisions (2026-10-08, images):
- AI image R2 key: `images/ai/{sha1(model + full prompt incl. style + style_version + nonce + size)}.webp|jpg`. The first drawing uses nonce "0"; **"Redraw"** uses a new random nonce (passed as the seed when the model supports one) and/or the edited prompt, so it produces a new key.
- **Seed support differs per model (checked 2026-10 with `wrangler ai models schema`):** `flux-1-schnell` accepts only `prompt` and `steps` (≤ 8); any other field (`seed`, `width`, `height`) is rejected with error 5006, and it picks the output size itself. `flux-2-klein-4b` (multipart) accepts `prompt`, `width`/`height` (256–1920), `seed`, `guidance`. So with schnell, **"Redraw" relies on the model's own randomness**, and the R2 key must use a random **nonce** instead of the seed: `sha1(model + full prompt + style_version + nonce + size)`, nonce = `"0"` for the first drawing and a new random value for every Redraw. With a seed-capable model the seed is the nonce. Each model's accepted input is a zod schema in `worker/services/imageModels.ts` (`inputSchema`, `supportsSeed`), checked before every call.
- Uploaded image R2 key: `images/upload/{sha1(file bytes)}.webp`. The server checks type (WebP/JPEG/PNG) and size (≤ 512 px, ≤ ~300 KB).
- Image size 512×512. Images are not regenerated when only glosses or translations change.
- Kid profiles cannot redraw or upload (a kid's first display of an example may still trigger its lazy drawing, charged to the family cap).
- Old images are **kept** in R2 after "Redraw" / "My photo" (no deletion); only the item's `image_key` changes.
- ~~Model: start with `flux-1-schnell`~~ **Decided after the benchmark (2026-10-09): primary `@cf/black-forest-labs/flux-2-klein-4b`, fallback `@cf/black-forest-labs/flux-1-schnell`** (used once when klein fails). `image_model` records which model drew each image, for fallback statistics.

  Benchmark (M1.8A, 5 items × 2 models, prompts by Gemini, style `style-v1`, estimates from the price list):

  | Model | Output | Time / image | File size | Neurons / image | Images per 10,000 Neurons |
  |---|---|---|---|---|---|
  | flux-2-klein-4b | 512×512 JPEG | 9–33 s (avg 19 s) | ≈ 90 KB | ≈ 26 | ≈ 383 |
  | flux-1-schnell | 1024×1024 JPEG (no size parameter) | 2–3 s | ≈ 280 KB | ≈ 58 | ≈ 173 |

  Klein is half the cost and already 512 px; it is slow, which is fine for background drawing. Schnell images (fallback only) are stored as they are (no image library in the Worker).
- M1.8A (benchmark only, not wired into the app): `npm run bench:images` (needs `npx wrangler login` once). Gemini writes each `image_prompt` with `buildImagePromptRequest()` / `IMAGE_PROMPT_RULES` (the same rules go into the enrichment prompt in M1.8B); images and `report.html` are written to `benchmarks/` (images gitignored). `flux-2-klein-4b` takes multipart input and is drawn at 512×512; `flux-1-schnell` has no size parameter.

### F4. Review with spaced repetition (FSRS) — P0
- [x] Scheduling uses the `ts-fsrs` library. Ratings: Again / Hard / Good / Easy.
- [~] Card types per word **and per phrase** (each scheduled independently):
  - **Recognition**: see the word/phrase (+ audio auto-play) → recall meaning. P0 (M1.4 words, M1.7 phrases)
  - **Picture**: see the image only → recall the word/phrase (and meaning). P0 (M1.9, done)
  - **Listening**: hear audio only → recall word/phrase and meaning. P0 (M1.4 words, M1.7 phrases)
  - **Speaking**: see image/meaning → say the word aloud → automatic score (see F5), then self-rate. P1
- [x] **Unlock order: recognition → picture → listening.** A new card of the next type only becomes available after the previous type's card of the same item has been reviewed at least once. An item without a ready image has no picture card and goes recognition → listening; when its image becomes ready later, the picture card is added and an existing listening card keeps its progress. Picture and listening cards do not count toward `daily_new_limit`. (M1.9)
- [x] Daily queue = due reviews + up to N new cards (per-profile setting, applied per language).
- [x] **Review only my own words (M6.12):** a per-profile switch (`profiles.own_words_only`, default off) that keeps the queue — and therefore the Home counts, which are built from the same inputs — to items this profile created: a word card follows `words.created_by_profile`, a phrase card its own `phrases.created_by_profile` (a phrase whose creator is unknown is excluded, never inherited from its root word). Hides only: no card is deleted and no schedule is reset, so turning it off resumes every hidden card where it left off.
- [x] **Per-profile card types (M6.6):** each profile chooses which of recognition / picture / listening it practises (`profiles.card_types`, default all three). Switching one off only hides its cards from the queue and the Home counts — the rows, their FSRS schedule and their review history are never touched, so switching it back on resumes the old schedule. Images still appear on card backs and on the word detail page; only the "guess the word from the picture" card type goes away. A disabled type is **transparent** to the unlock chain: the first enabled type becomes the entry type (the one `daily_new_limit` applies to) and each later type is gated on the nearest enabled type before it, so with picture off listening waits for recognition — exactly like an item with no ready image. At least one type must stay on.
- [x] Keyboard shortcuts on PC (Space = flip, 1–4 = rating); large tap targets on phone.
- [x] **Visual review screen (M1.9):** the image is the centre of the card. Back side: word/phrase, reading, meaning, audio, Hanja/Hán-Việt, and the example sentences, each with a small image + audio button.
- [ ] Works **offline**: reviews are stored locally and synced when online.
- [x] Each review is logged (for stats and FSRS optimization later).

Card faces (M1.9):
| Card | Front | Back |
|---|---|---|
| Recognition | word/phrase (+ audio auto-play), no image (it would give away the meaning) | large image, reading, meaning, Hanja/Hán-Việt, examples (small image + audio) |
| Picture | large image only | word/phrase + audio, reading, meaning, examples |
| Listening | audio only (big speaker) | large image, word/phrase, meaning, examples |

**Done when:** a profile can complete a 20-card session on a phone in airplane mode, and the results appear on another device after reconnecting.

Decisions (M1.4):
- Minimal decks: one default deck per language (ids `default-ko`, `default-en`; *superseded:* `default-zh` is removed in M1.6). Every word is in the deck of its language; phrases follow their root word. A profile studies the default decks of its `study_langs`; cards are created automatically, also for items saved earlier. Removing a language unlinks the deck but keeps the cards and their progress.
- Scheduling: `ts-fsrs` with library default parameters (learning steps 1m/10m, relearning 10m, retention 0.9) and **fuzz off**, so the interval shown under each rating button equals the server result. The server computes the schedule and is the authority for `review_logs` (also after offline sync in M2).
- A new listening card only becomes available after the recognition card of the same word has been reviewed at least once. *(Extended in M1.9 to the chain recognition → picture → listening.)*
- Daily queue for one language = due cards (learning cards up to 20 min ahead) + up to `daily_new_limit` new **recognition** cards minus those already introduced today in that language. New picture/listening cards do not count toward the limit. New recognition cards of words and phrases both count toward the limit (decided 2026-10-08).
- "Today" starts at local midnight of the device (the client sends its UTC offset).
- Cards answered "Again" (or still in learning steps) come back in the same session when due within 20 minutes.
- The session starts after choosing a language; the review screen has no navigation, only an Exit button back to Home (M1.5).
- Dev time travel: while running locally, a small panel (only in `import.meta.env.DEV`) shifts "today"; it sends `X-Dev-Now`, which the server reads **only** when `DEV_TIME_TRAVEL=1` (in `.dev.vars`). Production always ignores it.
Decisions (M1.9):
- Picture cards are created (by `syncProfileCards`, idempotent) only for words/phrases whose `image_status = 'ready'`; kid profiles get picture cards for words, not for phrases. No migration: `card_type` has no CHECK constraint.
- Unlock chain in the queue: `prev_state` = recognition for picture; picture if the item has a picture card, else recognition, for listening.
- Queue items now carry the item's example sentences (with image fields and audio); `/api/review/summary` returns `by_type` (recognition / picture / listening counts of due + new cards) for the Home screen.
- Review UI: big square image, rating bar fixed at the bottom; desktop = image left, content right. The next 3 cards' images and audio are preloaded (`src/features/review/preload.ts`); preloading never asks for drawing. Picture cards play their audio on the flip, not on the front.
- Not in M1.4: kid mode (F8), speaking cards (M3), offline sync (M2).

### F5. Pronunciation practice & scoring — P1
- [ ] Practice screen: play reference audio → press-and-hold (or tap) to record → show score.
- [ ] Scoring via Azure Speech **Pronunciation Assessment** with reference text: overall score plus accuracy, fluency and completeness.
- [ ] Color each word/syllable by score: green ≥ 80, yellow 60–79, red < 60. Use the most detailed level the locale returns (phoneme → syllable → word) and degrade gracefully.
- [ ] "Compare" button: play reference, then own recording.
- [ ] History per word/phrase: last scores and best score. List of "my weakest words/sounds".
- [ ] Practice can target a word, a phrase or an example sentence.
- [ ] **Privacy:** voice recordings stay on the device only (IndexedDB, last 5 per item). The server stores scores, never audio.
- [ ] Daily scoring quota, two tiers like images: **25 takes per adult profile, 15 per kid profile, 60 for the whole family**, and a take is at most **8 seconds** (see Decisions below for where the numbers come from).

**Done when:** recording `사과` with a clearly wrong vowel shows a red syllable and a lower score than a correct recording.

Decisions (M3.0, 2026-11-13):
- **The Worker calls Azure, not the browser.** The app records a 16 kHz mono 16-bit WAV and posts it to the Worker, which calls Azure's *Speech to text REST API for short audio* with a `Pronunciation-Assessment` header and returns the result. This replaces the earlier plan (Speech SDK in the browser + a token from `/api/speech-token`, never built). Reasons: the server is the one that states the score (same rule as M7.24); the quota is real (`consumeQuota` → call → `refundQuota` on failure, where a 10-minute token would allow unlimited calls); no new dependency (the client bundle is 886 KB under a 1 MB ceiling); and it tests like TTS does (`createApp({ makePron })` + `fakePron`). The audio only passes through the Worker's memory — never R2, never D1.
- **8 seconds a take, and a two-tier daily quota — sized from Azure's free tier, not from Azure's limit.** Azure accepts 30 s; that is its ceiling, not our budget. F0 gives 5 hours of audio a month for *all* speech-to-text of the whole family (~18,000 s). At the first draft's 100 takes × 30 s, one profile would have used the month in 6 days and four profiles in a day and a half. And this is the **only paid call in the app that cannot be cached** — every take is new audio — so the quota and the length are the only fence. `PRON_MAX_SECONDS = 8` (`shared/wav.ts`) is enforced on both sides: the recorder cuts the take there and the Worker refuses a longer one. The quota is `PRON_DAILY_QUOTA_ADULT = 25`, `PRON_DAILY_QUOTA_KID = 15`, `PRON_FAMILY_DAILY_CAP = 60` (`shared/pron.ts`), taken in one atomic statement — `consumeTieredQuota`, the same statement the image quota goes through (M2.8/M2.9), not a second copy of it. Worst case 60 × 8 s × 31 days = 14,880 s, inside the allowance.
- **Kid profiles may use pronunciation scoring**, on the smaller allowance. It is study, not one of the "AI features" kid profiles are kept out of (enrichment, drawing, TOPIK generation); every other kid restriction is unchanged.
- **Capture is raw PCM from an AudioWorklet, not MediaRecorder** (mp4/AAC on iOS, webm/Opus on Chrome; Azure's REST API takes WAV/PCM or OGG/Opus only). `shared/wav.ts` is the one definition of an acceptable recording: the browser encodes with `encodeWav`, the Worker re-checks with `checkWav` before the quota and before Azure.
- **What `ko-KR` really answers (measured 2026-11-16, raw bodies in `data/pron-probe/out/`): per-syllable scores do exist, and they line up with the Hangul.** Azure's *documentation* promises syllable results and phoneme *names* for `en-US` only, and indeed every `Phoneme.Phoneme` and `Syllable.Syllable` comes back as an empty string for `ko-KR` — but the `Syllables` array of each word has **exactly one entry per Hangul syllable of that word, in order**, including where a sound change applies (`같이` → 2 entries, `먹었어요` → 4, `아침에` → 3). So "a red syllable" for `사과` needs no romanization and no phonology of ours: colour `Word` character *i* with `Syllables[i].AccuracyScore`, and fall back to the word score if the two counts ever disagree (that mismatch is the one thing the code must check at run time). `Words` lines up with the reference text split on whitespace, and `Lexical` echoes the reference text. **Phonemes are unusable** — no names, counts that follow jamo rather than letters (`사과` → 4) — so nothing is shown per phoneme.
- **A wrong take does score low, end to end:** TTS speaking `포도` scored against `사과` gave `PronScore` 6, `AccuracyScore` 30, `CompletenessScore` 0, `ErrorType: "Mispronunciation"` and syllables 32 / 13, against 99.4 / 99 / [99, 99] for the matching take. Scores are often uniform across a word's syllables but not always (`먹었어요`: 100, 100, 100, 80), so per-syllable colouring is worth showing. `SNR` is returned too (45.7 dB on synthesized audio) and may serve as a "the room was too noisy" hint later.
- **Two requests at once were both answered 200** (`--concurrent`, 2026-11-16: 793 ms and 504 ms, identical bodies). F0's "one concurrent request" did not produce a 429 in that test, so M3.1 has no observed throttling answer to classify; it still must treat a non-200 as a failure that refunds the quota unit, and that path stays covered by the fake only.
- **M3.0 is a probe, not a feature**, in two halves. `/practice/probe` (no link to it) records, plays the take back, and prints Azure's JSON untouched from `POST /api/pron/probe`: it settles PCM capture inside the installed PWA on a phone. `npm run pron-probe` (`scripts/pronProbe/`) does the scoring half with no microphone and no database: `--tts "<text>"` has Azure TTS speak the text straight into the scorer's own format (`riff-16khz-16bit-mono-pcm`) — a known-good take, so a high-score case exists without a recording — `--file <wav>` scores a take recorded by hand, `--lang en` adds `EnableProsodyAssessment`, and `--concurrent` fires two requests at once to capture what F0's one-concurrent-request limit really answers (M3.1 has to classify that and refund the quota unit). Bodies are written verbatim to `data/pron-probe/out/`; the run prints the seconds of audio it used and refuses what the app refuses (the same `checkWav`, the same 8 s — no second limit), showing the first 44 bytes of refused audio as hex so a header nobody expected is seen before any rule is loosened for it.
- **Run against real Azure (2026-11-16), so M3.0 is done.** The 401 that blocked this on 2026-11-13 was **not** a bad key: the Azure subscription had been locked read-only after the trial expired, which makes every key on the resource answer 401 with an empty body at every endpoint and in every region — which is why padding, trimming and 29 regions all led nowhere. Once the subscription was re-enabled the unchanged key in `.dev.vars` was accepted (voices list 200, `koreacentral`) and `npm run pron-probe` scored five Korean takes. "Production TTS works" was the misleading clue: TTS is served from the R2 cache, so it proves nothing about the key. Lesson kept in `DEV-NOTES.md`: a 401 with a zero-length body across every endpoint is a subscription problem; a key problem answers with a JSON error body.

### F6. AI enrichment & explanations — P0 (enrich), P1 (explain)
- [x] Enrichment (used by F2) returns **strict JSON** validated by a schema; invalid output → one retry → error message.
- [x] **Content sanity check (M2.11):** the schema only checks shape, not script — it missed a stray Latin letter inside a Korean sentence ("이야기에 a 빠져들다..."). Every vi/en/ko string the LLM generates (word & phrase glosses, example sentences and their translations, a typed sentence's AI translations/suggested rewrite) is also checked for the wrong script (`worker/services/contentCheck.ts`): Korean text must be Hangul (digits/punctuation/common loanword acronyms like TV/AI allowed; a lone Latin letter is always wrong), English text must not contain Hangul/Han/Kana, Vietnamese text must not contain Hangul. A violation shares the schema's one-retry budget (`generateStructured`'s optional `validateContent`); if it is still wrong afterwards, that one example/phrase/suggestion is dropped (logged, never saved) rather than failing the whole enrichment — a required, non-droppable field (e.g. a word's own gloss) is only logged. `npm run scan-llm-content` lists (never fixes) existing rows that would be flagged.
- [x] Resilient LLM calls: 500/503 and network errors are retried 3 times (backoff 1s, 3s, 9s with jitter), then the optional `LLM_FALLBACK_MODEL` is tried once; 400/401/403 are not retried. **429 (out of quota) is not retried either** (changed 2026-11-15, see §11): it goes straight to the fallback model, and the primary is skipped for the next 10 minutes. Retries and the fallback do not use extra quota. `ai_cache.model` records the model that answered. If the AI is still busy, the UI says "AI is busy, try again in a few minutes" with a **Try again** button and keeps what was typed.
- [x] Example sentences match the profile's level: kid → very short and concrete; beginner → simple; Korean (owner) → workplace/IT context allowed.
- [x] Enrichment also returns (M1.7: phrases with 1 example each; M1.8: `image_prompt`, prompt versions `enrich-v4` / `phrases-v2`): an **`image_prompt`** for the word, each example and each phrase; **1–3 suggested phrases**, each with reading, glosses, 1–2 examples (with translations and `image_prompt`).
  - `image_prompt` rules: **English**, one concrete scene with visible objects/people/actions; abstract words are illustrated by a typical situation (e.g. "promise" → two children hooking little fingers); no text or letters in the picture. The fixed style (F3) is appended by the server, not by the LLM.
- [ ] "Explain" button on a card: short explanation in the profile's `gloss_lang` (nuance, common collocations, confusing look-alikes).
- [~] All AI output is cached in the database. The same request is never paid for twice. (M1.2: enrichment cached; "Explain" comes with P1.)

Decisions (M1.2):
- Provider: **Gemini** (`LLM_PROVIDER=gemini`), default model **`gemini-3.8-flash`** (override with `LLM_MODEL`). The LLM client is behind an interface so Claude can be added later.
- Example level is chosen on the Add word screen: kid / beginner / intermediate (workplace/IT allowed). Default: kid for kid profiles, beginner for adults. The level is part of the cache key.
- Cache key = hash of task + prompt version + model + language + term + level. Only valid (schema-checked) output is cached. The prompt version is bumped when phrases and image prompts are added, so old cache entries are not reused.
- Daily quota: **50 LLM calls per profile per day** (`usage_daily`, service `llm`). Cache hits do not count.
- Field conventions: `ko` → Revised Romanization, Hanja + Hán-Việt for Sino-Korean words; `en` → US IPA, no Hanja/Hán-Việt. A gloss in the word's own language is a short definition; an example's translation into its own language is left empty. (*Superseded:* the `zh` conventions and the `hanzi_simplified` field are removed in M1.6.)
- Privacy note: on the Gemini free tier Google may use submitted content to improve its products. Only vocabulary is sent (no personal data).

### F7. Hanja links between Korean words — P1
- [ ] Each Sino-Korean word is split into its Hanja characters. Each character stores: Hanja (traditional form), Hán-Việt reading, Vietnamese meaning.
- [ ] Character page: e.g. `學 – học` lists every Korean word (and phrase) in the library containing it.
- [ ] On a card / Word detail, show "related words" sharing a Hanja character (max 5).

**Done when:** opening `學` shows `학생 (學生)` and `학교 (學校)`, linked by "học".

### F8. Kid mode — P1
- [ ] The image fills most of the card (emoji while the image is not ready). Audio plays automatically. Text is minimal.
- [ ] Only 2 ratings: 😊 "I know" (= Good) / 🤔 "Not yet" (= Again).
- [ ] No edit, delete, settings, AI, redraw or upload buttons.
- [ ] Short sessions (default 10 cards), with a simple reward animation at the end.
- [ ] Optional "say it" game: kid says the word, a star appears if the score ≥ 60 (lenient threshold).

### F9. Import & starter content — P1
- [ ] Import CSV/TSV (columns: term, gloss, optional reading, tags) → AI enrich in batch (images generated in the background within quota).
- [ ] Starter decks generated with AI + reviewed by an adult: "Korean IT/office words", "English basics", "Kids: animals, food, colors, numbers".
- [ ] (P2) Import Anki `.apkg`.
- Note: before bundling any official word list (TOPIK, etc.), check its license.

### F10. Progress & stats — P2
- [ ] Per profile: streak, reviews per day, words/phrases by state (new / learning / mature), retention rate.
- [ ] Pronunciation trend per language.

### F11. PWA & offline — P0
- [x] Installable (manifest, icons), opens full-screen. (M2.2)
- [~] App shell and media (audio **and images**) are cached on the device (M2.2). Still to do in M2.3: the current profile's due cards (the queue itself) available offline.
- [ ] Sync queue: offline reviews and edits are uploaded when back online. Conflict rule: review logs are append-only; for edits, last write wins. (M2.3)

Decisions (M2.2):
- `vite-plugin-pwa` (`injectManifest`, `registerType: "prompt"`) + a hand-written service worker `src/sw.ts` (Workbox). The worker exists only in the production build; `npm run dev` never registers one.
- Manifest: name "Lingo Family", short name "Lingo", `display: standalone`, `start_url: /`, theme `#4f46e5`, icons 192/512 + maskable (own drawing: speech bubble with an "L", `public/icons/icon.svg`, PNGs from `scripts/make-icons.py`). `<link rel="manifest" crossorigin="use-credentials">`, because the site is behind Cloudflare Access and the manifest request must carry the session cookie.
- Caching: app shell precached (JS/CSS/HTML/icons; the ~500 Noto Sans KR font pieces are cached when first used). `/api/media/*` cache-first, plain 200 only, Range requests supported (audio), max 800 entries, 60 days, purged when storage is full. All other `/api/*` network-only. Page loads network-first (4 s), and the precached shell answers only when the network fails; redirects (Access login) are never cached.
- Session expiry: when an `/api` request throws a network error, the app probes `/api/health` with `redirect: "manual"`. An `opaqueredirect` means the Access session expired → reload once (cool-down 60 s, no loop) so the browser reaches the login page. Anything else (offline, flaky) shows "Connection lost. Try again" and never reloads.
- Review preload: the first 30 cards of the session (3 downloads at a time; skipped when `navigator.connection.saveData`), then a window of the next 4 cards while reviewing. Preloading never asks for drawing.
- Settings has an "Install app" card (browser install prompt, iPhone steps for Share → Add to Home Screen, or a hint). A small banner offers "New version — Reload"; updates are checked hourly.
- `npm run preview` builds with `--mode preview` (production bundle and service worker, no Workers AI binding) so the production build can be tried locally.

### F12. TOPIK II practice — P1
**Stage 1 (M6.1, this milestone): question bank + import + practice.**
- [x] Question bank: `section` (`reading` only so far), `exam` (free-form source/exercise label), `number` (the real TOPIK question number), `block` (explicit, e.g. "1~2" — from the source file name/heading, never guessed from `instruction`), `instruction`, `stem` (text and/or image), 4 `options` (each text and/or image), `correct_option`. No separate "question type" field and no shared-reading-passage entity: a pair of questions sharing one reading passage simply repeats it in each question's own `instruction`/`stem`.
- [x] Import from `.docx` (`npm run topik-import`, `scripts/topikImport/`; source files are copyrighted, kept in `data/topik/`, gitignored): parses "유형: 문항 N~M" headings, "연습K" exam groups, "K-i" question labels, a 2-column table (stem row + 4 option cells) **or** an image stem + 4 list-paragraph options, the answer label ("N(M)") cross-checked against the bold+underlined option. A mismatch (between the two answer sources, or the file name vs. the heading's own declared block) is reported, never guessed; a malformed/mismatched item is skipped (not imported) and listed as an error. Idempotent: re-running skips a question that already exists (same `section`+`exam`+`number`) unless `--force`. Default is a dry run (prints a report only); `--apply` backs up production D1 first, then imports with `verified = false`. `--section reading|listening` / `--source <name>` narrow the run by file name, and `--force` without `--section` is refused (it would also reset `verified` on the other section's reviewed questions) unless `--all-sections` is given.
- [x] Review screen (Settings → TOPIK → "Quản lý câu hỏi"): imported questions start unverified; an adult reviews (sees the detected answer), edits if needed, and approves — one at a time or a whole exam/block at once ("Duyệt cả nhóm"). A question with an import warning (e.g. a number cross-check mismatch) sorts first. Only verified questions are used for practice.
- [x] Manual form (fallback next to import): same fields, saved already verified. Adults can edit/delete any question (`requireAdult`).
- [x] Practice: pick a question-number block (derived from the `block` field, e.g. "1~2", "9") → up to 10 questions per session, ordered per profile by ts-fsrs `due` (own `topik_cards` table, independent of word/phrase cards): overdue-and-previously-wrong first, then never-attempted, then other due questions. One question at a time; the answer is shown immediately after picking an option (no quiz-at-the-end). Every attempt is logged (`topik_attempts`: selected option, correct/not, time taken) per profile.
- [x] No AI in this phase; no daily quota (images are not AI-drawn, just optionally uploaded with the import or the manual form, so quota doesn't apply). Images use the same R2 upload/validation as elsewhere (`storeUploadedImage()`), but with their own, looser size limit (scans need to stay legible): ≤ 1900 px, ≤ ~1 MB (`TOPIK_IMAGE_MAX_SIDE` / `TOPIK_IMAGE_MAX_BYTES`, `shared/topik.ts`). The pixel figure has moved three times as real papers arrived (1600 → 1800 → 1900, see the constant's own comment) — read it from the constant, not from here.
- [x] Entry point: a card on Home ("Luyện TOPIK II"), not a 5th bottom-nav item (kept to 4 for mobile width).

**Stage 2 (M6.2, this milestone): tap a word to see its meaning.**
- [x] The server generates — once, in the background — a vocabulary list for a question's whole text (instruction + stem + 4 options): one AI call, cached (`ai_cache`), content words + notable grammar endings only, basic particles excluded. Stored on the question (`vocab` JSON column + `vocab_checked_at`). Each entry: `surface` (exact inflected form as it appears, so the client can match where the learner tapped — Korean attaches grammar endings without a space), `lemma`, `pos`, `gloss_vi`. Trigger: originally at save/approve time (including bulk-approve); changed after M6.3, once imports started growing toward ~600 questions, to only when a question is actually picked for a practice session (`GET /topik/session`), plus a manual single-question create/edit or the review screen's own "Tạo dữ liệu AI" button — never a bulk import/approve, to keep those free.
- [x] Exempt from the 50/day LLM quota (content work, not a practice action), but every call is still logged (`usage_daily` service `topik_vocab`, no cap).
- [x] Client splits each text field into tappable/non-tappable spans by exact `surface` match (longest-first, non-overlapping) — no default underline/highlight; tapping a word shows a small popup (lemma, Vietnamese meaning, "Add to library"); tapping a particle shows nothing. A word already in the library shows the library's own gloss instead of the AI's, with a link to it instead of "Add to library". "Add to library" (M6.3 revision, see below) marks the term instead of leaving the practice screen; the actual full enrichment runs from the end-of-session results screen.
- [x] One-off script `npm run topik-words` (`scripts/topikWords/`) generates the vocabulary for existing questions: dry-run by default (counts + estimated AI calls), `--apply` to write, resumable (skips already-processed questions unless `--force`).

**Stage 3 (M6.3, this milestone): answer explanation + key terms, and a non-interrupting way to add them.**
- [x] When a question's vocabulary is (re)generated, the server also generates — same background job, same cache-first rule, same trigger as the vocabulary (session-start/manual-create-or-edit/"Tạo dữ liệu AI", never a bulk import/approve — see M6.2 above) — an explanation (`explanation_vi`, Vietnamese, names the grammar point when the question is testing one) and 3-5 `key_terms`: lemmas that MUST already be in that question's own `vocab` (never invented; validated and filtered server-side). Regenerates on a stem/options text change, or when `correct_option` itself changes (even with no text change). Exempt from the 50/day LLM quota, logged under `usage_daily` service `topik_explain`, no cap. While generation hasn't finished yet, the practice screen shows "Đang tạo giải thích…"/"Đang tải từ vựng…" and polls `GET /topik/questions/:id/content` until it has, without ever blocking the next question.
- [x] Never sent in `GET /topik/session` (would leak the answer) — only in the `POST /topik/attempts` response, which already reveals `correct_option`. The server resolves `key_terms` per profile at that point: a grammar entry always shows; a content word not yet in the library shows first ("new"), one in the library whose `recognition` card hasn't reached ts-fsrs's Review state shows next ("weak", linking to the existing word instead of offering to add it again), one already at Review state is dropped (the learner knows it). Capped at 5.
- [x] Client: a wrong answer shows the explanation (with an AI badge) and key terms right away; a correct answer only shows a "Xem giải thích" link. Each addable key term has the same "Add to library" action as the M6.2 popup.
- [x] "Add to library" (both the M6.2 popup and the M6.3 key-terms list) was changed from "open the Add-word screen" to **mark the term for later**, so answering questions is never interrupted: the button becomes "Đã đánh dấu" (tap again to un-mark). The marked list lives only in memory for the session (not D1); leaving the practice screen with marks still pending asks for confirmation first (in-app navigation and an actual tab close/reload).
- [x] The end-of-session results screen lists every marked term (with a checkbox to drop some first) and one "Thêm tất cả vào thư viện" button: it runs the full normal enrichment (Hanja, all 3 glosses, example sentences, image, FSRS card) for each, one by one, with no per-word review screen — the review already happened implicitly by marking during practice. Respects the daily LLM/image quotas; hitting one stops the run and reports which terms still need adding later (with a link to the normal Add-word screen for a manual retry).
- [x] **The review screen reviews one section at a time (M7.1):** a Đọc/Nghe switch above the approve tabs, defaulting to Đọc, with the exam-label and block dropdowns scoped to it — ~230 reading rows would otherwise bury the listening ones, and their labels and blocks have nothing to do with each other. A listening row also shows whether a clip is attached (and its timestamps), and "Xem" plays that clip.
- [x] **Read-only question view (M6.7):** every row in the review list has a "Xem" button beside "Sửa"/"Xoá" that shows the question laid out like practice — instruction, stem (line breaks kept, image at full width, the `<u>…</u>` phrase bold+underlined), all 4 options — plus what practice hides until you answer: which option is correct, the explanation and the key terms. A "Sửa" button switches to the edit form from there. The edit form is for typing, not for reading, which is why reviewing content needed its own screen. Words are not tappable here (that marks terms for a practice session's bulk add, which has no meaning outside one).
- [x] **Progress on the block picker (M6.9):** each block row has a thin progress bar (the part already studied is filled) with the counts beside it, always spelled out including zeros ("thuộc 27/46 · chưa làm 0"). The bar has two filled segments (M6.11): dark for what the profile already knows — the question's card reached ts-fsrs `Review`, the same "already knows it" rule the key-terms use — then a lighter one for what it has answered but not learnt yet, then the empty remainder. "✓ Đã xong N/N" replaces the pair only once every question is *known* — it used to appear once every question had merely been answered, which read as "nothing left here" on a block the learner remembered nothing from, and a total row, set apart by a rule above it, adds every block up. The three states are told apart deliberately — finished ("Đã xong" + tick, full but faded bar — nothing is left to do there, so it must not be the loudest row on screen), never started (empty bar, grey text) and part-done (partly filled bar, stronger text) — because "0 of 7 left" and "24 of 24 left" otherwise look identical while meaning opposite things. "Studied" = answered at least once, so a question skipped during a session stays counted as not studied. A question skipped during a session writes no attempt, so it stays counted as not studied. The counts come from one aggregate query (`GET /topik/blocks`, LEFT JOIN against the profile's distinct attempted question ids), never one query per block; `profile_id` is optional there so an installed PWA running an older build still gets its list instead of a 400.
- [x] One-off script `npm run topik-explain` (`scripts/topikExplain/`): same dry-run/`--apply`/`--force`/`--limit`/`--ids`/resumable convention as `topik-words`; only processes questions that already have a vocabulary.

**Stage 4 (M7.1, in progress): the listening paper.**
- [x] `section = 'listening'` alongside reading, from the file name (`TOPIK_Listening_Cau<N>[_<M>]_<source>_VERSION<v>.docx`). The two reading-only fixes for questions 1~4 are scoped to reading.
- [x] One mp3 per exam, never cut (`topik_audio`, R2 `topik/audio/<sha1>.mp3`, named `TOPIK_Listening_<source>_Test<N>.mp3`). A clip is three timestamps into it (`topik_segments`): `start_ms`, `speech_end_ms` (practice plays to here plus ~5s, instead of 18s of dead air) and `end_ms` (the real exam boundary, for the timed mock test). `topik_questions.segment_id` lets a dialogue carry a pair of questions. `/api/media` answers byte ranges, so a 30-second clip does not download a 30 MB paper.
- [x] **Where the exam round comes from (M7.1).** A question's own Heading3 label wins (one Heading2 group can hold items from several real rounds — Cau09/Cau10), then the group's own Heading2 (`35회`, `연습1 (35회)`), then the `연습N` group counter. The listening files use the middle one: Heading2 carries the round and Heading3 stays a plain question number, which keeps the round in one place per group.
- [x] **Names are ASCII, labels are Korean (M7.1).** Every file name — Word and mp3 — stays ASCII, because Korean in a file name gets mangled by one toolchain or another sooner or later; every exam label stays Korean (`OfficialTest-35회`), matching the reading section and the Heading 2 the questions carry. The round therefore travels as `Test<N>` in the mp3 name and is converted in exactly one place, `scripts/topikAudio/plan.ts#examFromAudioName`. A name without a readable `Test<N>` is an **error**, never a quiet fallback to the `연습N` group counter — that kind of silent fallback mislabelled a whole import once already (see the "exam label" lesson in CLAUDE.md).
- [x] **Mock test, stage 1: one real paper (M6.4).** `/topik/tests` lists every paper whose questions **and** clips are approved, with 20 / 32 / whole-paper buttons — a length the paper cannot fill is shown greyed with the reason ("đề này mới có 12 câu"), and a paper whose numbering has a hole offers nothing at all, because "questions 1-20" has to really be 1-20 (`isContiguousFromOne`). Each paper carries its own history line. **The audio is the clock**: no countdown of our own, one span of one mp3 from the first clip's start to the last clip's end — the approval rules guarantee an exam's clips are contiguous, so the tape runs straight through the answering silences at the paper's own pace (`audioSpan`, `useTestTape`, its own `<audio>` rather than the shared player, which anything in the app may stop). No replay, no speed, no seeking; flipping back to change an earlier answer *is* allowed, as it is on paper. Pausing is allowed and never blocked — studying happens after work — but each pause is counted and the result says the sitting was not under exam conditions. The end of the tape submits it; leaving part way cancels it after a confirmation, and a cancelled sitting **answers 410 rather than its result**, or starting and cancelling a test would be a way to read the answer key. Scores are **raw** ("6/24 điểm") and only shown out of 100 for a full 50-question paper. Each question's worth comes from its instruction's own `각 N점` (`pointsFromInstruction`, `topik_questions.points`, default 2), correctable by hand on the review screen for a paper that slips in a 3-point question without saying so. Every answer feeds the FSRS schedule with `scheduled = 1`: a timed sitting is the truest recall test there is.
- [x] **Two defects a real sitting on a phone found, that the tests could not (M6.4).** (a) A picture option that had been chosen looked exactly like an untouched one: `TopikPictureOptions` only styled selection in its `answered` branch, and "chosen but not graded" is a state **only a mock test has** — practice grades the instant you choose. Tapping "Chọn 2" therefore looked like the app ignored the tap. Now `pictureOptionState()` names all five states and the chosen card takes the primary border with a "Đã chọn N" button. Text options were never affected, since they already highlighted the selection. (b) The screen stopped following the tape for good after one tap on "Câu trước"/"Câu tiếp": the rule was the inline `viewing ?? tapePosition`, with nothing to ever clear `viewing`, so every later question needed a manual tap. `shownPosition()` replaces it with a park that ends by itself — the screen holds still while the question gone back to is still unanswered (being dragged away mid-correction is the point of being allowed to flip back) and rejoins the tape once it is answered. Both rules are pure and tested now; neither was a function before, which is exactly why no test covered them. Found at the same time: `useTestTape`'s effect was keyed on the `audio` object and never removed its `loadedmetadata` listener, so a cleaned-up element would start playing the moment its metadata arrived — several tapes running underneath each other. It is keyed on `audio_key`/`start_ms` now, and the listener is removed with the rest.
- [x] **The test schema is not tied to one exam (M6.4), because stage 2's mixed paper is coming.** A sitting owns a *list of questions* (`topik_test_items`: position, question_id, a snapshot of number and points, and the clip), while `topik_tests.source_exam` is only a label and is null for a mixed paper. Mixing therefore needs no migration — only a different way of choosing the rows — and two positions sharing one clip (the paired questions from 21 on) is already just two items with the same `segment_id`. The snapshots keep an old result readable after the bank moves on, and `question_id` is `set null` so deleting a question does not delete the history of having sat it. Known for stage 2: clips from different papers cannot play as one continuous span, so the break between them must be made to fall inside a question's answering silence, never across speech.
- [x] **How long a practice session is, per profile (M6.13).** `profiles.session_size` (5 / 10 / 15 / 20, default 10) sits next to the card-type switches and sets how many questions one **TOPIK practice** session asks — previously the constant `TOPIK_SESSION_SIZE`. It deliberately does **not** touch word review, which has no session length to set: that queue is "everything due today" plus up to `daily_new_limit` new cards, and `daily_new_limit` (the field just below, already settable) is the knob for how long a word session runs. Capping the word queue instead would hide due cards from a Home count that says they are due, which is a different feature and a worse one. The hint under the picker says so, because the two settings sitting together otherwise read as one. A stored size the form does not offer (a row from before the setting, or a future build's number) opens on the default rather than on a selection nothing matches.
- [x] **The 100-parameter ceiling, re-checked at a size nobody could pick before (M6.13).** Allowing 20 meant re-reading every statement in the practice path, and it turned up one that was already broken independently of the setting: `GET /topik/session` read this profile's cards with one `IN` holding **every verified question of the block**, not just the session's. A reading block of 1~50 across a few papers is past 100 bound parameters, so every practice session on it would have answered 500 — not some day, but as soon as the next import landed. Both that query and the clip lookup go through `readInD1Chunks` now, and the test runs a 20-question session over a block of **105** questions: at 60 it would have passed either way and proved nothing (the lesson in §11 again — a feature whose real size is known has to be tested at that size). Removing the chunking makes that one test fail with D1's own `too many SQL variables`.
- [x] **A pair of questions on one clip, in Word (M7.3).** From question 21 a clip is followed by two questions that ask different things, so the block-wide instruction is no longer the whole prompt. A question's own line is a marked paragraph, `HỎI: 남자의 중심 생각으로 맞는 것을 고르십시오.`, in the same spirit as `CHUNG ĐOẠN`; it cannot live in the stem cell, because that cell is the transcript and the server withholds it while the question is being answered. It is appended under the block's line in the same `instruction` column (no migration), so `(각 2점)` still sets the points, and the three screens that show an instruction render it `whitespace-pre-line` — the manual edit form became a textarea for the same reason, since a single-line input would flatten the second line back out. The second question of a pair leaves its **stem cell empty**: `CHUNG ĐOẠN` already says it is the same recording, so the parser takes the transcript from the question before rather than have it typed twice, which would be two copies nothing compares and which drift the first time one is corrected. A second stem that *is* typed out wins, and contradicting the one it shares a clip with is a warning — one recording cannot have two transcripts.
- [x] **A single file may not decide whether an update happens (M7.4).** The service worker copies only the shell at install — `index.html` and the icons, one file at a time, with every failure swallowed — and caches the hashed CSS/JS when they are first used instead of precaching them. The rule it enforces is the one in §11: *activation may never depend on anything that can fail*. One transient 500 on one stylesheet had been enough to stop a new worker installing and lock a phone on the previous build, with no developer tools to escape with; a failed file now costs one unstyled load and is refetched on the next request. In the same change the asset layer stopped answering `index.html` for missing files: an unmatched path falls through to the Worker, which returns a real **404** for anything whose last segment has an extension and the shell for everything else, so a path's *shape* decides — no list of routes to keep up to date (`shared/staticPath.ts`, `worker/app.ts#spaFallback`).
- [x] **The one loss that stays a warning (M7.3).** In the listening layout the transcript is plain paragraphs, not a table cell, so a question line typed **without** its `HỎI: ` prefix is indistinguishable from a line of the recording: it is absorbed into the transcript, which the server withholds while the question is being answered, so it is invisible exactly when it is needed. Nothing can be refused over it — a speaker really can say "안녕히 계십시오" — so `commandLikeStemLines` warns, quoting the line and naming the question, and the question still imports. It matches only the verbs the instructions themselves use (고르십시오, 답하십시오, 쓰십시오, 완성하십시오, …), not every polite imperative: the first, broader rule flagged **11** real stems, because reading questions 5-8 quote notices and medicine labels written as orders ("1회 2정 이상 복용하지 마십시오"), and each false alarm would have been written into that question's warning field for good. Narrowed, the full dry run reports **0** of them across 269 questions.
- [x] **The parser may not throw content away in silence (M7.3).** Three separate losses of typed-up work went unnoticed because it did exactly that: a stem cell split into two cells, an image path missing its `word/` prefix, and this per-question question line. Every paragraph inside a question is now accounted for; anything nothing used is collected (`ParsedItem.ignored`) and reported **verbatim with its question number**. Where it sits decides how loudly: before or between the question's own parts it is content meant to be read, so the question is refused rather than imported incomplete; after the four options it is the file author's own note area (Vietnamese glosses, "관람료: phí, tiền vé"), which is listed in the import report and left out without failing anything. Surveying the real files before switching the behaviour on — the only honest way to do it, with 269 questions already imported — found **22** such paragraphs: 20 author notes, and 2 occurrences of a **third silent loss nobody had noticed**, a `[3~4] …` block instruction typed inside question 3 of a group headed `[1~2] …`. A block instruction found inside a question is now used as the instruction for that question and the rest of its group (the reading import had been hiding the loss behind its own per-number instruction table). After all three changes the full dry run is unchanged at **269 questions, 0 errors**.
- [x] **An underline nobody can see (M7.10).** The first thing M7.9's new warnings reported was ten listening questions with "all four options underlined" — and the owner, looking at the same file in Word, saw exactly one underline per question. The XML settled it: Word keeps the formatting of a paragraph's own end mark in `<w:pPr><w:rPr>`, an underline there draws nothing on screen, and `hasUnderline` was walking the whole subtree. Measured on 36회 #5: option 1 had **10** underlined runs, options 2-4 had **none**, and all four carried the invisible mark. The rule now counts only a `<w:r>` whose own `rPr` is underlined **and** whose text is not blank. All ten warnings were false. Scanned both sections for past damage, since reading used to treat ">1 underline" as a hard error: **0 of 227** reading question tables were affected, so nothing was ever wrongly refused — luck rather than design, because every one of the ten sat in the listening section, where the label rule had already hidden the consequence.
- [x] **The answer label is the answer, in both sections (M7.9).** Reading used to take the *underline* as authoritative and refuse any question where the `N(N)` label disagreed — so a stray underline, which is routine formatting bleed in a paper typed up from a PDF, threw away a question whose answer was perfectly legible. Listening had already moved to the label in M7.1; now both follow one rule, and `parseTopikDocument` no longer takes a `section` at all. Every underline anomaly (none, several, or one that disagrees) is a warning that names both numbers so it can be checked by eye; the only hard error left is a **missing label**, because nothing is ever inferred from an underline. Measured before changing it: across all 241 reading questions, **zero** had no label, zero had no underline, zero had several, and zero disagreed — so no stored answer moved and no reviewed question had to be approved again. The gain is entirely in what no longer gets refused. A re-import of both sections now differs from production in nothing but 10 `warning` cells in listening, where multi-underline bleed used to pass in silence.
- [x] **A half-typed paper says so now (M7.8).** The dry run ends with two sections, for both sections of the exam: **Nhóm thiếu câu** compares each group against the range in the file's own name (*"nhóm 8DeOfficial-60회: có 2 câu, dải đòi 3; thiếu câu 18"*) and **Độ phủ theo đề** lists, per exam, how many questions exist and how far the numbering runs unbroken from 1 — which is exactly how many a mock test of that paper can use. Both are warnings: a paper typed up over several evenings must still import. The second is the one that found what the first cannot see — all eight 8DeOfficial papers hold 12-14 questions but can only be sat as **4**, because questions 5-8 have not been typed for any of them.
- [x] **One source of truth for a question's instruction (M7.7).** 52 reading questions had no instruction line at all and 24 more were only right because a patch table forced it by question number — three Word files never carried the line, and two carried the "[1~2] …" line on their 3-4 questions. The files were fixed (33 typed lines) rather than the code, and `FIXED_NUMBER_INSTRUCTION` was deleted; `FIXED_NUMBER_BLOCK` stays, because one file genuinely covers questions 1-4 and `block` cannot come from its name. Verified against production in both directions before and after: a re-import had to differ in exactly **52 instruction cells and no other column**, and after removing the patch, in **nothing at all**. Two traps surfaced on the way, both from the data rather than the code: renaming the merged file to "Cau03_04" made the importer map its four questions onto two numbers (16 questions would have been overwritten with the content of questions 1-2, flagged only as a `label says question 1, computed 3` warning), and a block instruction typed *between* two questions belongs to the one before it, so it applied from question 2 on. `--force --keep-verified` kept all 229 `verified` flags, and `vocab`, `explanation_vi`, `points` and `segment_id` are not in the overwrite statement at all.
- [x] **A pair's second question has to be announced (M7.6).** Listening to a pair, "이십이 번" was never heard: practice stops at `speech_end_ms + 5s`, and the cutter's `mergeShortSegments` folds that one-second announcement into the dialogue's clip while keeping the *dialogue's* speech end — so playback stopped ~15 seconds before the second question was announced. Measured on 35회 clip 21: clip 1008.158→1182.682s, `speech_end_ms` 1136.106s, playback stopped at 1141.106s, announcement at 1156.3s. Scanning both papers' 72 clips showed the shape of the fault exactly: **all 15 pair clips of each paper drifted (+17.9s to +21.5s), not one of the 40 single-question clips** — the detector only ever loses speech that follows a long pause, and only a pair has one. Fixed in the cutter (the merged clip now takes the announcement's own speech end) and in the data already cut (`npm run topik-speech-end`, which writes that one column and measures inside each clip's own stored boundaries, so hand-reviewed boundaries survive and `verified` is untouched). The stop-gap that played a multi-question clip whole was removed in the same change: with the data right, one 5-second tail serves every clip, and a longer one would only add dead air.
- [x] **A recording's questions are one screen (M7.5).** From question 21 a clip is followed by two questions, and the real paper prints them on one page: the tape plays once, so both have to be answerable while it is fresh, in either order, either of them left blank. A **group** is the clip they share (`segment_id`, already in the data; a question without one is a group of itself), and it is the unit everywhere — a practice screen, a sitting screen, and the unit a session draws. A session takes whole groups and lets the last one overshoot the chosen length, so asking for 5 can return 6: a group is at most two questions, and the real waste is hearing a recording and being allowed to answer half of what it asks. Progress still counts **questions** ("Đã trả lời 6/10 câu"), while the heading names the exam's own numbers ("Câu 21–22"). In a sitting the tape moves the screen on by group, and "Câu trước"/"Câu tiếp" step by group too.
- [x] **The transcript is withheld until the whole group is answered — on the server (M7.5).** A listening question's stem *is* its transcript, and it answers the question next to it just as well: revealed after question 21, question 22 would be a free mark. `POST /topik/attempts` takes `group_pending` and then sends the verdict for that question alone — no transcript, no words, no explanation — and the answer that completes the group brings `group_reveal` for every question in it at once. Enforced in the payload, not in the screen: what the screen hides is still on the device. **"Bỏ qua và xem lời thoại"** is the way out when a recording cannot be made out at all, which is exactly when its words are worth most: the questions still unanswered are locked for the session and scored nothing (its endpoint is read-only — no attempt, no card, since a question nobody answered is not one anyone got wrong). That needed a third state, `given_up`, separate from an ordinary skip, because `recordAnswer` deliberately overwrites a skip — without it, one tap on "Câu trước" would take an answer typed with the transcript open and write it into the schedule as recall that never happened.
- [x] **Mock test, stage 2: the mixed paper (M6.5).** A second card above the papers on `/topik/tests` sits a paper that does not exist: every position is drawn from the whole bank. **The unit of the draw is the clip, never the question** — from number 21 a clip carries a pair, so "take question 21" has to mean taking 21 and 22 from the same paper, and that is not a flag anyone has to remember: two questions sharing a clip simply share a `segment_id` (`planMixedTest`, `worker/services/topikMixed.ts`). A position is filled by a clip whose numbers run on from it and fit inside the asked length; **questions the profile has not met in its last 3 sittings come first**, and only when every candidate has been seen is one reused, the one seen longest ago. An **abandoned** sitting counts only the questions actually answered (`answered_at IS NOT NULL`) — its tape may have stopped at question 3, and pretending the other 17 were met would push them out of the next draw for nothing; a finished sitting counts all of them, because the tape played all of them. A length the bank cannot fill names **the position it ran out at** ("ngân hàng chưa có câu 23"), which is something the owner can go and add, unlike "too short". No migration: `topik_tests.kind = 'mixed'` and `source_exam = null` were already there from M6.4, and each result row reads its paper's label live from the question it points at (a deleted question simply loses the label).
- [x] **The mixed tape: two `<audio>` elements and one virtual clock (M6.5).** Clips from several mp3s cannot be one span, so `createMixedTape` (`src/features/topik/mixedTape.ts`) alternates two elements, preparing the next clip the moment the current one starts. Three rules carry the feature: the switch happens at **`end_ms`**, the end of the paper's own answering silence, never at `speech_end_ms` — a clip's silence is part of its question and the change of file must never land on speech; if the next clip is **not** ready the tape **waits in that silence** rather than skipping, because a few quiet seconds cost nothing and a question nobody heard costs the sitting; and **both elements are unlocked inside the starting tap** (a phone refuses `play()` on an element no gesture ever started, and the second element is exactly that), which is why a mixed sitting has a Start button and an original paper does not. Above that, `mixedTimeline` stitches the clips into one **virtual** timeline — clip after clip, each starting where the last ended — so the countdown, the current question, the park and the auto-submit are M6.4's own tested rules working on `positionMs`/`endMs`, not a second implementation for the mixed case (`useSittingTape` is the one place that knows which kind of tape is playing). The tape keeps its event log, folded away under "Chi tiết băng" during the sitting: the wait branch cannot be reproduced on a desktop with a warm cache, and if it ever misbehaves the person it happens to is holding a phone with no developer tools.
- [x] **Proving the audio by hand before writing any of the UI (M6.5).** The one risk no test can cover — a phone blocking the second `<audio>` element for the whole session — was settled first, with the smallest possible thing: `/topik/tests/audio-probe` (adult-only, read-only, creates no sitting) plays four real clips from alternating papers and prints what the tape did. The real run on the phone reported both elements unlocked, three handovers with no wait at all (next clip preloaded in 14-250 ms) and no audible seam, and only then was the rest of the mode written. The route is kept on purpose, with no link to it: it is the only way to re-answer that question after a browser update, and it is cheaper than reasoning about it. Local work found three bugs the probe would have hidden behind "it just does nothing": `play()` on a **source-less** element never settles (so unlocking plays a 0.05 s silent WAV instead), owning the tape in a component let StrictMode's double mount dispose the tape it had just built (so one tape lives at module level), and the state subscription attached to whatever tape existed at subscribe time — none (so the module broadcasts). The wait branch itself is now covered by a test that holds the next clip unloaded on purpose and checks the tape stays on the current question; flipping the readiness check to "always ready" makes exactly that test fail.
- [x] **Practising ahead of schedule, without lying to FSRS (M7.2).** The empty-session screen offers "Luyện lại dù chưa đến hạn" when something is waiting; it opens the same block with `mode=all` in the URL (`topikSessionModeSchema`), which adds the not-yet-due cards as a final tier in `buildTopikSession` — same tiers in the same order, so the questions that need work still come first. Answers there send `schedule: false` to `POST /topik/attempts`: the attempt row is written (it happened) with the new `topik_attempts.scheduled = 0`, and **no card is created or updated** — a question that was new stays new, a due date that was set stays set. The column exists from the start rather than being inferred later, because "this question keeps catching me out" means something different for a miss during extra practice than for one on a review that was actually due, and a column added afterwards could never recover that for rows already written. A permanent amber banner runs along the top of such a session, not a one-off toast. **`unseen` is counted from `topik_cards`, not from `topik_attempts`** (migration-free change to the blocks query): a practise-anyway answer writes an attempt but no card, so counting attempts would have made the picker call a question "đã làm" while the next real session still handed it out as new — two screens disagreeing about one question is exactly what destroys trust in the numbers.
- [x] **A question whose four options are drawings gets its own layout (M7.2).** `allPictureOptions()` (`src/features/topik/optionLayout.ts`) is true only when every option is a picture with no text of its own; a mixed set keeps the ordinary text rows, where a picture is an illustration rather than the thing being asked about. Listening questions 1-3 ask which of four drawings matches what was said, and those drawings carry the question — who holds what, which way someone faces — so the old 64px `object-cover` thumbnail in a text row made them unanswerable. Now: each picture fills its cell at its natural ratio, one column below 480px (half of a 360px phone is no better than the thumbnail was) and 2x2 above, numbered by a dark badge on the image instead of in a column of its own, and loaded eagerly rather than lazily — these four *are* the question, and a lazy one leaves a zero-height gap exactly where the answer belongs. **Looking and choosing are separate targets**: tapping the drawing opens it full screen (`TopikImageZoom`, closed by tapping it again), while choosing is its own button underneath, so wanting a closer look can never submit an answer. After answering, the correct option carries a green border, a check and "Đáp án đúng", the chosen wrong one a red border and "Bạn đã chọn", the rest dim.
- [x] **Approving a paper means its timestamps are right, not that the paper is finished (M7.2).** A clip nobody asks a question about is a **warning**, never a problem: ffmpeg finds all 36 clips of an exam the moment the mp3 is loaded, while the questions are typed up a block at a time, so requiring all 36 to be linked before approval would mean typing up 38 more questions before the listening flow could be tried at all. A partly covered paper is approved, practised with the questions that have a clip, and the remaining clips simply wait — `GET /topik/session` already selects only questions that have a `segment_id` whose audio is verified, so nothing half-ready can reach a learner. Only the mistakes that cannot be heard (an overlap, a gap, a boundary past the end of the file, a start after its own end) still block approval. Questions with no clip are reported the same way, as information: they cannot be practised yet, but they do not hold up the rest of the paper.
- [x] **Linking questions to clips that already exist (`--link-only`, M7.2).** A paper is typed up a few questions at a time, so the usual case is: the clips are cut and approved, and only the newly imported questions need attaching. The normal `--apply --force` would achieve that by deleting the audio row, cascading all 36 clips away (nulling every existing `segment_id`) and re-cutting — losing the hand-checked boundaries to change a foreign key. `--link-only` writes `topik_questions.segment_id` and nothing else: no ffmpeg, no R2, no clip row, no approval touched. `planLinks` works in *groups*, not questions — from question 21 a group is the pair sharing one clip (`same_segment`) — and an exam where anything disagrees is skipped whole, because a question on the wrong clip plays perfectly normal audio and only surfaces as answers that stop making sense. A question the Word files describe but which has not been imported yet is reported as such rather than linked, or the UPDATE would match no rows and the run would claim links it never made.
- [x] **Reviewing 36 clip boundaries by eye, not by ear (M7.2).** The boundary screen leads with a table: one row per clip with its number, start, end, **length** and **the silence at its end** (`end_ms - speech_end_ms`), all `m:ss.s`. The last column is the one that matters and the one three stored timestamps do not show at a glance — a real paper leaves ~12-18 s there for choosing an answer, so anything under `SHORT_PAUSE_MS` (3 s) means the clip was cut inside the paper's own pause. Rows are tinted amber for a warning and red for a problem (a problem outranks a warning: only it blocks approval), with a legend naming the clips and the reason. Three warnings, none of which block approval: `shortPause`; `shortClip`, a clip under half the median length of the `LOCAL_WINDOW` (9) clips **around it**; and `shortLastClip`, the same for the final clip, which is usually the closing announcement rather than a question. The window matters — a TOPIK II paper is two different papers stitched together (questions 1-20 are ~30-70 s exchanges, 21-36 are ~2.5-3.5 min dialogues and lectures), so one median across the whole thing lands between the groups and gets it backwards: on the real 35회 it flagged a normal 28-second question 5 while a 70-second half-split lecture clip would have passed. Each clip also gets **5 giây đầu** and **10 giây cuối** buttons — the only two places a wrong cut is audible — where the tail ends at `speech_end_ms`, not at `end_ms`, because a correct clip ends in designed silence that would prove nothing. While anything plays, a progress bar and a `0:01.5 / 0:05.0` clock follow it, fed by the shared player's new `clip` state (`src/features/audio/player.ts`).
- [x] **Where a listening answer comes from (M7.1):** the `N(N)` label, for every listening question, picture options or not. Underlining is no longer required there — questions 1~3 offer four pictures with nothing to underline, and in a paper typed up from a PDF the underline bleeds across options often enough that treating it as authoritative rejected more good questions than it caught bad ones. A single underline that *disagrees* with the label is a real contradiction and becomes a per-question **warning** (imported, surfaced first in the review screen); several underlines, or none, say nothing and pass silently. Still rejected: no label at all, an answer outside 1-4, or an option count other than 4. **Reading is unchanged** — there the underline is the answer and the label cross-checks it.
- [x] `npm run topik-audio` proposes boundaries from ffmpeg `silencedetect` (`--silence`, `--noise`, `--intro`, `--min-speech`, `--local`): the pause after a clip belongs to that clip, the spoken introduction belongs to none, and a "clip" with ~1s of speech is the narrator announcing the second question of a pair, folded into the one before it. Questions are linked only when their numbers run 1..n without a hole; a Word file covering just the start of the paper takes the first n clips. An exam's audio is always stored **unverified**, and no listening question reaches practice until an adult approves its boundaries in Settings → TOPIK: a one-clip offset plays perfectly normal audio, so it would surface only as answers that stop making sense.
- [x] Review screen: Settings → TOPIK → "Đoạn nghe" lists the papers and edits each clip's three timestamps (typed or nudged ±0.25s/±1s) with "listen as in practice" / "listen to the whole clip". Editing only writes timestamps — the mp3 is never touched — and un-approves the exam. Approval is blocked while any clip overlaps, leaves a gap, falls outside the file or has no question.
- [x] Listening practice: the clip plays on arrival (stopping shortly after the talking, not at the exam boundary — in self-paced practice that would be 18 seconds of dead air) with unlimited replays and the usual 1×/0.75× speeds. The **transcript never leaves the server** before the answer is in: `GET /topik/session` strips `stem.text` and `vocab` for listening (hiding them in the UI would still leave them in the response), the polled content endpoint withholds the vocabulary until this profile has answered, and both come back with the attempt result, where "Xem lời thoại" reveals the transcript with tappable words. The block picker has a Đọc/Nghe switch, and a listening block is listed only once its questions have a clip and the exam's audio is approved.

- [x] **Câu chưa làm thuộc về bài thi thử (M7.27).** Ở phạm vi "Tất cả các đề", phiên ôn tập **chỉ** phục vụ câu hồ sơ này **đã làm** — "đã làm" có đúng một định nghĩa ở server (`worker/services/topikAnswered.ts#answeredQuestionIds`: một lượt trong `topik_attempts`, **hoặc** một `topik_test_items.selected_option` của chính hồ sơ; ô chưa trả lời trong bài thi dở thì không tính) và một luật thuần cho cả cụm (`shared/topikAnswered.ts#splitReservedForTests`: cặp dùng chung đoạn/băng không bị tách — một nửa đã làm thì cả cặp vào phiên). Chọn **một đề cụ thể** là cách cố ý để ôn câu mới, giữ nguyên như cũ. Server quyết theo phạm vi nó nhận được, client không gửi cờ (M7.24). Khối hoặc khoảng câu mà mọi câu đều đang để dành thì **không mở phiên rỗng**: dòng "N câu đang dành cho thi thử — chọn đề cụ thể để ôn" hiện ngay tại chỗ, và ở phạm vi mọi đề số đếm của khối ghi "dành cho thi thử N" thay cho "chưa làm N" (`reserved_for_tests` trong `/topik/blocks`, `/topik/practice-range`, `/topik/session`; không có migration).

- [x] **Lịch sử thi thử (M7.29).** `/topik/tests/history` liệt kê **mọi lượt đã nộp** của hồ sơ (bỏ lượt đang dở và lượt đã huỷ: chúng không có điểm, vẽ vào biểu đồ sẽ thành 0% giả), mới nhất trên cùng, mỗi dòng ghi ngày giờ, phần thi, tên đề gốc hay "Đề trộn", khoảng câu, điểm/tổng và %. Lọc theo Nghe/Đọc nằm trong URL (`?section=`) như ở màn chọn đề, và lọc ở server để một hồ sơ có lịch sử dài không phải tải cả hai phần. Bấm một dòng mở `/topik/tests/:id` — màn kết quả đã có, nơi xem câu nào sai; màn này không nhân bản phần đó. Mỗi phần có **biểu đồ riêng** (% theo thời gian thật, không theo thứ tự trong danh sách), đề gốc và đề trộn là hai đường hai màu; so theo **%** chứ không theo điểm thô, vì một lượt 20 câu và một đề 50 câu khác tổng điểm. Hình học của biểu đồ nằm trong hàm thuần `src/features/topik/scoreChart.ts` (có test) và được vẽ bằng một thẻ `<svg>` viết tay — **không thêm thư viện biểu đồ**. Đọc đúng `topik_tests`, không bảng mới, không migration.
- [x] **Đề trộn ưu tiên câu chưa thuộc (M7.28).** `planMixedTest` (`worker/services/topikMixed.ts`, hàm thuần) xếp ứng viên của mỗi vị trí vào ba nhóm và lấy nhóm đầu tiên còn ứng viên: **(1)** còn câu **chưa làm**, **(2)** đã làm nhưng **chưa thuộc**, **(3)** đã làm và đã thuộc. "Đã làm" dùng đúng định nghĩa của M7.27 (`answeredQuestionIds`, gồm cả ô đã trả lời trong bài thi thử); "thuộc" dùng đúng định nghĩa thanh tiến độ khối câu đang dùng (M6.11) — thẻ đã sang `Review` của ts-fsrs — và định nghĩa đó nay nằm một chỗ duy nhất (`shared/topikMastery.ts#MASTERED_CARD_STATE`, được cả truy vấn `/topik/blocks` và `masteredQuestionIds` dùng). Cụm/cặp xét theo **câu kém nhất**: một nửa chưa làm thì cả cặp vào nhóm 1, vì cặp luôn được lấy hoặc bỏ cùng nhau. Trong cùng một nhóm giữ nguyên luật cũ: câu lâu không gặp trước, rồi câu thi lâu nhất, rồi ngẫu nhiên. Không có migration.

- [x] **Xin thêm giờ trong lượt thi (M7.31).** Chỉ **phần Đọc** (phần Nghe do băng định nhịp, nới hạn chót không làm băng dài ra) và chỉ khi đang hiện cảnh báo "còn dưới 3 phút", chưa tạm dừng và **chưa hết giờ**: nút "+5 phút" nằm ngay trong khung cảnh báo, bấm được nhiều lần, mỗi lần thêm 5 phút. Đồng hồ vẫn là của server (M7.13): client **không tự cộng**, chỉ gọi `POST /topik/tests/:id/extend` (không gửi số phút — bước là hằng số của server) rồi nhận đồng hồ mới; cùng một điều kiện `canExtend` quyết định cả nút trên màn hình và endpoint, nên không có trạng thái "nút hiện ra mà server từ chối". Một lần gia hạn dịch **cả `ends_at` và `length_ms`** đúng một bước: chỉ dịch `ends_at` thì `elapsed = length_ms − remaining` tụt lùi, tức là **cuốn băng về sau** — đổi cả hai thì vị trí trong bài đứng yên và bài chỉ dài ra, đúng nghĩa "được thêm giờ". `extension_count` / `extension_ms` được ghi riêng: màn kết quả nói "đã xin thêm giờ 2 lần, tổng 10 phút" (cùng kiểu với dòng tạm dừng), mỗi dòng lịch sử ghi "+10 phút", và biểu đồ vẫn vẽ lượt đó nhưng **chấm rỗng** kèm chú giải — lượt có thêm giờ vẫn là chuyện đã xảy ra, nhưng không phải điều kiện thi thật. Hồ sơ trẻ em **được** xin thêm giờ (đúng tình huống nó dành cho), và kết quả vẫn ghi rõ.
- [x] **Xoá một lượt khỏi lịch sử = ẨN (M7.32).** `DELETE /topik/tests/:id` chỉ ghi một mốc `topik_tests.hidden_at`. **Không** xoá `topik_attempts` (đã đẩy thẻ trong lịch FSRS) và **không** xoá `topik_test_items` (nơi đếm "đã làm" của M7.30), vì xoá chúng là âm thầm viết lại chuyện người học đã học gì: định nghĩa "đã làm" không đổi, câu đã làm trong lượt đã ẩn vẫn là đã làm, lịch ôn tập y nguyên. Mọi danh sách mang nghĩa lịch sử đều bỏ qua lượt đã ẩn: màn `/topik/tests/history` và biểu đồ của nó, và cả khối "đã thi" ở màn chọn đề. Link `/topik/tests/:id` vẫn mở được (có thể đã bookmark). Nút thùng rác đứng **cạnh** dòng (không lồng trong link — button trong `<a>` là HTML sai và trên điện thoại là một cú chạm hai nghĩa), có hộp xác nhận nói rõ phần học không mất. Hồ sơ trẻ em không có nút và server chặn (`requireAdult`); server kiểm lượt thi thuộc đúng hồ sơ, từ chối lượt **đang thi dở** (ẩn nó sẽ bỏ rơi một bài còn chạy), và bấm hai lần không phải lỗi.
- [x] **Chỉ báo "câu mới / đã làm" trong thi thử (M7.30).** Mỗi câu hiện "Câu mới" hoặc "2/4" — số lần đã làm và số lần đúng — tính bằng **đúng một định nghĩa "đã làm"** của M7.27, mở rộng ngay trong module đó: một lượt `topik_attempts` **có chọn đáp án** (ô bị tape bỏ qua được `gradeAndFinish` ghi `selected_option = 0` cho FSRS, và `0` không phải đáp án người học chọn được nên không tính là đã làm), hoặc một `topik_test_items.selected_option` của lượt thi **chưa chấm** (lượt đã nộp đã có đủ `topik_attempts`, đếm cả hai nơi sẽ thành "4 lần" cho 2 lần). Phép đếm là hàm thuần `shared/topikAnswered.ts#historyAsOf(events, asOf, excludeTestId)`; **server tính, client chỉ hiển thị**. Trong lúc thi: cắt tại `topik_tests.started_at` và bỏ chính lượt thi này, nên con số **đứng yên suốt bài** — một con số nhảy từ 2/4 lên 3/5 là đã tiết lộ vừa chọn đúng; chỉ báo nhỏ, nằm trên dòng câu hỏi, không che câu hỏi và không ảnh hưởng băng. Màn kết quả / lịch sử: mỗi câu hiện trạng thái tại **thời điểm bắt đầu lượt thi đó** (mở lại sau nhiều tháng vẫn y nguyên) kèm đúng/sai của lượt đó, cộng một dòng tổng "Câu mới: x/y đúng · Câu đã làm: a/b đúng" (`splitByFamiliarity`; nửa không có câu nào thì bỏ, không ghi "0/0"). Chỉ báo ở màn ôn tập dùng chung định nghĩa này — trước đây nó chỉ đọc `topik_attempts` nên bỏ sót lượt thi đang dở. Không migration (`topik_test_items.answered_at` và `is_correct` đã có).

### F13. TOPIK Listening Podcast — P2 (M8, not started)

**What it is for.** Studying Korean with the ears alone — driving, doing the dishes, folding laundry — with the screen locked in a pocket. Not a second way to practise: a way to use the hours that are already lost. Every decision below follows from "the eyes are busy and the hands are busy", and where a decision looks odd, that is the reason.

#### One question, in order

1. The question number, spoken in Korean.
2. **The question line** (the `HỎI:` line) read by TTS.
3. **The original clip**, exactly as in the exam.
4. The four options read by TTS.
5. A gap of N seconds for thinking.
6. `정답은 N번` + **the correct option read out in full**.
7. The correct option **read a second time**.
8. *(optional, stage 3)* the Vietnamese explanation.

#### Decisions, and why

- **The question line comes before the clip, not after.** In the real exam the prompt is printed on the paper and read before the tape starts; the listener always knows what is being asked. Put it after the clip and the learner spends two to three minutes listening with no idea what to listen *for*, which is a different and much less useful exercise.
- **Default gap 5 seconds, adjustable 3 / 5 / 8.** Long enough to decide, short enough that a 30-minute session is not half silence. The choice is a setting because thinking speed is personal in a way the app cannot measure.
- **Questions 21-50 get a longer gap automatically.** They are the long dialogues and lectures, and a gap tuned to question 4 is not a gap at all after a three-minute lecture. Automatic rather than another setting: the difficulty is a property of the paper, not a preference.
- **The answer is announced as both the number and the words.** The number is what the listener checks their own answer against; the full sentence is what actually teaches, because hearing "정답은 3번" alone teaches nothing. Reading it **twice** is deliberate — the first time it is being compared against what was chosen, and only on the second pass is it heard as Korean.
- **TTS is used for the question line and the options, and for nothing else.** Those are the parts printed on paper in the real exam, so a synthetic voice reading them changes nothing about the exercise.
- **The original clip is never replaced by TTS.** This is the one rule that cannot bend. The whole skill being trained is understanding real recorded speech — several speakers, real pace, real noise — and a clean synthetic voice reading a transcript trains something else that feels like progress and is not. If a clip is missing, the question is left out of the podcast rather than substituted.
- **The announcement is in Korean, not Vietnamese.** It is four syllables the listener already knows, it keeps the session in one language, and switching languages every question breaks the listening frame that took a minute to settle into.
- **The transcript is never read aloud.** It would add one to three minutes per question — on a 30-minute session that is the difference between fifteen questions and six. The Vietnamese explanation (stage 3) carries the teaching instead, and only for questions this profile has gotten wrong before, where there is something to explain.
- **No podcast for the reading section.** There is nothing to listen to; reading a passage aloud would be the TTS substitution rule broken by another door.
- **Nothing is written to FSRS.** A podcast gives no evidence of recall: nobody answered anything, and a listener who dozed off looks exactly like a listener who got it right. Writing spacing data from that would corrupt the one thing the schedule is for. Instead a **separate "heard in a podcast" mark** (its own table, `topik_podcast_plays` or similar: profile, question, when) so the next set does not replay the same questions — the mark is for choosing content, never for scheduling.
- **Questions 1-3 of every paper cannot be in a podcast at all**: their four options are pictures, so there is nothing to read out. The picker must **say so plainly** ("3 câu đầu mỗi đề là đáp án ảnh, không có trong podcast") rather than quietly returning 47 questions when 50 were asked for. Silently dropping content is the failure this project keeps finding; see §11 M7.3.

#### Choosing what to listen to

- **By duration: 30 or 60 minutes.** This is how someone with a commute actually thinks about it, and it is the only option that matches the situation the feature exists for. It needs an estimate per question (clip length + TTS length + gap), which is known before a byte is played.
- **By question range** — reuse the range picker from M7.24 exactly as it is, including the widening to whole groups.
- **By paper.**
- **"Câu tôi hay sai"** — drawn from `topik_attempts`, the questions this profile has gotten wrong most often. The most valuable of the four, and the only one that needs no new input from the listener.

#### Hands-free, for real

- **Media Session API**, so the lock screen and the car's Bluetooth head unit show the question and offer transport controls. Without this the feature does not work in a car at all, which is the main place it is meant to work.
- **Previous = replay THIS question**, not go back one. In a car, "I missed that, say it again" is the thing wanted ten times more often than "take me back one question", and the steering-wheel button is the only control available. Next stays next.
- **Audio focus** must be handled: when the phone speaks a navigation instruction, the podcast ducks or pauses and resumes afterwards — losing thirty seconds of a question to a turn announcement would be worse than a pause.
- **Offline download is mandatory, not an option.** Mobile data in a car is unreliable and the whole session is audio; a session that stalls at a junction is a session abandoned.

#### What this reuses

Stitching clips from several files into one continuous tape is **the mixed mock test's problem, already solved** (M6.5): two alternating `<audio>` elements with the next segment preloaded. The podcast is that player with a different playlist and a different set of labels. Do not write a second one.

#### Cost

About **210 characters of TTS per question** (question line + four options + the announcement), × ~400 questions ≈ **84,000 characters, once**. Azure's F0 tier allows 500,000 characters a month, so the whole bank fits inside one month's free allowance with room to spare, and nothing is regenerated afterwards: audio is stored in R2 under a content key, exactly like the word/phrase TTS (§7).

#### Phases

- **M8.1 — core, online, fixed gap.** The sequence above, selection by range and by paper, a plain screen with play/pause/next. Proves the shape; no Media Session, no offline, no explanation.
- **M8.2 — genuinely hands-free.** Media Session API (lock screen + car), audio focus, "replay this question" on Previous, and offline download. This is the milestone that makes the feature usable for its actual purpose; M8.1 without it is a demo.
- **M8.3 — the smart parts.** Selection by duration and by "câu tôi hay sai", the Vietnamese explanation after the answer, and the longer automatic gap for questions 21-50.

---

## 5. Data model (Cloudflare D1 / SQLite)

Target model after M1.6–M1.9. Changes vs. the current schema are marked `← M1.x`.

```
profiles      id, name, avatar, ui_lang ('vi'|'ko'|'en'), gloss_lang ('vi'|'ko'|'en'), is_kid,
              pin_hash?, daily_new_limit, study_langs (json, subset of ['ko','en']) ← M1.6,
              card_types (json, subset of ['recognition','picture','listening']) ← M6.6,
              own_words_only ← M6.12, created_at

words         id, lang ('ko'|'en') ← M1.6, term, reading, pos,
              gloss_vi, gloss_en, gloss_ko,
              hanja? ← M1.6 (renamed from hanzi_traditional; hanzi_simplified dropped), han_viet?,
              emoji?, audio_key?, notes?,
              topik_sources? (json [{section, exam, number}], where the word was met) ← M7.12,
              image_key?, image_prompt?, image_source? ('ai'|'upload'),
              image_status ('none'|'pending'|'ready'|'failed'), image_nonce?, image_requested_at?, image_model? ← M1.8,
              ai_generated, verified, created_by_profile, created_at, updated_at
              UNIQUE(lang, term)

phrases       id, word_id → words (root word, ON DELETE CASCADE), lang, text, reading,  ← M1.7
              gloss_vi, gloss_en, gloss_ko, emoji?, audio_key?,
              image_* (same columns as words) ← M1.8,
              ai_generated, verified, created_by_profile, created_at, updated_at
              UNIQUE(lang, text)

examples      id, word_id → words (root word, ON DELETE CASCADE),
              phrase_id? → phrases (ON DELETE CASCADE) ← M1.7,  -- NULL = example of the word itself
              sentence, translation_vi, translation_en, translation_ko,
              audio_key?, level ('kid'|'beginner'|'intermediate'), ai_generated,
              image_* (same columns as words) ← M1.8   -- examples stay 'none' until first displayed

decks         id, name, lang, is_kid_deck, kind ('default'|'album') ← M2.4, created_at
                                                        -- default decks: default-ko, default-en; albums: kind = 'album'
deck_words    deck_id, word_id, added_at ← M2.4         -- phrases follow their root word's decks / albums
profile_decks profile_id, deck_id                       -- which decks a profile studies

cards         id, profile_id, word_id → words (root word, ON DELETE CASCADE),
              phrase_id? → phrases (ON DELETE CASCADE) ← M1.7,  -- NULL = card of the word itself
              card_type ('recognition'|'picture' ← M1.9|'listening'|'speaking'),
              <all fields of the ts-fsrs Card object: due, stability, difficulty, state, reps, lapses, ...>,
              updated_at
              UNIQUE(profile_id, word_id, card_type)   WHERE phrase_id IS NULL      ← M1.7
              UNIQUE(profile_id, phrase_id, card_type) WHERE phrase_id IS NOT NULL  ← M1.7

review_logs   id, card_id? → cards (ON DELETE SET NULL) ← M1.7, profile_id, lang ← M1.7,
              rating, reviewed_at, duration_ms,
              <ts-fsrs ReviewLog fields>                -- append-only

pron_attempts id, profile_id, word_id?, phrase_id? ← M1.7, example_id?, lang, reference_text,
              pron_score, accuracy, fluency, completeness, details_json, created_at

han_chars     hanja (PK) ← M1.6/M4, han_viet, meaning_vi, ai_generated, verified
word_chars    word_id, position, hanja                  -- Korean words only (F7)

ai_cache      key (hash of task + input + model), response_json, created_at
usage_daily   date, profile_id, service ('tts'|'pron'|'llm'|'image' ← M1.8 | 'topik_vocab' ← M6.2 | 'topik_explain' ← M6.3), count

topik_questions id, section ('reading'), exam, number, block, instruction?,            ← M6.1
                stem_text?, stem_image_key?, options (json, 4×{text?, image_key?}),
                correct_option, warning? (set by the import script), verified, created_by_profile?,
                vocab? (json, [{surface, lemma, pos, gloss_vi}]), vocab_checked_at?,     ← M6.2
                explanation_vi?, key_terms? (json, lemma[]), explain_checked_at?,        ← M6.3
                created_at, updated_at
                UNIQUE(section, exam, number)
topik_cards     id, profile_id, question_id → topik_questions (ON DELETE CASCADE),      ← M6.1
                <ts-fsrs Card fields, same as `cards`>, updated_at
                UNIQUE(profile_id, question_id)
topik_attempts  id, profile_id, question_id? → topik_questions (ON DELETE SET NULL),    ← M6.1
                section, exam, number (copied, so history reads even after a question is deleted),
                selected_option, is_correct, duration_ms?, answered_at
```

Notes:
- **Word or phrase (M1.7, option A, decided 2026-10-08):** D1/SQLite cannot add a CHECK or relax NOT NULL without rebuilding a table, and rebuilding `cards`/`examples` would cascade-delete their children. So `examples.word_id` and `cards.word_id` stay NOT NULL and always hold the **root word**; `phrase_id` is set when the row belongs to a phrase. Hand-written triggers (migration `0002_phrases`) enforce that `word_id` equals the phrase's root word, and that `phrases.word_id` never changes. Deleting a word therefore cascades to its phrases, their examples and all their cards.
- `review_logs` was rebuilt in M1.7: `card_id` is nullable with `ON DELETE SET NULL` (logs survive card deletion), and `lang` was added and backfilled, so per-language stats and the daily new-card count stay correct after deletions.
- Images (M1.8, migration `0004_images`): `image_status` = `none` (not requested: lazy example, quota reached, typed by hand without a prompt, or saved before M1.8) → `pending` → `ready` | `failed`. New words and selected phrases **with an AI prompt** start `pending` (drawn with `waitUntil` right after saving); everything saved before M1.8 starts `none` and is drawn by the Settings backfill (decided 2026-10-09, instead of drawing old items automatically). `image_nonce` ("0" first, random per Redraw) is part of the R2 key; a job only writes its result if the nonce is unchanged, so a newer Redraw/upload always wins. `image_requested_at` marks the claim: `waitUntil` may run only ~30 s after the response, so a `pending` item older than 2 minutes counts as stalled and the next display takes it over. Every claim is a conditional `UPDATE` — only the request that changes the row (`changes = 1`) calls Workers AI, so two requests never draw the same item. Examples without a prompt use their English translation as the scene. `image_model` = model that drew it (null for uploads).
- The family-wide image cap is checked as the sum of today's `usage_daily` rows with service `image` across all profiles (no new table).
- M1.6 data migration (destructive, approved 2026-10-08): delete `zh` words (cascades to examples, cards, review logs, deck links), the `default-zh` deck and its profile links; remove `zh` from `profiles.study_langs` (a profile left with no language gets `['ko']`); drop `words.hanzi_simplified`; rename `hanzi_traditional` → `hanja`; restructure `han_chars` / `word_chars` (empty so far); delete R2 objects under `audio/zh/`. `ai_cache` entries cannot be filtered by language (hashed keys), so the enrichment cache is cleared (the prompt version changes in M1.7 anyway).

Media storage (R2) keys:
- `audio/{lang}/{voice}/{sha1(text)}.mp3`
- `images/ai/{sha1(model + prompt + style_version + nonce + size)}.{webp|jpg}`
- `images/upload/{sha1(file bytes)}.webp` — also used by TOPIK stem/option photos (M6.1, same content-addressed scheme, just a looser size limit)

---

## 6. Screens

1. **Profile picker**
2. **Home** (per profile): today's due/new count per language (and per album, a chooser under each language), "Start review", "Practice speaking", streak
3. **Review session** (no navigation, Exit button): image-centred card front → flip → back with examples (small image + audio) → rating buttons; progress bar
4. **Word library**: tabs "All | Albums" (M2.4); "All": list with thumbnail image (emoji while pending) + search + filters; words and phrases; "Add word"
5. **Add / edit word**: language + term → AI enrich preview → edit fields → tick suggested phrases → save (images then appear in the background)
6. **Word detail**: image (Redraw / My photo), audio, readings, glosses, Hanja/Hán-Việt, phrases (each with image, audio, meaning, examples), examples (each with image + audio + practice), related Hanja words
7. **Pronunciation practice**: reference audio, record button, colored result, history
8. **Hanja page** (F7): one Hanja character and the Korean words/phrases containing it
9. **Decks**: create, assign to profiles
10. **Settings** (profile and app)
11. **Stats** (P2)

Navigation (M1.5; TOPIK added M6.10): Home, Review, TOPIK, Library, Settings (room reserved for a later "Hanja" item, F7), each with an icon + i18n label. The tab bar builds one column per *visible* item, because "TOPIK" is adult-only — TOPIK II is an advanced-learner exam and a session has the server generate its vocabulary/explanations, an AI feature kid profiles never trigger — so a kid profile sees four items and the `/topik` route itself turns it away. The tab bar label is the short "TOPIK" (five full names do not fit at 360 px); the page title stays "Luyện TOPIK II". Home no longer repeats the TOPIK link: the tab bar now reaches it from every screen.  the active item is highlighted. Desktop (≥ 768 px): collapsible left sidebar with the active profile's avatar + name at the top. Phones (< 768 px): fixed bottom tab bar, avatar + name in the top-right corner. Tapping the avatar opens the profile picker. Add-word shortcuts (adults only): a "+ Add word" button at the top of the Library on every screen size, and on phones a floating "+" on Home and the Library, above the tab bar (safe-area aware, rendered by AppLayout). Two independent ways in, so one can never be the only one. The review screen and the profile picker hide all navigation (review keeps only its Exit button).

Image editing (adults only): "Redraw" opens a small dialog with the editable prompt (style is appended automatically and not editable); "My photo" picks a file / camera photo, resizes it in the browser to ≤ 512 px WebP, then uploads.

Design: mobile-first, clean, images first, large Korean typography (Noto Sans KR), light + dark mode.

---

## 7. External services & limits

| Service | Use | Free-tier guard |
|---|---|---|
| Cloudflare Workers (+ static assets) | Hosts the SPA and `/api` | — |
| Cloudflare D1 | Database | — |
| Cloudflare R2 | Audio & images | Media is small (images 512 px WebP/JPEG; target total < 2 GB) |
| Cloudflare Workers AI (FLUX) | Image generation via the `env.AI` binding (word + selected phrases at save time, example sentences lazily) | Cache-first (content-addressed R2 key); never redraw an existing key; **60 images/profile/day + 100/day family cap** (lowered from 100/250 in M2.9, after production hit the account's own daily Neuron allocation). Only a successful drawing is billed (M2.9: a failed attempt is refunded). Free allocation: **10,000 Neurons/day** (checked 2026-10); when it runs out Workers AI answers error **4006**, detected and surfaced as a distinct `provider_exhausted` state (M2.9) rather than retried or billed. Benchmark (2026-10-09): `flux-2-klein-4b` (primary) ≈ **26 Neurons/image**, `flux-1-schnell` (fallback) ≈ 58. Compare with the real Neurons in the dashboard after some use. |
| Cloudflare Access | Family-only login | Allow-list of family emails |
| Azure Speech: TTS | Generate audio once per text (words, phrases, examples) | Cache-first (R2 key = lang + voice + sha1(text)); never re-generate an existing key; 200 calls/profile/day. Free tier F0: 0.5M neural characters/month (checked 2026-10) |
| Azure Speech: Pronunciation Assessment | Speaking score | Cannot be cached, so: a take is at most 8 s, and 25/adult profile, 15/kid profile, 60/family a day (`usage_daily` service `pron`, M3.0). Free tier F0: 5 hours of speech-to-text audio a month, one concurrent request |
| LLM API (Gemini; Claude switchable) | Enrichment (incl. phrases + image prompts), examples, explanations | Cache-first (`ai_cache`), 50 calls/profile/day |

API keys never reach the client: the Worker makes every Azure call itself, TTS and pronunciation scoring alike (M3.0 — the planned `/api/speech-token` was never built and is not needed). Workers AI is a binding (no API key).
Free-tier limits change, so check the providers' current pricing pages before relying on any number.

---

## 7.1 Deployment & security decisions (M2.1, done 2026-10-10)

- **URL:** `https://lingo.ai4life.workers.dev` (Worker `lingo`; D1 `lingo-family`; R2 `lingo-family-media`). `workers_dev` is the only hostname; **preview URLs are off** (`preview_urls: false`) so there is no second hostname to protect.
- **Fail-closed API:** `worker/middleware/access.ts` runs before every `/api/*` route (also `/api/health`). It verifies the `Cf-Access-Jwt-Assertion` JWT (RS256, team JWKS of `ai4life.cloudflareaccess.com`, `iss`, `aud` = `ACCESS_AUD`, `exp`) and then the email against the secret `ALLOWED_EMAILS` (comma separated, case-insensitive). Missing JWT, missing/blank `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` or `ALLOWED_EMAILS` → **401**; verified but not allowed → **403**. The verified email is `c.get("userEmail")`. So even before Access was switched on, nobody could use the paid APIs.
- **Local-only switches:** `DEV_AUTH_BYPASS=1` and `DEV_TIME_TRAVEL=1` (`X-Dev-Now`) work only when `new URL(request.url).hostname` is localhost / 127.0.0.1 / [::1]; the Host header is never trusted. Tested for production hosts and look-alike hostnames.
- **Gemini location:** Cloudflare's Hong Kong data center (HKG, where Korean users enter) is not a supported Gemini location. `wrangler.jsonc` pins **Placement to Seoul** (`gcp:asia-northeast3`); do not remove it. Settings shows an "AI status" line (which model answered last: primary or fallback).
- **Secrets:** never pasted with Ctrl+V in `cmd` (it corrupted a key once). Use the dashboard or `npx wrangler secret bulk <file.json>` from a temporary file outside the repo, then delete the file. The LLM client trims whitespace.
- **Local development:** `npm run dev` uses a **fake image provider** (one fixed 512×512 placeholder, `image_model = 'fake'`, no quota, no cost) because the real Workers AI binding is remote and would need a preview session behind Access (cloudflared). `npm run dev:ai` keeps the real binding (needs `cloudflared`, see README). Production always has the AI binding and can never use the fake provider (fake only on a local host and only without the binding).
- **Moving local content ("B reduced"):** `npm run migrate:content` (dry run by default; `--apply`; `--verify`). Moves only words, phrases, examples, han_chars, word_chars, ai_cache and every R2 object. Never moves profiles, profile_decks, cards, review_logs, usage_daily, pron_attempts (their dates came from time travel). Production wins: a local row whose language + term / text or cache key already exists is skipped and logged; children of a skipped parent are skipped, new phrases of a skipped word are attached to the production word; profile references become NULL. Idempotent; production D1 is exported to `backups/` before any write. Profiles then get their cards from `syncProfileCards` on the next Home visit (`--verify` checks it).
- Done 2026-10-10: 3 words, 1 phrase, 8 examples, 2 cache entries and 26 media files moved; profile Hiep has recognition / listening / picture cards for all Korean words.

## 8. Non-functional requirements

- **Privacy:** family data only; voice recordings never leave the device except for the scoring request; uploaded photos are resized on the device and stored only in the family's R2 bucket; no analytics/trackers.
- **Performance:** first load < 3 s on 4G; card flip < 100 ms; audio starts < 300 ms when cached; images ≤ 512 px, lazy-loaded in lists; image generation never blocks saving.
- **Offline:** review works offline, including images (F4, F11).
- **Cost:** $0 hosting; paid APIs < ~5 USD/month for the family.
- **Accessibility:** tap targets ≥ 44 px; works with keyboard on PC; images have alt text (the item's gloss).

---

## 9. Milestones

| # | Milestone | Contents | Status |
|---|---|---|---|
| M0 | Scaffold | Project setup, DB schema + migrations, i18n, empty screens, runs locally | [x] |
| M1 | MVP (local) | Sub-milestones below | [~] |
| M1.1 | Profiles | F1 | [x] |
| M1.2 | Add word + AI | F2 add word, F6 enrichment | [x] |
| M1.3 | Audio | F3 TTS audio | [x] |
| M1.4 | Review | F4 FSRS, recognition + listening cards | [x] |
| M1.5 | Navigation | Shared navigation (desktop collapsible sidebar, mobile tab bar), add-word button, focused review screen | [x] |
| M1.6 | Remove Chinese | Migration deleting `zh` data, Hanja field rename, code/UI/TTS/font clean-up | [x] |
| M1.7 | Phrases | Phrases table, AI suggestions + selection, phrase audio/examples, phrase cards (recognition + listening) | [x] |
| M1.8 | Image pipeline | Workers AI FLUX (benchmark flux-1-schnell vs flux-2-klein-4b), image prompts in enrichment, `waitUntil` background generation, lazy example images, R2, Try again / Redraw / My photo, quotas | [x] |
| M1.9 | Picture card + visual review | `picture` card type, unlock chain recognition → picture → listening, image-centred review UI | [x] |
| M2 | Online | Sub-milestones below | [~] |
| M2.1 | Deploy + Access | Production D1/R2, fail-closed JWT check, Cloudflare Access (One-time PIN, email allow-list), move local content | [x] |
| M2.2 | PWA | F11 installable PWA, service worker, media cache, update + install UI | [x] |
| M2.3 | Offline reviews | F11 offline queue + review sync (incl. images already cached) | [ ] |
| M2.4 | Albums | Playlists of words (many-to-many, per language, family-shared), Library tabs, select-many, review by album | [x] |
| M2.5 | Focus view | Full-screen view of an example sentence / phrase (big picture and text, hidden meaning, listen / repeat, swipe) in Word detail, review and the Library | [x] |
| M2.6 | Typed sentences + AI | AI help for sentences / phrases typed by hand (translate, picture prompt, check the sentence), add / edit / delete example sentences, pron_attempts keep history | [x] |
| M2.7 | Library scope filter | Filter the shared library by profile ("I'm learning" / "I added" / "All"), cards synced right away on word creation | [x] |
| M2.8 | Image quota banner | Amber banner (reset time) wherever a draw is skipped for quota; limits raised to 100/profile, 250/family | [x] |
| M2.9 | Billing fix + provider exhaustion | Only bill image quota on success (refund on failure); detect Workers AI's own 4006 account exhaustion, distinct banner + pause auto-draw; limits lowered to 60/profile, 100/family | [x] |
| M2.10 | Profile avatar photo | Upload a real photo as a profile avatar (adults only, no AI, no quota), shared content-addressed storage with word/phrase/example photos, server-side adult check on the new routes | [x] |
| M2.11 | LLM content sanity check | Script/script-mismatch check (stray Latin in Korean, etc.) on every LLM-generated vi/en/ko string, sharing the existing one-retry budget; bad examples/phrases are dropped rather than saved; read-only scan script for existing data | [x] |
| M3 | Speaking | F5 pronunciation scoring, speaking cards. Sub-milestones below | [~] |
| M3.0 | Pronunciation probe | WAV capture + `POST /api/pron/probe` + `npm run pron-probe`, all returning Azure's raw answer. Scoring half **run against real Azure 2026-11-16**: `ko-KR` gives one syllable score per Hangul syllable, a wrong take scores 6/100, two concurrent requests both answered. Left: record a take on the phone through `/practice/probe` (needs a human and a microphone) | [~] |
| M3.1 | Scoring | Assess endpoint storing `pron_attempts`, coloured result, Compare, last 5 takes on the device, quota | [ ] |
| M3.2 | History | Last / best score per item, weakest words, Practice screen | [ ] |
| M3.3 | Speaking cards | `speaking` card type in review | [ ] |
| M4 | Family & Hanja | F8 kid mode, F7 Hanja links, F9 import + starter decks | [ ] |
| M5 | Insights | F10 stats, FSRS parameter optimization | [ ] |
| M6.1 | TOPIK II practice (stage 1) | F12 question bank + `.docx` import (dry-run/apply, idempotent) + review screen + manual form + practice (own ts-fsrs scheduling, ~10 questions/session) + attempt history | [x] |
| M6.2 | TOPIK: word lookup | Tap a word in a TOPIK question to see its meaning (AI-generated once per question, cached, exempt from the LLM quota) | [x] |
| M6.3 | TOPIK: explanations | Explanation + key terms on an attempt (never in the session), mark-then-bulk-add so adding words never interrupts practice | [x] |
| M6.4 | TOPIK: mock test | Sit one real paper end to end, the tape as the clock, one raw score at the end | [x] |
| M6.5 | TOPIK: mixed mock test | A paper drawn from the whole bank by clip, preferring what was not sat lately; its clips stitched into one tape | [x] |
| M6.6 | Per-profile card types | Switch recognition / picture / listening on or off per profile; hidden, never reset | [x] |
| M6.7 | TOPIK: read-only question view | "Xem" on each review row: the question as practice shows it, plus the correct answer, explanation and key terms | [x] |
| M6.9 | TOPIK: block progress | "N/M chưa học" per block + a total row, from one aggregate query | [x] |
| M6.10 | TOPIK in the main navigation | "TOPIK" tab after "Ôn tập", adult profiles only (the route is gated too) | [x] |
| M6.11 | TOPIK: mastered split | Two-segment block bar (known / answered-not-known) + "thuộc N" count, one query | [x] |
| M7.1 | TOPIK listening (groundwork) | One mp3 per exam + clip timestamps + byte-range playback + boundary review screen | [x] |
| M6.12 | Review only my own words | Per-profile switch; hides other people's cards from the queue and Home counts, never resets them | [x] |
| M7.14 | A mock test covers a range of questions | `from_number`/`to_number` on `topik_tests`; the three lengths become shortcuts that fill a range, a range that would cut a pair in half is widened, a hole in it refuses the sitting, and the preview that says so writes nothing | [x] |
| M7.16 | A whole exam paper as one file | Second file-name shape, block taken from each question's own `[N~M]` line, `<w:br/>` no longer dropped (it was gluing words together), and `--diff` reports missing recordings | [x] |
| M7.13 | The mock test's clock belongs to the server | `ends_at` in `topik_tests`; the countdown and the tape's position are derived from it, reopening a paper resumes where the time got to, a pause costs nothing, and a paper nobody came back to is submitted and graded instead of staying `running` | [x] |
| M7.12 | TOPIK words into their own album | A word added from a TOPIK question joins "TOPIK II Reading"/"Listening", gets exam-style example sentences and remembers which question it was met in; markable from a sitting's result too | [x] |
| M7.11 | TOPIK: the reading section can be sat | Section chips, a countdown instead of the tape (70min/50 questions, pausable, auto-submit), free navigation by question grid, Submit, and a mixed reading paper | [x] |
| M7.10 | TOPIK: underline on real text only | An underline on the paragraph mark is invisible in Word and was being counted | [x] |
| M7.9 | TOPIK: one answer rule | The N(N) label decides in both sections; every underline anomaly is a warning naming both numbers | [x] |
| M7.8 | TOPIK: import says what is missing | Short groups vs the file name's range, and per-exam coverage (how much a mock test can use) | [x] |
| M7.7 | TOPIK: the file is the only source of the instruction | 52 missing + 24 patched instruction lines fixed in the Word files; the patch table deleted | [x] |
| M7.6 | TOPIK: a pair's second question is heard | The cutter keeps the "22번" announcement as speech; one-off repair of the clips already cut | [x] |
| M7.5 | TOPIK: a recording's questions on one screen | Group = clip, in practice and in a sitting; transcript withheld until the group is answered, or deliberately given up | [x] |
| M7.3 | TOPIK: paired listening questions | A question's own `HỎI:` line, an inherited transcript for the second of a pair, and no paragraph dropped in silence | [x] |
| M6.13 | Per-profile session length | 5 / 10 / 15 / 20 questions per TOPIK practice session, beside the card-type switches | [x] |
| M7.32 | Xoá một lượt khỏi lịch sử thi thử | `hidden_at` trên `topik_tests`: ẩn khỏi danh sách lịch sử, biểu đồ và khối "đã thi" ở màn chọn đề; không xoá `topik_attempts` / `topik_test_items`, không đụng FSRS, không đổi định nghĩa "đã làm"; hộp xác nhận, hồ sơ trẻ em bị chặn | [x] |
| M7.31 | Xin thêm giờ trong lượt thi (chỉ phần Đọc) | Nút "+5 phút" trong khung cảnh báo "còn dưới 3 phút", bấm nhiều lần; `POST .../extend` của server dịch cả `ends_at` và `length_ms`, ghi `extension_count` / `extension_ms`; kết quả và lịch sử ghi "+10 phút", biểu đồ vẽ chấm rỗng | [x] |
| M7.30 | Chỉ báo "câu mới / đã làm" trong thi thử | "Câu mới" hoặc "2/4" cho mỗi câu, một định nghĩa "đã làm" dùng chung (M7.27 mở rộng), đóng băng tại lúc bắt đầu lượt thi; màn kết quả thêm dòng tổng câu mới / câu đã làm; server tính, không migration | [x] |
| M7.29 | Lịch sử thi thử | `/topik/tests/history`: mọi lượt đã nộp của hồ sơ, mới nhất trên cùng, lọc theo Nghe/Đọc, bấm một dòng mở lại màn kết quả; biểu đồ % theo thời gian cho từng phần, đề gốc và đề trộn hai màu, vẽ bằng SVG tay (không thêm thư viện); không bảng mới, không migration | [x] |
| M7.19 | A practice session survives being interrupted | Place, answers and marked words kept on the device; restored only onto the same block within 3 hours, and a finished session with words still waiting reopens its results screen | [x] |
| M8.1 | TOPIK listening podcast: core | F13 — question number → question line → clip → options → gap → answer in Korean, spoken twice; selection by range/paper; online, fixed gap | [ ] |
| M8.2 | TOPIK listening podcast: hands-free | Media Session (lock screen + car Bluetooth), audio focus, Previous = replay this question, offline download | [ ] |
| M8.3 | TOPIK listening podcast: smart selection | By duration (30/60 min), "câu tôi hay sai" from `topik_attempts`, Vietnamese explanation, longer gap for questions 21-50 | [ ] |

---

## 10. Open questions

- ~~Which LLM provider to use as default (Gemini free tier vs Claude)?~~ **Decided (M1.2):** Gemini, model `gemini-3.8-flash` by default; switchable by `LLM_PROVIDER` / `LLM_MODEL`.
- Is the Hán-Việt quality from the LLM good enough, or should we import an open Hán-Việt dictionary dataset?
- Should kids' profiles get an English or a Korean UI by default?
- **Backlog:** a reading for example sentences (romanization for Korean, IPA for English) shown in the Focus view. Needs the enrichment prompt / schema to return it (bump the prompt version) and a way to fill sentences saved before.
- **For M4 (kid mode):** consider picture-first order for kids (look at the image and listen first, text later), because young children may not read well yet; M1.9 keeps recognition → picture → listening for everyone.
- Should the wife's profile have specific goals/levels? (Not yet specified.)
- ~~Images per word?~~ **Decided (2026-10-08):** draw the word + selected phrases right away; example images lazily on first display; unselected phrases never; 2 examples per word, 1 per phrase.
- ~~FLUX model?~~ **Decided:** start with `flux-1-schnell`; M1.8 benchmark (5 prompts × `flux-1-schnell` / `flux-2-klein-4b`, Neurons per image, saved images) to choose the final model and family cap.
- ~~`waitUntil` vs Queues?~~ **Decided:** `waitUntil`; `failed` shows "Try again". Queues later if needed.
- ~~Old images after Redraw / My photo?~~ **Decided:** keep them in R2.
- ~~Phrase selection shared or per profile?~~ **Decided:** shared family library; cards per profile.
- ~~Do phrases count toward `daily_new_limit`?~~ **Decided:** yes, together with words.
- ~~Rename `hanzi_traditional` → `hanja`?~~ **Decided:** yes, in the M1.6 migration.
- **Việc cần vá sau (M2.10):** `PATCH /api/profiles/:id` and `DELETE /api/profiles/:id` have no server-side permission check at all (no `profile_id` of the caller, no `requireAdult`) — only the client hides the editor from kid profiles (`canManageProfiles`). The new `POST`/`DELETE /api/profiles/:id/avatar-photo` routes added `requireAdult` (M2.10); the older profile edit/delete routes should get the same check later.
- **Việc cần vá sau (TOPIK, 2026-10-18):** còn 1 câu `topik_questions.explanation_vi` là tiếng Việt không dấu (sinh trước khi `checkVietnameseDiacritics` tồn tại); 2 câu kia đã sinh lại xong. `ai_cache` của nó đã bị xoá nên lần chạy tới chắc chắn gọi Gemini mới. Khi hạn mức Gemini còn chỗ, chạy: `npm run topik-explain -- --apply --force --ids 34abc7b0-7959-49b5-a4f8-9496722ceef2` (8DeOfficial-60회 #13), rồi `npm run scan-llm-content` để xác nhận sạch.
- **Việc cần vá sau (TOPIK import, 2026-10-18):** 2 file `Cau05_08` (MasterTopik, Yonsei) đánh dấu đáp án đúng bằng **chữ in đậm** chứ không gạch chân, nên cả 60 câu đều lỗi `expected exactly one underlined option, found 0`. Quy ước của parser là gạch chân (in đậm chỉ là phụ, và chính đề bài cũng hay in đậm nên không thể dùng làm dấu hiệu) → sửa ở file input, không sửa parser.

- **Việc cần vá sau (TOPIK, 2026-11-04):** 20 ghi chú từ vựng chủ sở hữu tự gõ **sau phần đáp án** trong các file Word đang bị bỏ đi (M7.3 chỉ in chúng ra trong báo cáo import, không nhập). Chúng ở dạng "từ: nghĩa" ("관람료: phí, tiền vé", "는 김에: nhân tiện/ 는 사이에: giữa lúc", đôi khi kèm một câu ví dụ và bản dịch), và **đúng trọng tâm hơn** phần từ vựng AI sinh ra cho cùng câu hỏi đó, vì người gõ biết câu nào khó ở chỗ nào. Việc cần làm: nhập chúng vào `topik_questions.vocab` của chính câu hỏi đó (`surface`/`lemma`/`gloss_vi`, `pos` suy ra hoặc để "other"), **ưu tiên hơn** bản AI khi trùng `lemma`, thay vì để M6.2 sinh lại từ đầu. Hình dạng nhiều mục trên một dòng (phân cách bằng "/") và dòng không phải ghi chú (câu ví dụ, bản dịch trong ngoặc) phải phân biệt được, nên cần một bước duyệt bằng mắt trước khi ghi — cùng tinh thần "xem mẫu rồi mới chạy hết" của M6.2/M6.3. Chưa làm.

- **Việc cần vá sau (thi thử, 2026-11-08):** `queue.pending` trong `TopikTestRun` — những đáp án **chưa được server xác nhận** — chỉ nằm trong bộ nhớ React. Mọi thứ khác của một lượt thi đã bền: từng đáp án ghi thẳng D1 lúc bấm, đồng hồ do server giữ (M7.13), nên tải lại trang là thi tiếp bình thường. Chỗ hở duy nhất: một đáp án mà POST đang bay lúc tab bị hệ điều hành giải phóng thì mất hẳn — `unsentAnswers` không còn gì để mang theo trong `/finish`. Hiếm, và mỗi lần chỉ mất một câu. Cách vá cùng kiểu M7.19: ghi `queue` xuống localStorage theo id lượt thi ở mỗi lần bấm, lúc mount thì gộp vào hàng đã nạp từ server và gửi lại những vị trí còn `pending`. Chưa làm.
- **Việc cần vá sau (TOPIK đoạn văn dùng chung, 2026-11-08):** một đoạn văn của cặp câu đọc (19-20, và sau này 23-24, 42-43, 48-50…) đang **lưu hai bản**, mỗi câu một bản trong `stem_text` của chính nó — 191 ký tự ×2 cho cặp đầu tiên. Lúc nhập thì `inheritStem` chép sang nên chúng giống hệt nhau; sau đó **không gì canh**: sửa một lỗi chính tả trên màn duyệt là sửa một bản, bản kia trôi đi lặng lẽ. Chốt rẻ đã làm trong M7.21: cả `topik-import` lẫn `topik-groups` so `stem_text` của các câu cùng `group_key` và **cảnh báo, in cả hai bản** — phát hiện được, nhưng không ngăn được. Và từ M7.21 nó còn **hiện ra trên màn hình**: hai câu giờ nằm chung một màn, nên đoạn văn được vẽ hai lần liên tiếp (xem ảnh trong M7.21). Hai việc, nên tách: (a) vẽ một lần cho cả cụm khi mọi câu trong cụm có `stem_text` giống nhau — nhỏ, nằm trong `TopikQuestionCard`/`TopikSession`; (b) lưu một bản, nghĩa là một bảng `topik_groups` (phương án P5 đã bàn) giữ đoạn văn, `stem_text` của câu thành null và màn hình đọc từ cụm — đổi mô hình dữ liệu, migration, sửa cả màn duyệt lẫn import. Làm (a) trước; (b) chỉ khi có lý do khác nữa. Chưa làm.
- **Việc cần vá sau (TOPIK import, 2026-11-08):** 37 câu **đọc** đã nhập từ trước lệch với parser hiện tại ở đúng một chỗ: dấu gạch chân bị **tách theo từ**. Bản trong D1 có `<u>가려던 참이었어요</u>`, parser bây giờ sinh `<u>가려던</u> <u>참이었어요</u>` — cùng số chữ, cùng chỗ bắt đầu và kết thúc, chỉ khác số thẻ `<u>`. **Vô hại**: nghĩa chữ không đổi, `stripUnderline` cho ra kết quả y nguyên (nên cả chốt an toàn "thêm formatting không được đổi ký tự" của `--apply --force` cũng không kêu), và trên màn hình hai bản gạch chân giống nhau. Vấn đề duy nhất là **nhiễu**: `stem_text (37)` sẽ hiện trong mọi bảng `--diff` về sau, che mất đúng loại thay đổi mà `--diff` tồn tại để nhìn ra. Cách dọn một lần: `npm run topik-import -- --apply --force --keep-verified --section reading` (`--keep-verified` giữ nguyên các câu đã duyệt — đây chính là trường hợp nó được làm ra cho; `--section reading` là bắt buộc, `--force` không có `--section` bị từ chối trước khi ghi). Cân nhắc trước khi chạy: dấu `<u>` nằm trong văn bản gửi cho AI, nên `--diff` sẽ đề nghị xoá `vocab_checked_at`/`explain_checked_at` của 37 câu đó để sinh lại — không cần thiết vì nghĩa không đổi, cứ bỏ qua câu SQL ấy. Chưa làm.

- **Việc cần vá sau (album TOPIK, 2026-11-07):** album trong app là **toàn cục cả nhà** — bảng `decks` không có cột hồ sơ, và `albumScopes` chỉ lọc theo `kind='album'` + `lang`. Hai album M7.12 ("TOPIK II Reading" / "TOPIK II Listening") vì thế dùng chung cho mọi hồ sơ: hiện chỉ một người trong nhà luyện TOPIK nên không sao. Khi có người thứ hai luyện TOPIK, hai người sẽ đổ từ vào cùng một album — lúc đó mới tính chuyện tách album theo hồ sơ, và đó là đổi mô hình album toàn cục (migration + sửa cả tính năng album), không phải việc riêng của TOPIK.


### M7.4 — Việc kích hoạt service worker không bao giờ được phụ thuộc vào thứ có thể lỗi (2026-11-04)

**Đây là lần thứ hai chủ sở hữu bị kẹt ở bản cũ trên điện thoại, vì hai lý do khác nhau.** Lần đầu (M7.2) là service worker mới đứng ở trạng thái `waiting`, chờ một cái nút do chính app vẽ ra — mà app đang trắng màn. Lần này app không hỏng gì cả: Cloudflare trả **một mã 500 tức thời cho đúng một file CSS** trong lúc service worker mới đang cài. `precacheAndRoute(self.__WB_MANIFEST)` nạp cả 18 file của bản dựng và **một file lỗi là cả lần cài thất bại** (`bad-precaching-response`), nên worker mới không bao giờ kích hoạt, worker cũ tiếp tục phục vụ bản dựng trước, và trên điện thoại thì không có DevTools để tự gỡ.

Hai nguyên nhân khác nhau, cùng một hình dạng: **đường kích hoạt đi qua một thứ có thể lỗi.** Nên nguyên tắc phải ghi ở mức nguyên tắc, không phải vá từng ca:

> Việc kích hoạt service worker không bao giờ được phụ thuộc vào thứ có thể lỗi. Một file thiếu hoặc một phản hồi lỗi được phép làm xấu **một lần tải**; nó tuyệt đối không được khoá người dùng ở bản cũ.

Cụ thể hoá trong `src/sw.ts`: `install` chỉ chép **vỏ app** (`index.html` + icon, lọc bằng `isShellPath`), từng file một qua `Promise.allSettled`, và cả hàm bọc trong `.catch()` — kể cả việc mở cache thất bại (chế độ riêng tư, hết quota) cũng không làm `install` bị từ chối. CSS/JS/font chuyển sang **runtime cache** (`isHashedAsset`, `CacheFirst`): tên file đã chứa hash nội dung nên cache vĩnh viễn là an toàn, và một file tải lỗi chỉ làm trang đó thiếu style **một lần**. `activate` hâm nóng CSS/JS của bản dựng (`warmAssets`, cũng `allSettled`) để mở offline ngay sau khi cập nhật vẫn chạy, rồi xoá mọi cache không thuộc 4 cache của chính nó (dọn luôn precache Workbox cũ). **Tự phục hồi mà không cần làm gì thêm:** `cache: "reload"` nạp lại vỏ ở mỗi lần cài, và một file từng lỗi được xin lại ở lần dùng tiếp theo — không có trạng thái lỗi nào bị ghi nhớ vĩnh viễn.

Chẩn đoán cũng là một bài học: bằng chứng đầu tiên ("mở URL file CSS ra trang 404 của app") **không** chứng minh file vắng mặt, vì gõ URL là một *navigation request* và service worker **cũ** có đúng một luật cho navigation là trả vỏ app trong cache của nó. Phép thử đúng là mở trong **cửa sổ ẩn danh** (không có service worker nào của site): kết quả là CSS thật, 229.212 byte, 200 — tức server không hề thiếu file, lỗi 500 chỉ là tức thời. Dấu hiệu khoanh vùng nhanh nhất: trong cùng một lần cài, `index-*.js` **cùng bản dựng** tải bình thường còn `index-*.css` thì không → không phải lệch bản dựng, không phải deploy thiếu, mà là một file đơn lẻ.

Việc thứ hai làm kèm (vệ sinh, không phải nguyên nhân): `not_found_handling: "single-page-application"` trả `index.html` cho **mọi** đường dẫn không khớp, kể cả `/assets/x.css` — tức Workbox nhận một trang HTML ở chỗ đáng lẽ là stylesheet. Bỏ cấu hình đó; đường dẫn không khớp asset nay rơi về Worker, và Worker quyết định bằng **hình dạng đường dẫn** (`shared/staticPath.ts#isStaticFilePath`, không dùng danh sách cứng — danh sách sẽ bị quên đúng một lần và app mất điều hướng): có đuôi file → **404 thật**; không có đuôi → `index.html` (mọi route của app, kể cả route thêm sau này).


- **Việc cần vá sau (TOPIK nghe, 2026-11-04):** đoạn nghe của một **cặp** câu chứa khoảng lặng ~20 giây **ở giữa** — thời gian trả lời câu thứ nhất, trước khi băng đọc "이십이 번". Hiện màn luyện phát cả khoảng lặng đó (nó nằm trước `speech_end_ms`, mà ba mốc `start_ms`/`speech_end_ms`/`end_ms` không mô tả được chỗ nào ở giữa). Nếu sau này làm, phải phân biệt rạch ròi hai chỗ, và đây là lý do chứ không phải sở thích:
  - **Mini test: GIỮ NGUYÊN 20 giây đó.** Thi thật có đúng khoảng im lặng ấy; bỏ đi là bài thi không còn giống thi thật.
  - **Luyện tập: nhảy qua được thì tốt.** Người học tự nhịp, 20 giây câm là lãng phí.
  Cách làm khi cần: thêm mốc thứ tư (điểm bắt đầu khoảng lặng giữa) vào `topik_segments`, và **chỉ** `TopikClipPlayer` (màn luyện) nhảy qua — `useTestTape`/`useSittingTape` (mini test) không bao giờ đọc mốc đó. Chủ sở hữu sẽ nghe thử rồi quyết có đáng làm không. Chưa làm.

### M7.8 — Parser chỉ đếm được cái có, không biết cái đáng lẽ phải có (2026-11-04)

Bộ đọc `.docx` đếm số nhãn `Heading3` trong mỗi nhóm và lấy đúng bấy nhiêu câu. Nó **không có cách nào biết** một nhóm đáng lẽ phải có mấy câu, nên một đề soạn dở — nhóm 60회 của file `Cau16_18` mới gõ tới câu 17 — **parse sạch, nhập sạch, không một cảnh báo nào**. Lỗ hổng chỉ lộ ra khi một tính năng khác vấp phải: mini test đề gốc đòi số câu chạy liền từ 1 (`isContiguousFromOne`), nên nó lặng lẽ chào một đề ngắn hơn thay vì nói "đề này thiếu câu".

Hình dạng chung của sai lầm: **thứ duy nhất ghi lại ý định là tên file** (`Cau16_18` = ba câu mỗi đề), còn mọi kiểm tra lại chỉ nhìn nội dung. Khi ý định không được đem ra đối chiếu với kết quả thì "thiếu" và "đủ" trông giống hệt nhau.

Vá bằng hai mục in ra ở cuối dry-run (`shortGroups`, `examCoverage` trong `scripts/topikImport/plan.ts`, đều thuần và có test):
- **Nhóm thiếu câu** — so số câu thật với dải trong tên file: *"nhóm 8DeOfficial-60회: có 2 câu, dải đòi 3; thiếu câu 18"*. Là **cảnh báo**, không chặn nhập: soạn dở là cách làm việc bình thường.
- **Độ phủ theo đề** — mỗi đề có bao nhiêu câu và **chạy liền từ 1 được bao nhiêu**, tức đúng số câu mini test đề gốc dùng được. Chính mục này phát hiện cái `shortGroups` không thấy nổi: cả 8 đề 8DeOfficial có 12-14 câu nhưng chỉ dùng được **4**, vì chưa đề nào có câu 5-8; và một đề vắng mặt hẳn khỏi một file thì không để lại "nhóm thiếu" nào để mà tìm.


### M7.16 — Một đề trọn vẹn trong một file, và dấu ngắt dòng bị nuốt (2026-11-08)

Đề hoàn chỉnh tới dưới dạng **một file 50 câu, 20 khối** — ngược hẳn hình dạng cũ (một *khối câu*,
nhiều đề bên trong). Quy ước tên cũ không có chỗ cho nó: khối nằm trong tên file, mà 20 khối thì
không dải nào đúng. Nên có **dạng tên thứ hai**, và với nó **khối lấy từ dòng `[N~M]` của chính câu
hỏi** — nguồn đúng hơn tên file vốn chỉ là vật thay thế.

Không nhét số đề vào tên: `Heading2` đã nói `35회`, luật nhãn đề sẵn có biến nó thành
`OfficialTest-35회` — đúng nhãn production đang dùng. `Test35` trong tên **chỉ để đối chiếu** và
cảnh báo khi lệch; dùng nó để suy ra nhãn là tạo nguồn sự thật thứ hai cho cùng một thông tin.

Hai cái bẫy, cả hai đều im lặng:

- **Dòng `[N~M]` nằm giữa hai câu.** Nó đứng sau bảng của câu 3, trước tiêu đề câu 4, mà một đoạn
  giữa hai câu thuộc về câu *trước* nó (M7.3) — nên khối 4~8 rơi vào câu 3. Thay vì phụ thuộc vị
  trí, dòng được khớp theo **dải nó tự khai**: nó ghi 4~8 thì thuộc về câu 4 đến 8, câu 3 giữ khối
  1~3 và đề bài của nó. Không sửa thì lệch khối **và** lệch đề bài ở câu cuối của cả 20 khối.
- **`textOf` bỏ `<w:br/>`,** và bỏ nghĩa là **nối hai dòng không có gì ở giữa**. File cũ xuống dòng
  bằng đoạn riêng nên không lộ; file đề trọn vẹn để cả lượt thoại trong một ô, ngăn bằng `<w:br/>`,
  nên ba lượt dính thành một dòng, và một ngắt gõ tại chỗ Word tự xuống dòng thì **dán liền hai
  chữ**: `나타났으며` + `10대가` → `나타났으며10대가`. Thứ này đầu độc hai lần — nó là cái người học
  đọc, và là đầu vào sinh vocab/giải thích, nên model được đưa những từ không tồn tại.

Quy mô: **178/200 câu, 1003 dòng** — quá nhiều để nhờ sửa tay. Nên sửa luôn khi nhập, một cách xác
định: dòng không mở đầu bằng nhãn người nói là phần tiếp của dòng trên, và chỗ ngắt vốn là một dấu
cách, nên nối lại bằng dấu cách. **Kiểm được**: 22 câu trong số đó đã có bản gõ tay trên production,
và sau khi nối, văn bản trùng khít từng ký tự (chỉ còn khác `남자:` với `남자 :`). Đó là cách duy
nhất tin được một phép sửa tự động trên dữ liệu học: so với bản người làm.

**Và phép nối tự động ấy đã bị rút lại ngay sau đó** — đây mới là bài học thật. Nó khớp ở câu 3 nên
tôi tuyên bố "đã kiểm chứng"; xem thêm vài câu nữa thì thấy nó **bịa ra dấu cách giữa từ**:
`제품` + `인지도` phải là `제품인지도`, `중요하` + `다고` phải là `중요하다고`. Tiếng Hàn xuống dòng ở
**bất kỳ ký tự nào**, nên chỗ ngắt rơi vào giữa từ cũng thường như rơi vào dấu cách, mà file không
giữ dấu vết nào để phân biệt (đã kiểm XML thô: ký tự trước `<w:br/>` không có dấu cách thừa). Một
phép sửa sai ở số chỗ không biết được thì tệ hơn một file sai lộ liễu. Giờ chỉ **báo, không sửa** —
và bài học là: "khớp một ca" không phải là kiểm chứng; phải xem đủ số ca mà dữ liệu cho phép, nhất
là khi mình đang định viết lại nội dung người khác gõ.

Một mảnh nữa của cùng câu chuyện: luật nhận "lượt thoại mới" lúc đầu dò đúng chữ `남자`/`여자`, mà
một file có `남잠:` (gõ nhầm) — thế là dòng đó không phải lượt mới, và phép nối **dán hai lượt của
hai người vào nhau**. Giờ lượt thoại là "nhãn ngắn + dấu hai chấm", nhãn gì cũng được: sai về phía
"đây là lượt mới" thì cùng lắm để nguyên dòng, sai phía kia thì phá văn bản.

Bài học chung: lỗi lộ ra **chỉ vì** có bản cũ để đối chiếu. Nếu nhập thẳng 4 đề mới thì 156 câu
chưa từng có sẽ mang nguyên lỗi và không gì phát hiện. Vì vậy `buildImportDraft` giờ cảnh báo
thường trực mỗi dòng không mở đầu một lượt thoại, ở **mọi** chế độ chạy, và `--diff` báo thêm đề
nghe nào chưa có băng đã duyệt (câu không có băng vô hình ở cả luyện tập lẫn thi thử — an toàn,
nhưng im lặng).

### M7.15 — Hàng rào tưởng có mà không có, và `--diff` (2026-11-08)

**Quy trình bắt buộc: trước mỗi `npm run topik-import -- --apply --force`, phải chạy
`-- --diff` (cùng `--section`/`--source`) và xác nhận bảng đối chiếu.** `--diff` chỉ SELECT: nó
dựng đúng chín cột mà `--force` sẽ ghi, so với hàng đang chạy, và chỉ in những câu thật sự đổi —
kèm `verified` / có vocab chưa / có giải thích chưa của từng câu. Không ghi, không backup.

Lý do có quy trình này: **chốt chặn stem hẹp hơn nhiều so với tên gọi của nó.** Nó chỉ bật khi stem
mới có `<u>` mà stem cũ chưa có — đúng một thao tác "lần đầu thêm gạch chân" — và khi đó mới đòi bỏ
thẻ ra phải giống từng byte. Một stem bị viết lại hoàn toàn, không bên nào có `<u>`, **đi thẳng qua
không kiểm gì**. Tôi đã mô tả nó như thể nó canh "mọi thay đổi nội dung", chủ dự án tin theo, và
suýt dựa vào một hàng rào không tồn tại. Nó là chốt cho một thao tác, không phải cho ý nghĩa — bảng
`--diff` mới là thứ đứng giữa một file parse sai và 44 câu bị ghi đè.

Thứ hai: **ghi đè để lại dữ liệu AI cũ, và không gì tự sinh lại.** Câu `UPDATE` không nêu `vocab`,
`explanation_vi` hay hai dấu thời gian, nên chúng sống sót — *sai*. Cả `GET /topik/session` lẫn nút
"Tạo dữ liệu AI" đều chỉ chạy khi `*_checked_at IS NULL`, nên một transcript vừa sửa chính tả vẫn
mang nguyên phần giải thích dựng từ bản sai, im lặng. `--diff` (và cả `--apply`, sau khi ghi) vì thế
in sẵn câu `UPDATE ... SET vocab_checked_at = NULL, explain_checked_at = NULL WHERE id IN (...)` cho
đúng những câu vừa đổi nội dung **và** đã có dữ liệu AI — in ra để chủ dự án tự chạy, không bao giờ
tự chạy.

### M7.14 — Thi theo khoảng câu: một hình dạng đầu vào (2026-11-08)

Bài thi thử chỉ có ba cỡ (20 / 30 / cả đề), luôn đếm từ câu 1. Đúng cho việc thi nguyên bài, sai cho
việc luyện một dạng câu — mà luyện một dạng mới là phần lớn thời gian ngồi học. Giờ một bài thi phủ
một **khoảng**, và ba nút kia chỉ là cách điền nhanh một khoảng.

Quyết định đáng ghi nhất là **bỏ hẳn `length: 20|30|"full"` khỏi API** thay vì cho server hiểu cả
hai kiểu đầu vào. Hai luật song song nói cùng một chuyện là chỗ chắc chắn lệch nhau sau vài tháng —
và ở đây chúng đã suýt lệch ngay lập tức: "full" nghĩa là "bao nhiêu câu đã sẵn sàng", một con số
chỉ server biết, nên nếu giữ lại thì luật nới-cho-tròn-cặp phải viết hai lần, một lần cho mỗi kiểu.

- **Khoảng là ý định, không phải hệ quả.** `from_number`/`to_number` được lưu thành cột chứ không
  suy từ `min/max` của items: hai bài 21-30 và 1-30 phải phân biệt được trong lịch sử kể cả sau khi
  một câu bị xoá (items giữ `number` nhưng `question_id` thành NULL). Migration `0020` backfill các
  bài cũ từ chính items của chúng, nên màn lịch sử chỉ có một hình dạng để đọc.
- **Luật nới nằm ở hàm thuần, nhận nhóm làm dữ liệu** (`shared/topikRange.ts#expandToGroups`). Không
  có chữ "listening" nào trong đó: nhóm do caller dựng (`segment_id ?? id`), nên khi đề đọc có cặp
  19-20 / 23-24 thì cùng hàm đó đúng ngay, không sửa gì — có test chạy đúng bộ nhóm kiểu đề đọc để
  chốt điều này. Ở chế độ trộn, nới theo **hợp** của mọi nhóm (đề A ghép 21-22, đề B không), và chạy
  tới điểm bất động vì một lần nới có thể lộ ra nhóm kế tiếp.
- **Xem trước phải rẻ và không ghi gì.** `GET /topik/tests/range` chỉ SELECT: nó trả về khoảng đã
  nới, câu thiếu đầu tiên, và thời gian thật — gọi mỗi lần gõ phím cũng không tạo hàng nào. Có một
  test khẳng định đúng chuyện đó (gọi bốn lần, `topik_tests` vẫn rỗng), vì "endpoint xem trước lỡ
  tạo dữ liệu" là loại lỗi không ai thấy cho tới khi bảng đầy rác.
- **Thiếu câu thì từ chối, không âm thầm rút ngắn.** `missingNumber` trả về số câu đầu tiên không có,
  màn hình nói "Ngân hàng thiếu câu 21" và tắt nút Bắt đầu; server kiểm lại y hệt khi tạo thật.
- Thời gian không cần toán mới: M7.13 đã tính độ dài từ chính items của bài, nên khoảng 16-18 tự
  nhận đúng 2:57 băng thật, còn đề đọc vẫn 1,4 phút/câu.

Một chi tiết nhỏ bắt được khi sửa: tiêu đề màn thi hiện "Câu 21 / 10" — vị trí trên **số lượng** —
vô nghĩa với bài theo khoảng. Bốn trạng thái (một câu / một cặp, trong đề / trong khoảng) nên theo
luật §11 nó thành hàm thuần `sittingHeader`, không phải ba tầng ternary trong JSX.

### M7.13 — Đồng hồ bài thi: một mốc duy nhất ở server (2026-11-07)

Mở lại một bài thi đang làm dở thì đồng hồ chạy lại từ đầu và băng nghe về mốc 0, vì toàn bộ thời gian
chỉ nằm trong bộ nhớ React (`useReadingClock`, `useTestTape`). Nghĩa là **nạp lại trang là được thêm
giờ** — bài thi không còn giống thi thật, dù không ai cố tình.

Cách sửa là chọn **một** nguồn sự thật: `topik_tests.ends_at`. Thời gian còn lại là `ends_at − now`,
và vị trí băng là `length_ms − thời gian còn lại` — **không** lưu "băng đang ở đâu" thành cột riêng.
Hai nguồn sự thật về thời gian chắc chắn lệch nhau, và lệch luôn có lợi cho người nạp lại trang.

Hệ quả được chấp nhận có ý thức: đóng bài 20 phút là mất 20 phút băng, đúng như trong phòng thi. Băng
ghép đứng chờ nạp clip thì mất vài giây băng chứ không được bù — nới `ends_at` mỗi lần mạng chậm sẽ
thành một cách xin thêm giờ. Đường thoát là **Tạm dừng**: `ends_at` được đẩy ra đúng bằng khoảng đã
dừng, nên tạm dừng không mất gì; vì luật nghiêm, nút đó là nút to nhất màn hình, dán đáy, và hộp xác
nhận khi thoát nói thẳng rằng đồng hồ vẫn chạy.

Ba chỗ đáng ghi lại:

- **Hàm nghịch đảo phải có test tính chất.** `stitchedPosition` (clip, mốc trong clip) → ms đã có từ
  M6.5; vào lại một bài nghe ghép cần chiều ngược. `positionOnTimeline` được test bằng vòng lặp qua
  **mọi** millisecond của một băng ngắn và qua các mốc biên của một băng thật, chứ không phải vài ví
  dụ chọn tay — biên clip là chỗ sai một đơn vị sống được rất lâu mà không ai thấy.
- **Hết giờ không cần bộ hẹn giờ.** Không có cron trên gói free, và không cần: chỉ hai chỗ nhìn thấy
  một bài thi cũ (màn chọn đề và trang bài thi đó), nên cả hai quét trước khi đọc (`expireOverdueTests`).
  Hết giờ thì **chấm luôn** — đáp án đã nằm trong D1 ngay khi chọn — và `finished_at` là **mốc hết
  giờ của chính nó**, không phải lúc tình cờ bị phát hiện hai tiếng sau.
- **Một pha tạm dừng không ai mở lại** là bài `running` vĩnh viễn, tức vẫn trả lời được: sau 24 giờ
  thì chuyển `abandoned`. 5 bài trên production đã treo `running` 1–5 ngày (không có `ends_at` nào để
  đo) — migration `0019` kết chúng lại.

Một chi tiết nhỏ nhưng là bug thật, phát hiện khi thử trên trình duyệt: lúc đầu `length_ms` chỉ được
chốt khi bấm Bắt đầu, nên màn "Sẵn sàng làm bài?" hiện "1 câu · 0:00". Độ dài bài giờ được chốt ngay
khi rút đề (chỉ `ends_at` chờ cú bấm), nên màn hình nói được bài dài bao nhiêu trước khi cam kết bắt
đầu — và vẫn miễn nhiễm với việc sửa câu hỏi về sau.

### M7.10 — Gạch chân vô hình: định dạng của dấu kết đoạn (2026-11-05)

Sau khi M7.9 biến "gạch chân bất thường" thành cảnh báo, phần nghe hiện ra **10 cảnh báo** kiểu *"nhãn nói đáp án 1, nhưng cả 4 đáp án đều gạch chân"*. Chủ sở hữu mở Word kiểm và nói ngay: **chỉ một đáp án được gạch chân**, cảnh báo sai chứ file không hỏng. Đúng vậy — và nếu tin cảnh báo thì đã đi sửa 10 câu hỏi hoàn toàn lành lặn.

Đo bằng XML thô của 36회 #5 (`<w:u>` nằm ở đâu, trong ô nào):

```
đáp án 1   <w:u> trong run CÓ CHỮ = 10    ở dấu kết đoạn = 1
đáp án 2   trong run có chữ = 0           ở dấu kết đoạn = 1
đáp án 3   trong run có chữ = 0           ở dấu kết đoạn = 1
đáp án 4   trong run có chữ = 0           ở dấu kết đoạn = 1
```

Word lưu định dạng của **dấu kết đoạn** (ký tự ¶) trong `<w:pPr><w:rPr>`, và gạch chân ở đó **không nhìn thấy được** — không có chữ nào để gạch. `hasUnderline` duyệt cả cây con nên đếm luôn nó. Sửa: chỉ tính khi `<w:u>` nằm trong `<w:rPr>` của một **`<w:r>` có chữ thật** (bỏ qua run rỗng và run chỉ có khoảng trắng).

Hai điều đáng nhớ hơn bản vá:

1. **Người dùng nhìn Word, parser nhìn XML — và XML chứa thứ Word không vẽ ra.** Mọi quy tắc đọc định dạng (gạch chân, in đậm) phải nói rõ nó tính *cái gì mang chữ*, không phải "có thẻ đó ở đâu đó bên dưới".
2. **Luật cũ của phần đọc coi ">1 gạch chân" là LỖI CỨNG.** Quét lại toàn bộ để biết đã có câu nào bị loại oan chưa: phần đọc **0/227** bảng có hiện tượng này, nên chưa câu đọc nào từng bị loại oan — may, không phải nhờ thiết kế. Toàn bộ 10 ca đều ở phần nghe, nơi luật nhãn-làm-chuẩn (M7.1) đã che mất hậu quả. Nếu M7.9 không hạ lỗi xuống cảnh báo trước, bản vá M7.7-M7.9 cộng với lỗi đếm này sẽ loại thẳng 10 câu nghe.


### M7.19 — Phiên luyện tập sống sót qua việc bị ngắt (2026-11-08)

Cả phiên luyện TOPIK nằm trong `useState`: đang ở câu nào, đã chọn gì, nhóm nào đã lộ lời thoại,
và **danh sách từ đã đánh dấu để thêm vào thư viện**. Mất sạch khi điện thoại giải phóng tab lúc
chuyển sang app khác, khi phiên Cloudflare Access hết hạn làm trang tự tải lại, hoặc khi đóng nhầm
tab.

**Giá của mỗi thứ mất đi không bằng nhau, và đó là điều quyết định thiết kế.** Các câu trả lời
thực ra *không* mất: chúng đã nằm trong `topik_attempts`/`topik_cards` ngay lúc bấm. Thứ duy nhất
không dựng lại được từ đâu là danh sách từ đã đánh dấu — công người học vừa bỏ ra trong lúc làm
bài. Nên bản lưu này chỉ để **vẽ lại màn hình**, không bao giờ là nguồn sự thật: đường khôi phục
không gọi một mutation nào, và hai chốt sẵn có (`choose` chỉ nhận câu `unanswered`, `recordAnswer`
từ chối câu `given_up`) khiến một trạng thái được khôi phục không thể sinh thêm lần ghi thứ hai.

Lưu ở **localStorage**, không phải D1 — một phiên kéo dài vài phút trên một điện thoại, thêm một
lần ghi mạng cho mỗi câu trả lời không mua được gì. `sessionProgress.ts` giữ một ô cho mỗi hồ sơ
(`topik_session_v1_<profileId>`, nên hồ sơ này không thấy tiến độ hồ sơ kia); `testMarks.ts` giữ
ô riêng cho màn kết quả bài thi, nơi duy nhất của một lượt thi còn thứ chỉ nằm trong bộ nhớ.

Ba chi tiết đáng ghi lại, vì cả ba chỉ lộ ra khi hình dung mình đang thật sự dùng:

- **Lưu cả nội dung câu, không chỉ id.** Ở `mode: "due"`, câu vừa trả lời đã bị FSRS đẩy hạn nên
  lần fetch sau **không trả về nó nữa**. Nếu chỉ lưu id thì dải chấm co lại sau mỗi câu và bảng
  tổng kết cuối phiên sẽ nói "7 câu" thay vì 10.
- **Luật "còn khớp" phải cho phép câu đã trả lời biến mất.** Đây là hệ quả trực tiếp của điều
  trên: đòi "đúng tập câu cũ" thì bản lưu bị vứt ngay sau câu trả lời đầu tiên — đúng lúc nó bắt
  đầu có giá trị. `restoreSession` chỉ đòi mọi câu **chưa xử lý** còn trong tập server vừa phục
  vụ; câu `answered`/`given_up` vắng mặt là bình thường. Thiếu một câu *chưa* xử lý mới có nghĩa
  là khối đã đổi bên dưới (nhập lại, xoá) → bỏ cả bản lưu, không ghép nửa vời.
- **Phiên đã xong mà còn từ chưa thêm thì phải mở lại được màn kết quả.** Khi ấy khối không còn
  câu nào đến hạn, nên nhánh "Không có câu nào để luyện" sẽ chặn mất — và màn kết quả là nơi
  **duy nhất** thêm được đống từ đó vào thư viện. Không có nhánh này thì bản lưu vô dụng đúng ở
  tình huống cần nó nhất.

Hạn 3 giờ (quay lại hôm sau là muốn phiên mới). Mọi lần đọc/ghi bọc `try/catch` — chế độ riêng tư,
hết dung lượng, trình duyệt chặn đều chỉ làm mất tiện lợi, không làm hỏng màn hình; nếu quota từ
chối bản đầy đủ thì ghi bản gọn giữ **nhóm đang làm + toàn bộ từ đã đánh dấu**. Và có một dòng
"Đã tiếp tục phiên đang dở trên thiết bị này" tự tắt sau 8 giây: vào thẳng câu 4/5 mà không nói gì
thì người dùng chỉ thấy khó hiểu.

Phiên ôn **từ vựng** (`ReviewSession`) cố tình không làm gì cả: ở đó mỗi lần bấm điểm ghi D1 ngay
và FSRS đẩy hạn thẻ, nên tải lại là hàng mới chứa đúng phần còn lại — không có gì không dựng lại
được. Thêm bản lưu vào đó là thêm chỗ để sai mà không cứu được gì.


## 11. Lessons learned (sự cố production)

### M7.2 — Hai bản React trong một bundle vì thư mục viết sai hoa/thường (Windows, 2026-11-01)

**Triệu chứng:** deploy xong, production màn trắng, console báo `Uncaught TypeError: Cannot read properties of null (reading 'useSyncExternalStore')`. Vẫn lỗi trong cửa sổ ẩn danh và sau khi mọi service worker đã bị xoá đăng ký, nên **không phải cache**. `npm run preview` ở máy chạy tốt với cùng commit.

**Nguyên nhân:** Windows mở file không phân biệt hoa/thường, nên `cd d:\dev\lingo-family` vẫn vào được thư mục thật là `D:\DEV\lingo-family`. Nhưng Vite đặt id module theo **chuỗi đường dẫn**: `root` giữ đúng cách viết bạn gõ (`d:\dev\...`), còn resolver đi qua `realpath` thì Windows trả về tên thật (`D:\DEV\...`). Cùng một file vào đồ thị dưới **hai id**, và mọi thứ chạm tới được từ cả hai phía bị nhân đôi — trong đó có `node_modules/react/index.js`. Hai thực thể React trong một file: một bản shim `use-sync-external-store` chạy trước khi bản React của nó kịp khởi tạo, nên `require("react")` trả về giá trị chưa gán → đúng câu lỗi trên. Chỉ hỏng trên production vì các bản build ở máy tình cờ chạy từ thư mục viết đúng.

**Dấu hiệu nhận biết (số đo thật của lần này):**

| | bundle | module client | i18n `resources` |
|---|---|---|---|
| Lành | **886 KB** | **2438** | 1 bản |
| Hỏng | **1,05 MB** | **4478** | 2 bản (hai thực thể i18next, mỗi cái tự `init()`) |

Số module là dấu hiệu đáng tin nhất (1,84×); dung lượng chỉ phình 1,19× vì tên biến đã rút gọn và nhiều chuỗi dùng chung, nên **đừng** chỉ nhìn KB.

**Cách chẩn đoán đã dùng — làm lại y như vậy cho mọi ca "local chạy, production hỏng":**

1. Tải đúng file JS production về (DevTools → Network → chuột phải bundle → Save, hoặc copy URL rồi tải), đặt tạm ở gốc dự án.
2. `npm run build` rồi **so byte** với file vừa tải. Chuỗi `__BUILD_ID__` luôn khác nhau, nên che nó đi trước khi so (`re.sub` mẫu `` `<sha> <ngày> <giờ>Z` ``) — nếu sau khi che mà **giống hệt** thì production đúng là chạy bundle đó, và mọi giả thuyết về cache/CDN/Access bị loại ngay.
3. Khác nhau thì đo cấu trúc chứ không đọc mã rút gọn: số dòng, độ dài từng dòng (`awk '{print NR, length($0)}'`), số ký tự non-ASCII, số lần xuất hiện của một chuỗi UI đặc trưng (ví dụ `Ai đang học`). Thấy mọi chuỗi xuất hiện **đúng hai lần** là biết đồ thị bị nhân đôi.
4. Xác nhận bằng số module: `npx vite build` in `✓ N modules transformed` cho environment `client`.
5. Chỉ tên được cặp id trùng bằng một plugin `moduleParsed` gom `info.id` rồi nhóm theo `id.toLowerCase()` — chính là `scripts/viteGuards/buildIntegrity.ts#findDuplicateModules`, giờ chạy thường trực trong mọi build.
6. Dựng lại sự cố để chắc chắn: chạy cùng lệnh build từ thư mục viết khác casing (`cd /d/dev/...` thay vì `/d/DEV/...`).

**Đã sửa:** `vite.config.ts` chốt `root` (và cả ba alias `@`, `@shared`, `@db`) vào `realpathSync.native(import.meta.dirname)`, nên hai cách viết hội tụ về một chuỗi; build từ `d:\dev\...` và `D:\DEV\...` giờ ra **cùng một hash**. `buildIntegrity()` làm **fail build** nếu có file nào lọt vào dưới nhiều hơn một id, hoặc đồ thị client vượt `CLIENT_MODULE_CEILING`, hoặc bundle vượt `CLIENT_BYTES_CEILING` — vì kiểu lỗi này âm thầm theo nghĩa xấu nhất: build xanh, test xanh, preview ở máy chạy tốt, chỉ sập trên máy thật.

**Bài học đi kèm:** giả thuyết đầu tiên của tôi (service worker cũ kẹt ở `waiting` phục vụ shell cũ) **sai**, dù nó giải thích được triệu chứng một cách hợp lý và đã có thật một lỗi lifecycle trong `src/sw.ts` (sửa ở `dd1f51f`, vẫn đáng giữ). Phép thử đáng làm **trước tiên** là so byte bundle production với bản build local — nó phân định ngay giữa "sai cái được phục vụ" và "sai cái được build", thay vì suy luận từ triệu chứng.

### M6.4 — Quyết định hiển thị nằm trong JSX thì không có gì để test (2026-11-02)

**Hai lỗi lọt lưới cùng một lý do.** Cả hai chỉ lộ ra khi ngồi thi thật trên điện thoại, và cả hai đều **không** phải do test yếu — mà do thứ cần kiểm **không phải là hàm**, nên không có gì để gọi trong test.

1. **Chọn đáp án ảnh không thấy phản hồi.** Màu viền của thẻ ảnh được quyết định ngay trong JSX bằng một chuỗi ba tầng `answered ? (isCorrect ? … : isSelected ? … : …) : "border-border"`. Nhánh `answered === false` gộp cả "chưa chọn" lẫn "đã chọn" vào một kiểu duy nhất. Trạng thái **đã chọn nhưng chưa chấm chỉ tồn tại trong bài thi** — màn ôn tập chấm ngay khi chọn — nên không có đường nào để bộ test cũ chạm tới. Bộ test cũ có `allPictureOptions` (chọn *bố cục nào*) nhưng không có gì hỏi *thẻ trông ra sao sau khi được chọn*.
2. **Màn hình kẹt, không tự nhảy câu.** Quy tắc là một biểu thức trong thân component: `const current = viewing ?? tapePosition`. `positionAt` (băng → câu) có test đầy đủ; nửa còn lại của quyết định — "…trừ khi người học chủ động quay lại" — không phải hàm, không ai xoá `viewing`, và một lần bấm "Câu tiếp" khoá màn hình cho hết bài.

**Quy tắc rút ra:** mỗi khi một quyết định hiển thị có **nhiều hơn hai nhánh**, tách nó thành một **hàm thuần** rồi mới dùng kết quả trong JSX. Hàm đó nhận đủ dữ kiện, trả về một trong các tên trạng thái (`"correct" | "wrong" | "dimmed" | "chosen" | "idle"`) hoặc một giá trị dứt khoát (số câu đang hiện), và JSX chỉ việc ánh xạ tên đó sang class. Hai lợi ích, và lợi ích thứ hai mới là chính:

- test gọi thẳng được từng nhánh, kể cả nhánh chỉ xuất hiện ở một màn;
- **liệt kê hết các trạng thái buộc phải nghĩ tới nhánh mình đang bỏ quên** — viết ra `PictureOptionState` là lúc nhận ra "đã chọn, chưa chấm" chưa có chỗ nào xử lý.

Áp dụng xong: `pictureOptionState()` (`src/features/topik/optionLayout.ts`) và `shownPosition()`/`isParked()` (`testClock.ts`), 13 test mới cho đúng hai ca hồi quy đó. Cùng lúc phát hiện thêm `useTestTape` gắn effect theo *đối tượng* `test.audio` và không gỡ `loadedmetadata` khi dọn — 4 thẻ `<audio>` phát chồng lên nhau mà nghe như một vì cùng vị trí.

**Liên quan:** cùng tinh thần với §11 ở trên — khi một lỗi "chạy máy mình thì tốt", đừng suy luận từ triệu chứng, hãy dựng lại. Ở đây cách dựng lại là chặn `window.Audio` trong trình duyệt để tua băng, không đụng tới dữ liệu.

### M6.4 — D1 chỉ cho 100 tham số mỗi câu lệnh, và test chạy ở quy mô tối thiểu không bắt được (2026-11-02)

**Lỗi.** Màn thi thử báo "Không mở được bài thi" ở mọi đề. Log thật:

```
D1_ERROR: too many SQL variables at offset 746: SQLITE_ERROR
  at worker/routes/topikTests.ts:120   ← insert into topik_test_items
```

`POST /topik/tests` chèn toàn bộ câu của bài thi bằng **một INSERT nhiều dòng**, mỗi dòng 7 tham số. D1 từ chối mọi câu lệnh **quá 100 tham số** (giới hạn tính theo *câu lệnh*, không phải theo `batch()` — một `batch()` gồm 36 câu lệnh một dòng thì hoàn toàn bình thường).

| Số câu | Tham số | |
|---|---|---|
| 12 | 84 | chạy được — nên hôm trước không ai thấy gì |
| **15** | **105** | ngưỡng gãy |
| 20 | 140 | lỗi thật của người dùng |
| 50 (đề đủ) | 350 | |

Trần này bị chạm do **dữ liệu lớn lên**, không phải do code đổi. Loại lỗi này không bao giờ xuất hiện khi đang viết tính năng.

**Vì sao bộ test không bắt được.** Mọi test API của thi thử tạo bài **3 câu** (21 tham số) — vừa đủ để khẳng định logic đúng, và mãi mãi dưới trần. Bài học: **test phải chạy ở quy mô thật, không phải quy mô tối thiểu**. Với một tính năng có kích thước dữ liệu biết trước (đề TOPIK = 50 câu), ít nhất một test phải chạy ở kích thước đó, hoặc gần nhất có thể. Cùng họ với §11 ở trên: thứ chỉ sai ở quy mô thật thì chỉ test ở quy mô thật mới thấy.

**Rà soát toàn bộ mã nguồn** (mọi chỗ sinh câu lệnh có số tham số tỉ lệ với số dòng):

| Chỗ | Tham số tối đa | |
|---|---|---|
| `topikTests.ts` chèn `topik_test_items` | 7 × 50 = **350** | hỏng, đã sửa |
| `albums.ts` `inArray(words.id, ids)` khi thêm từ vào album | 1 × `ALBUM_BATCH_MAX` = **200** | hỏng (>100 từ một lần), đã sửa |
| `albums.ts` xoá từ khỏi album | 200 + 1 | hỏng, đã sửa |
| `words.ts` chèn `examples` khi lưu từ | 17 × `EXAMPLES_MAX` 5 = **85** | chưa gãy nhưng chỉ cách một cột, đã sửa |
| `topikTests.ts` đọc `inArray` câu hỏi / đoạn nghe | 50 | an toàn, vẫn chẻ mẻ cho chắc |
| `albums.ts#listAlbums` đọc ảnh bìa theo số album | 1 × số album, **không chặn trên** | đã sửa |
| `scripts/topikAudio` chèn 36 đoạn | 7 mỗi câu lệnh (`batch` 36 câu lệnh) | an toàn |
| `scripts/topikImport`, `scripts/migrate` | một dòng mỗi câu lệnh | an toàn |
| `review.ts#syncProfileCards` | `INSERT ... SELECT`, vài tham số | an toàn |

**Cách sửa.** Một hàm dùng chung, `worker/lib/d1Chunk.ts`: `chunkForD1(rows, paramsPerRow, { reserved })` cùng hai hàm bọc `writeInD1Chunks` / `readInD1Chunks`. Mọi INSERT nhiều dòng và mọi `IN (...)` có số phần tử không chặn trước đều đi qua đây, thay vì từng người tự nhớ con số 100. `reserved` dành cho tham số mà câu lệnh ràng buộc ngoài phần dòng (ví dụ `WHERE deck_id = ? AND word_id IN (...)`).

Mọi `IN (...)` còn lại đều có trần rõ ràng: ≤50 album (`wordAlbumsSchema`), ≤30 câu một trang quản lý, ≤10 câu một phiên luyện, ≤5 từ khoá của một câu TOPIK, ≤3 cụm từ của một từ.

**Hệ quả phụ cùng lúc:** hàng `topik_tests` được chèn **trước** các câu, nên mỗi lần chèn câu gãy là để lại một bài thi `running` không có câu nào — 5 hàng rác trên production, đúng 5 lần người dùng bấm nút. Giờ nếu chèn câu hỏng thì hàng bài thi bị xoá trước khi báo lỗi, và có test khẳng định không còn hàng nào 0 câu.

### M7.17 — `silencedetect` coi nhạc là tiếng nói, và con số đó suýt làm lệch bản đồ 50 câu (2026-11-08)

**Triệu chứng:** cắt băng nghe 64회, đoạn cuối (đoạn 36) hiện ra **99,9 giây "tiếng nói"**. Ba đề kia có đoạn 36 dài 14–15,5 giây và là lời kết thúc bài thi. Một trăm giây thì không thể là lời kết thúc, nên nó trông y như một **bài đọc dài — tức câu 49-50**. Và nếu câu 49-50 nằm ở đoạn 36 thì cả bản đồ đang lệch một đoạn: đoạn 1 là lời dẫn, câu 1 ở đoạn 2, và **toàn bộ 50 câu dính sai clip**.

**Nguyên nhân:** `ffmpeg -af silencedetect=noise=-35dB` đo **mức âm lượng**, không phân biệt loại âm. 64회 kết thúc bằng 13,6 giây lời kết thúc + 81,5 giây **nhạc không lời**. Nhạc nằm trên ngưỡng −35 dB nên được tính là "có tiếng", và hai thứ cộng lại thành 99,9 giây "tiếng nói" liền mạch.

**Vì sao suýt tin:** cách đọc "lệch một đoạn" **khít hoàn hảo về mặt số học** — 15 đoạn cặp sẽ nằm ở đoạn 22-36, không còn đoạn thừa nào, trong khi cách đọc đúng để lại một đoạn 99,9 giây không giải thích được. Một mô hình sai mà giải thích được nhiều dữ liệu hơn mô hình đúng là thứ khó cưỡng nhất.

**Thứ đã cứu:** đối chiếu **độ dài transcript trong Word với độ dài tiếng nói từng đoạn**, lấy 37회 (bản đồ đã biết đúng) làm đối chứng. Câu 49 của 64회 có 308 ký tự; đoạn 35 nói 174,8s → 0,57 s/ký tự, khớp với 37회 (398 ký tự / 216,7s = 0,54). Đặt câu 49-50 vào đoạn 36 thì ra 0,32 s/ký tự, nhanh gần gấp đôi — vô lý. Nhưng phép đo ấy chỉ **nghiêng về**, không kết luận: tương quan `r` không phân biệt được (0,97 so với 0,92, vì mọi cách gán đều tương quan khi độ dài tăng dần theo đề) và CV của tốc độ đọc là 42–46% ở cả bốn tổ hợp. **Chốt lại là 10 giây nghe thật của người dùng.**

**Luật rút ra:**

- `silencedetect` trả lời "to hơn hay nhỏ hơn X dB", không trả lời "có ai đang nói hay không". Mọi suy luận về *nội dung* dựa trên đầu ra của nó đều là suy luận gián tiếp. Nhạc, tiếng vỗ tay, nhiễu nền đều thành "tiếng nói".
- Một đoạn dài bất thường ở **đuôi** file phải được coi là "chưa biết là gì", không phải "chắc là câu cuối". Đuôi file là nơi hay có nhạc, lời cảm ơn, lời dẫn phần thi sau.
- Khi hậu quả đoán sai là **im lặng** (lệch một đoạn thì băng nghe vẫn hoàn toàn bình thường, chỉ lộ khi đáp án không còn ăn nhập — xem ghi chú `topik_audio.verified` trong `db/schema.ts`), thì phép đo gián tiếp **không đủ**, dù có 35 điểm dữ liệu khớp. Phải có một quan sát trực tiếp, kể cả khi nó rẻ đến mức tầm thường.

### M7.17 — `pickIntroEnd` ngầm giả định "file bắt đầu bằng tiếng nói" (2026-11-08)

**Luật:** `pickIntroEnd` (`scripts/topikAudio/plan.ts`) lấy **khoảng lặng ≥0,8 giây đầu tiên trong 120 giây đầu** và coi điểm kết thúc của nó là chỗ hết lời dẫn mở đầu.

**Nó sai ở cả bốn đề, theo hai kiểu khác nhau:**

| Đề | Mốc nó chọn | Thực tế |
|---|---|---|
| 35회 | 43,70 s | khoảng lặng 4,15 s đó nằm *giữa* lời dẫn; hội thoại câu 1 mới bắt đầu quãng 82 s |
| 36회 | 44,13 s | như trên, câu 1 quãng 86 s |
| 37회 | 50,78 s | như trên, câu 1 quãng 98 s |
| 64회 | **1,07 s** | file mở đầu bằng 1,07 giây im lặng, nên nó lấy ngay chỗ đó và không cắt được gì |

**Hệ quả:** đoạn 1 của **mọi** đề mang 40–48 giây lời dẫn + hướng dẫn khối + câu ví dụ (보기) trước khi tới hội thoại câu 1. Đo được bằng tốc độ đọc: đoạn 1 có 0,76–0,92 s/ký tự, còn đoạn 2-3 cùng khối chỉ 0,20–0,31.

**Vì sao không ai thấy:** luật **không bao giờ báo lỗi**. Nó luôn tìm được một khoảng lặng và luôn trả về một con số trông hợp lý — bốn con số 43,7 / 44,1 / 50,8 / 1,07 đều "có vẻ là một mốc". Chỉ 1,07 đủ lệch để gây chú ý, và đúng chỗ đó thì nó lại **không** sai hơn ba đề kia, chỉ sai theo kiểu khác. Hai đề đã được người duyệt bằng tay vẫn mang nguyên lỗi này.

**Luật rút ra:** một hàm dò tự động mà **không có trạng thái "không biết"** là một hàm không kiểm được. Nếu `pickIntroEnd` trả về `null` khi không tìm thấy khoảng lặng nào ≥2 giây (ngưỡng thật của một mốc cấu trúc, so với 0,8 giây của một chỗ ngắt câu), lỗi này sẽ lộ ở báo cáo dry-run ngay đề đầu tiên. Thà đòi `--intro` đặt tay còn hơn đoán một con số trông hợp lý. **Chưa vá** — vá bây giờ đòi cắt lại cả bốn đề, mà cắt lại là xoá mọi biên đã duyệt (xem dưới).

### M7.17 — `CURRENT_TIMESTAMP` là chuỗi, và cột `timestamp()` nhận nó không một tiếng động (2026-11-08)

**Việc đã làm:** hạ `verified` của hai đề bằng SQL trực tiếp trên production, kèm `updated_at = CURRENT_TIMESTAMP`:

```sql
UPDATE topik_audio SET verified = 0, updated_at = CURRENT_TIMESTAMP WHERE exam IN (...);
```

**Sai ở đâu:** `CURRENT_TIMESTAMP` của SQLite trả về **chuỗi** `"2026-11-08 04:57:12"`. Cột `topik_audio.updated_at` là drizzle `timestamp()`, tức **số epoch ms**. SQLite không có kiểu cột cứng, nên nó ghi thẳng chuỗi đó vào cột số và không báo gì.

**Vì sao không lộ ra:**

- SQLite nhận mọi kiểu vào mọi cột, nên không có lỗi ghi.
- `updated_at` **không nằm trong `topikAudioSchema`**, nên zod ở biên API không bao giờ nhìn tới nó. Mọi màn hình vẫn chạy đúng.
- Phía JS, `new Date("2026-11-08 04:57:12")` phân tích được, nên drizzle đọc ra một `Date` hợp lệ. Không có ngoại lệ nào ném ra.
- Chỗ duy nhất nó lộ là **sắp xếp**: SQLite xếp `integer` trước `text` bất kể giá trị, nên một `ORDER BY updated_at` sẽ đặt hàng đó sai chỗ.

**Nó tự khỏi, và đó là may chứ không phải thiết kế:** người dùng bấm duyệt lại đề đó qua giao diện, route tự ghi `updated_at` đúng kiểu và đè lên. Nếu không có cú bấm đó thì hàng kia nằm im với kiểu sai, chờ một lần sắp xếp nào đó trong tương lai.

**Quy tắc:**

- **Sửa dữ liệu qua API thay vì SQL trực tiếp khi có thể.** Route tự đặt `updated_at` đúng kiểu, và nó còn giữ các bất biến đi kèm mà SQL không biết — ví dụ `PATCH /topik/segments/:id` tự hạ `topik_audio.verified` khi biên đổi, điều mà bản SQL phải nhớ làm bằng tay.
- Bắt buộc dùng SQL thì **`CAST(strftime('%s','now') AS INTEGER) * 1000`**, không bao giờ `CURRENT_TIMESTAMP`, cho mọi cột drizzle `timestamp()`.
- Một cột không nằm trong schema zod của route là một cột **không có ai kiểm**. Ghi tay vào đó thì không có lưới nào đỡ.

### M7.18 — Nhạc nền đè lên lời dẫn: kiểu sai thứ ba của `pickIntroEnd` (2026-11-08)

Đề thứ năm (60회) đúng là cái bẫy mà mục `pickIntroEnd` ở trên cảnh báo, nhưng nó sai theo một kiểu **mới**, và con số nó đưa ra trông hợp lệ hơn cả bốn lần trước.

| Đề | `pickIntroEnd` tính | Thực tế | Kiểu sai |
|---|---|---|---|
| 35회 | 43,7 s | 81,0 s | khoảng lặng nằm *giữa* lời dẫn |
| 36회 | 44,1 s | 85,4 s | như trên |
| 37회 | 50,8 s | 98,2 s | như trên |
| 64회 | 1,07 s | 39,5 s | file mở đầu bằng im lặng |
| **60회** | **95,7 s** | **121,87 s** | **nhạc nền lấp hết chỗ nghỉ** |

95,7 s nằm gọn trong khoảng 39–98 s của bốn đề đã sửa, nên nó **không hề trông bất thường**. Thứ phát hiện ra nó là đếm khoảng lặng ở ngưỡng nhạy:

```
Khoảng lặng >= 0,2 s trong 100 giây đầu:
  60회:  10 chỗ — chỗ đầu tiên ở 81,81 s
  37회:  20 chỗ — rải đều từ đầu
```

**Nguyên nhân:** 60회 có **nhạc nền chạy đè lên lời dẫn**. Tiếng nói bắt đầu từ giây 10 (người dùng nghe xác nhận), nhưng nhạc lấp kín mọi chỗ ngắt câu, nên `silencedetect` không thấy một khoảng lặng nào cho tới 81,81 s — chỗ nhạc tắt. Dải 82 giây "liền mạch" **không phải vì người đọc không nghỉ**, mà vì nhạc che chỗ nghỉ. `pickIntroEnd` do đó lấy khoảng lặng ≥0,8 s đầu tiên và rơi vào *giữa phần nói*, không phải cuối lời dẫn.

**Cùng gốc với sự cố 99 giây "tiếng nói" ở đuôi 64회** (mục M7.17 ở trên): `silencedetect` đo **độ to**, không phân biệt loại âm. Ở 64회 nhạc tạo ra một đoạn giả; ở 60회 nhạc làm *biến mất* các biên thật. Một nguyên nhân, hai biểu hiện trái ngược — nên đừng chỉ nhớ "nhạc sinh ra đoạn thừa".

**Dấu hiệu nhận biết, đáng tin hơn mọi ngưỡng:**

> **Tiếng người luôn có chỗ nghỉ.** Một dải dài quá ~50 giây mà không có một khoảng lặng nào ≥0,2 giây thì gần như chắc chắn có nhạc, và **mọi con số bộ dò đưa ra trong dải đó đều không tin được.**

Đây là phép kiểm nên chạy trước khi tin bất kỳ mốc nào: nó không cần biết nội dung, không cần transcript, không cần tai, và nó bắt được cả hai biểu hiện. 37회 — đề có lời dẫn đọc liền một hơi dài nhất trong năm đề — vẫn chỉ 49,5 giây, nên ngưỡng 50 giây có chỗ dư thật.

**Chỗ làm đúng lần này:** 60회 là đề duy nhất **chưa duyệt băng bao giờ**, nên mốc được truyền thẳng vào lúc cắt (`--apply --intro 2:01.870`) thay vì sửa `start_ms` sau. Không có lần hạ `verified` nào, không có lần sửa tay nào. Bốn đề trước buộc phải sửa tay chỉ vì băng đã duyệt rồi — **với một đề mới, luôn đặt `--intro` ngay lúc cắt.**

**Ba đề thứ sáu–tám (41회, 47회, 52회, 2026-11-08) sai y hệt kiểu nhạc nền** — cùng một kiểu, cùng một ngày, nên phép kiểm trên đã thành phép kiểm thường quy chứ không còn là phát hiện riêng của 60회:

| Đề | `pickIntroEnd` tính | Thực tế (đặt tay) | Lệch | Khoảng lặng ≥0,2 s trong 100 giây đầu |
|---|---|---|---|---|
| 41회 | 102,169 s | **142,253 s** | −40,1 s | **0 chỗ** |
| 47회 | 102,208 s | **144,593 s** | −42,4 s | **0 chỗ** |
| 52회 | 104,025 s | **165,882 s** | −61,9 s | **0 chỗ** |

Không chỗ nào, không phải "ít chỗ": một trăm giây đầu của cả ba đề không có nổi một khoảng lặng 0,2 giây (trừ 0,25–0,30 giây ở đúng đầu file). Nhạc nền chạy liền từ giây 0 tới ~101 s, và `pickIntroEnd` lại bắt đúng chỗ **nhạc tắt** ở cả ba. Tổng kết đến nay: **8/8 đề sai, theo 4 kiểu** (lặng giữa lời dẫn ×3, im lặng đầu file ×1, nhạc nền ×4).

**Mốc đúng suy được bằng tốc độ đọc, và cách này đo được sai số của chính nó.** Cách làm: lấy đoạn 2 và đoạn 3 của *chính đề đó* làm thước (biên của chúng sinh ra từ khoảng lặng trả lời ~12 giây, không phụ thuộc mốc lời dẫn), tính âm tiết Hangul / giây, rồi suy ngược độ dài đoạn 1 từ `speech_end` của nó: `start ≈ speech_end − (âm tiết câu 1 / tốc độ)`. Đếm cả 18 âm tiết của `instruction` ở **cả ba** đoạn — băng chỉ đọc lời dẫn một lần cho cả khối, nhưng đếm nhất quán thì phần lệch tự triệt tiêu, và đó là biến thể cho sai số nhỏ nhất trong ba biến thể đã thử. Kiểm hậu nghiệm trên 5 đề đã duyệt: sai **+0,6 → +2,0 giây** (trung bình +1,4, lệch chuẩn 0,6) — luôn muộn hơn mốc thật, vì mốc thật nằm ở biên khoảng lặng, có một quãng lấy đà trước tiếng nói. Trừ 1,4 giây rồi lấy **điểm kết thúc của khoảng lặng thật gần nhất** là ra mốc để nghe thử. Cả ba đề mới đều khớp ngay lần đầu (lệch 0,5 / 0,7 / 1,2 giây so với con số suy ra), và người dùng nghe xác nhận cả ba mẩu 14 giây.

**Luật "trả về null thay vì đoán" chỉ bắt được 3/8 — đo rồi mới biết.** Luật đề xuất: trả `null` khi (a) không có khoảng lặng nào ≥2 giây trong 120 giây đầu, **hoặc** (b) 100 giây đầu không có khoảng lặng nào ≥0,2 giây. Chạy thử trên cả tám đề:

| | 35회 | 36회 | 37회 | 41회 | 47회 | 52회 | 60회 | 64회 |
|---|---|---|---|---|---|---|---|---|
| Lệch của bộ dò | −37,3 | −41,2 | −47,5 | −40,1 | −42,4 | −61,9 | −26,2 | −38,4 |
| Luật mới | nhận | nhận | nhận | **từ chối** | **từ chối** | **từ chối** | nhận | nhận |

Nó bắt đúng ba đề nhạc nền và **bỏ sót năm đề còn lại**, vốn sai 26–47 giây. Lý do không phải ngưỡng chọn sai mà là **không có dấu hiệu nào để bắt**: ở năm đề đó lời dẫn là tiếng nói có chỗ nghỉ thật, và một chỗ ngắt câu *bên trong* lời dẫn không khác gì chỗ nghỉ *trước câu 1* nếu chỉ nhìn độ dài khoảng lặng. Hai điều rút ra, cho lần vá:
- Điều kiện (b) phải **bỏ khoảng lặng bắt đầu ở giây 0** (chính là kiểu sai "im lặng đầu file"). Nếu không, 52회 không bị bắt: nó có một khoảng lặng 2,92 giây nên (a) không nổ, và (b) chỉ nổ khi ta phớt đi 0,30 giây im lặng ở đầu file.
- Một luật chỉ bắt 3/8 vẫn để lại đúng cái nó định chữa: năm đề kia vẫn được cắt sai trong im lặng. Hoặc **đòi `--intro` vô điều kiện cho mọi đề mới** (8/8 đề thật đều cần người nghe, nên nhánh "tìm được chỗ đáng tin" chưa một lần nào đáng tin), hoặc để bộ dò **in ra mốc suy từ tốc độ đọc** ở trên — thứ đã đúng 8/8 — rồi vẫn bắt người xác nhận.

**Đã vá ở M7.20 bên dưới** (bỏ hẳn `pickIntroEnd`). Và chỗ tôi nhầm khi bàn việc này, đừng lặp lại: sửa luật dò **không** đòi cắt lại tám đề. Tám đề đã nằm trong D1 với mốc đã duyệt; `pickIntroEnd` chỉ chạy lúc cắt một đề mới, nên sửa nó chỉ ảnh hưởng tới đề thứ chín trở đi.

### M7.18 — Chạy lại một lệnh ghi chỉ để đọc thông điệp lỗi (2026-11-08)

**Việc đã làm:** lần chạy `npm run topik-audio -- --exam OfficialTest-60회 --apply --intro 2:01.870` đầu tiên ném stack trace, và dòng lỗi thật bị lọc mất vì cách bắt output sai. Thay vì **dừng lại** và tìm lỗi bằng đường khác, đã chạy lại chính lệnh ghi đó vài lần để nhìn cho ra thông điệp. **Một trong những lần đó ghi thật lên production** — lần cuối mới báo `SKIPPED: already has audio`.

Tức là dữ liệu production được ghi trong một lần chạy **để chẩn đoán**, không phải một lần chạy có chủ ý. Không ai quyết định "ghi bây giờ".

**Lần này không hỏng, vì hai thứ tình cờ:**

- script có chốt "đề đã có băng thì bỏ qua, trừ khi `--force`", nên các lần sau không ghi thêm;
- kiểm lại ra sạch: đúng 1 hàng `topik_audio`, 36 đoạn `idx` 1–36 liền mạch, 50 câu gán đủ, `start_ms` của đoạn 1 đúng 121 870.

Lỗi ban đầu gần như chắc chắn là lỗi tạm thời ở khâu kết nối D1 (cùng loại 7403/network đã gặp trong ngày), vì cùng câu lệnh ở lần sau chạy trót lọt.

**Nếu lệnh đó không idempotent thì đã nhân bản dữ liệu** — và nhiều lệnh ghi trong repo này không có chốt như vậy.

**Luật:** một lệnh **GHI** mà lỗi thì **dừng lại**. Đọc cho ra lỗi bằng cách khác: xem lại output đã lưu, bắt toàn bộ stdout+stderr vào file thay vì lọc bằng `grep`, chạy phần **đọc** tương đương (`--diff`, dry-run, một `SELECT`), hoặc kiểm trạng thái hiện tại trước đã. Chỉ khi đã biết nguyên nhân mới chạy lại, và **đúng một lần**.

**Không bao giờ chạy lại một lệnh ghi chỉ để nhìn thông điệp lỗi.** Lệnh ghi không phải công cụ chẩn đoán.

### M7.20 — Bỏ `pickIntroEnd`: một bài toán không có lời giải tự động (2026-11-08)

**Kết cục:** `pickIntroEnd` sai **8/8 đề thật, theo 4 kiểu**, lệch 26 đến 62 giây. Nó đã bị bỏ hẳn. Mốc hết lời dẫn bây giờ **luôn** là `--intro` do người nghe quyết định; không có đường dự phòng tự động nào.

| Đề | Bộ dò tính | Mốc thật | Lệch | Kiểu sai |
|---|---|---|---|---|
| 35회 | 43,7 s | 81,0 s | −37,3 | khoảng lặng *giữa* lời dẫn |
| 36회 | 44,1 s | 85,4 s | −41,2 | như trên |
| 37회 | 50,8 s | 98,2 s | −47,5 | như trên |
| 64회 | 1,07 s | 39,5 s | −38,4 | im lặng ở đúng đầu file |
| 60회 | 95,7 s | 121,9 s | −26,2 | nhạc nền che chỗ nghỉ |
| 41회 | 102,2 s | 142,3 s | −40,1 | như trên |
| 47회 | 102,2 s | 144,6 s | −42,4 | như trên |
| 52회 | 104,0 s | 165,9 s | −61,9 | như trên |

**Lý do bỏ không phải vì chọn ngưỡng kém.** Luật từng được vá bốn lần, mỗi lần nới một ngưỡng, và đề sau lại phá. Trước khi bỏ, một luật "trả về `null` thay vì đoán" đã được **đo trên cả tám đề**: `null` khi không có khoảng lặng nào ≥2 s trong 120 giây đầu, **hoặc** 100 giây đầu không có khoảng lặng nào ≥0,2 s. Nó từ chối đúng ba đề nhạc nền và **bỏ sót năm đề còn lại**, vốn sai 26–47 giây.

Lý do thật: ở năm đề đó **tín hiệu không chứa dấu hiệu nào** để phân biệt chỗ nghỉ *trong* lời dẫn với chỗ nghỉ *trước câu 1*. 35회 có 21 khoảng lặng trong 100 giây đầu, dài nhất 12,3 giây, mốc thật ở 81,0 s — không một luật nào theo độ dài khoảng lặng tách được chúng, vì khác biệt nằm ở **nghĩa của lời nói hai bên**, thứ `silencedetect` không đo. (Chi tiết phụ: điều kiện ≥0,2 s còn phải bỏ khoảng lặng bắt đầu ở giây 0, nếu không 52회 không bị bắt — chính là kiểu sai của 64회 quay lại cửa sau.)

> **Một bài toán không có lời giải tự động thì cách đúng là nói ra điều đó, không phải đoán hay hơn.** Một hàm dò đưa ra con số trông hợp lý rồi chờ người ta tin thì tệ hơn là không có hàm nào: nó chuyển việc kiểm từ "phải làm" thành "chắc là xong rồi".

**Thay bằng một con số tự kiểm được, không phải một con số để tin.** `estimateIntroEnd` (`scripts/topikAudio/plan.ts`) **đề xuất** mốc bằng tốc độ đọc, và không quyết định gì:

- Đoạn 2 và đoạn 3 là **thước do chính đề đó tạo ra**: biên của chúng sinh từ khoảng lặng trả lời ~12 giây, hoàn toàn không phụ thuộc mốc lời dẫn. Âm tiết Hangul của chúng chia cho số giây ra tốc độ của người đọc này (thật tế 2,9–4,2 âm tiết/giây giữa tám đề — một hằng số cố định không thể dùng).
- Số âm tiết của câu 1 nói đoạn 1 phải dài bao nhiêu, nên `speech_end(đoạn 1) − độ dài đó` là chỗ đoạn 1 bắt đầu. `speech_end(đoạn 1)` là **mốc duy nhất lấy trực tiếp từ tín hiệu**: khoảng lặng ≥5 giây đầu tiên luôn là khoảng lặng trả lời của chính câu 1 (đúng cả tám đề — trước mốc thật không đề nào có khoảng lặng ≥5 giây).
- Trừ `INTRO_BIAS_MS` = 1,4 giây rồi **bám vào biên khoảng lặng thật gần nhất**. Sai số đo lại trên tám mốc người đã duyệt: **≤4 mili-giây, cả tám** — vì người cũng đang chọn một biên khoảng lặng. Không bám thì muộn 0,6–2,0 giây.
- Đếm 18 âm tiết của `instruction` ở **cả ba** câu, dù băng chỉ đọc lời dẫn khối một lần: đếm nhất quán thì phần lệch tự triệt tiêu. Ba biến thể đã thử, đo trên 5 đề đã duyệt lúc hiệu chỉnh — đếm cả ba (lệch +0,6…+2,0 s), chỉ đếm cho câu 1 (−2,1…−4,7 s), không đếm đâu cả (+2,7…+3,9 s) — biến thể đầu cho khoảng lệch hẹp nhất, nên nó được chọn **vì số đo**, không vì nó đúng về mặt ngữ nghĩa.

**Độ chính xác đó không phải giấy phép cắt tự động**, và chỗ này dễ trượt nhất: 4 mili-giây trên tám đề trông như "thôi tin nó đi". Giá trị thật của bộ suy mốc là nó in kèm `clip1_ms`: *"đoạn 1 sẽ dài 16,2 s, văn bản câu 1 đòi 15,7 s"*. Hai số sát nhau là dấu hiệu tin được; chính tỉ lệ này tố giác cả tám lần sai trước (đoạn 1 dài 56 / 62 / 82 giây trong khi văn bản chỉ đòi 16–18). Còn "102,169" thì không tự tố giác được gì.

**Quy trình một đề mới giờ đúng hai bước** (trước đây là ba, bước giữa phải nhờ cắt mẩu nghe thử bằng tay):

1. `npm run topik-audio -- --exam <nhãn>` — **không cắt gì, không đọc D1, thoát mã 1**. In: dấu hiệu nhạc nền (nếu có), mốc đề xuất, dòng tự kiểm, **một mẩu 14 giây cắt sẵn tại mốc đó** (mốc ở đúng giây thứ 6) trong `data/topik-audio/_check/`, và dải khoảng lặng quanh mốc — mỗi dòng kèm luôn `--intro <số>` để chọn mốc khác mà không phải hỏi lại.
2. Nghe mẩu, rồi `npm run topik-audio -- --exam <nhãn> --intro <số> --apply`.

Hai chốt nữa trong cùng lần vá:

- `--intro` **là mốc của một đề**. Chạy `--intro` mà không `--exam` lúc trong `data/topik-audio` có nhiều mp3 thì **từ chối**, kể cả dry-run: trước đây con số đó sẽ lặng lẽ cắt cả tám đề tại mốc đo trên một đề, và từng đề đều trông hợp lệ.
- Ngưỡng dò khoảng lặng hạ từ 0,8 s xuống **0,2 s**. Không phải để an toàn hơn: "100 giây đầu không có khoảng lặng nào ≥0,2 s" là **dấu hiệu duy nhất** nhận ra đề bị nhạc nền (4/8 đề), và bộ suy mốc bám vào đúng danh sách này. Việc cắt không đổi — `boundarySilences` vẫn lọc ở 5 giây — và đã kiểm lại: 41회 với `--intro 142.253` ra đúng 36 đoạn, đoạn 1 y nguyên bản đã duyệt.

**Thứ làm việc vá này kiểm được:** tám đề thật giờ là tám ca kiểm trong `scripts/topikAudio/plan.test.ts`, mỗi ca gồm khoảng lặng thật của mp3 đó, số âm tiết thật của câu 1–3, và mốc người đã duyệt trong D1 production. Đây chính là bài kiểm mà `pickIntroEnd` **không bao giờ có thể có**: nó sai cả tám. Đề thứ chín nào đánh đổ được bộ suy mốc thì cũng phải vào bảng đó.

### M7.21 — Cặp câu đọc dùng chung đoạn văn, và hai biểu thức cho một khái niệm (2026-11-08)

Phần đọc từ câu 19 có cặp câu hỏi về cùng một đoạn văn. Dữ liệu thật đầu tiên (`TOPIK_Reading_Cau19_20_8DeOfficial_VERSION1.docx`) làm lộ **hai lớp vấn đề**: một lỗi cụ thể chặn câu 19 không nhập được, và một kiểu lỗi lặp lại đứng sau nó.

**Lỗi cụ thể: một ký tự.** Dòng khối trong file gõ bằng dấu ngã toàn chiều rộng `～` (U+FF5E) — thứ bàn phím tiếng Hàn cho ra. Hai biểu thức cùng đọc một khái niệm "dải `[N~M]`" nhưng viết khác nhau:

| Nơi | Biểu thức | Nhận `～`? |
|---|---|---|
| `topikParse.ts` — *đây có phải dòng khối không* | `/^\[\s*\d+\s*(~\s*\d+)?\s*\]/` | **không** |
| `topikImport.ts` — *dải trong dòng khối là gì* | `/^\s*\[\s*(\d+)\s*(?:[~～-]\s*(\d+))?\s*\]/` | có |

Lớp nhận dạng không nhận ra dòng đó, nên nó thành "đoạn văn không thuộc phần nào của câu hỏi" — và theo luật M7.3, đó là **lỗi cứng**: câu 19 bị từ chối, câu 20 nhập bình thường. Một nửa cặp vào kho, không ai báo gì ngoài một dòng lỗi dễ đọc nhầm thành lỗi của người gõ.

**Kiểu lỗi đứng sau nó: cùng một khái niệm, hai biểu thức, ở hai nơi.** Quét hết hai file parser tìm những cặp như vậy, ra **ba**:

| Khái niệm | Bản A | Bản B | Khác nhau ở |
|---|---|---|---|
| dải `[N~M]` | `topikParse` | `topikImport` | `～` |
| dòng mở lượt thoại | `SPEAKER_PREFIX` `/^[^:：]{1,12}[:：]/` | `SPEAKER_LABEL` `/^[^\s:]{1,8}\s*:/` | dấu hai chấm toàn chiều rộng, độ dài tên, khoảng trắng trong tên |
| số thứ tự lựa chọn người gõ tự đánh | `topikParse` `.replace(/^\d+\)\s*/, "")` | `topikImport#stripOptionNumber` | A cắt **vô điều kiện**, mọi chữ số, chỉ `)`; B chỉ cắt `1-4` khi **khớp đúng vị trí** và chấp nhận `. ) ． ）` |

Cặp thứ ba đáng sợ hơn cặp đầu: hai bản **mâu thuẫn nhau về ý định**. Chú thích của B viết rõ *"đánh số lại trong im lặng là cách một bảng đáp án lặng lẽ thôi khớp với các lựa chọn của nó"* — và A làm đúng việc đó, trước khi B kịp nhìn thấy. Cách sửa không phải gộp hai biểu thức mà là **xoá bản sai**: lớp parse để nguyên văn bản, một mình `stripOptionNumber` quyết định và báo cáo.

Đo tác động trên cả 22 file trước/sau, như M7.7 đã chốt: lỗi 1 → 0 (câu 19 nhập được), cảnh báo +15 — đúng 15 câu mà bản A vẫn âm thầm cắt số và chưa bao giờ ai được biết. Cột `options` **không đổi một ô nào**: 15 câu đó số đều khớp vị trí, nên kết quả y hệt, chỉ khác là bây giờ nó được nói ra.

> **Một khái niệm được nhận dạng ở hai nơi bằng hai biểu thức là một lỗi đang chờ ngày.** Chúng không bao giờ sai cùng lúc: một bên nhận, bên kia không, và chỗ gãy hiện ra cách xa nguyên nhân. Ba cặp ở đây đã tồn tại nhiều tháng và chỉ lộ khi gặp file đầu tiên gõ bằng ký tự khác.

**Nhóm cho phần đọc: cột `group_key`.** Phần nghe nói "hai câu này chung một nguồn" bằng `segment_id`. Đoạn văn không có đoạn băng để trỏ tới, nên cặp 19-20 **không có cách nào nói ra** — `same_segment` (dấu `CHUNG ĐOẠN` trong file Word) được đọc ra, dùng cho script cắt băng, rồi **vứt đi**, không bao giờ vào D1. Thêm `topik_questions.group_key` (nullable, migration `0021`, một câu `ALTER TABLE` nên không dựng lại bảng và không mất trigger nào), khoá suy từ câu đầu cụm (`section|exam|number`) để nhập lại cùng file ra cùng khoá.

**Và một hàm duy nhất cho `group_id`:** `topikGroupId()` (`shared/topik.ts`), thứ tự **`segment_id` → `group_key` → id của chính câu**. Định đi gộp "ba chỗ" viết `segment_id ?? id`; cách tìm ra số thật là **bắt `group_key` thành bắt buộc trong kiểu tham số** rồi để trình biên dịch gọi tên từng nơi — ra **sáu**:

1. phiên luyện tập (`toPracticeQuestion`), 2. danh sách ứng viên của phiên, 3. nới dải của mini test (`groupsOf`), 4. câu hỏi của một lượt thi, 5. bốc đề trộn (`mixedCandidates`), 6. `revealGroup` — chỗ quyết định ẩn/hiện giải thích.

Chỗ 5 đã mọc **biến thể thứ sáu của luật** (`section === "listening" ? segment_id : id`) kèm chú thích "phần đọc không có đoạn văn dùng chung" — đúng vào ngày nó được viết, và nó sẽ bốc một nửa cặp 19-20 vào bài thi trộn rồi bỏ nửa kia lại. Chỗ 6 thì **test bắt được, không phải mắt đọc được**: biểu thức ở đó trông hoàn chỉnh một mình, chỉ khi chạy thật mới thấy trả lời xong cả cặp mà chỉ hiện giải thích của một câu.

> Gộp một biểu thức lặp lại thì **đừng tin `grep`**: bắt kiểu dữ liệu đòi trường mới là bắt buộc, rồi để trình biên dịch liệt kê. `grep "segment_id ??"` ra ba; trình biên dịch ra sáu, và cái thứ năm là cái sẽ hỏng nặng nhất.

**Chốt phát hiện hai bản đoạn văn trôi khỏi nhau** (`driftNotes`): hai câu cùng `group_key` mà `stem_text` khác nhau thì cảnh báo và in cả hai bản — chạy cả trên file vừa đọc lẫn trên hàng đang có trong D1, vì chỉ bản trong D1 mới lộ được drift **xảy ra sau khi nhập**. Không chặn, chỉ nói ra; sửa tận gốc là việc riêng ở §10.

**Backfill** `npm run topik-groups` (dry-run mặc định, `--apply`, `--local`): ghi **đúng một cột**, không đụng `verified`, `stem_text`, kể cả `updated_at` — điền một thứ hàng đó vốn đã mang nghĩa thì không phải là một lần sửa câu hỏi. Hàng nào không file Word nào phủ thì **báo là mồ côi và bỏ qua**, không bao giờ xoá khoá của nó. Chạy lần hai ra 0 thay đổi.

**Kiểm chứng trên dữ liệu thật** (local D1 + trình duyệt, cộng test API):
- mini test dải 1-19 → **tự nới thành 1-20**, và câu 19/20 cùng `group_id` trong lượt thi;
- màn ôn tập hiện **câu 19 và 20 trên cùng một màn**;
- trả lời câu 19 → **không có giải thích**; trả lời nốt câu 20 → giải thích của cả hai hiện ra.

Hai thứ màn hình thật chỉ ra mà test không: câu ghi chú viết "cùng một **đoạn nghe**" nằm trên một đoạn văn đọc (sửa luôn: chọn câu chữ theo cụm đó có băng hay không), và **đoạn văn được vẽ hai lần** trên một màn — hệ quả trực tiếp của việc gộp nhóm, ghi vào §10. Không có bước mở trình duyệt thì cả hai lọt.

### M7.22 — Một hàm ném lỗi lúc render, và màn ôn tập phần nghe sập (2026-11-08)

**Hiện tượng (production, bản `603cf5cf`):** chạm vào một từ trong **lời thoại** ở màn ôn tập phần nghe → cả màn hình chết:

```
Unexpected Application Error!
useMarkSource must be used inside a MarkSourceContext provider
URL: /topik/practice?section=listening&from=9&to=12
```

**Không phải lỗi của việc C** (M7.19, bản vừa deploy), dù bản đó đúng là đã dời `MarkedWordsProvider`. Bằng chứng: ở commit `d9b56c6` (M7.12, chỗ sinh ra `MarkSourceContext`) dòng vẽ lời thoại trong `TopikSession.tsx` **đã** nằm ngoài mọi thẻ câu hỏi, và commit của việc C **không đụng vào dòng đó** (`git show 19d3e55 -- TopikSession.tsx` không có dòng nào khớp `Transcript`). Lỗi đã sống từ M7.12; việc C chỉ tình cờ là bản deploy mà người dùng gặp nó.

**Nguyên nhân:** `MarkSourceContext` được cung cấp bởi **`TopikQuestionCard`**, tức mỗi thẻ câu hỏi một nguồn. Nhưng không phải thứ gì trên màn ôn tập cũng nằm trong một thẻ: **lời thoại là của cả cụm**, nên `TopikSession` vẽ nó ở ngoài. Từ trong lời thoại vẫn chạm được → popover → `TopikMarkToggle` → `useMarkSource()` → **ném lỗi giữa lúc render**.

Và `useMarkSource` ném lỗi là có chủ ý, với lý lẽ ghi sẵn trong chú thích: *"một từ được đánh dấu mà không biết thuộc câu nào thì không xếp album được, nên hỏng to còn hơn bỏ qua trong im lặng"*. Lý lẽ đúng, **chỗ đặt sai**: nó chạy trong pha render, nên một màn hình chỉ *có thể* mời đánh dấu một từ nó không quy được về câu nào thì chết hẳn, kéo theo cả phiên.

**Cách sửa, hai phần tách bạch:**
1. **Bất biến giữ nguyên nhưng đổi chỗ**: `useMarkSource()` trả `null` thay vì ném, và `TopikMarkToggle` **không vẽ gì** khi không có nguồn. Không có nút thì không thể bấm, nên vẫn không thể đánh dấu mà thiếu nguồn — nhưng cái giá của một chỗ quên provider tụt từ *màn hình trắng* xuống *thiếu một cái nút*.
2. **Vá đúng chỗ thủng**: `TopikSession` tự cấp `groupSource` (câu đầu của cụm — một đoạn băng, một đoạn văn, mọi câu trong cụm chia đều) cho những khối **nó tự vẽ**. Nút hiện thật, từ được xếp đúng album.

**Quét ra ba chỗ, không phải một:**

| Nơi vẽ chữ chạm được | Nguồn |
|---|---|
| `TopikQuestionCard` | tự cấp, cho câu của chính nó ✓ |
| `TopikTranscript` (lời thoại, do `TopikSession` vẽ) | **không có** → đây là lỗi production |
| `TopikSession` — đoạn văn dùng chung (M7.21, thêm cùng buổi chiều hôm đó) | **không có** → cùng một lỗ, mở lại sau vài giờ |
| `TopikTestResultView` | có, trừ khi câu đã bị xoá (`exam === null`) → trước đây là **sập**, giờ là thiếu nút |

Chỗ thứ ba đáng nhớ nhất: tôi vừa vá xong chỗ thứ hai thì phát hiện chính thay đổi mình làm hai giờ trước đã mở lại đúng cái lỗ đó. Một context bắt buộc mà **không có gì ở mức kiểu dữ liệu nhắc người ta cấp nó** thì mỗi khối vẽ chữ mới là một lần tung đồng xu.

> **Đừng ném lỗi trong pha render để bảo vệ một bất biến.** React không có chỗ nào bắt lỗi đó ngoài error boundary, và error boundary nghĩa là mất cả màn hình. Bất biến nào diễn đạt được bằng "không đủ điều kiện thì không vẽ nút" thì diễn đạt như vậy: hỏng thành thiếu một chức năng, chứ không thành mất cả phiên làm việc.

**Dữ liệu:** không mất gì. Lỗi nằm hoàn toàn trong pha render, không đường ghi nào bị đụng — các lần trả lời đã nằm trong `topik_attempts`/`topik_cards`, và danh sách từ đã đánh dấu **sống sót** nhờ chính việc C: `marked` nằm trong bản ghi localStorage (`topik_session_v1_<profile>`), ghi lại sau mỗi lần đổi, nên tải lại trang là phiên và danh sách từ trở về. Trớ trêu là bản deploy bị nghi gây ra lỗi lại chính là bản làm cho nó không mất gì.

**Test chặn tái phát, và nó kiểm được đúng những gì** (`src/features/topik/markSource.test.ts`): dự án **không có test component**, nên không có gì ở đây render React. Test đúng ra phải mount `TopikSession` với một cặp câu nghe, trả lời cả hai, mở lời thoại, bấm vào một từ — sáu bước render thật. Thay vào đó là hai phép kiểm rẻ tiền đọc mã nguồn: (1) hook **không ném lỗi** — đây mới là tính chất biến lỗi từ màn hình trắng thành thiếu nút, và nó hỏng ngay nếu ai đó khôi phục `throw`; (2) **danh sách các file vẽ chữ chạm được là cố định**, mỗi mục kèm một dòng nói nguồn ở đâu ra — thêm chỗ mới là test đỏ, buộc phải trả lời câu hỏi đó. Chính danh sách này là thứ sẽ hỏi khi đoạn văn dùng chung ra đời. Chúng **không** kiểm được provider có thật trong cây lúc chạy, giá trị có đúng câu không, hay nút có hiện không — chỉ màn hình thật mới nói được, và đó vẫn là nơi tôi xác nhận bản vá này (chạm vào 자전거 trong lời thoại: popover mở, không sập, từ được ghi với `source` đúng là câu 21).

### M7.23 — Đề đọc đầy đủ đầu tiên: bốn thứ nó dạy (2026-11-08)

File `TOPIK_II_Test35_Reading_OfficialTest.docx` là đề **đọc** 50 câu đầu tiên. Lần `--diff` đầu: 43/50 câu, 7 lỗi. Bốn việc rút ra, mỗi việc một loại.

**1. Giới hạn ảnh 1600 → 1800, và con số là số đo.** Sáu câu (5-10) có ảnh rộng **đúng 1710px** — 1710×296 tới 1710×944, cùng một lần scan cắt theo chiều ngang cố định. 1600 chặn cả sáu. Thu nhỏ tay 6 ảnh × mỗi đề là việc lặp vô ích, nên nâng ngưỡng; 1800 là 1710 cộng một khoảng dư nhỏ, vẫn xa ảnh điện thoại (3000-4000px). Lần sau muốn nâng nữa thì cũng phải nêu được *đề nào, rộng bao nhiêu*.

**2. Một câu bị loại làm gộp nhầm hai cụm — và chốt chống lệch viết hôm qua bắt được ngay.** Câu 46 bị từ chối (một đoạn văn không thuộc phần nào), nên trong mảng còn lại câu 45 và 47 nằm cạnh nhau; 47 có dấu `CHUNG ĐOẠN` nên nối vào cụm của 44-45. Hai đoạn văn khác hẳn nhau (khí thải / sáp nhập công ty) thành một cụm. `driftNotes` in cả hai bản ra, đúng một lần chạy sau khi nó được viết.

`assignGroupKeys` ngắt chuỗi khi gặp câu không đánh dấu và khi đổi đề; thiếu vế thứ ba: **số hiệu không liền nhau**. Cả ba là một luật đọc cho chặt — dấu `CHUNG ĐOẠN` nghĩa là "chung với câu **ngay trước**", nên nó cần câu đó có mặt. Một câu rơi khỏi mảng vì lỗi parse là một câu không có mặt.

> Khi một danh sách bị lọc trước khi xử lý, mọi luật dựa trên "phần tử liền trước" đều thành sai âm thầm. Hoặc giữ chỗ trống, hoặc kiểm bằng dữ liệu của chính phần tử (ở đây là số hiệu câu).

**3. Câu `<보 기>`: quy ước đã có sẵn trong chính file đó.** Câu 46 là dạng "câu này đặt vào chỗ nào trong bài", nên có **một câu cho sẵn** nằm ngoài bảng → parser không có ô nào cho nó → lỗi cứng. Thoạt nhìn là một dạng câu hỏi mới cần quy ước mới. Nhưng câu **39, 40, 41** trong cùng file là **cùng dạng** và không hề lỗi, vì ở đó người gõ đặt câu ấy **bên trong ô đoạn văn**, sau một dòng `<보 기>`. Tức file đã có quy ước; câu 46 chỉ gõ lệch khỏi nó.

Vậy mà **không thể bê nguyên quy ước đó sang 46**, và lý do phải ghi lại kẻo ba tháng nữa có người "sửa cho đúng chỗ": **câu 47 dùng chung đoạn văn của 46** (`CHUNG ĐOẠN`, ô stem trống) và `inheritStem` chép stem sang. Mọi thứ bỏ vào ô đó đều chảy sang 47 — kể cả câu chèn chỉ thuộc về 46, và nó sẽ hiện ngay dưới đoạn văn như thể là một phần của bài đọc. Câu 39-41 không dính vì mỗi câu một đoạn văn riêng, không ai kế thừa ai.

Cách làm: một hàm tách duy nhất, `splitBoxedSentence` (`shared/topik.ts`), và **mọi nơi đọc stem đều tách qua nó**:
- `inheritStem` chỉ chép **phần đoạn văn**, nên 47 nhận đúng bài đọc, không nhận câu chèn;
- `driftNotes` so **phần đoạn văn**, nếu không chốt chống lệch sẽ kêu ở mọi cặp kiểu này;
- `sharedStem` (màn hình) so phần đoạn văn → vẫn vẽ đoạn văn **một lần** cho cả cụm, còn `ownStemBesideShared` giữ cái hộp `<보 기>` ở lại với câu của nó.

Giữ nguyên dòng nhãn `<보 기>` trong phần hộp: đó là nhãn của chính đề thi, không chữ nào của ta dễ nhận ra hơn với người đang đi thi.

Phương án bị loại, và vì sao: nhét câu chèn vào đoạn `HỎI:` thì nó thành một phần `instruction`, mà `instruction` **in đậm toàn bộ** ở cả bốn chỗ hiển thị. Chụp màn hình 375px cho thấy ba dòng đậm liền nhau, câu chèn đọc thành "đề bài dài" chứ không ra "câu rời cần đặt vào chỗ nào". Sửa bằng cách in đậm dòng đầu thôi thì **ngược vai trò** — dòng đầu là `[46~47] … (각 2점)`, dòng hai mới là lệnh thật. Cách còn lại (đậm tới hết dòng kết thúc bằng 십시오, dùng lại `POLITE_IMPERATIVE` đã có) chạy được, nhưng để lại **hai quy ước cho một dạng câu trong cùng một file** — thứ sẽ gây rối ở chỗ không ai nghĩ tới.

**4. `CANONICAL_EXAM`: hai tên cho một kỳ thi — và vì sao nó KHÁC `FIXED_NUMBER_INSTRUCTION` đã gỡ.** Đề đọc 35회 đã có 20 câu trong kho dưới nhãn `8DeOfficial-35회` (từ các file mảnh), còn file đầy đủ này cho nhãn `OfficialTest-35회`. Đối chiếu từng câu: **cùng câu, cùng đáp án**, và bản mới còn sửa một lỗi chính tả (`사용기도` → `사용되기도`).

Cái bẫy sâu hơn vẻ ngoài: bước bỏ qua trùng lặp khớp theo `(section, exam, number)`, nên sau khi đổi nhãn 20 câu cũ sang `OfficialTest-35회`, **một lần `--apply` thường** lên file mảnh cũng sẽ **chèn mới 20 câu trùng** — không cần `--force`, không cảnh báo nào, và báo cáo gọi chúng là việc mới.

Hai cách hiển nhiên đều hỏng: gỡ nhóm 35회 khỏi từng file mảnh thì nhiều file, dễ sót, và vẫn hỏng nếu sau này ai đó gõ lại; để nguyên thì nuôi một quả mìn. Cách chọn là **bảng đồng nghĩa** một dòng, áp ngay chỗ tính nhãn, in ra báo cáo mỗi lần áp dụng. Sai cũng không sinh dữ liệu trùng — hai nhãn hội tụ, nên lần nhập sau là *bỏ qua vì đã có*.

> **Bảng này không phải `FIXED_NUMBER_INSTRUCTION` thứ hai**, và khác ở chỗ quyết định: bảng kia là **nguồn sự thật thứ hai** cho một thông tin vốn phải nằm trong file Word (đề bài của một câu) — nên nó che lỗi trong file, và cách đúng là sửa file rồi xoá bảng (M7.7). Bảng này giữ thứ **không file nào nói ra được**: việc hai nguồn là hai tên của cùng một kỳ thi là chuyện **giữa các file**, không file nào biết file kia tồn tại. Một bên là ghi đè, một bên là từ điển đồng nghĩa. Ai đó về sau định "gỡ nốt mấy bảng vá" thì dừng ở đây.

Chọn `OfficialTest-35회` làm nhãn chuẩn vì **băng nghe 35회 đã mang đúng nhãn đó** — sau này ghép đề đọc và đề nghe của cùng một kỳ vào một bài thi thử thì chúng khớp sẵn.

**Kết quả sau cả bốn:** 49/50 câu nhập được (còn câu 46 chờ sửa file), 0 cảnh báo lệch, độ phủ chạy liền tới câu 45, và file mảnh giờ báo đúng một dòng *"8DeOfficial-35회 được xếp vào OfficialTest-35회"* thay vì âm thầm dựng một đề song song.

### M7.24 — Khoảng câu tự chọn, ôn thẳng một câu, và ai được quyền nói "lượt này không tính" (2026-11-12)

Hai tính năng nhỏ, một luật lớn đi kèm.

**Luật: một lượt trả lời được tính khi và chỉ khi câu đó đang đến hạn** (hoặc chưa từng làm — lần trả lời đầu tiên chính là thứ lịch giãn cách cần). Tính theo **từng câu**, và do **server** quyết.

Trước đây `schedule` do **client gửi lên** (`TopikSession.tsx` gửi `schedule: mode === "due"`) và server dùng thẳng. Hai chỗ hỏng: một lỗi ở client — hoặc một bản cũ còn chạy trên điện thoại — ghi được trạng thái FSRS cho câu chưa tới hạn mà không ai phát hiện; và một phiên trộn lẫn (khoảng câu gõ tay, hay "Ôn câu này") thì *bất kỳ* lựa chọn chung nào cũng sai cho một nửa số câu. Server có thẻ và có đồng hồ của chính nó; đó là chỗ duy nhất không thể nói dối. `isDueNow` (`topikScheduling.ts`) là một định nghĩa, hai người đọc: xếp thứ tự phiên, và quyết định tính/không tính lúc chấm.

Trường `schedule` **bị bỏ khỏi API**. Zod không `.strict()` nên một bản cũ gửi lên thì nó bị bỏ qua và nhận luôn hành vi mới — không có cửa sổ hỏng giữa hai bản.

**Đổi hành vi có chủ ý:** phiên `mode=all` ("Luyện lại dù chưa đến hạn") trước kia không tính **gì cả**, kể cả câu đang đến hạn. Nay câu đến hạn **có** tính — trả lời một câu đã đến hạn *là* một lượt ôn thật, vứt nó đi là mất dữ liệu thật. `mode=all` từ nay chỉ còn một nghĩa: *chọn cả câu chưa đến hạn vào phiên*. Hai test cũ mã hoá luật cũ đã được viết lại theo luật mới, không phải xoá.

`GET /topik/session` trả thêm `counts_toward_schedule` cho **từng câu** — **chỉ để hiển thị**: màn hình gắn nhãn "Không tính vào lịch ôn" lên đúng thẻ câu đó và đếm thành một băng ("1 câu trong lượt này…"). Server vẫn quyết lại lúc nhận câu trả lời. Hai bên chỉ lệch nhau nếu một câu **đến hạn ngay giữa phiên** — cách nhau hàng giờ theo thiết kế, và khi đó tôi chọn để server đúng hơn là để nhãn đúng.

**Khoảng câu tự chọn** (`/topik`): ô chọn đề ("Tất cả đề" mặc định) + thẻ nhập khoảng, cả hai trạng thái nằm trong URL. Ô chọn đề áp cho **cả** danh sách khối lẫn thẻ khoảng — một ô điều khiển, một phạm vi, thay vì một bộ lọc chỉ ăn nửa màn hình.

`GET /topik/practice-range` là endpoint riêng chứ không dùng chung với `GET /topik/tests/range`, và lý do là một khác biệt thật chứ không phải tiện tay: **lỗ hổng chỉ là lỗ hổng bên trong một đề**. Bài thi thử phủ một đề nên thiếu câu 17 là không thi được; còn luyện khoảng 16-18 gom từ *mọi* đề thì một đề thiếu câu 17 chỉ nghĩa là đề đó chưa gõ xong, từ chối luyện vì thế là sai. Nên `missing_number` chỉ báo khi đã chọn một đề; chọn tất cả thì trả về bảng phân bổ theo đề.

**Ôn thẳng một câu:** không có endpoint mới, không có nhánh code riêng. Nút "Ôn câu này" chỉ là một liên kết tới `?from=N&to=N&mode=all&exam=…`; luật nới cụm tự kéo cả cụm vào nếu câu đó dùng chung đoạn văn hay đoạn băng.

**Và một lỗi cũ được sửa nhân tiện:** truy vấn phiên lọc `number BETWEEN from AND to` rồi mới gộp cụm, nên một dải kết thúc giữa cụm **cắt đôi cụm** — hỏi câu 19 thì nhận đúng câu 19, câu 20 biến mất. Sửa không phải bằng luật mới: nới cửa sổ truy vấn thêm `TOPIK_MAX_GROUP_SPAN` = 3 (cụm dài nhất là 48-50) rồi chạy **đúng `expandToGroups`** mà bài thi thử dùng từ M7.14. `topikGroupsOf` giờ là một định nghĩa cho cả ba chỗ nới dải.

**Kiểm trên trình duyệt** (D1 local, hai đề đọc): khoảng 16→18 báo "6 câu — 8DeOfficial-35회 (3) · OfficialTest-35회 (3)"; khoảng 19→19 báo "đã nới thành 19–20 (thêm câu 20)" và mở ra đúng cả cặp; "Ôn câu này" trên câu 19 (vừa trả lời, chưa tới hạn) hiện băng **"1 câu…"** chứ không phải 2 — vì câu 20 chưa từng làm nên vẫn tính — và sau khi trả lời, `due` và `reps` của câu 19 **không đổi**, lịch sử có đúng một lượt `scheduled=1` và một lượt `scheduled=0`.

### M7.25 — Hai file cùng ghi một câu trong một lần chạy (2026-11-12)

Bảy đề đọc đầy đủ (36, 37, 41, 47, 52, 60, 64회) nhập theo đúng quy trình 35회: thêm nhãn chuẩn, đổi nhãn hàng cũ, rồi ghi đè. Nhưng bước cuối suýt chạy sai, và chỗ sai là một lỗ hổng thật do chính `CANONICAL_EXAM` mở ra.

**Tình huống:** sau khi đổi nhãn, **file mảnh cũng cho ra `OfficialTest-<N>회`** — đó là mục đích của bảng nhãn. Nghĩa là một lần chạy **không lọc file** chứa cả file mảnh lẫn file đề đầy đủ, hai bên cùng sinh ra `(reading, OfficialTest-36회, #1)`.

**Script xử lý thế nào:** `run.ts` đọc hàng hiện có **một lần, trước mọi lần ghi** (`rows: ImportRow[]`). Nên hai bản nháp cùng khoá đều cầm **cùng một `existing`**:
- có hàng sẵn + `--force` → **cả hai cùng `UPDATE` một `id`, bản chạy sau thắng, không ai báo gì**;
- chưa có hàng → cả hai cùng `INSERT`, chỉ mục duy nhất ném lỗi giữa chừng.

Cái thứ nhất mới đáng sợ: thứ tự thắng thua phụ thuộc `readdir`, và **file mảnh là bản kém hơn** — thua ván đó nghĩa là bản đầy lỗi gõ đè lên bản vừa sửa. Không có cảnh báo nào.

**Vá:** `duplicateKeys` (`scripts/topikImport/plan.ts`) chạy **trước chốt phạm vi, trước sao lưu, trước mọi lần ghi**: hai bản nháp cùng `(section, exam, number)` thì từ chối cả lần chạy, nêu tên câu và **cả hai file**. Đặt trước cả nhánh `--diff` nữa, vì một bảng `--diff` dựng từ hai file so vào cùng một hàng là bảng nói dối.

Chạy thử ngay trên dữ liệu thật: **126 câu** bị trùng khoá (106 câu vừa đổi nhãn + 20 câu của 35회). Lỗ hổng không phải giả thuyết, nó đã nằm sẵn trong kho từ lúc bảng nhãn ra đời.

> Một bảng đồng nghĩa làm hai thứ **cố ý** hội tụ về một khoá. Lợi ích là không còn dữ liệu trùng; cái giá là từ nay *trong một lần chạy* cũng có thể có hai nguồn cho một hàng. Thêm luật hội tụ mà không thêm luật phát hiện va chạm là mở một cửa sau.

**Chi tiết đáng nhớ thứ hai:** `--file TOPIK_II_Test` khớp **8 file, không phải 7** — 35회 cũng mang tên đó. Vô hại (50 hàng của nó đã trùng khít, `--diff` xác nhận 156 so được nhưng chỉ 106 đổi), nhưng con số in ra là `8 of 30` và phải đọc đúng nó trước khi ghi chứ không phải đọc cái mình mong đợi.

**Kết quả:** 8 đề đọc × 50 câu = **400 câu**, ghi đè 156, chèn mới 244, giữ nguyên 156 câu đã duyệt. Nội dung mới sửa một loạt lỗi gõ của bản cũ (`컴표터`→`컴퓨터`, `우제국`→`우체국`, `이백만 월`→`이백만 원`, `했빛`→`햇빛`, `고르시시오`→`고르십시오`), trong đó vài lỗi nằm ngay trong đáp án.

**Và một bài học nhỏ về test:** năm test "đọc số kỳ thi từ tiêu đề" đỏ ngay khi bảy số thật vào bảng nhãn, vì chúng dùng chính 36/37/41회 làm ví dụ. Đổi sang **91/92/93회** — những số không phải đề thật và sẽ không bao giờ vào bảng. Một test minh hoạ luật A không nên mượn dữ liệu mà luật B cũng nhận.

### Model chính hết hạn mức, và ba lần thử lại biến nó thành lỗi của tính năng khác (2026-11-15)

**Triệu chứng nhìn từ ngoài:** không có. Mọi thứ "chạy": từ vựng và giải thích TOPIK vẫn hiện ra, chỉ là chậm, và thỉnh thoảng không có. Thứ lộ ra nó là một con số tình cờ nhìn thấy trong `ai_cache`: 757 trên 846 mục do model **dự phòng** trả lời.

**Số đo (chỉ SELECT trên production, rồi `wrangler tail` một phiên luyện tập thật):**

| | |
|---|---|
| Mục `ai_cache` do model chính trả lời, 8–15/10 | 52 / 86 |
| Như trên, 1–15/11 (không có script hàng loạt nào chạy) | **4 / 330** |
| Một phiên đọc câu 1–10 lúc 03:19 UTC: lượt gọi model chính | 31, **cả 31 đều 429 `RESOURCE_EXHAUSTED`**, kể cả lượt đầu tiên; 0 lượt 503 |
| Kết quả của phiên đó | 7, đều do model dự phòng |
| Lượt sinh trong phiên ra được kết quả, 1–15/11 | từ vựng 190 / 328 (58%), **giải thích 66 / 307 (21%)** |
| Dòng cuối của log phiên đó, ở +30,0 giây | `waitUntil() tasks did not complete within the allowed time … cancelled` |

**Cơ chế:** 429 nằm trong danh sách "tạm thời, thử lại". Nên mỗi kết quả tốn bốn lượt gọi model chính (1 + 3 lần thử lại, chờ 1 + 3 + 9 giây) trước khi model dự phòng được hỏi. Một câu cần từ vựng rồi giải thích đi qua vòng đó **hai lần nối tiếp**: 27–33 giây, đúng mép giới hạn ~30 giây của việc chạy nền. Giải thích là thứ chạy sau nên là thứ bị cắt. Câu bị cắt giữ `explain_checked_at = null`, phiên sau lại thử, lại tốn bốn lượt.

**Giả thuyết đầu sai một nửa, và phải đo mới biết.** Giả thuyết: phiên bắn ~20 lượt cùng lúc → vượt giới hạn theo phút → thử lại đốt hạn mức ngày. Log bác phần đầu: lượt gọi **đầu tiên** của phiên, sau ít nhất ba phút Worker không gọi Gemini lần nào, đã bị 429. Giới hạn theo phút thì lượt đầu phải qua. Và model chính gần như không bao giờ trả lời, kể cả ngay sau giờ đặt lại hạn mức ngày (từ 19/10: 8 lần, rải ở các giờ bất kỳ). Khớp hơn là khoá này gần như không còn hạn mức miễn phí cho model đó. Loại hạn mức chính xác lúc ấy **không đọc được**, vì dòng log cắt message của Google ở 300 ký tự, dừng đúng ở `Quota exceeded for metric: generativelangua`.

**Đã sửa (`worker/services/llmRetry.ts`, `llm.ts`):**
- 429 không thử lại model chính, chuyển thẳng sang model dự phòng. 500/503/lỗi mạng giữ nguyên ba lần thử lại.
- Sau một lần 429, bỏ qua model chính 10 phút (`isModelExhausted`, theo khuôn M2.9 của Workers AI): theo isolate, không bền, và chỉ áp dụng khi có model dự phòng để chuyển sang.
- Dòng log của lỗi 429 giữ tên hạn mức sau ` | quota: `, nằm ngoài chỗ cắt 300 ký tự.

> **Một lỗi "tạm thời" và một lỗi "hết hạn mức" trông giống nhau ở mã HTTP nhưng cần hai phản xạ ngược nhau.** Thử lại là đúng với 503 và là đổ thêm dầu với 429. Gộp chúng vào một danh sách là quyết định hợp lý lúc viết — khi model chính còn hạn mức — và không ai xem lại khi điều kiện đổi.

> **Cơ chế dự phòng hoạt động tốt thì che mất việc thứ chính đã hỏng.** Không có gì báo lỗi suốt một tháng vì model dự phòng luôn đỡ được. Một con số "bao nhiêu phần trăm do dự phòng trả lời" nhìn thấy được ở đâu đó (màn "AI status" hiện chỉ nói về lượt gọi cuối) sẽ lộ chuyện này từ tuần đầu.

**Chưa làm:** đưa tỉ lệ dự phòng lên màn "AI status"; và 102 câu có nội dung AI cũ nhưng `*_checked_at` null (văn bản đã đổi sau các lần nhập lại) sẽ tự sinh lại khi vào phiên — 54 từ vựng và 81 giải thích sẽ gọi Gemini, mỗi câu một lần.
