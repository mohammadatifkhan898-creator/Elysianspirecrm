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
   - `VITE_CLERK_PUBLISHABLE_KEY` — Clerk publishable key (`pk_test_…` / `pk_live_…`).
     Get it from Clerk Dashboard → your app → API Keys → **Publishable key**.
     It is public and safe to ship. Never use the Clerk **secret** key (`sk_…`) here.
   - `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` — Supabase project URL and publishable key
3. `npm run dev`

### Clerk troubleshooting

The publishable key embeds your Clerk **Frontend API** host, and the browser
downloads `clerk.browser.js` from that host. If the host is wrong or is not
provisioned, sign-in cannot start. `ClerkGate` (`src/components/auth/ClerkGate.tsx`)
turns both failure modes into a named error screen rather than an endless
spinner:

| Symptom | Cause | Fix |
| --- | --- | --- |
| "Sign-in unavailable" immediately | `VITE_CLERK_PUBLISHABLE_KEY` missing or malformed | Set the env var and rebuild |
| "Could not reach sign-in" after ~12s | Key is valid but its Frontend API host is unreachable | Point the key at a real, provisioned Clerk instance |

## Deployment (Vercel)

`vercel.json` builds with `npm run build`, publishes `dist/`, and rewrites all
non-`/assets/` paths to `/index.html` so direct navigation to app routes does not
404.

Required environment variables (Project → Settings → Environment Variables):

- `VITE_CLERK_PUBLISHABLE_KEY` — **must** be a valid Clerk publishable key
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

Vite inlines `VITE_*` variables at **build** time, so changing these requires a
redeploy, not just a restart.

Note: the app uses `HashRouter`, so canonical deep links look like
`/#/login`. Requesting `/login` also works — the rewrite serves the SPA, which
then redirects to the hash route.

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