# Lingo Family

A family-only PWA for learning Korean and English vocabulary, phrases and pronunciation, picture-first.

- **What** is being built: [`SPEC.md`](SPEC.md)
- **How** it is built (stack, rules, commands): [`CLAUDE.md`](CLAUDE.md)

## Quick start

Requirements: Node.js 22.22+ (LTS), npm 11+.

```bash
npm install
cp .dev.vars.example .dev.vars   # fill in secrets when needed (from M1)
npm run db:migrate:local         # create the local D1 database
npm run dev                      # http://localhost:5173
```

Check the API: http://localhost:5173/api/health should return `{"ok":true,"profileCount":0}`.

Add `DEV_AUTH_BYPASS=1` to `.dev.vars` (see `.dev.vars.example`): there is no Cloudflare Access in front of the local server, and this flag (honoured on localhost only) skips the check.

### Local images: fake by default, real with `dev:ai`

| Command | Images | Needs |
|---|---|---|
| `npm run dev` | **Fake provider**: every drawing is the same fixed placeholder (`image_model = fake`). No Workers AI, no quota, no cost. | nothing |
| `npm run dev:ai` | **Real Workers AI** (remote binding, same models and quota as production). | `cloudflared` and a one-time Access login |

Why: the real Workers AI binding runs in a remote preview session on `lingo.ai4life.workers.dev`, which is behind Cloudflare Access, so Wrangler must sign in through `cloudflared`. Install it once, then run `npm run dev:ai` in an interactive terminal and log in in the browser window that opens:

```bash
winget install --id Cloudflare.cloudflared
npx wrangler login
npm run dev:ai
```

Production always uses the real binding; the fake provider only exists on a local host.

## Try the production build (PWA)

```bash
npm run preview   # http://localhost:4173, with the service worker and manifest
```

The service worker only exists in this build (not in `npm run dev`). In DevTools → Application you can inspect the manifest, the service worker and the caches (`workbox-precache`, `media-v1`).

## Deploy (production)

`npm run deploy` builds and deploys the Worker `lingo` to https://lingo.ai4life.workers.dev (behind Cloudflare Access, see SPEC §7.1). Secrets are set once with `npx wrangler secret bulk <file.json>` (a temporary file outside the repo, deleted afterwards) or in the dashboard, never by pasting with Ctrl+V in `cmd`. `npm run db:migrate:remote` applies migrations to the production D1.

## Layout

```
src/       React app (pages, components, features, i18n)
worker/    Hono API on Cloudflare Workers (/api/*)
shared/    zod schemas and types used by both sides
db/        Drizzle schema + SQL migrations for D1
scripts/   Python helper scripts
public/    static assets
```
