# CLAUDE.md — Instructions for AI coding assistants

Loaded on every message, so it stays short. **What** to build is in `SPEC.md`. Details of every
module, command and past incident are in `DEV-NOTES.md`. Both files are large: search them for
the section you need and read only those lines, never the whole file.

## Project
Family-only PWA for learning **Korean and English** (words, phrases, example sentences,
pronunciation, TOPIK II practice), picture-first. No Chinese (`zh`) code, ever.
React + TypeScript SPA and one Cloudflare Worker (Hono) serving the SPA and `/api`; D1 + Drizzle;
R2 for media. External: Azure Speech (TTS, Pronunciation Assessment), Gemini (LLM), Workers AI
(FLUX images). Production: https://lingo.ai4life.workers.dev behind Cloudflare Access.
Everything must stay on free tiers.

## Talking to the owner
- **Vietnamese.** Code, comments, commit messages and docs stay in English.
- The owner is an experienced programmer (Python / Computer Vision), new to web development.
  The first time a web concept comes up, explain it in 1–2 sentences.
- Request unclear or in conflict with `SPEC.md`: ask before coding.
- **Reports are short**: at most ~15 lines. Start with the outcome, then only what the owner must
  decide or do. No tables unless asked, no restating the request, no list of every file touched.

## Keep token use low
- Search `SPEC.md`, `DEV-NOTES.md` and big test files (`topik*.test.ts`); never read them whole.
- No browser testing, screenshots or mutation testing unless the owner asks for it.
- While working, run the affected test file or `npm run test:unit`. Run the full `npm test`
  (plus `typecheck` and `lint`) once, right before a commit or deploy.
- One task per session.

## Stack (ask before changing it or adding any dependency)
Vite + `@cloudflare/vite-plugin` · React 19, TS strict, Tailwind, shadcn/ui, lucide-react ·
React Router · TanStack Query · `vite-plugin-pwa` (Workbox) · `react-i18next` (`vi` default,
`ko`, `en`) · `ts-fsrs` (never hand-write scheduling) · Hono · D1 + Drizzle + drizzle-kit ·
`zod` shared by client and server · Azure Speech REST called **only by the Worker** (no SDK, no
token endpoint) · Workers AI via `env.AI` · Vitest.

## Folders
`src/` app (`pages/`, `components/`, `features/<feature>/`, `lib/`, `i18n/`) · `worker/` API
(`routes/`, `services/`, `middleware/`, `lib/`, `test/`) · `shared/` zod schemas and pure rules ·
`db/` `schema.ts` + `migrations/` · `scripts/` one-off tools · `data/`, `backups/` gitignored.

## Commands (full list and every script's flags: `DEV-NOTES.md` → "Commands")
- `npm run dev` → http://localhost:5173 with local D1/R2 and a fake image provider
- `npm run typecheck` · `npm run lint` · `npm run test:unit` (fast) · `npm test` (full, ~70 s)
- `npm run db:generate -- --name <name>` · `npm run db:migrate:local` / `:remote`
- `npm run cf-typegen` after editing `wrangler.jsonc` or `.dev.vars`
- `npm run deploy` (build + `wrangler deploy`)
- One-off scripts (`topik-*`, `migrate:content`, …) are a **dry run by default**; `--apply`
  backs up production D1 into `backups/` first. Read the script's entry in `DEV-NOTES.md` first.

## Workflow
1. Read the relevant `SPEC.md` section. Before a large change, state the plan in a few
   Vietnamese bullets.
2. One feature or fix at a time, small changes.
3. Tests for logic (scheduling, parsing, API validation, quotas). A display decision with more
   than two branches goes in a pure function so it can be tested.
4. `typecheck`, `lint`, full `npm test` clean before saying it is done.
5. Update the status checkboxes in `SPEC.md`.
6. Short summary + how to try it. Suggest a commit message; commit only when asked.

## Rules
- TS strict, no `any` (`unknown` + zod). Validate every API input and every LLM output with zod.
- No hard-coded UI strings: everything through i18n in all three locales.
- Korean text in `lang="ko"` elements. Mobile-first, check at 375 px, tap targets ≥ 44 px.
- Worker stays stateless; state lives in D1/R2.
- **Database:** schema only in `db/schema.ts`, then a drizzle-kit migration. Never edit an
  applied migration. Ask before dropping or renaming columns. `review_logs` is append-only.
  `cards.word_id` / `examples.word_id` always hold the root word (`phrase_id` set for phrases).
  Hand-written triggers live in `0002_phrases.sql`.
- **Production D1: back it up before every write** (scripts do it; do it by hand otherwise).
- **Secrets** only in `.dev.vars` (local) and `wrangler secret` (production). Never in frontend
  code, `wrangler.jsonc` vars, git, logs or chat. Every `/api` route is behind the fail-closed
  Access check; `DEV_AUTH_BYPASS` / `DEV_TIME_TRAVEL` work only on localhost.
- **Cost:** cache first for every paid call (TTS in R2, LLM in `ai_cache`); never regenerate
  existing media; enforce daily quotas through `usage_daily`; only a successful paid call is
  counted (refund on failure). Limits live in `shared/*.ts` constants, change them only there.
- **Privacy:** voice recordings stay on the device; only scores reach the server. No analytics.
  Kid profiles cannot edit, delete, change settings or call AI generation; pronunciation
  scoring is allowed for them on a smaller quota.
- **Copyright:** TOPIK papers are copyrighted. `data/`, `backups/`, `.wrangler/` and `.dev.vars`
  are never committed.
- Don't implement features that are not in `SPEC.md` (suggest them instead). Don't skip or
  delete failing tests to make the build pass. Keep files under ~250 lines.

## Pitfalls that already broke something (details in `DEV-NOTES.md` → "Lessons learned")
- **Windows path casing:** always work from `D:\DEV\lingo-family` exactly; a differently cased
  path made Vite bundle React twice.
- **Tests never call `createApp()`**: build the app with `testApp({...})` from
  `worker/test/testEnv.ts` and inject the fakes, or the test hits real Gemini/Azure.
- **D1 binds at most 100 parameters per statement**: chunk multi-row INSERTs and long `IN (...)`.
- `npx shadcn add`: answer **no** to overwriting `button.tsx` (custom 44 px sizes).
- `topik-import --force` without `--section` is refused on purpose; don't work around it.
- An automatic boundary in audio (`pickIntroEnd`) was wrong on every paper: marks that matter
  are given by a human, never guessed from silence or length.
