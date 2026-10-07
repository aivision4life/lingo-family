# CLAUDE.md — Instructions for AI coding assistants

This file is read automatically at the start of every session. Follow it strictly.
**What** to build is in `SPEC.md`. **How** to build it is described here.

## Project in one paragraph
A family-only PWA for learning Korean, Chinese (Simplified) and English vocabulary and pronunciation.
Frontend: React + TypeScript. Backend: one Cloudflare Worker (serves the SPA and `/api`), D1 database, R2 media storage.
External: Azure Speech (TTS + Pronunciation Assessment), an LLM API for word enrichment. Hosting must stay on free tiers.

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
- Add a shadcn component: `npx shadcn@latest add <name>` (then keep tap targets >= 44px)

## Project setup notes
- Path aliases: `@/` → `src/`, `@shared/` → `shared/`, `@db/` → `db/` (in `vite.config.ts`, `vitest.config.ts`, `tsconfig.base.json`). Worker and `db/` code use relative imports.
- TypeScript projects: `tsconfig.app.json` (src + shared, DOM), `tsconfig.worker.json` (worker + shared + db, Workers runtime), `tsconfig.node.json` (config files).
- i18n: `src/i18n/locales/{vi,ko,en}.json`; `vi` is the source of truth for key types. A unit test enforces identical keys and placeholders.
- npm 11 blocks install scripts by default; allowed packages are listed in `package.json` → `allowScripts` (`esbuild`, `workerd`).
- shadcn/ui uses the `cn` package (from shadcn-ui) instead of `clsx` + `tailwind-merge`.
- API: validate with `zv(target, schema)` from `worker/lib/validate.ts`; errors are `{ error, issues? }` (`shared/api/error.ts`). Client calls go through `api()` in `src/lib/api.ts` (validates responses with zod) and TanStack Query hooks in `src/features/<feature>/api.ts`.
- API tests run the Hono app against a real in-memory local D1 via `createTestEnv()` (`worker/test/testEnv.ts`, uses wrangler's `getPlatformProxy`; `@cloudflare/vitest-pool-workers` does not support Vitest 5).
- LLM: `worker/services/llm.ts` (`LlmClient` interface, Gemini via REST `generateContent` + `responseJsonSchema`, `generateStructured()` = zod-validated JSON with one retry). Enrichment prompt in `worker/services/enrichPrompt.ts`: bump `ENRICH_PROMPT_VERSION` when the prompt or output schema changes (it is part of the `ai_cache` key).
- The Worker app is built by `createApp({ makeLlm })` (`worker/app.ts`) so tests inject a fake LLM (`worker/test/fakeLlm.ts`). `getPlatformProxy` loads `.dev.vars` (real keys), so `createTestEnv()` defaults to **no LLM**; tests must never call a paid API.
- Daily quotas: `consumeQuota()` in `worker/lib/quota.ts` (atomic upsert on `usage_daily`, UTC day).
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
- Put CJK text in elements with the right `lang` attribute (`ko`, `zh-CN`) and use Noto Sans KR / Noto Sans SC.
- Mobile-first layout; tap targets ≥ 44 px; check every screen at 375 px width.
- Feature code lives in `src/features/<feature>/`; shared UI goes in `src/components/`.
- Keep the Worker stateless; all state lives in D1/R2.

## Database rules
- Schema lives only in `db/schema.ts`. Change it, then generate a migration with drizzle-kit.
- **Never edit a migration that has already been applied.** Create a new one.
- Ask before any schema change that drops or renames columns.
- Store ts-fsrs `Card` and `ReviewLog` fields exactly as the library defines them.
- `review_logs` is append-only.

## Secrets & security
- Secrets (`AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION`, `LLM_API_KEY`, `LLM_PROVIDER`, `LLM_MODEL`) go in `.dev.vars` locally and in `wrangler secret` in production.
- **Never** put secrets in frontend code, in `wrangler.jsonc` vars, or in git. Keep `.dev.vars` in `.gitignore`.
- The browser only receives short-lived Azure tokens from `/api/speech-token`.
- In production, the Worker must verify the Cloudflare Access JWT (`Cf-Access-Jwt-Assertion`) on every `/api` request.

## Cost rules (free tiers)
- **Cache first** for every paid call: TTS audio (R2 key = hash of lang + voice + text), LLM responses (`ai_cache`).
- Never regenerate media that already exists.
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
- Gemini can return 503 "high demand" or take 30s+ under load; the client retries 500/503 once and times out after 45s. If the default model stays overloaded, set `LLM_MODEL=gemini-3.5-flash-lite` in `.dev.vars`.
- Homonyms (e.g. 사과 = apple / apology) made the LLM mix meanings with one Hanja; the prompt now asks for the most common meaning only.
<!-- Add a line here whenever the AI repeats a mistake, e.g.:
- Always use `lang="ko"` on Korean text (fixed glyph bug on 2026-10-xx). -->
