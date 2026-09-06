# Elysian Spire CRM

Restaurant management CRM for Elysian Spire — Vite + React + TypeScript SPA with Clerk authentication and Supabase data access.

## Stack

- Vite 5 / React 18 / TypeScript 5
- Clerk (auth authority, `@clerk/react`)
- Supabase (`@supabase/supabase-js`, anon/publishable key — no service role client-side)
- React Router (HashRouter)
- Vitest (unit) + Playwright (e2e)

## Setup

1. `npm install`
2. Copy `.env.example` to `.env.local` and fill in:
   - `VITE_CLERK_PUBLISHABLE_KEY` — Clerk publishable key
   - `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` — Supabase project URL and publishable key
3. `npm run dev`

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Vite dev server |
| `npm run build` | Type-check (`tsc -b`) then production build to `dist/` |
| `npm run typecheck` | TypeScript build check |
| `npm run test:unit` | Vitest unit suites (`tests/unit`) |
| `npm run test:e2e` | Playwright end-to-end (`tests/e2e`) |
| `npm run preview` | Preview the production build |

## Project layout

- `src/` — React app (pages, components, routing, services, store, types)
- `supabase/migrations/` — SQL migrations 0001–0010; `supabase/config.toml`
- `tests/unit/` — Vitest suites; `tests/unit/helpers/supabaseMock.ts` shared mock
- `tests/e2e/` — Playwright specs
- `docs/` — phase reports (QA, architecture, cleanup)