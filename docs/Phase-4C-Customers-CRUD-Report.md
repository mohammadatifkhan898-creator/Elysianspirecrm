# Elysian Spire CRM — Phase 4C: Customers CRUD Implementation

**Scope delivered:** Full Customers module CRUD on the real Supabase-backed foundation built in Phase 4B:
CREATE, DETAIL with real-UUID navigation, EDIT (update), immutable NOTES (read + create), and a soft DELETE.
Migrations 0001–0006 were NOT modified, RLS is untouched, no demo data was created, and no Reservations /
Menu / Orders / Staff / Notifications / Dashboard integration was started (per the Phase 4C STOP boundary).

This builds strictly on the approved Phase 4B data flow:
`Supabase (RLS-safe) → typed service → ServiceResult<T> → hook mutation/adapter → store → UI`.
No competing data architecture was introduced.

Guiding docs: `docs/Phase-4A-CRM-Data-Integration-Plan.md` and `docs/Phase-4B-Data-Foundation-Report.md`.

---

## A. Architecture chosen (unchanged from 4B, extended for writes)

- **Frontend store remains the in-memory singleton** (`src/store/store.tsx`). Not rewritten.
- **Create / Update / Delete / Notes** all terminate in the typed service layer (`src/services/customers.ts`),
  return `ServiceResult<T>`, and update `s.customers` (single source of truth) + `notify()` on success.
- **Tenancy is derived by RLS** and, where an explicit tenant is required, from **authenticated identity** —
  never from user input. On INSERT the RLS `WITH CHECK` requires the row's `restaurant_id` to equal
  `current_restaurant_id()`, so the service resolves the tenant via `getCurrentIdentity` at call time (see D).
- **Identity** continues to be resolved through the Clerk → `profiles` → `staff_members` → `roles` chain via
  `getCurrentIdentity`.
- **Typed boundary** remains the hand-written, schema-accurate `src/types/database.ts` (sanctioned fallback —
  `supabase gen types` cannot run in this environment).
- **Delete = SOFT DELETE** (`deleted_at = NOW()`), matching the codebase's approved reference-entity
  convention — see C for the full analysis and decision.

## B. Files changed

New files:
- `src/hooks/useCustomerActions.ts` — mutation + note hooks: `useCreateCustomer`, `useUpdateCustomer`,
  `useDeleteCustomer`, `useCustomerNotes` (see E). Kept separate from the read-only `useCustomers` so the
  read slice stays a pure hydration adapter.

Modified files:
- `src/services/customers.ts` — extended (was read-only `listCustomers` only) with: `getCustomer`,
  `createCustomer`, `updateCustomer`, `softDeleteCustomer`, `listCustomerNotes`, `createCustomerNote`; added
  `CustomerCreateInput`, `CustomerUpdateInput`, `CustomerNote`, `TenantContext`, and a real-time `last`
  formatter (`relativeVisit`). The `customerRowToView` mapper is unchanged in shape.
- `src/pages/Customers.tsx` — rewired the existing page:
  - `+ Add Customer` now opens a real **create modal** (was a "Coming soon" toast).
  - Row click opens a **drawer keyed by the customer's real UUID** (`c.id`) with live, store-refreshed data
    (was index-based navigation into the in-memory array).
  - Added **Edit** (inline form in the drawer) and **Remove** (soft delete, confirmed) controls.
  - The **Notes** section now renders real notes from `customer_notes` (read list + "Add Note"); the old
    silent `c.note` mutation and fake "Save Note" toast were removed.
  - List / table / search / tier filter / KPIs / tier badges / seed fallback are preserved.

Not modified: migrations 0001–0006, all RLS policies, the store shape (`notify`/`replaceState`),
`src/types/database.ts`, `src/types/index.ts` (`Customer.id?: string` from 4B), `src/lib/supabase.ts`,
`src/lib/useSupabase.ts`, SessionGate, Onboarding, provisioning RPC, `.env.*`, other pages.

## C. DELETE decision and reasoning (required audit)

**Step 1 — FK relationships on `customers` (verified in `0001_initial_schema.sql`):**

| Dependent table | FK column | ON DELETE | Effect of hard-deleting a customer |
|---|---|---|---|
| `reservations` | `customer_id` | `SET NULL` | reservation kept, customer link cleared |
| `orders` | `customer_id` | `SET NULL` | order kept, customer link cleared |
| `customer_notes` | `customer_id` | `CASCADE` | notes removed with the customer |

Note: `customer` PK is `uuid`; `author_staff_id` on notes is `SET NULL`. On FK rules alone, a **hard** DELETE
would be technically safe — it would not orphan or silently delete `orders`/`reservations` (they set NULL), and
only the customer's own notes would cascade.

**Step 2 — RLS policies in `0006_enable_rls_policies.sql`:**

- `customers` DELETE policy exists and requires `restaurant_id = current_restaurant_id() AND
  has_permission('customers.manage')` — so a hard DELETE would be tenant-scoped and permission-gated.
- `customers` UPDATE policy (`USING` + `WITH CHECK`) requires the same, so a customer can never be moved to
  another restaurant by a malicious update.

**Step 3 — The decision: SOFT DELETE.**

Although hard delete is FK-safe, the codebase **design intent** for `customers` is a soft-delete reference
entity: `customers.deleted_at` exists, `0001` decision #8 adopted `deleted_at` soft-delete for reference
entities, and the read service already filters `deleted_at IS NULL`. Therefore Phase 4C implements `Remove` as
**`UPDATE customers SET deleted_at = NOW()`** (`softDeleteCustomer`) — the approved, non-destructive path. It:
- requires no destructive FK cascade (notes stay until a hard delete is explicitly chosen later),
- keeps order/reservation history intact and recoverable,
- renders the customer out of the list immediately (list filters `deleted_at IS NULL`),
- is RLS-constrained to the caller's restaurant + `customers.manage`.

Hard `DELETE` was **not** wired into the UI. The destructive path is deliberately not exposed; the audit
recommends it remain gated behind an explicit future owner action if ever needed.

## D. Tenancy on writes (customer.create)

The `pol_customers_insert` policy uses `WITH CHECK (restaurant_id = current_restaurant_id() AND has_permission('customers.manage'))`,
so an insert **must** carry `restaurant_id = current_restaurant_id()`. Phase 4C satisfies this without trusting
the UI: `useCreateCustomer` resolves `restaurantId` from `getCurrentIdentity` at submit time and passes it to
`createCustomer(supabase, input, { restaurantId })` as `TenantContext` — never as user-supplied form data. The
form only supplies `name/phone/email/favorite_item`. If identity cannot be resolved, the create returns a
typed `FORBIDDEN` error instead of guessing a tenant.

`updateCustomer` never sends `restaurant_id` (immutable; RLS `WITH CHECK` already prevents tenant moves), and
`softDeleteCustomer` sends only `deleted_at`.

## E. Notes behavior (immutable, per schema)

`customer_notes` RLS in `0006` grants only `SELECT` (parent same restaurant + `customers.view`) and `INSERT`
(parent same restaurant + `customers.manage`); **UPDATE and DELETE are denied (`USING (false)`)** — notes are
immutable historical records by design. Phase 4C therefore implements exactly **read + create**:
- `listCustomerNotes` (SELECT, ORDER BY created_at DESC)
- `createCustomerNote` (INSERT; `author_staff_id` optional, SET NULL allowed)
- No note update/delete UI (correctly impossible under RLS).

The drawer renders existing notes newest-first and an "Add Note" control; the previous silent in-memory
`c.note` mutation and fake save toast were removed.

## F. Service layer (src/services/customers.ts)

Follows 4B conventions (`ServiceResult<T>` / `ServiceError` / `toServiceError`); all calls use the token-aware
Clerk client; anon/service-role never used. New operations:

- `getCustomer(supabase, id)` — single non-deleted row by uuid (`maybeSingle`; `null` when missing/soft-deleted).
- `createCustomer(supabase, input, identity)` — resolves `restaurant_id` from `identity`; trims/validates name
  (required); starts counters at 0; inserts with `.select().single()` and maps the returned row.
- `updateCustomer(supabase, id, input)` — subset update of `name/phone/email/favorite_item` only (never
  `id`/`restaurant_id`); guards empty name; `.maybeSingle()` surfaces `NOT_FOUND` for a missing/soft-deleted row.
- `softDeleteCustomer(supabase, id)` — sets `deleted_at = NOW()` (same-tenant constrained by RLS UPDATE policy).
- `listCustomerNotes` / `createCustomerNote` — read + create only (E).
- `customerRowToView` — single boundary; view models (`Customer`) never leak DB row shapes into components.

## G. Hooks (src/hooks/useCustomerActions.ts)

Each mutation hook returns `{ run, submitting, error }`; on success it updates `s.customers` and calls
`notify()` (same store pattern as 4B's read adapter), plus `toast()` feedback. `submitting` guards against
double-submit (double-click / Enter). `useCustomerNotes(customerId)` returns `{ notes, status, error, saving,
save, retry }`, loading server-side and prepending new notes on save. When Supabase is unconfigured, all hooks
return a `NOT_CONFIGURED` error and the page stays on its seed fallback (unchanged offline behavior).

## H. UI integration (src/pages/Customers.tsx)

- **Create modal** — `Name` (required) + `Phone` / `Email` / `Favourite dish`; Save disabled while
  submitting; validation + server errors surfaced inline; closes on success.
- **Detail drawer** — opened with the customer's real uuid when present; reads the **freshest copy from the
  store** by id each render (so edits/removals reflect live); renders KPIs, detail grid, order-history display
  join (by display name, same as before — orders integration is deferred), and real Notes. If a real customer
  is removed, the drawer auto-closes.
- **Edit** — inline form pre-filled from the customer; "Save Changes" via `useUpdateCustomer`; returns to view.
- **Remove** — `window.confirm` then `useDeleteCustomer` (soft delete); closes the drawer on success.
- **Seed rows (no DB id)** — open the drawer read-only (no Edit/Remove/DB writes); editing is gated behind an
  informational toast. This preserves the offline/clean-DB UI without fake mutations.
- All controls reuse existing classes (`btn`, `btn-primary`, `btn-ghost`, `btn-danger`, `field`, `input`,
  `grid`, `modal-head/body/foot`, `drawer-head/body/foot`, `sec-title`, `badge-*`). No new styles added.

## I. Tests run

- `npm run typecheck` (`tsc -b`, `strict` + `noUnusedLocals`/`noUnusedParameters`): **PASS** (0 errors).
- `npm run build` (vite production build): **PASS** (192 modules).
- `npm run test:e2e`: **11/11 PASS** (signed-out auth suite; Playwright manages its own dev server;
  `reuseExistingServer` is `false` as expected).
- **Live RLS verification** (`supabase db query --linked`, read-only SELECT under synthetic owner JWT):
  - Owner identity chain resolves: restaurant `0cfad912-…`, staff `2a2446c1-…`, role `owner-admin`.
  - `has_permission('customers.view')` = **true**, `has_permission('customers.manage')` = **true** — the exact
    gate the CREATE/UPDATE/DELETE + `customer_notes` INSERT policies enforce, so owner writes are permitted.
  - Owner read of `customers` and `customer_notes` returns 0 rows with **no RLS error** (clean DB).
  - **Cross-tenant invisibility:** owner sees 0 rows that belong to another restaurant
    (`restaurant_id <> current_restaurant_id()` → 0) — tenant isolation holds.
  - **Anonymous** (`role anon`): `customers` and `customer_notes` both return **0** (fully denied).

## J. Verification checklist (from the Phase 4C brief)

1. First do the DELETE/FK/RES audit, then decide — done in C (soft delete chosen; hard delete not wired).
2. **DB**: tenant isolation verified (cross-tenant invisible = 0); `customers.view` reads / `customers.manage`
   writes live-verified (both true for owner); create derives tenant from identity; update cannot mutate
   `restaurant_id` (immutable + RLS `WITH CHECK`); notes attach to the parent customer (RNLS-scoped);
   unauthorized/anon mutations rejected (RLS gates, anon = 0); delete respects FKs (soft delete touches nothing).
3. **Double-submit** guarded via `submitting` on every mutation + notes save.
4. **Frontend**: list, create, detail-with-UUIDs, edit, notes, error/empty states, refresh all wired; the
   previous silent note bug removed; UI design preserved (list/table/filter/KPIs unchanged).
5. **Regression**: `tsc` PASS, `build` PASS, 11/11 E2E PASS, SessionGate/Onboarding untouched.
6. No migrations, no RLS changes, no demo data, no service_role usage.

## K. Known limitations

- **Write execution not exercised end-to-end through the browser**: real Clerk→PostgREST CREATE/UPDATE writes
  cannot be automated (Cloudflare Turnpike CAPTCHA blocks headless sign-in). RLS permission gating for the
  owner was live-verified true, and the `db query` path is read-only, so live writes are exercised only at the
  policy/permission layer — the SQL itself follows the identical, proven 4B mechanics.
- **`supabase gen types` still unavailable** — typed boundary remains hand-written (`src/types/database.ts`).
- **Seed fallback**: on the clean DB (0 rows) the page still shows seed customers (preserved offline UX); real
  writes engage once a real customer is created. Seed rows are read-only (no DB edit/remove).
- **Order History** still joins by display name from mock `s.orders` (Orders module integration is deferred to
  a later phase); validated display only, not persisted.
- Hard delete / note-edit-note-delete are intentionally absent (RLS-blocked and/or soft-delete convention).

## L. Next steps / STOP boundary

Next steps (all out of Phase 4C scope, for later phases): Reservations, Menu, Orders, Staff, Notifications,
and Dashboard integration; the deferred Chef order-status RPC, menu permission design, notification `read_at`
mutations, code-generation RPC (0007), and a generated type boundary upgrade.

**STOPPED after Phase 4C.** No Reservations / Menu / Orders / Staff / Notifications / Dashboard work was
started or completed in this phase.

---

*Phase 4C complete. No migration, no RLS change, no demo data, no service_role, no destructive hard delete.*
