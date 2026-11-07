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
- [ ] Per-profile daily scoring quota (default 100 attempts) to stay inside the free tier.

**Done when:** recording `사과` with a clearly wrong vowel shows a red syllable and a lower score than a correct recording.

### F6. AI enrichment & explanations — P0 (enrich), P1 (explain)
- [x] Enrichment (used by F2) returns **strict JSON** validated by a schema; invalid output → one retry → error message.
- [x] **Content sanity check (M2.11):** the schema only checks shape, not script — it missed a stray Latin letter inside a Korean sentence ("이야기에 a 빠져들다..."). Every vi/en/ko string the LLM generates (word & phrase glosses, example sentences and their translations, a typed sentence's AI translations/suggested rewrite) is also checked for the wrong script (`worker/services/contentCheck.ts`): Korean text must be Hangul (digits/punctuation/common loanword acronyms like TV/AI allowed; a lone Latin letter is always wrong), English text must not contain Hangul/Han/Kana, Vietnamese text must not contain Hangul. A violation shares the schema's one-retry budget (`generateStructured`'s optional `validateContent`); if it is still wrong afterwards, that one example/phrase/suggestion is dropped (logged, never saved) rather than failing the whole enrichment — a required, non-droppable field (e.g. a word's own gloss) is only logged. `npm run scan-llm-content` lists (never fixes) existing rows that would be flagged.
- [x] Resilient LLM calls: 429/500/503 and network errors are retried 3 times (backoff 1s, 3s, 9s with jitter), then the optional `LLM_FALLBACK_MODEL` is tried once; 400/401/403 are not retried. Retries and the fallback do not use extra quota. `ai_cache.model` records the model that answered. If the AI is still busy, the UI says "AI is busy, try again in a few minutes" with a **Try again** button and keeps what was typed.
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
- [x] No AI in this phase; no daily quota (images are not AI-drawn, just optionally uploaded with the import or the manual form, so quota doesn't apply). Images use the same R2 upload/validation as elsewhere (`storeUploadedImage()`), but with their own, looser size limit (scans need to stay legible): ≤ 1600 px, ≤ ~1 MB (`TOPIK_IMAGE_MAX_SIDE` / `TOPIK_IMAGE_MAX_BYTES`, `shared/topik.ts`).
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
- [x] **Mock test, stage 1: one real paper (M6.4).** `/topik/tests` lists every paper whose questions **and** clips are approved, with 20 / 30 / whole-paper buttons — a length the paper cannot fill is shown greyed with the reason ("đề này mới có 12 câu"), and a paper whose numbering has a hole offers nothing at all, because "questions 1-20" has to really be 1-20 (`isContiguousFromOne`). Each paper carries its own history line. **The audio is the clock**: no countdown of our own, one span of one mp3 from the first clip's start to the last clip's end — the approval rules guarantee an exam's clips are contiguous, so the tape runs straight through the answering silences at the paper's own pace (`audioSpan`, `useTestTape`, its own `<audio>` rather than the shared player, which anything in the app may stop). No replay, no speed, no seeking; flipping back to change an earlier answer *is* allowed, as it is on paper. Pausing is allowed and never blocked — studying happens after work — but each pause is counted and the result says the sitting was not under exam conditions. The end of the tape submits it; leaving part way cancels it after a confirmation, and a cancelled sitting **answers 410 rather than its result**, or starting and cancelling a test would be a way to read the answer key. Scores are **raw** ("6/24 điểm") and only shown out of 100 for a full 50-question paper. Each question's worth comes from its instruction's own `각 N점` (`pointsFromInstruction`, `topik_questions.points`, default 2), correctable by hand on the review screen for a paper that slips in a 3-point question without saying so. Every answer feeds the FSRS schedule with `scheduled = 1`: a timed sitting is the truest recall test there is.
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
| Azure Speech: Pronunciation Assessment | Speaking score | Per-profile daily quota (`usage_daily`) |
| LLM API (Gemini; Claude switchable) | Enrichment (incl. phrases + image prompts), examples, explanations | Cache-first (`ai_cache`), 50 calls/profile/day |

The browser gets a **short-lived Azure token** from `/api/speech-token`; API keys never reach the client. Workers AI is a binding (no API key).
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
| M3 | Speaking | F5 pronunciation scoring, speaking cards | [ ] |
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
