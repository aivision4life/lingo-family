# SPEC — Family Language Learning App (Korean · Chinese · English)

> **What we are building.** This document describes the product: features, data, screens and acceptance criteria.
> For *how* to build it (stack, commands, coding rules) see `CLAUDE.md`.
> Status markers: `[ ]` not started · `[~]` in progress · `[x]` done. Update them as work progresses.

---

## 1. Overview

A personal, family-only Progressive Web App (PWA) for learning **Korean, Chinese (Simplified) and English**, focused on:

1. **Vocabulary**: remembering words long-term with spaced repetition (FSRS).
2. **Pronunciation**: hearing native-quality audio, recording yourself and getting an automatic score.

It is visual (images, large clear typography) and audio-first. It runs in the browser on PC and phone, can be installed to the home screen, and works offline for reviewing.

### Goals
- Daily review takes 10–15 minutes and feels smooth on a phone.
- Every word has audio. Most words have an image or emoji.
- Pronunciation feedback shows *which syllable/word* was wrong, not just a number.
- Cross-language links through Chinese characters (Sino-Korean ↔ Chinese ↔ Sino-Vietnamese) help Vietnamese speakers learn faster.
- Hosting cost stays at **$0** (free tiers); paid API usage stays under a few USD/month.

### Non-goals (for now)
- Public sign-up, multiple families, monetization.
- Grammar courses, long reading/listening lessons, chat tutor.
- Native mobile apps (the PWA is enough).

---

## 2. Users & profiles

The app is used by **one family** on shared or personal devices.

| Profile type | Example | Needs |
|---|---|---|
| Adult (owner) | Father: Korean TOPIK 3–4 (workplace/IT Korean), Chinese beginner, English beginner | Full features, word editing, AI enrichment, stats |
| Adult | Mother | Same as above, own progress |
| Kid | Young children | **Kid mode**: big images, audio-first, few buttons, no text-heavy screens, cannot edit/delete shared content |

Requirements:
- [x] Netflix-style **profile picker** (avatar + name). Decision (M1.1): the app opens the last used profile directly; the picker is opened from the top bar or on first run.
- [~] Each profile has its own: learning languages, SRS progress, pronunciation history, settings.
- [x] Per-profile settings: `ui_lang` (vi / ko / en), `gloss_lang` (meaning language shown on cards: vi / ko / en), daily new-card limit, kid mode on/off.
  - The daily new-card limit (`daily_new_limit`) is one profile setting applied **separately to each learning language**, and counts only new recognition cards (see F4).
  - Rationale: kids living in Korea may read Korean better than Vietnamese, so they may learn English with Korean glosses.
- [x] Optional 4-digit PIN on adult profiles (to stop kids from changing settings; not real security).
- [ ] Access to the whole app is protected by Cloudflare Access (family email allow-list). There is no in-app password system.

---

## 3. Languages & content conventions

| | Korean (`ko`) | Chinese (`zh`) | English (`en`) |
|---|---|---|---|
| Script | Hangul | **Simplified** characters | Latin |
| Reading | Revised Romanization (optional, can be hidden) | Pinyin **with tone marks** (nǐ hǎo) | IPA, US English |
| Chinese characters | Hanja (traditional) for Sino-Korean words | Simplified (+ traditional as secondary info) | — |
| Sino-Vietnamese | Hán-Việt reading when word is Sino-Korean | Hán-Việt reading | — |
| Default TTS voice | ko-KR neural voice | zh-CN neural voice | en-US neural voice |
| Pronunciation scoring locale | ko-KR | zh-CN | en-US |

Example of a fully enriched entry:

```
학생  [haksaeng]   學生   Hán-Việt: học sinh   →  student / học sinh
  ↔ zh: 学生 xuésheng
```

- AI-generated fields (readings, Hanja, Hán-Việt, glosses, examples) are marked `ai_generated = true` and can be edited by an adult. Hán-Việt and Hanja readings are error-prone, so they show a small "AI" badge until an adult confirms them.
- HTML text in CJK must carry the right `lang` attribute (`ko`, `zh-CN`) so the correct font glyphs are used.

---

## 4. Features

Priority: **P0** = MVP, **P1** = next, **P2** = later.

### F1. Profiles — P0
- [x] Create / edit / delete profile (adult only can delete).
- [x] Profile picker, remember last profile per device.
- [x] Per-profile settings listed in §2.

**Done when:** two profiles on the same device have completely separate review queues.
(All per-profile data is keyed by `profile_id`; this check is completed together with F4.)

### F2. Word library & decks — P0
- [x] Add a word: choose language, type the term → **AI enrich** fills reading, glosses (vi/en/ko), part of speech, Hanja/Hanzi, Hán-Việt, 2–3 example sentences with translations, and an emoji suggestion.
- [x] Preview and edit before saving.
- [~] Words are a **shared family library**. Decks group words (e.g. "IT Korean", "Animals for kids"). (M1.2: shared library done; decks come with F4.)
- [~] Search/filter by language, deck, tag. (M1.2: language + text search done; deck/tag filters later.)
- [x] Duplicate detection (same language + same term).
- [ ] Adding a word to a deck creates cards for every profile that studies that deck.

Decisions (M1.2):
- Only adult profiles can add words or call AI enrichment; kid profiles only browse the library.
- Terms are normalized before saving and duplicate checks (trim, collapse spaces, Unicode NFC). English duplicates are case-insensitive ("Apple" = "apple").
- The duplicate check runs **before** the AI call, so an existing word costs nothing and links to the existing entry.
- Words can also be entered by hand (no AI); then `ai_generated = false`. Saved AI entries keep `ai_generated = true, verified = false` even after edits, until an adult confirms them.
- After saving, the app opens a simple read-only **Word detail** screen (§6 screen 6). Editing a saved word comes later.

**Done when:** typing `학생` and pressing "Add" produces a complete entry like the example in §3 within ~5 seconds, with audio playable.

### F3. Media: audio & images — P0 (audio), P1 (images)
- [~] Audio generated by TTS for the word and each example sentence. Generate once, store in R2, cache on device. (M1.3: generated + stored in R2, browser HTTP cache; offline cache with F11.)
- [x] Audio playback speed: 1.0× and 0.75×.
- [ ] Image priority: emoji (free, instant) → user-uploaded image (resized to WebP ≤ 512px) → (P2) stock-photo search.
- [x] Media is **content-addressed**: the same text + voice always maps to the same file (no duplicates).

Decisions (M1.3):
- TTS: Azure Speech REST, output `audio-24khz-48kbitrate-mono-mp3` (mp3, mono, 24 kHz).
- Default voices (in code): `ko-KR-SunHiNeural`, `zh-CN-XiaoxiaoNeural`, `en-US-JennyNeural`. Override with `vars` in `wrangler.jsonc`: `TTS_VOICE_KO`, `TTS_VOICE_ZH`, `TTS_VOICE_EN`. A different voice gives different files (the voice is part of the key).
- R2 key: `audio/{lang}/{voice}/{sha1(text)}.mp3`, text normalized (NFC, trimmed). If the key already exists, Azure is not called.
- Audio is generated **while saving a word** (the word and each example). If TTS fails or the quota is reached, the word is still saved without audio, a light notice is shown, and a **"Generate audio"** button on Word detail fills in what is missing (also for words saved before M1.3).
- Daily quota: **200 Azure TTS calls per profile per day** (`usage_daily`, service `tts`). Existing files in R2 do not count.
- Playback speed (1.0× / 0.75×) uses the browser's `playbackRate`; no extra files. The choice is remembered per device.
- Audio is served by `/api/media/...` with immutable cache headers, so the browser keeps it; full offline caching comes with F11 (M2).

### F4. Review with spaced repetition (FSRS) — P0
- [x] Scheduling uses the `ts-fsrs` library. Ratings: Again / Hard / Good / Easy.
- [~] Card types per word (each scheduled independently): (M1.4: recognition + listening done; speaking in M3)
  - **Recognition**: see word (+ audio auto-play) → recall meaning. P0
  - **Listening**: hear audio only → recall word and meaning. P0
  - **Speaking**: see image/meaning → say the word aloud → automatic score (see F5), then self-rate. P1
- [x] Daily queue = due reviews + up to N new cards (per-profile setting, applied per language).
- [x] Keyboard shortcuts on PC (Space = flip, 1–4 = rating); large tap targets on phone.
- [ ] Works **offline**: reviews are stored locally and synced when online.
- [x] Each review is logged (for stats and FSRS optimization later).

**Done when:** a profile can complete a 20-card session on a phone in airplane mode, and the results appear on another device after reconnecting.

Decisions (M1.4):
- Minimal decks: one default deck per language (ids `default-ko`, `default-zh`, `default-en`). Every word is in the deck of its language. A profile studies the default decks of its `study_langs`; cards (recognition + listening) are created automatically, also for words saved earlier. Removing a language unlinks the deck but keeps the cards and their progress.
- Scheduling: `ts-fsrs` with library default parameters (learning steps 1m/10m, relearning 10m, retention 0.9) and **fuzz off**, so the interval shown under each rating button equals the server result. The server computes the schedule and is the authority for `review_logs` (also after offline sync in M2).
- A new **listening** card only becomes available after the recognition card of the same word has been reviewed at least once.
- Daily queue for one language = due cards (learning cards up to 20 min ahead) + up to `daily_new_limit` new **recognition** cards minus those already introduced today in that language. New listening cards do not count toward the limit.
- "Today" starts at local midnight of the device (the client sends its UTC offset).
- Cards answered "Again" (or still in learning steps) come back in the same session when due within 20 minutes.
- The session starts after choosing a language; the review screen has an Exit button back to Home.
- Dev time travel: while running locally, a small panel (only in `import.meta.env.DEV`) shifts "today"; it sends `X-Dev-Now`, which the server reads **only** when `DEV_TIME_TRAVEL=1` (in `.dev.vars`). Production always ignores it.
- Not in M1.4: kid mode (F8), speaking cards (M3), offline sync (M2).

### F5. Pronunciation practice & scoring — P1
- [ ] Practice screen: play reference audio → press-and-hold (or tap) to record → show score.
- [ ] Scoring via Azure Speech **Pronunciation Assessment** with reference text: overall score plus accuracy, fluency and completeness.
- [ ] Color each word/syllable by score: green ≥ 80, yellow 60–79, red < 60. Use the most detailed level the locale returns (phoneme → syllable → word) and degrade gracefully.
- [ ] "Compare" button: play reference, then own recording.
- [ ] History per word: last scores and best score. List of "my weakest words/sounds".
- [ ] Practice can target a single word or an example sentence.
- [ ] **Privacy:** voice recordings stay on the device only (IndexedDB, last 5 per word). The server stores scores, never audio.
- [ ] Per-profile daily scoring quota (default 100 attempts) to stay inside the free tier.

**Done when:** recording `사과` with a clearly wrong vowel shows a red syllable and a lower score than a correct recording.

### F6. AI examples & explanations — P0 (enrich), P1 (explain)
- [x] Enrichment (used by F2) returns **strict JSON** validated by a schema; invalid output → one retry → error message.
- [x] Example sentences match the profile's level: kid → very short and concrete; beginner → simple; Korean (owner) → workplace/IT context allowed.
- [ ] "Explain" button on a card: short explanation in the profile's `gloss_lang` (nuance, common collocations, confusing look-alikes).
- [~] All AI output is cached in the database. The same request is never paid for twice. (M1.2: enrichment cached; "Explain" comes with P1.)

Decisions (M1.2):
- Provider: **Gemini** (`LLM_PROVIDER=gemini`), default model **`gemini-3.8-flash`** (override with `LLM_MODEL`). The LLM client is behind an interface so Claude can be added later.
- Example level is chosen on the Add word screen: kid / beginner / intermediate (workplace/IT allowed). Default: kid for kid profiles, beginner for adults. The level is part of the cache key.
- Cache key = hash of task + prompt version + model + language + term + level. Only valid (schema-checked) output is cached.
- Daily quota: **50 LLM calls per profile per day** (`usage_daily`, service `llm`). Cache hits do not count.
- Field conventions: `ko` → Revised Romanization, Hanja in `hanzi_traditional` (+ simplified form), Hán-Việt for Sino-Korean words; `zh` → pinyin with tone marks, `hanzi_simplified` = the term, traditional form, Hán-Việt; `en` → US IPA, no Hanzi/Hán-Việt. A gloss in the word's own language is a short definition; an example's translation into its own language is left empty.
- Privacy note: on the Gemini free tier Google may use submitted content to improve its products. Only vocabulary is sent (no personal data).

### F7. Chinese-character links (Hanja / Hanzi / Hán-Việt) — P1
- [ ] Each Sino-Korean / Chinese word is split into its characters. Each character stores: simplified, traditional, Hán-Việt reading, Vietnamese meaning.
- [ ] Character page: e.g. `學 / 学 – học` lists every word in the library containing it, across Korean and Chinese.
- [ ] On a card, show "related words" sharing a character (max 5).

**Done when:** opening `学` shows both `학생 (學生)` and `学生 xuésheng`, linked by "học".

### F8. Kid mode — P1
- [ ] Image/emoji fills most of the card. Audio plays automatically. Text is minimal.
- [ ] Only 2 ratings: 😊 "I know" (= Good) / 🤔 "Not yet" (= Again).
- [ ] No edit, delete, settings or AI buttons.
- [ ] Short sessions (default 10 cards), with a simple reward animation at the end.
- [ ] Optional "say it" game: kid says the word, a star appears if the score ≥ 60 (lenient threshold).

### F9. Import & starter content — P1
- [ ] Import CSV/TSV (columns: term, gloss, optional reading, tags) → AI enrich in batch.
- [ ] Starter decks generated with AI + reviewed by an adult: "Korean IT/office words", "Chinese HSK-1 style basics", "English basics", "Kids: animals, food, colors, numbers".
- [ ] (P2) Import Anki `.apkg`.
- Note: before bundling any official word list (TOPIK, HSK, etc.), check its license.

### F10. Progress & stats — P2
- [ ] Per profile: streak, reviews per day, words by state (new / learning / mature), retention rate.
- [ ] Pronunciation trend per language.
- [ ] (P2) Chinese tone practice: draw the pitch contour of the recording against the reference.

### F11. PWA & offline — P0
- [ ] Installable (manifest, icons), opens full-screen.
- [ ] App shell and the current profile's due cards + media are cached for offline use.
- [ ] Sync queue: offline reviews and edits are uploaded when back online. Conflict rule: review logs are append-only; for word edits, last write wins.

---

## 5. Data model (Cloudflare D1 / SQLite)

```
profiles      id, name, avatar, ui_lang, gloss_lang, is_kid, pin_hash?, daily_new_limit,
              study_langs (json), created_at

words         id, lang ('ko'|'zh'|'en'), term, reading, pos,
              gloss_vi, gloss_en, gloss_ko,
              hanzi_simplified?, hanzi_traditional? (= Hanja for ko), han_viet?,
              emoji?, image_key?, audio_key, notes?,
              ai_generated, verified, created_by_profile, created_at, updated_at
              UNIQUE(lang, term)

examples      id, word_id → words, sentence, translation_vi, translation_en, translation_ko,
              audio_key, level ('kid'|'beginner'|'intermediate'), ai_generated

decks         id, name, lang, is_kid_deck, created_at
deck_words    deck_id, word_id
profile_decks profile_id, deck_id            -- which decks a profile studies

cards         id, profile_id, word_id, card_type ('recognition'|'listening'|'speaking'),
              <all fields of the ts-fsrs Card object: due, stability, difficulty, state, reps, lapses, ...>,
              updated_at
              UNIQUE(profile_id, word_id, card_type)

review_logs   id, card_id, profile_id, rating, reviewed_at, duration_ms,
              <ts-fsrs ReviewLog fields>                -- append-only

pron_attempts id, profile_id, word_id?, example_id?, lang, reference_text,
              pron_score, accuracy, fluency, completeness, details_json, created_at

han_chars     char_simplified, char_traditional, han_viet, meaning_vi, ai_generated, verified
word_chars    word_id, position, char_simplified

ai_cache      key (hash of task + input + model), response_json, created_at
usage_daily   date, profile_id, service ('tts'|'pron'|'llm'), count
```

Media storage (R2) keys:
- `audio/{lang}/{voice}/{sha1(text)}.mp3`
- `images/{word_id}/{sha1(file)}.webp`

---

## 6. Screens

1. **Profile picker**
2. **Home** (per profile): today's due count per language, "Start review", "Practice speaking", streak
3. **Review session**: card front → flip → rating buttons; progress bar
4. **Word library**: list + search + filters; "Add word"
5. **Add / edit word**: term input → AI enrich preview → edit fields → save
6. **Word detail**: audio, image, readings, glosses, examples (each with audio + practice), related characters
7. **Pronunciation practice**: reference audio, record button, colored result, history
8. **Character page** (F7)
9. **Decks**: create, assign to profiles
10. **Settings** (profile and app)
11. **Stats** (P2)

Design: mobile-first, clean, large CJK typography (Noto Sans KR / Noto Sans SC), light + dark mode.

---

## 7. External services & limits

| Service | Use | Free-tier guard |
|---|---|---|
| Cloudflare Workers (+ static assets) | Hosts the SPA and `/api` | — |
| Cloudflare D1 | Database | — |
| Cloudflare R2 | Audio & images | Media is small (target total < 2 GB) |
| Cloudflare Access | Family-only login | Allow-list of family emails |
| Azure Speech: TTS | Generate audio once per text (word + examples, when a word is saved) | Cache-first (R2 key = lang + voice + sha1(text)); never re-generate an existing key; 200 calls/profile/day. Free tier F0: 0.5M neural characters/month (checked 2026-10) |
| Azure Speech: Pronunciation Assessment | Speaking score | Per-profile daily quota (`usage_daily`) |
| LLM API (Gemini or Claude, configurable) | Enrichment, examples, explanations | Cache-first (`ai_cache`), daily cap |

The browser gets a **short-lived Azure token** from `/api/speech-token`; API keys never reach the client.
Free-tier limits change, so check the providers' current pricing pages before relying on any number.

---

## 8. Non-functional requirements

- **Privacy:** family data only; voice recordings never leave the device except for the scoring request; no analytics/trackers.
- **Performance:** first load < 3 s on 4G; card flip < 100 ms; audio starts < 300 ms when cached.
- **Offline:** review works offline (F4, F11).
- **Cost:** $0 hosting; paid APIs < ~5 USD/month for the family.
- **Accessibility:** tap targets ≥ 44 px; works with keyboard on PC.

---

## 9. Milestones

| # | Milestone | Contents | Status |
|---|---|---|---|
| M0 | Scaffold | Project setup, DB schema + migrations, i18n, empty screens, runs locally | [x] |
| M1 | MVP (local) | F1 profiles, F2 add word + AI enrich, F3 TTS audio, F4 recognition + listening review | [~] |
| M2 | Online | Deploy to Cloudflare, Access login, F11 PWA + offline sync | [ ] |
| M3 | Speaking | F5 pronunciation scoring, speaking cards | [ ] |
| M4 | Family & characters | F8 kid mode, F7 character links, F9 import + starter decks, F3 images | [ ] |
| M5 | Insights | F10 stats, tone contour, FSRS parameter optimization | [ ] |

---

## 10. Open questions

- ~~Which LLM provider to use as default (Gemini free tier vs Claude)?~~ **Decided (M1.2):** Gemini, model `gemini-3.8-flash` by default; switchable by `LLM_PROVIDER` / `LLM_MODEL`.
- Is the Hán-Việt quality from the LLM good enough, or should we import an open Hán-Việt dictionary dataset?
- Should kids' profiles get an English or a Korean UI by default?
- Should the wife's profile have specific goals/levels? (Not yet specified.)
