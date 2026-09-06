# Phase 4D — Checkpoint C: Restaurant Tables Frontend Integration Report

Replaces the in-memory/mock Restaurant Tables data path with a real Supabase-backed path, preserving the existing floor-plan UI and the existing RLS authorization model. **Restaurant Tables ONLY** — Reservations integration was NOT started, no migration was created/modified.

---

## A. Existing Tables audit findings

- **src/pages/Tables.tsx (152 lines, fully mock):**
  - Reads: `const { s, notify } = useStore()` → `s.tables` (`DiningTable[]` from seed).
  - Mutations: a single `setStatus(id, status)` that **directly mutates** `t.status` in the store + `toast` + `notify()` + `closeDrawer()` — no backend.
  - **No create / edit / delete UI existed.** The floor plan (`.floor`/`.tbl-card`) + drawer (status buttons, "Active reservations") were the only surface.
  - Display used `t.id.replace('T-','')` and `Table {t.id}` — i.e. the mock `id` doubled as the display code.
- **Conventions reviewed:** `src/services/customers.ts` (ServiceResult<T>, `getCurrentIdentity`-derived tenant, soft delete via `deleted_at`, mapper boundary); `src/hooks/useCustomers.ts` (hydration read); `src/hooks/useCustomerActions.ts` (`{run, submitting, error}`, resolve identity, update store only after success, `notify()`+`toast()`, in-flight guard); `src/services/shared.ts` (ServiceResult/ServiceError/toServiceError); `src/types/database.ts`; `src/services/index.ts`.
- **View-model mismatch:** `DiningTable` used `id` as the display code with no `label`; the DB uses a UUID `id` + a separate `label` display code.

## B. Database schema confirmed (0001:174-185, 0006:350-383)

- `restaurant_tables`: `id UUID PK`, `restaurant_id UUID NOT NULL`, `label TEXT NOT NULL` (display code, `UNIQUE(restaurant_id,label)`), `capacity INT CHECK(>0)`, `status TEXT DEFAULT 'available' CHECK IN ('available','occupied','reserved')`, `deleted_at TIMESTAMPTZ` (soft delete), `created_at`, `updated_at` (trigger-maintained).
- Status enum = `available | occupied | reserved` — **exactly matches** the frontend `TableStatus`. No mismatch to reconcile.
- **RLS:** `SELECT` = `restaurant_id = current_restaurant_id()` (broad to tenant staff, **no permission code**). `INSERT`/`UPDATE`/`DELETE` = `restaurant_id = current_restaurant_id() AND has_permission('settings.manage')`.
- **FK:** `reservations.table_id` (0001:229) and `orders.table_id` (0001:252) → `id` ON DELETE SET NULL. Soft-delete never triggers these.

## C. Files created

- `src/services/restaurantTables.ts` — service layer (list/get/create/update/soft-delete/status, mapper, error mapping).
- `src/hooks/useRestaurantTables.ts` — read/hydration hook + permission context.
- `src/hooks/useRestaurantTableActions.ts` — mutation hooks (create/update/status/delete).

## D. Files modified

- `src/types/index.ts` — added optional `label?: string` to `DiningTable` (real rows carry uuid `id` + display `label`; seed rows keep `id` as the code).
- `src/pages/Tables.tsx` — integrated the real data path.

No store rewrite (kept `s.tables` as the single source of truth). No migrations touched.

## E. Service architecture (`src/services/restaurantTables.ts`)

Flow: **Supabase → typed service → mapper → hooks → store hydration → Tables UI.** No Supabase queries in page JSX.

- `listRestaurantTables()` — SELECT, excludes `deleted_at IS NOT NULL`, orders by `label`, maps via `restaurantTableRowToView`.
- `getRestaurantTable(id)` — `maybeSingle` by uuid, excludes soft-deleted.
- `createRestaurantTable(input, identity)` — `restaurant_id` **derived from authenticated identity** (`TenantContext`), never from UI; validates label (required, uppercased) + capacity (int ≥1); default status `available`; `.select().single()`.
- `updateRestaurantTable(id, input)` — subset updates only (`label`/`capacity`/`status`); **never** `id`/`restaurant_id`; excludes soft-deleted; `NOT_FOUND` via `maybeSingle`.
- `softDeleteRestaurantTable(id)` — sets `deleted_at = NOW()`; **never a physical DELETE**.
- `tableMutationError()` — maps `23505` (duplicate `label`) → friendly VALIDATION; `42501` → FORBIDDEN.
- Mapper `restaurantTableRowToView(row): DiningTable` — single boundary: `id`=uuid, `label`=display, `cap`=capacity, `status` normalizes to the 3-value union.

## F. Hook architecture

- `useRestaurantTables()`: hydration read. No config → no-op (seed stays, offline). Real rows → replace `s.tables` wholesale + `notify()` (status `loaded`). **Zero rows → `s.tables = []` + `notify()` (status `empty`) — genuine empty state, no demo injection.** Surfaces `context` and `canManageTables` (`roleSlug === 'owner-admin'`).
- `useCreateRestaurantTable` / `useUpdateRestaurantTable` / `useSetRestaurantTableStatus` / `useDeleteRestaurantTable`: each returns `{run, submitting, error}`, guards `isSupabaseConfigured` + user, `getCurrentIdentity` for create, updates `s.tables` **only after confirmed DB success**, calls `notify()` + `toast()`, prevents double-submit (`submitting`), no optimistic fake UUIDs.

## G. Permission handling (C4)

- RLS is authoritative. `SELECT` broad to tenant staff; writes gated by `settings.manage`.
- Frontend **convenience gate only**: `canManageTables = roleSlug === 'owner-admin'` hides/disables Add/Edit/Status/Remove controls for non-managers. No `tables.manage` permission invented.
- Verified live: owner `settings.manage`=true; a non-manager identity `settings.manage`=false yet can still `SELECT` (broad read). Anon: no access (0 rows; `authenticated`-only policy).

## H. Soft-delete behavior (C7)

- Delete calls `softDeleteRestaurantTable` → `UPDATE set deleted_at = NOW()`, **not** `DELETE`. Normal reads exclude soft-deleted rows. Historical FK references (reservations/orders) are preserved because the row is never physically removed. Re-listable later.

## I. UI integration changes (C5/C6)

- Preserved the existing `.tbl-card` floor plan, `SEAT_ICONS`, `STATUS_LABEL`/`STATUS_BADGE`, legend, `.t-num`/`t-num`, drawer layout, and the "Active reservations" section (matched by display code).
- Display uses `label ?? id` (codeOf) so real (labeled) rows and seed rows both render correctly.
- Added (gated by `canManageTables`): **+ Add Table** (page + empty state), an **Edit details** modal (label + capacity + **Remove** = soft delete) in the table drawer, and real **Change Status** buttons (a normal `updateRestaurantTable(id, { status })`) using only DB statuses from `TABLE_STATUSES`.
- **Genuine empty state** ("No tables yet") shown when the DB returns zero rows; **no demo tables injected**.
- Status uses only `available | occupied | reserved` — exact DB CHECK values (no invention). No auto-sync with reservations (manual status only, as approved).

## J. Verification results

Frontend:
- `npx tsc -b` — **PASS** (after removing an unused `toast` import flagged by `noUnusedLocals`).
- `npm run build` — **PASS** (195 modules).
- `npm run test:e2e` — **11/11 PASS**.

Live RLS/identity (non-destructive, `db query --linked` + JWT simulation):
- **Identity:** owner resolves correct restaurant; owner `settings.manage` = **true**.
- **RLS read:** authorized owner can read `restaurant_tables` (0 own rows — clean DB). Non-manager tenant identity can still `SELECT` (broad tenant read). **Anon = denied** (0 rows; only the `authenticated` SELECT policy exists → anonymous sees nothing).
- **Permissions:** `settings.manage` gates writes (owner true, non-manager false → writes denied by WITH CHECK); reads follow the no-permission tenant policy.
- **Empty state:** 0 real rows → the page renders the genuine empty state; no demo data inserted (confirmed `restaurant_tables` count = 0).
- **Soft delete:** verified in code that it issues `UPDATE deleted_at`, never `DELETE`. Direct browser CRUD (real create/edit/status/delete round-trips) requires a manual authenticated session (Clerk CAPTCHA) — see K.

## K. Known limitations

- **Browser mutation testing requires manual authenticated verification** (real Clerk sign-in is blocked in CI by Cloudflare Turnstile; `db query --linked` is read-only and cannot run DML). The service/hook + RLS paths are verified statically and via live RLS permission checks; the on-screen create/edit/status/delete flows need a signed-in human/automation pass.
- The clean production DB means the Tables page currently shows the genuine **empty state** (0 tables). Live write round-trips were not executed against production.
- Because the clean database hydrates to zero tables, `s.tables` is cleared — this is the required genuine-empty behavior. The Reservations page's table dropdown (Checkpoint D scope) is intentionally not modified here; it will read from the same store when Checkpoint D integrates reservations.
- `canManageTables` is derived from `roleSlug === 'owner-admin'` (the only seeded role with `settings.manage` per the permission matrix). If the RBAC matrix changes, RLS (`settings.manage`) remains authoritative; only the convenience gate would need revisiting.

## L. Explicitly NOT changed

- **No Reservations integration** (no Reservations UI/service/hook touched).
- **No migration created or modified** (0001–0007 untouched).
- **No RLS policy weakened or added; no new permission code** (`tables.manage` intentionally not invented).
- **No `service_role` used or exposed.**
- **No demo data inserted into production.**
- **No store rewritten** (mutations use `s.tables` in place).
- **No optimistic fake UUIDs;** no silent fallback to fake data after a real backend error.

---

*Checkpoint C complete. STOPPED here. Not proceeding to Checkpoint D (Reservations frontend integration) — awaiting review.*
