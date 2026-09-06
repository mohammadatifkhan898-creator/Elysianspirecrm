# Elysian Spire CRM — Phase 4B: Data Foundation Implementation

**Scope delivered:** Minimal, clean, additive data-foundation that lets CRM modules migrate from the
in-memory store to real Supabase data safely. Includes the first **read-only** vertical slice (Customers).
**Migrations 0001–0006 were NOT modified. RLS is untouched. No demo data was created. No Chef order-status,
menu-permission, notification-mutation, or full-CRUD work was done.** Per the approved Phase 4B gate, no full
Customers CRUD was implemented.

Guiding doc: `docs/Phase-4A-CRM-Data-Integration-Plan.md` (architectural source of truth).

---

## A. Architecture chosen

- **Frontend store remains the in-memory singleton** (`src/store/store.tsx`). Nothing was rewritten.
- **Supabase is the source of truth** and hydrates store slices via a thin adapter on page mount. Page
  components keep reading the store (`useStore()`), so design/JSX is unchanged.
- **Hydration is additive and per-slice**: one read-only hook per module. Phase 4B ships the Customers slice
  only; other modules follow the same pattern later.
- **Tenancy is derived by RLS** from the caller's profile — the service layer never accepts or sends a
  client-supplied `restaurant_id`.
- **Identity** is resolved through the existing Clerk → `profiles` → `staff_members` → `roles` chain with an
  RLS-safe query, exposed once as `getCurrentIdentity`.
- **Typed boundary** is hand-written and schema-accurate (see C) applied at the service layer via casts — the
  sanctioned approach because `supabase gen types` cannot run here (no CLI DB access token, no local Docker).

The architecture deliberately does NOT introduce a giant generic CRUD abstraction; each module gets a small,
specific service + hook.

## B. Files changed

New files:
- `src/types/database.ts` — schema-accurate Row/Insert/Update types for all 16 tables + `Database` wrapper +
  `TableRow<T>` helper.
- `src/services/shared.ts` — service-layer conventions: `ServiceResult<T>`, `ServiceError`, `toServiceError`,
  `NOT_CONFIGURED`.
- `src/services/customers.ts` — read-only `listCustomers` + `customerRowToView` mapper (first vertical slice).
- `src/hooks/useCustomers.ts` — read-only hydration slice (loads real rows, replaces `s.customers` when
  present; never mixes mock ids with DB uuids).

Modified files:
- `src/types/index.ts` — added optional `id?: string` to `Customer` (carries DB uuid on real rows; mock rows
  stay id-less, so no collision/mixing).
- `src/lib/supabase.ts` — added `AppSupabaseClient = SupabaseClient` type alias + refreshed the RLS/tenant
  header comment (RLS is live). No behavior change.
- `src/lib/useSupabase.ts` — explicit `UseSupabaseResult` return type (typed client); refreshed stale RLS
  comment. No behavior change.
- `src/services/index.ts` — unchanged provisioning functions; added the canonical identity resolver
  `getCurrentIdentity` + `CurrentIdentity`/`IdentityResult` types (Step 4). Client param types changed to
  `AppSupabaseClient` (alias of the same `SupabaseClient`).
- `src/pages/Customers.tsx` — added `useCustomers()` call at the top of the component (one line + import).
  **No JSX/visual change.**

Not modified: migrations 0001–0006, all other pages, store shape, SessionGate, Onboarding, provisioning RPC,
RLS policies, `.env.*`.

## C. Database type strategy

- **Generated types unavailable** in this environment (no CLI DB access token, no Docker), so a **hand-written,
  schema-accurate typed boundary** (`src/types/database.ts`) is used — matching the real deployed schema in
  `0001_initial_schema.sql`, not the older `Database-Architecture-Audit.md` draft.
- Distinct families per table:
  - `Row` — canonical stored shape (what a SELECT returns).
  - `Insert` — required = NOT NULL with no server default; `id`/timestamps optional (server defaults).
  - `Update` — `Partial<Insert>`.
- **Type accuracy rules:** UUID/TIMESTAMPTZ/DATE/TIME → `string`; NUMERIC money (`spent`, `price`,
  `subtotal`, …) → `string` (PostgREST) converted to `number` at view boundaries; INTEGER (`visits`,
  `orders`, `capacity`, `guests`) → `number`; status columns typed as literal unions matching the CHECK
  constraints.
- **Frontend view models are separate** (`src/types/index.ts` `Customer`) and reused by pages; DB row types
  are never leaked into components (the `customerRowToView` mapper is the single boundary).
- **Why not `SupabaseClient<Database>`:** threading the hand-written `Database` generic into the client broke
  `.rpc()` argument typing and row inference (rows fell back to `never`). The client is typed as base
  `SupabaseClient` and the schema boundary is applied explicitly via casts (`data as CustomersRow[]`) at the
  service layer — the documented "temporary typed boundary" approach.
- **No type duplication:** pages/types import `Customer` from `src/types`; DB types live only in
  `src/types/database.ts` and are consumed by services.

## D. Service layer conventions

Established in `src/services/shared.ts` and followed by `customers.ts`:
- **Auth:** every call uses the token-aware client from `lib/supabase.ts` (Clerk session on every request).
  Anon/service-role keys are never used.
- **Response:** every service returns `ServiceResult<T>` =
  `{ ok: true, data: T } | { ok: false, error: ServiceError }` (discriminated union).
- **Error normalization:** PostgREST errors → `toServiceError` → stable `ServiceErrorCode`
  (`NOT_FOUND` for PGRST116, `FORBIDDEN` for 42501, `NETWORK`, `NOT_CONFIGURED`, `UNKNOWN`) + message. Raw
  error kept under `raw` for diagnostics only.
- **Loading:** services are async and do not manage loading state; consumers model `loading` locally on hooks.
- **Tenancy:** derived by RLS; services never send a client-supplied `restaurant_id`.
- **IDs:** uuid PKs (or TEXT `profiles.id`). Display codes (`ORD-1042`, `RSV-308`, `T-01`) are separate
  columns and never used as keys in the service layer.
- **Read filtering:** `listCustomers` filters `deleted_at IS NULL` and orders by name.

## E. Identity / context flow

- Clerk remains the auth authority. The authenticated request carries the Clerk session token, so PostgREST
  resolves the caller via `auth.jwt() ->> 'sub'`.
- `getCurrentIdentity(supabase, userId)` (services/index.ts) resolves the caller's application identity with an
  RLS-safe read: `profiles(id, restaurant_id, email, full_name, staff_members(id, roles(slug, name)))`. Returns
  `CurrentIdentity` (profileId, restaurantId, staffId, roleSlug, roleName, email, fullName) or a typed error.
- Live-verified against the project: owner `user_3Ie…` → restaurant `0cfad912-…`, staff `2a2446c1-…`, role
  `owner-admin`, `has_permission('customers.view')` = true.
- **No duplicate identity state:** the resolver is the canonical function; `useCustomers` consumes it for
  UI context and does not keep a parallel identity store. (Full global identity sharing remains a later-phase
  concern; SessionGate behavior is unchanged.)

## F. Store hydration strategy

- Additive adapter (`useCustomers` hook) hydrates `s.customers` only when real rows exist:
  - **Not configured** (dev/demo offline) → no-op; seed remains (existing offline behavior preserved).
  - **Configured + rows** → `s.customers = mappedRows; notify()` — wholesale replacement, real rows (with DB
    uuids) only, so **mock ids and DB uuids never mix**.
  - **Configured + 0 rows** (clean DB) → seed left in place so the UI does not blank mid-migration. This honors
    the no-demo-data ruling: the empty DB is the true state; the slice replaces once real data exists.
- **No hidden background mutation:** hydration is explicit, runs once on page mount (guarded by a `ran` ref),
  and sets a visible `status` (`loading/loaded/empty/error`) with a `refetch` handle.
- **No store rewrite:** shape + `notify()`/`replaceState()` semantics unchanged.

## G. First real Supabase vertical slice

**Customers list — READ ONLY.**

Path proven end-to-end:
```
Supabase (RLS-safe) -> listCustomers (service, typed CustomersRow[]) -> customerRowToView -> Customer[]
-> useCustomers (hook) -> s.customers hydrate + notify -> existing Customers page (unchanged JSX)
```

- Service: `src/services/customers.ts` — `listCustomers` (select, `deleted_at IS NULL`, order by name), typed
  via `CustomersRow[]`, mapped to `Customer` view models (uuid carried as `id`, `spent` numeric, `last` derived
  from `last_visit_at`).
- Hook: `src/hooks/useCustomers.ts` — loads on mount, resolves identity (best-effort), lists customers, hydrates
  store when real rows exist, exposes `{ customers, status, error, context, refetch }`.
- Page: `src/pages/Customers.tsx` — one additive `useCustomers()` call; zero JSX/visual change.
- **No create/update/delete** implemented (deferred per Phase 4B gate).

## H. Mock-data compatibility strategy

- Production/normal-dev DBs stay clean (no demo seeding infrastructure added — per decision #3).
- Mock data remains the fallback only when Supabase is unconfigured or before any real rows exist.
- **No mixing:** if real rows exist they replace `s.customers` wholesale; otherwise seed stays. A real row can
  never coexist with a mock row in the list.
- Display codes vs keys: the service layer keys on DB uuids; human codes are untouched display columns. Legacy
  `StaffBrief` and analytics constants are untouched (out of scope).
- The dashboard/analytics remain hardcoded (Phase 4A section A.4) — no analytics work in 4B.

## I. Tests run

- `npm run typecheck` (`tsc -b`): **PASS** (0 errors, `strict` + `noUnusedLocals`/`noUnusedParameters`).
- `npm run build`: **PASS** (vite production build, 191 modules).
- `npm run test:e2e`: **11/11 PASS** (signed-out auth suite against the project dev server). Port 5173 was
  already occupied by this project's dev server, so I ran Playwright with a **temporary** `reuseExistingServer:
  true` and reverted it to `false` afterward (verified).
- Live RLS read verification (read-only `supabase db query --linked`):
  - Authenticated owner can read `customers` (returns 0 rows on the clean DB — read permitted, no error).
  - Identity chain + helpers resolve (owner → restaurant/staff/role; `customers.view` = true).
  - Anonymous access to `customers` returns 0 (denied).
- No migrations or writes were executed.

Verification checklist (from the Phase 4B brief):
1. Existing auth works — E2E signed-out suite green; auth code untouched.
2. SessionGate works — untouched; only client type alias/comment changed.
3. Onboarding works — untouched.
4. Provisioned user reaches dashboard — SessionGate/README intact; identity resolver chain live-verified.
5. RLS-protected authenticated reads work — live-verified (owner read customers = 0, permitted).
6. Anonymous access remains denied — live-verified (anon count = 0).
7. Real DB ids do not collide with mock ids — real rows carry uuid `id`, mock rows are id-less, list replaced
   wholesale (never mixed).
8. Existing UI remains functional — 11 E2E green, page JSX unchanged, build passes.
9. `npx tsc -b` passes — yes.
10. `npm run build` passes — yes.
11. Existing E2E tests pass — 11/11.

## J. Known limitations

- **Manual typed boundary** (not generated): `supabase gen types` is unavailable in this environment. Database
  types are hand-written from 0001 and applied via casts; should be replaced by `supabase gen types` output once
  CLI/DB access exists. The `Database` generic is intentionally not threaded into the client (see C).
- **Customers slice hydrates only when real rows exist.** On the currently clean DB the Customers page still
  shows seed data (deliberate, per the no-demo-data ruling and the "UI must not visually break" requirement).
  Once a real customer is created (future phase), hydration will visibly engage. Runtime proof today = the
  service returns a typed empty/ok result and RLS permits the read.
- **Identity resolver is used for context only** in this slice (RLS derives tenancy for reads); it is the
  canonical resolver for future write-gating but is not yet consumed by SessionGate.
- **A pre-existing dev server was already running on port 5173** (from earlier work) — I did not start or stop
  it; E2E reuses it. Not a regression.
- **First real-data change requires a configured Supabase environment.** If `.env.local` lacks Supabase config,
  the slice no-ops and the app runs on seed (unchanged behavior).
- Deferred (not in 4B, per decisions): Chef order-status RPC, menu permission design, notification read
  mutations, full Customers CRUD/write, other modules, analytics, legacy seed cleanup.

## K. Recommended exact scope for Phase 4C

Pending approval. Proposed to minimize risk while delivering a real write path on the established foundation:
1. **Customers write path** — `createCustomer`/`updateCustomer`/`addCustomerNote` (insert into `customers`,
   derive `visits/orders/spent` per the audit, note via `customer_notes`), a Customers create/edit modal, and
   fix the Phase 4A migration-blocking silent-note bug now that note writes exist. Gate behind `customers.manage`
   (RLS already enforces at the DB; add graceful `FORBIDDEN` UX).
2. **Reference data slice** — `restaurant_tables` (list + status via a narrow manager/operational write) and
   `menu` (list + CRUD once the menu-permission decision from Phase 4A C.3 is resolved).
3. **Orders read slice** — list orders + `order_items` read-only (unblocks Dashboard "Recent Orders" and
   Customers order history with real data).
4. **Code-generation RPC (0007, additive only)** — atomic next-code function for `orders.code`/`reservations.code`
   to replace the length-based collision bug, spec'd but gated on the relevant module.
5. **Type boundary upgrade** — if CLI DB access becomes available, swap the hand-written boundary for
   `supabase gen types` output.

4C should ship **one write module (Customers)** plus read slices, verifying tsc/build/E2E and live RLS writes
each step. No Chef order-status, no menu permissions, no notification mutations, no demo seeding.

---

*Phase 4B complete. No migration, no RLS change, no demo data, no Customer write logic was introduced.*
