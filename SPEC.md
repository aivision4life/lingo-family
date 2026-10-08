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
- [ ] Access to the whole app is protected by Cloudflare Access (family email allow-list). There is no in-app password system.

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

**Done when:** two profiles on the same device have completely separate review queues.
(Verified in M1.4: profiles cannot see or answer each other's cards.)

### F2. Word library, phrases & decks — P0
- [x] Add a word: choose language, type the term → **AI enrich** fills reading, glosses (vi/en/ko), part of speech, Hanja, Hán-Việt, example sentences with translations, an emoji, an **image prompt** for the word and each example, and **1–3 suggested phrases**. *(image prompts and phrases: M1.7–M1.8; from M1.7: **2 examples per word, 1 example per phrase**; M1.2 produced 2–3 per word)*
- [x] Preview and edit before saving.
- [ ] **Phrases:** the Add word screen lists the AI-suggested phrases (each with reading, glosses, 1 example); the adult ticks which ones to keep. Phrases that are not ticked are not saved (and never drawn). Kept phrases are saved with the word, linked to it as root word, and get their own cards. Phrases can also be added later from Word detail.
- [~] Words and phrases are a **shared family library**. Decks group words (e.g. "IT Korean", "Animals for kids"). (M1.4: one default deck per language; phrases follow the deck of their root word.)
- [~] Search/filter by language, deck, tag. (M1.2: language + text search done; deck/tag filters later. Search also matches phrases from M1.7.)
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

**Done when:** typing `학생` and pressing "Add" produces a complete entry like the example in §3 within ~5 seconds, with audio playable; images appear shortly after (background generation).

### F3. Media: audio & images — P0
Audio:
- [~] Audio generated by TTS for every word, phrase and example sentence. Generate once, store in R2, cache on device. (M1.3: words + examples; browser HTTP cache; offline cache with F11. Phrases from M1.7.)
- [x] Audio playback speed: 1.0× and 0.75×.
- [x] Media is **content-addressed**: the same text + voice always maps to the same file (no duplicates).

Images (M1.8):
- [ ] Every word, phrase and example sentence has an image. Sources:
  1. **AI drawing** with Cloudflare Workers AI (FLUX) through the `env.AI` binding — the default.
  2. **"My photo"**: the adult uploads a picture; the browser resizes it to ≤ 512 px (WebP) **before** uploading.
  3. While an image is not ready (or failed), the **emoji** is shown as a placeholder.
- [ ] Every image has a **"Redraw"** button with an editable prompt, and a **"My photo"** button (adults only).
- [ ] The prompt is built from the item's `image_prompt` (from Gemini, see F6) plus a **fixed style**:
  `flat vector illustration, bright colors, simple shapes, plain background, no text, no letters`.
- [ ] **When images are drawn:** right after saving, the **word** and its **selected phrases** are drawn. **Example sentence** images are drawn **lazily**, the first time the sentence is displayed. Unselected phrases are never drawn.
- [ ] Generation runs **in the background with Workers `waitUntil`** (Cloudflare Queues later). Image status per item: `none` (lazy, not requested yet) → `pending` → `ready` | `failed`. The UI shows the emoji placeholder and updates automatically when the image is ready; `failed` shows a **"Try again"** button (plus "Redraw" with an editable prompt).
- [ ] Stored in R2, **content-addressed**; an image that already exists is never drawn again. `image_prompt` and `image_source` (`ai` | `upload`) are stored with the item.
- [ ] Daily quota: service `image` in `usage_daily`, default **60 images per profile per day**, plus a **family-wide daily cap** derived from the Workers AI free tier (provisional 150/day, must be measured in practice; see §7).

Decisions (M1.3):
- TTS: Azure Speech REST, output `audio-24khz-48kbitrate-mono-mp3` (mp3, mono, 24 kHz).
- Default voices (in code): `ko-KR-SunHiNeural`, `en-US-JennyNeural` (*superseded:* `zh-CN-XiaoxiaoNeural` / `TTS_VOICE_ZH` are removed in M1.6). Override with `vars` in `wrangler.jsonc`: `TTS_VOICE_KO`, `TTS_VOICE_EN`. A different voice gives different files (the voice is part of the key).
- R2 key: `audio/{lang}/{voice}/{sha1(text)}.mp3`, text normalized (NFC, trimmed). If the key already exists, Azure is not called.
- Audio is generated **while saving a word** (the word and each example; phrases and their examples from M1.7). If TTS fails or the quota is reached, the item is still saved without audio, a light notice is shown, and a **"Generate audio"** button on Word detail fills in what is missing.
- Daily quota: **200 Azure TTS calls per profile per day** (`usage_daily`, service `tts`). Existing files in R2 do not count.
- Playback speed (1.0× / 0.75×) uses the browser's `playbackRate`; no extra files. The choice is remembered per device.
- Media is served by `/api/media/...` with immutable cache headers, so the browser keeps it; full offline caching comes with F11 (M2).

Decisions (2026-10-08, images):
- AI image R2 key: `images/ai/{sha1(model + full prompt incl. style + style_version + seed + size)}.webp|jpg`. The first drawing uses a fixed seed; **"Redraw"** uses a new random seed (and/or the edited prompt), so it produces a new key.
- Uploaded image R2 key: `images/upload/{sha1(file bytes)}.webp`. The server checks type (WebP/JPEG/PNG) and size (≤ 512 px, ≤ ~300 KB).
- Image size 512×512. Images are not regenerated when only glosses or translations change.
- Kid profiles cannot redraw or upload (a kid's first display of an example may still trigger its lazy drawing, charged to the family cap).
- Old images are **kept** in R2 after "Redraw" / "My photo" (no deletion); only the item's `image_key` changes.
- Model: start with **`@cf/black-forest-labs/flux-1-schnell`**. M1.8 includes a **benchmark script** that draws 5 sample prompts with `flux-1-schnell` and `flux-2-klein-4b`, records Neurons per image and saves the images to a folder for a side-by-side comparison; the final model and family cap are chosen from it.

### F4. Review with spaced repetition (FSRS) — P0
- [x] Scheduling uses the `ts-fsrs` library. Ratings: Again / Hard / Good / Easy.
- [~] Card types per word **and per phrase** (each scheduled independently):
  - **Recognition**: see the word/phrase (+ audio auto-play) → recall meaning. P0 (M1.4 for words)
  - **Picture**: see the image only → recall the word/phrase (and meaning). P0 (M1.9)
  - **Listening**: hear audio only → recall word/phrase and meaning. P0 (M1.4 for words)
  - **Speaking**: see image/meaning → say the word aloud → automatic score (see F5), then self-rate. P1
- [ ] **Unlock order: recognition → picture → listening.** A new card of the next type only becomes available after the previous type's card of the same item has been reviewed at least once.
- [x] Daily queue = due reviews + up to N new cards (per-profile setting, applied per language).
- [x] Keyboard shortcuts on PC (Space = flip, 1–4 = rating); large tap targets on phone.
- [ ] **Visual review screen (M1.9):** the image is the centre of the card. Back side: word/phrase, reading, meaning, audio, Hanja/Hán-Việt, and the example sentences, each with a small image + audio button.
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
- [x] Example sentences match the profile's level: kid → very short and concrete; beginner → simple; Korean (owner) → workplace/IT context allowed.
- [ ] Enrichment also returns (M1.7–M1.8): an **`image_prompt`** for the word, each example and each phrase; **1–3 suggested phrases**, each with reading, glosses, 1–2 examples (with translations and `image_prompt`).
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
- [ ] Installable (manifest, icons), opens full-screen.
- [ ] App shell and the current profile's due cards + media (audio **and images**) are cached for offline use.
- [ ] Sync queue: offline reviews and edits are uploaded when back online. Conflict rule: review logs are append-only; for edits, last write wins.

---

## 5. Data model (Cloudflare D1 / SQLite)

Target model after M1.6–M1.9. Changes vs. the current schema are marked `← M1.x`.

```
profiles      id, name, avatar, ui_lang ('vi'|'ko'|'en'), gloss_lang ('vi'|'ko'|'en'), is_kid,
              pin_hash?, daily_new_limit, study_langs (json, subset of ['ko','en']) ← M1.6, created_at

words         id, lang ('ko'|'en') ← M1.6, term, reading, pos,
              gloss_vi, gloss_en, gloss_ko,
              hanja? ← M1.6 (renamed from hanzi_traditional; hanzi_simplified dropped), han_viet?,
              emoji?, audio_key?, notes?,
              image_key?, image_prompt?, image_source? ('ai'|'upload'),
              image_status ('pending'|'ready'|'failed') ← M1.8,
              ai_generated, verified, created_by_profile, created_at, updated_at
              UNIQUE(lang, term)

phrases       id, word_id → words (root word, ON DELETE CASCADE), lang, text, reading,  ← M1.7
              gloss_vi, gloss_en, gloss_ko, emoji?, audio_key?,
              image_key?, image_prompt?, image_source?, image_status,
              ai_generated, verified, created_by_profile, created_at, updated_at
              UNIQUE(lang, text)

examples      id, word_id? → words, phrase_id? → phrases ← M1.7,
              CHECK (exactly one of word_id / phrase_id),
              sentence, translation_vi, translation_en, translation_ko,
              audio_key?, level ('kid'|'beginner'|'intermediate'), ai_generated,
              image_key?, image_prompt?, image_source?,
              image_status ('none'|'pending'|'ready'|'failed') ← M1.8   -- 'none' = lazy, not requested yet

decks         id, name, lang, is_kid_deck, created_at     -- default decks: default-ko, default-en
deck_words    deck_id, word_id                          -- phrases follow their root word's decks
profile_decks profile_id, deck_id                       -- which decks a profile studies

cards         id, profile_id, word_id? → words, phrase_id? → phrases ← M1.7,
              CHECK (exactly one of word_id / phrase_id),
              card_type ('recognition'|'picture' ← M1.9|'listening'|'speaking'),
              <all fields of the ts-fsrs Card object: due, stability, difficulty, state, reps, lapses, ...>,
              updated_at
              UNIQUE(profile_id, word_id, card_type)   WHERE word_id IS NOT NULL
              UNIQUE(profile_id, phrase_id, card_type) WHERE phrase_id IS NOT NULL

review_logs   id, card_id, profile_id, rating, reviewed_at, duration_ms,
              <ts-fsrs ReviewLog fields>                -- append-only

pron_attempts id, profile_id, word_id?, phrase_id? ← M1.7, example_id?, lang, reference_text,
              pron_score, accuracy, fluency, completeness, details_json, created_at

han_chars     hanja (PK) ← M1.6/M4, han_viet, meaning_vi, ai_generated, verified
word_chars    word_id, position, hanja                  -- Korean words only (F7)

ai_cache      key (hash of task + input + model), response_json, created_at
usage_daily   date, profile_id, service ('tts'|'pron'|'llm'|'image' ← M1.8), count
```

Notes:
- New words and selected phrases start with `image_status = 'pending'`; new examples start with `'none'` and become `'pending'` when first displayed. `ready` when `image_key` is set; `failed` after the background job gives up ("Try again" sets it back to `pending`). Items saved before M1.8 get `pending` (words) / `none` (examples) via the migration and are drawn within quota.
- The family-wide image cap is checked as the sum of today's `usage_daily` rows with service `image` across all profiles (no new table).
- M1.6 data migration (destructive, approved 2026-10-08): delete `zh` words (cascades to examples, cards, review logs, deck links), the `default-zh` deck and its profile links; remove `zh` from `profiles.study_langs` (a profile left with no language gets `['ko']`); drop `words.hanzi_simplified`; rename `hanzi_traditional` → `hanja`; restructure `han_chars` / `word_chars` (empty so far); delete R2 objects under `audio/zh/`. `ai_cache` entries cannot be filtered by language (hashed keys), so the enrichment cache is cleared (the prompt version changes in M1.7 anyway).

Media storage (R2) keys:
- `audio/{lang}/{voice}/{sha1(text)}.mp3`
- `images/ai/{sha1(model + prompt + style_version + seed + size)}.{webp|jpg}`
- `images/upload/{sha1(file bytes)}.webp`

---

## 6. Screens

1. **Profile picker**
2. **Home** (per profile): today's due/new count per language, "Start review", "Practice speaking", streak
3. **Review session** (no navigation, Exit button): image-centred card front → flip → back with examples (small image + audio) → rating buttons; progress bar
4. **Word library**: list with thumbnail image (emoji while pending) + search + filters; words and phrases; "Add word"
5. **Add / edit word**: language + term → AI enrich preview → edit fields → tick suggested phrases → save (images then appear in the background)
6. **Word detail**: image (Redraw / My photo), audio, readings, glosses, Hanja/Hán-Việt, phrases (each with image, audio, meaning, examples), examples (each with image + audio + practice), related Hanja words
7. **Pronunciation practice**: reference audio, record button, colored result, history
8. **Hanja page** (F7): one Hanja character and the Korean words/phrases containing it
9. **Decks**: create, assign to profiles
10. **Settings** (profile and app)
11. **Stats** (P2)

Navigation (M1.5): Home, Review, Library, Settings (room reserved for a later "Hanja" item, F7), each with an icon + i18n label; the active item is highlighted. Desktop (≥ 768 px): collapsible left sidebar with the active profile's avatar + name at the top. Phones (< 768 px): fixed bottom tab bar, avatar + name in the top-right corner. Tapping the avatar opens the profile picker. A prominent "+" (add word) button: in the Library header, and as a floating button above the tab bar on phones. The review screen and the profile picker hide all navigation (review keeps only its Exit button).

Image editing (adults only): "Redraw" opens a small dialog with the editable prompt (style is appended automatically and not editable); "My photo" picks a file / camera photo, resizes it in the browser to ≤ 512 px WebP, then uploads.

Design: mobile-first, clean, images first, large Korean typography (Noto Sans KR), light + dark mode.

---

## 7. External services & limits

| Service | Use | Free-tier guard |
|---|---|---|
| Cloudflare Workers (+ static assets) | Hosts the SPA and `/api` | — |
| Cloudflare D1 | Database | — |
| Cloudflare R2 | Audio & images | Media is small (images 512 px WebP/JPEG; target total < 2 GB) |
| Cloudflare Workers AI (FLUX) | Image generation via the `env.AI` binding (word + selected phrases at save time, example sentences lazily) | Cache-first (content-addressed R2 key); never redraw an existing key; 60 images/profile/day + family cap (provisional 150/day; final value from the M1.8 benchmark). Free allocation: **10,000 Neurons/day** (checked 2026-10). `@cf/black-forest-labs/flux-1-schnell` at 512×512, 4 steps ≈ 4.8 + 4 × 9.6 ≈ **43 Neurons/image ⇒ ~230 images/day in theory**. **Must be measured in practice** (dashboard) before fixing the cap. |
| Cloudflare Access | Family-only login | Allow-list of family emails |
| Azure Speech: TTS | Generate audio once per text (words, phrases, examples) | Cache-first (R2 key = lang + voice + sha1(text)); never re-generate an existing key; 200 calls/profile/day. Free tier F0: 0.5M neural characters/month (checked 2026-10) |
| Azure Speech: Pronunciation Assessment | Speaking score | Per-profile daily quota (`usage_daily`) |
| LLM API (Gemini; Claude switchable) | Enrichment (incl. phrases + image prompts), examples, explanations | Cache-first (`ai_cache`), 50 calls/profile/day |

The browser gets a **short-lived Azure token** from `/api/speech-token`; API keys never reach the client. Workers AI is a binding (no API key).
Free-tier limits change, so check the providers' current pricing pages before relying on any number.

---

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
| M1.7 | Phrases | Phrases table, AI suggestions + selection, phrase audio/examples, phrase cards (recognition + listening) | [ ] |
| M1.8 | Image pipeline | Workers AI FLUX (benchmark flux-1-schnell vs flux-2-klein-4b), image prompts in enrichment, `waitUntil` background generation, lazy example images, R2, Try again / Redraw / My photo, quotas | [ ] |
| M1.9 | Picture card + visual review | `picture` card type, unlock chain recognition → picture → listening, image-centred review UI | [ ] |
| M2 | Online | Deploy to Cloudflare, Access login, F11 PWA + offline sync (incl. images) | [ ] |
| M3 | Speaking | F5 pronunciation scoring, speaking cards | [ ] |
| M4 | Family & Hanja | F8 kid mode, F7 Hanja links, F9 import + starter decks | [ ] |
| M5 | Insights | F10 stats, FSRS parameter optimization | [ ] |

---

## 10. Open questions

- ~~Which LLM provider to use as default (Gemini free tier vs Claude)?~~ **Decided (M1.2):** Gemini, model `gemini-3.8-flash` by default; switchable by `LLM_PROVIDER` / `LLM_MODEL`.
- Is the Hán-Việt quality from the LLM good enough, or should we import an open Hán-Việt dictionary dataset?
- Should kids' profiles get an English or a Korean UI by default?
- Should the wife's profile have specific goals/levels? (Not yet specified.)
- ~~Images per word?~~ **Decided (2026-10-08):** draw the word + selected phrases right away; example images lazily on first display; unselected phrases never; 2 examples per word, 1 per phrase.
- ~~FLUX model?~~ **Decided:** start with `flux-1-schnell`; M1.8 benchmark (5 prompts × `flux-1-schnell` / `flux-2-klein-4b`, Neurons per image, saved images) to choose the final model and family cap.
- ~~`waitUntil` vs Queues?~~ **Decided:** `waitUntil`; `failed` shows "Try again". Queues later if needed.
- ~~Old images after Redraw / My photo?~~ **Decided:** keep them in R2.
- ~~Phrase selection shared or per profile?~~ **Decided:** shared family library; cards per profile.
- ~~Do phrases count toward `daily_new_limit`?~~ **Decided:** yes, together with words.
- ~~Rename `hanzi_traditional` → `hanja`?~~ **Decided:** yes, in the M1.6 migration.
