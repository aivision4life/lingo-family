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
- [ ] Add a word: choose language, type the term → **AI enrich** fills reading, glosses (vi/en/ko), part of speech, Hanja/Hanzi, Hán-Việt, 2–3 example sentences with translations, and an emoji suggestion.
- [ ] Preview and edit before saving.
- [ ] Words are a **shared family library**. Decks group words (e.g. "IT Korean", "Animals for kids").
- [ ] Search/filter by language, deck, tag.
- [ ] Duplicate detection (same language + same term).
- [ ] Adding a word to a deck creates cards for every profile that studies that deck.

**Done when:** typing `학생` and pressing "Add" produces a complete entry like the example in §3 within ~5 seconds, with audio playable.

### F3. Media: audio & images — P0 (audio), P1 (images)
- [ ] Audio generated by TTS for the word and each example sentence. Generate once, store in R2, cache on device.
- [ ] Audio playback speed: 1.0× and 0.75×.
- [ ] Image priority: emoji (free, instant) → user-uploaded image (resized to WebP ≤ 512px) → (P2) stock-photo search.
- [ ] Media is **content-addressed**: the same text + voice always maps to the same file (no duplicates).

### F4. Review with spaced repetition (FSRS) — P0
- [ ] Scheduling uses the `ts-fsrs` library. Ratings: Again / Hard / Good / Easy.
- [ ] Card types per word (each scheduled independently):
  - **Recognition**: see word (+ audio auto-play) → recall meaning. P0
  - **Listening**: hear audio only → recall word and meaning. P0
  - **Speaking**: see image/meaning → say the word aloud → automatic score (see F5), then self-rate. P1
- [ ] Daily queue = due reviews + up to N new cards (per-profile limit).
- [ ] Keyboard shortcuts on PC (Space = flip, 1–4 = rating); large tap targets on phone.
- [ ] Works **offline**: reviews are stored locally and synced when online.
- [ ] Each review is logged (for stats and FSRS optimization later).

**Done when:** a profile can complete a 20-card session on a phone in airplane mode, and the results appear on another device after reconnecting.

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
- [ ] Enrichment (used by F2) returns **strict JSON** validated by a schema; invalid output → one retry → error message.
- [ ] Example sentences match the profile's level: kid → very short and concrete; beginner → simple; Korean (owner) → workplace/IT context allowed.
- [ ] "Explain" button on a card: short explanation in the profile's `gloss_lang` (nuance, common collocations, confusing look-alikes).
- [ ] All AI output is cached in the database. The same request is never paid for twice.

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
| Azure Speech: TTS | Generate audio once per text | Cache-first; never re-generate an existing key |
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

- Which LLM provider to use as default (Gemini free tier vs Claude)? Keep it switchable by env var.
- Is the Hán-Việt quality from the LLM good enough, or should we import an open Hán-Việt dictionary dataset?
- Should kids' profiles get an English or a Korean UI by default?
- Should the wife's profile have specific goals/levels? (Not yet specified.)
