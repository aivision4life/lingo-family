# CLAUDE.md — Instructions for AI coding assistants

This file is read automatically at the start of every session. Follow it strictly.
**What** to build is in `SPEC.md`. **How** to build it is described here.

## Project in one paragraph
A family-only PWA for learning **Korean and English** vocabulary, phrases and pronunciation, picture-first (every word, phrase and example sentence has an image).
Chinese was removed from the product on 2026-10-08 and from the code/DB in M1.6 — don't add `zh` code back.
Frontend: React + TypeScript. Backend: one Cloudflare Worker (serves the SPA and `/api`), D1 database, R2 media storage.
External: Azure Speech (TTS + Pronunciation Assessment), an LLM API (Gemini) for enrichment, Cloudflare Workers AI (FLUX) for images. Hosting must stay on free tiers.

## Communication
- The owner is an experienced programmer (Python / Computer Vision) who is new to web development.
- **Talk to the user in Vietnamese.** Code, comments, commit messages and docs stay in English.
- When introducing a web concept for the first time (e.g. service worker, CORS, migration), add a 1–2 sentence explanation.
- If a request is unclear or conflicts with `SPEC.md`, ask before coding.

## Tech stack (do not change without asking)
| Area | Choice |
|---|---|
| Build | Vite + `@cloudflare/vite-plugin` |
| UI | React 19, TypeScript (strict), Tailwind CSS, shadcn/ui, lucide-react icons |
| Routing | React Router |
| Server state | TanStack Query |
| Local storage / offline | Dexie (IndexedDB) + `vite-plugin-pwa` (Workbox) |
| i18n | `react-i18next`; locales `vi` (default), `ko`, `en` |
| SRS | `ts-fsrs` (never hand-write scheduling logic) |
| API | Hono on Cloudflare Workers |
| Database | Cloudflare D1 + Drizzle ORM + drizzle-kit migrations |
| Validation | `zod`, schemas shared between client and server |
| Speech | `microsoft-cognitiveservices-speech-sdk` (browser) with token from `/api/speech-token` |
| Images | Cloudflare Workers AI (FLUX, `env.AI` binding) for AI drawings; client-side resize of uploads with Canvas (no image library) |
| Tests | Vitest (unit), Playwright (e2e, from M2) |
| Scripts | Python 3.11+ in `scripts/` (batch TTS, imports, data prep) |

Ask before adding any new dependency. Prefer small, well-maintained packages.

## Folder structure
```
src/              React app (pages/, components/, features/<feature>/, lib/, i18n/)
worker/           Hono API (routes/, services/azure.ts, services/llm.ts, middleware/)
shared/           zod schemas + TypeScript types used by both sides
db/               drizzle schema.ts + migrations/
scripts/          Python helper scripts (+ requirements.txt)
public/           icons, manifest assets
SPEC.md  CLAUDE.md  README.md
```

## Commands
- `npm run dev`: Vite dev server on http://localhost:5173 — SPA + Worker (`/api/*`) with local D1/R2 (Miniflare, data in `.wrangler/state`)
- `npm run build`: typecheck (`tsc -b`) + production build into `dist/`
- `npm run preview`: build, then serve the production build locally
- `npm run typecheck` / `npm run lint` / `npm test` (`npm run test:watch` for watch mode)
- `npm run db:generate -- --name <short_name>`: create a migration in `db/migrations/` from `db/schema.ts`
- `npm run db:migrate:local` / `npm run db:migrate:remote`: apply pending migrations to D1
- `npm run cf-typegen`: regenerate `worker-configuration.d.ts` (the `Env` type) after editing `wrangler.jsonc` or `.dev.vars`
- `npm run deploy`: build + `wrangler deploy` (needs a real `database_id` in `wrangler.jsonc`, see M2)
- `npm run bench:images`: M1.8A image benchmark (Gemini image prompts + FLUX models), output in `benchmarks/report.html`
- Add a shadcn component: `npx shadcn@latest add <name>` (then keep tap targets >= 44px)

## Project setup notes
- Path aliases: `@/` → `src/`, `@shared/` → `shared/`, `@db/` → `db/` (in `vite.config.ts`, `vitest.config.ts`, `tsconfig.base.json`). Worker and `db/` code use relative imports.
- TypeScript projects: `tsconfig.app.json` (src + shared, DOM), `tsconfig.worker.json` (worker + shared + db, Workers runtime), `tsconfig.node.json` (config files).
- i18n: `src/i18n/locales/{vi,ko,en}.json`; `vi` is the source of truth for key types. A unit test enforces identical keys and placeholders.
- npm 11 blocks install scripts by default; allowed packages are listed in `package.json` → `allowScripts` (`esbuild`, `workerd`).
- shadcn/ui uses the `cn` package (from shadcn-ui) instead of `clsx` + `tailwind-merge`.
- API: validate with `zv(target, schema)` from `worker/lib/validate.ts`; errors are `{ error, issues? }` (`shared/api/error.ts`). Client calls go through `api()` in `src/lib/api.ts` (validates responses with zod) and TanStack Query hooks in `src/features/<feature>/api.ts`.
- API tests run the Hono app against a real in-memory local D1 via `createTestEnv()` (`worker/test/testEnv.ts`, uses wrangler's `getPlatformProxy`; `@cloudflare/vitest-pool-workers` does not support Vitest 5).
- LLM: `worker/services/llm.ts` (`LlmClient` interface, Gemini via REST `generateContent` + `responseJsonSchema`, `generateStructured()` = zod-validated JSON with one retry, returns `{ data, model }`). Transient errors (429/500/503, network, timeout) are retried 3× with backoff 1s/3s/9s ± 25 % jitter (`worker/services/llmRetry.ts`), then `LLM_FALLBACK_MODEL` gets one try; 400/401/403 fail at once (`rejected` → `ai_rejected`). `ai_cache.model` records the model that answered; the cache key keeps the primary model. The quota is consumed once per cache miss, never per retry. Tests inject `fetch`/`sleep` into `createLlmClient(env, opts)`. Enrichment prompt in `worker/services/enrichPrompt.ts`: bump `ENRICH_PROMPT_VERSION` when the prompt or output schema changes (it is part of the `ai_cache` key).
- The Worker app is built by `createApp({ makeLlm, makeTts })` (`worker/app.ts`). `getPlatformProxy` loads `.dev.vars` (real keys), so in tests **always** build the app with `testApp({...})` from `worker/test/testEnv.ts` (paid clients default to null) and inject fakes (`worker/test/fakeLlm.ts`, `fakeTts.ts`). Never call `createApp()` directly in a test: it would use real Gemini/Azure.
- TTS: `worker/services/tts.ts` (Azure REST, voices from `voiceFor()`), `worker/services/audio.ts` (`generateWordAudio()`: R2 `head` first, Azure only on a miss, never throws for TTS errors). Audio is served by `GET /api/media/audio/...` with immutable cache headers; the client plays it through the shared player in `src/features/audio/player.ts`.
- Daily quotas: `consumeQuota()` in `worker/lib/quota.ts` (atomic upsert on `usage_daily`, UTC day).
- Review/FSRS: pure rules in `shared/scheduling.ts` (`scheduler` with fuzz off, `applyReview`, `previewIntervals`, `buildQueue`, `localDayStart`), used by both the Worker (authority) and the client (previews). `worker/services/review.ts` → `syncProfileCards()` (idempotent: default decks `default-{lang}`, deck_words, profile_decks, missing cards) runs on every `/api/review/summary|queue` call. M1.9: picture cards exist only for items with a ready image; unlock chain recognition → picture → listening via `QueueCandidate.prev_state`; face rules in `src/features/review/cardFace.ts`, preloading in `preload.ts`.
- Dev time travel: client `src/lib/devClock.ts` (only when `import.meta.env.DEV`) sends `X-Dev-Now`; the Worker reads it via `resolveNow()` only when `DEV_TIME_TRAVEL=1` in `.dev.vars`. `createTestEnv(app, vars)` forces `DEV_TIME_TRAVEL=0` unless a test passes it.
- Navigation (M1.5): items in `src/components/layout/navItems.ts` (a slot is reserved for a later "Hanja" item). Desktop (≥ 768px, `md:`): collapsible left sidebar with the profile avatar at the top; phones: bottom tab bar + top bar with the avatar, and a floating "+" (add word) button. Screens that need focus (review) use `FocusLayout` (no navigation; the page has its own Exit button); the profile picker is outside the app layout.
- Images (M1.8): columns `image_*` on words/phrases/examples (`db/schema.ts` → `imageColumns()`). Worker: `worker/services/imageStore.ts` (R2 key, conditional-UPDATE claims, `finishImage` guarded by `image_nonce`), `imageJobs.ts` (`drawClaimedItem`: R2 head → `consumeImageQuota` → klein → schnell), `imageBackfill.ts`, routes `worker/routes/images.ts` (`ensure`/`retry`/`redraw`/`upload`/`backfill`, `GET /api/usage`). Only draw an item after winning `claimImage()`. Client: `src/features/images/` (`ItemImage` shows image or emoji and triggers lazy/stalled drawing, `ImageTools` for adults, `pollWhilePending` as `refetchInterval`). `createApp({ makeImageAi })`; tests use `fakeImageAi()` and `t.settle()` to await `waitUntil` work.
- Active profile: `useActiveProfile()` (`src/features/profiles/activeProfile.ts`); the UI language follows the active profile's `ui_lang`. Use `canManageProfiles()` to hide edit/delete/settings for kid profiles.

## Workflow for every task
1. Read the relevant section of `SPEC.md`. Restate the plan in a few bullet points (in Vietnamese) before large changes.
2. Work on **one feature or sub-feature at a time**. Keep changes small.
3. Write or update tests for logic (scheduling, sync, parsing, API validation).
4. Run `typecheck`, `lint` and `test`. Fix all errors before saying a task is done.
5. Update the status checkboxes in `SPEC.md`.
6. Summarize what changed and how to try it manually.
7. Suggest a commit message; do not commit unless asked.

## Coding rules
- TypeScript `strict`; no `any` (use `unknown` + zod parsing).
- Validate every API input and every LLM output with zod. LLM output must be strict JSON. On invalid output: retry once, then return an error.
- **No hard-coded UI strings.** Everything goes through i18n (`vi`, `ko`, `en`).
- Put Korean text (incl. Hanja) in elements with `lang="ko"` and use Noto Sans KR.
- Every `<img>` of a study item has alt text (its gloss) and is lazy-loaded in lists; show the item's emoji while `image_status` is `pending` or `failed`.
- Mobile-first layout; tap targets ≥ 44 px; check every screen at 375 px width.
- Feature code lives in `src/features/<feature>/`; shared UI goes in `src/components/`.
- Keep the Worker stateless; all state lives in D1/R2.

## Database rules
- Schema lives only in `db/schema.ts`. Change it, then generate a migration with drizzle-kit.
- **Never edit a migration that has already been applied.** Create a new one.
- Ask before any schema change that drops or renames columns.
- Store ts-fsrs `Card` and `ReviewLog` fields exactly as the library defines them.
- `review_logs` is append-only. Its `card_id` becomes NULL when a card is deleted; use `review_logs.lang` for per-language counts.
- Words vs phrases (option A): `cards.word_id` / `examples.word_id` always hold the **root word**; `phrase_id` is set for phrase rows (NULL = the word itself). Filter word-only rows with `phrase_id IS NULL`.
- Hand-written triggers live in the migration SQL (`0002_phrases.sql`); drizzle-kit does not know about them. `db/migrations.test.ts` runs all migrations and checks that the triggers exist and work. If a later migration rebuilds `cards`, `examples` or `phrases`, recreate the triggers there.
- Before applying migrations locally: stop the dev server, export the DB into `backups/` (gitignored) and compare row counts before/after.

## Secrets & security
- Secrets (`AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION`, `LLM_API_KEY`, `LLM_PROVIDER`, `LLM_MODEL`, `LLM_FALLBACK_MODEL`) go in `.dev.vars` locally and in `wrangler secret` in production.
- **Never** put secrets in frontend code, in `wrangler.jsonc` vars, or in git. Keep `.dev.vars` in `.gitignore`.
- The browser only receives short-lived Azure tokens from `/api/speech-token`.
- In production, the Worker verifies the Cloudflare Access JWT (`Cf-Access-Jwt-Assertion`) on every `/api` request (`worker/middleware/access.ts`, installed first in `createApp()`): signature via the team JWKS, `iss`, `aud`, `exp`, then the email against `ALLOWED_EMAILS` (secret, comma separated). **Fail-closed**: missing JWT or missing `ACCESS_TEAM_DOMAIN` / `ACCESS_AUD` / `ALLOWED_EMAILS` → 401, email not allowed → 403. The verified email is `c.get("userEmail")`.
- `DEV_AUTH_BYPASS=1` (local `.dev.vars` only) skips the check, and `DEV_TIME_TRAVEL=1` enables `X-Dev-Now`, **only when `new URL(request.url).hostname` is localhost / 127.0.0.1 / [::1]** (`worker/lib/localDev.ts`; never trust the Host header). Never set either in production. Tests run at `http://localhost` with the bypass on (`createTestEnv`); `worker/middleware/access.test.ts` tests the gate with a fake JWKS.
- `workers_dev` is the only hostname; `preview_urls` is off in `wrangler.jsonc`.

## Cost rules (free tiers)
- **Cache first** for every paid call: TTS audio (R2 key = hash of lang + voice + text), LLM responses (`ai_cache`).
- Never regenerate media that already exists.
- **Images (Workers AI):** primary model `flux-2-klein-4b` (512×512, ≈ 26 Neurons), fallback `flux-1-schnell` (≈ 58 Neurons, no seed, 1024×1024). Content-addressed R2 key = sha1(model + full prompt + style version + nonce + size) (nonce: "0" first, random per Redraw; flux-1-schnell has no seed, see SPEC F3). Check R2 before calling `env.AI`. The fixed style suffix (`flat vector illustration, bright colors, simple shapes, plain background, no text, no letters, family-friendly, safe for children`) lives in one constant (`IMAGE_STYLE` in `worker/services/imagePrompt.ts`) with `IMAGE_STYLE_VERSION`; changing it means bumping the version, never silently redrawing existing images.
- Image generation after saving runs with `waitUntil` (never inside the save request; ~30 s limit, stalled items are taken over after 2 min). Redraw / Try again / lazy examples / backfill draw inside their own request. Always idempotent: a retried job finds the existing R2 object and only updates the row.
- Image quota: `usage_daily` service `image`, 60/profile/day **and** a family-wide daily cap (sum over profiles; provisional 150, measure Neurons in the dashboard before changing). Count only real `env.AI` calls; R2 hits are free.
- Uploads ("My photo") are resized in the browser to ≤ 512 px WebP before upload; the Worker re-checks type and size and never re-encodes.
- Enforce daily quotas per profile through `usage_daily` (pronunciation, LLM, TTS).
- Batch jobs (e.g. TTS for a whole deck) go through Python scripts in `scripts/`, not through the UI.

## Privacy rules
- Voice recordings stay on the device (IndexedDB, keep only the last 5 per word). Only scores go to the server.
- No analytics, trackers or third-party scripts.
- Kid profiles cannot edit, delete, change settings or call AI features.

## Don'ts
- Don't change the tech stack, folder structure or data model without asking.
- Don't implement features that are not in `SPEC.md` ("nice to have" ideas → suggest them instead).
- Don't remove or skip failing tests to make the build pass.
- Don't write large files in one go. Split them into components or modules (< ~250 lines each).

## Lessons learned
- `npx shadcn add <x>` may ask to overwrite `button.tsx`: answer **no** (`echo n | npx shadcn add <x>`), it has custom 44px sizes. Check new components for hard-coded English strings (e.g. "Close" in `dialog.tsx`).
- Don't `disable` an input while checking it asynchronously (it loses focus); use `readOnly`.
- Gemini can return 503 "high demand" or take 30s+ under load. The shared client retries (see LLM above) within a 100 s budget, 45 s per attempt; set `LLM_FALLBACK_MODEL=gemini-3.5-flash-lite` in `.dev.vars` so a busy primary falls back. The UI shows "AI is busy" + a Try again button (`isRetryableAiError()`); a button inside a `<form>` needs `type="button"` or it also submits the form.
- Homonyms (e.g. 사과 = apple / apology) made the LLM mix meanings with one Hanja; the prompt now asks for the most common meaning only.
- drizzle's `db.batch()` on D1 cannot run raw `db.run(sql\`...\`)` statements with parameters (`stmt` is undefined). For raw SQL batches use the D1 API: `env.DB.batch([env.DB.prepare(...).bind(...)])`.
- `drizzle-kit generate` asks interactively when a column is renamed (it cannot be answered here). Write a custom migration instead: `npx drizzle-kit generate --custom --name <x>`, put the SQL in it, then copy the table definitions of a reference snapshot (generate the current schema into a temp `out` dir) into the new `meta/000N_snapshot.json`, keeping its `id`/`prevId`; `npm run db:generate` must then report "No schema changes". Test the migration in `db/migrations.test.ts`.
- Workers AI (`env.AI`) has no local simulator: it always runs on Cloudflare, so `npm run dev` needs `npx wrangler login` once (otherwise the remote proxy session fails). Tests call `getPlatformProxy({ remoteBindings: false })` so they never need login or touch Workers AI.
- Scripts that need Worker code (TypeScript) run through `benchmarks/run.mjs` (Vite's `runnerImport`, no extra TS runner).
- `getPlatformProxy().env` bindings are not enumerable: `{...env}` / `Object.assign({}, env)` drops them; use `Object.create(env)` to add overrides.
<!-- Add a line here whenever the AI repeats a mistake, e.g.:
- Always use `lang="ko"` on Korean text (fixed glyph bug on 2026-10-xx). -->
