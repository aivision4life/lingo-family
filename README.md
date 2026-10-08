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

## Layout

```
src/       React app (pages, components, features, i18n)
worker/    Hono API on Cloudflare Workers (/api/*)
shared/    zod schemas and types used by both sides
db/        Drizzle schema + SQL migrations for D1
scripts/   Python helper scripts
public/    static assets
```
