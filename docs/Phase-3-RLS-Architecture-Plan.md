# Phase 3 — RLS & Multi-Tenant Security: Architecture Plan

**Status:** PLAN ONLY — no code, migration, or SQL changes.
**Scope:** Design the Row Level Security (RLS) + tenant-isolation layer for all 16 tables, aligned with the existing Clerk↔Supabase Third-Party Auth integration and the already-applied migrations `0001`–`0004`.
**Auth source of truth:** Clerk. Clerk user ids are TEXT (`user_...`) and equal `profiles.id`.
**Identity expression for ALL policies:** `auth.jwt() ->> 'sub'` (TEXT). **Never `auth.uid()`** (it casts `sub` to UUID and fails with Clerk).

---

## A. Current-state audit

### Migrations applied (all Local + Remote)
| File | What it does | RLS state after |
|---|---|---|
| `0001_initial_schema.sql` | Creates 16 tables + constraints + indexes + 4 roles + role_permissions seed. No GRANTs, no RLS. | RLS **not touched** (per-table default = disabled) |
| `0002_owner_provisioning.sql` | `provision_owner` RPC (`SECURITY DEFINER`, `search_path=public,pg_temp`) + partial unique index (≤1 active owner per restaurant). | RLS not touched |
| `0003_grant_public_access.sql` | `GRANT USAGE`/table/sequence/function to `anon`, `authenticated`, `service_role`. | RLS not touched (RLS off ⇒ grants alone exposed everything) |
| `0004_disable_rls.sql` | `ALTER TABLE ... DISABLE ROW LEVEL SECURITY` on all 16 tables. | **RLS disabled on all 16 tables** |

### Live DB reality (Phase 3 starting point)
- 16 tables exist; RLS is explicitly **disabled** on all 16 (`0004`).
- `anon`/`authenticated` have full CRUD grants (`0003`).
- `service_role` has full access and **bypasses RLS** always (Postgres role attribute), so it remains usable for server-side/admin tasks and `SECURITY DEFINER` helpers.
- Exactly one real tenant: restaurant `0cfad912-…`, one owner `staff_members` (`status='active'`, `inv_status='accepted'`), one profile (`user_3IelIFsjtuzqVugykS2JfaskM2W`).
- **No CRM CRUD has been connected** in the frontend yet. The only live read path is `getProfileState()` (reads `profiles` + embedded `staff_members(status)`) and RPC `provision_owner`. This is the critical thing RLS must not break.

### Source audit
- `src/lib/supabase.ts` — `createTokenAwareSupabase(getToken)`; every request carries the Clerk token via `accessToken`. `anon` key is the only browser credential.
- `src/lib/useSupabase.ts` — `useSupabase()` hooks Clerk session → token-aware client.
- `src/services/index.ts` — `getProfileState()` (SELECT `profiles` + `staff_members(status)` embed) and `provisionRestaurant()` (RPC `provision_owner`). No permission checks today.

**Implication:** Enabling RLS must keep three flows working with **zero frontend changes**: (1) `getProfileState` reading its own profile row (and the embedded `staff_members.status`), (2) `provision_owner` RPC, (3) SessionGate reaching a ready user.

---

## B. Security model

Three orthogonal axes:
1. **Tenant isolation** — every tenant-owned row carries `restaurant_id`; a user may only see/manipulate rows where `restaurant_id = current_restaurant_id()`.
2. **Role-based authorization** — the user's `staff_members.role` maps to a set of **permission codes** (from `role_permissions`); writes on sensitive tables require the matching permission.
3. **Ownership/self rows** — a few tables are inherently per-user (own `profiles` row, `notification_prefs`, personal `staff_activity`, recipient-matched `notifications`).

The model is: **`authenticated` role + RLS policies**, with **`SECURITY DEFINER` helper functions** (owned by a role with `BYPASSRLS`/owner privileges, `search_path` pinned) to resolve identity, tenant, and permissions without recursion.

Global (non-tenant) tables `roles` and `role_permissions` are **read-only to authenticated** via direct SELECT policies (they are seeded, immutable reference data), or via the `has_permission` helper. Direct writes are denied to everyone except `service_role`/owner.

---

## C. Identity resolution

- The Clerk JWT `sub` claim (TEXT `user_...`) is resolved with **`auth.jwt() ->> 'sub'`** in every helper. It is never cast to UUID.
- `profiles.id` is the TEXT PK holding that same `sub`, so `profiles.id = auth.jwt() ->> 'sub'` is the canonical "this is me" predicate.
- Reservation: **`current_clerk_user_id()`** centralises this so policies/helpers don't repeat the raw JWT expression and stay consistent.

**Why not `auth.uid()`:** `auth.uid()` casts `sub` to `uuid`, which raises for any non-UUID `sub` (every Clerk id). It must never be used.

---

## D. Helper-function design (`SECURITY DEFINER`)

All helpers are `SECURITY DEFINER`, owner = a privileged role (e.g. `postgres`/`supabase_admin`), and **must set `search_path = public, pg_temp`** to prevent search-path hijacking. They exist to (a) centralise identity/tenant/permission logic and (b) **avoid RLS recursion** (see §I) by reading through the definer's privileges instead of the caller's policy-qualified view.

| Function | Returns | Purpose / policy usage |
|---|---|---|
| `current_clerk_user_id()` | `text` | `auth.jwt() ->> 'sub'`; `NULL` if not set. Used directly in identity policies with `to`/`using`. |
| `current_restaurant_id()` | `uuid` | `SELECT restaurant_id FROM profiles WHERE id = current_clerk_user_id()` (definer, returns NULL when no profile). Central tenant key used in **every** `restaurant_id = current_restaurant_id()` policy. Per-query `STABLE`/`IMMUTABLE`-ish (mark `STABLE`). |
| `current_staff_id()` | `uuid` | `SELECT staff_id FROM profiles WHERE id = current_clerk_user_id()` (definer, NULL if unlinked). |
| `current_restaurant_role_slug()` | `text` | `SELECT r.slug FROM staff_members sm JOIN roles r ON r.id=sm.role_id WHERE sm.id = current_staff_id()` (definer). Used by "self/role" orchestration if needed. |
| `has_permission(p_code text)` | `boolean` | True iff an `active` staff row for the caller is linked to a role that has `p_code` in `role_permissions`. **Definition is deliberately non-recursive** (reads underlying tables via definer) so policies using it don't recurse. Required for write policies on sensitive tables. |

**Recursion note:** Because RLS policies call `current_*()`/`has_permission()` **SECURITY DEFINER** functions that read the same tables *as the definer* (bypassing the caller's RLS), the functions do **not** re-trigger the caller's policies → **no recursion**. This is the standard, safe pattern. (Without SECURITY DEFINER, a policy on `profiles` that selects from `profiles` inside a helper recurses infinitely.) See §I.

**Security of the helpers:**
- `REVOKE ALL ON FUNCTION ... FROM PUBLIC;` then `GRANT EXECUTE ... TO authenticated` (and `anon` only if truly needed — see provisioning).
- `SET search_path = public, pg_temp` so an attacker cannot shadow `profiles`/`roles`/`role_permissions` with objects in another schema.
- Mark all read-only helpers `STABLE` for planner safety; never `VOLATILE`-leaky on secret data.

---

## E. Complete 16-table policy matrix

Legend — policies on role `authenticated` unless noted. `rid = current_restaurant_id()`, `sub = current_clerk_user_id()`, `sid = current_staff_id()`, `HP(code) = has_permission(code)`. "via helper" = SELECT policy allows ONLY the columns the helper returns (or reliance on SECURITY DEFINER rather than a broad SELECT). Owner role = slug `owner-admin`. "Self" filters target the caller's own row.

Write policies use: `INSERT ... WITH CHECK (...)` and `UPDATE/DELETE ... USING (...)` and `UPDATE ... WITH CHECK (...)`. Every check on new rows must **re-derive `restaurant_id` from the session** where possible, NOT trust a client-supplied `restaurant_id` (see §I — spoofing).

### 1. `restaurants` (tenant root)
- **RLS:** ON.
- **SELECT:** `USING (id = current_restaurant_id())`
- **INSERT:** Deny (restaurants only via `provision_owner` or operator). `WITH CHECK (false)`.
- **UPDATE:** Deny to normal users (name edits via operator/service_role). `false`.
- **DELETE:** Deny. `false`.
- **Permission:** none (structural; operated only by `service_role`/definer). Record as intentional.

### 2. `roles` (GLOBAL reference)
- **RLS:** ON (or keep OFF — see §5 recommendation).
- **SELECT:** `true` (all `authenticated` may read the fixed roles list).
- **INSERT/UPDATE/DELETE:** Deny. `false`.
- **Permission:** none needed (read-only reference). Writes only `service_role`.

### 3. `staff_members` (tenant; includes self + others)
- **RLS:** ON.
- **SELECT:** `USING (restaurant_id = rid)` (all staff in own restaurant; availability filtered by `HP('staff.view')` at the row level OR column-level — see note).
- **INSERT:** `WITH CHECK (restaurant_id = rid AND HP('staff.manage'))`
- **UPDATE:** `USING (restaurant_id = rid AND HP('staff.manage'))` **AND** `WITH CHECK (restaurant_id = rid)`; extra guard so users can't self-promote (see §9): deny role/status changes unless `HP('staff.manage')` — implement by a `has_permission` guard in the `WITH CHECK`, not by comparing who is editing.
- **DELETE:** `USING (restaurant_id = rid AND HP('staff.manage'))`
- **Permission:** `staff.view` (read), `staff.manage` (write). **Architectural gap:** no dedicated "staff.chang erole" scope — `staff.manage` covers it.

### 4. `profiles` (Clerk bridge; SELF row is the bootstrap anchor)
- **RLS:** ON.
- **SELECT:** `USING (id = sub)`
  - **CRITICAL bootstrap case:** a *brand-new* Clerk user has NO profile yet. To let `getProfileState()` return `none` (and to allow onboarding to detect unprovisioned state), the SELECT policy must allow an authenticated user to see (an absent → empty) row set for their own `id` — an empty result is safe. For a **fresh provisioning** path the RPC creates the row via the definer, so no SELECT grant is needed to write it. Provide `USING (id = sub)` only; supply `true`-for-self-collection is unnecessary.
- **INSERT:** Normally `WITH CHECK (id = sub)` would allow a user to create their OWN profile — but that lets a user fabricate a `restaurant_id`/`staff_id`. **Deny INSERT on `profiles` to `authenticated`** (`false`); creation goes **only** through `provision_owner` (definer) — or a future invite-claim RPC.
- **UPDATE:** `USING (id = sub) WITH CHECK (id = sub)` — allows editing OWN `full_name`/email only; **do not allow** changing `restaurant_id`/`staff_id` (deny via column or a `WITH CHECK` that forbids changing them — see §9 spoofing). Recommend: UPDATE allowed only on `full_name` via a minimal column-set, or deny entirely until needed.
- **DELETE:** Deny. `false` (profiles removed via staff/org lifecycle).
- **Permission:** none (self-scoped). This is the **identity anchor** and must not be writable cross-tenant.

### 5. `role_permissions` (GLOBAL reference)
- **RLS:** ON.
- **SELECT:** `true` (readable reference) — or none if only `has_permission()` is used. Recommend read-only `true` for check/UI.
- **INSERT/UPDATE/DELETE:** Deny. `false`. Only `service_role`/operator edits grants.

### 6. `customers`
- **RLS:** ON.
- **SELECT:** `USING (restaurant_id = rid AND HP('customers.view'))`
- **INSERT:** `WITH CHECK (restaurant_id = rid AND HP('customers.manage'))`
- **UPDATE:** `USING (restaurant_id = rid AND HP('customers.manage'))` + `WITH CHECK (restaurant_id = rid AND HP('customers.manage'))`
- **DELETE:** `USING (restaurant_id = rid AND HP('customers.manage'))`
- **Permission:** `customers.view` (read), `customers.manage` (write/delete).

### 7. `restaurant_tables`
- **RLS:** ON.
- **SELECT:** `USING (restaurant_id = rid)` (floor plan is broadly visible; optionally gate with `inventory` — see note).
- **INSERT/UPDATE/DELETE:** `restaurant_id = rid AND HP('settings.manage')` (table layout is a settings/configuration action).
- **Permission:** **Architectural gap** — the seeded set has no `tables.*` code. Recommend reusing `settings.manage` for table CRUD (it's configuration), or `inventory.manage` (table = reusable asset). Flag for decision; do **not** invent a new code unless approved.

### 8. `menu_categories`
- **RLS:** ON.
- **SELECT:** `USING (restaurant_id = rid)`
- **INSERT/UPDATE/DELETE:** `restaurant_id = rid AND HP('inventory.manage')` (menu + inventory content).
- **Permission:** `inventory.manage` (menu content). NOTE: there is **no `menu.*` code**; `inventory.*` is the closest. Flag as a naming gap (see §F).

### 9. `menu_items`
- **RLS:** ON.
- **SELECT:** `USING (restaurant_id = rid)`
- **INSERT/UPDATE/DELETE:** `restaurant_id = rid AND HP('inventory.manage')`.
- **Permission:** `inventory.manage`. (Menu content managed under inventory type per existing seed.)

### 10. `reservations`
- **RLS:** ON.
- **SELECT:** `USING (restaurant_id = rid AND HP('reservations.view'))`
- **INSERT:** `WITH CHECK (restaurant_id = rid AND HP('reservations.manage'))`
- **UPDATE:** `using (restaurant_id = rid AND HP('reservations.manage'))` + `WITH CHECK (restaurant_id = rid AND HP('reservations.manage'))`
- **DELETE:** `USING (restaurant_id = rid AND HP('reservations.manage'))`
- **Permission:** `reservations.view` / `reservations.manage`.

### 11. `orders`
- **RLS:** ON.
- **SELECT:** `USING (restaurant_id = rid AND HP('orders.view'))`
- **INSERT:** `WITH CHECK (restaurant_id = rid AND HP('orders.create'))`
- **UPDATE:** `USING (restaurant_id = rid AND HP('orders.manage'))` + `WITH CHECK (restaurant_id = rid AND HP('orders.manage'))`
  - Note: the seeded "chef" has only `orders.view`; a chef cannot advance status (that's `orders.manage`). If kitchen `preparing→ready` should be chef-doable, that needs a **non-seeded** distinction (see §F) — document as a gap/decision.
- **DELETE:** `USING (restaurant_id = rid AND HP('orders.manage'))`
- **Permission:** `orders.view` / `orders.create` (insert) / `orders.manage` (update, delete).

### 12. `order_items` (child of orders)
- **RLS:** ON.
- **SELECT:** `USING (EXISTS (SELECT 1 FROM orders o WHERE o.id = order_id AND o.restaurant_id = rid AND HP('orders.view')))`
- **INSERT:** `WITH CHECK (EXISTS (... orders.create ...))`
- **UPDATE:** Treat as **immutable** — deny (order line snapshots shouldn't change). `false`.
- **DELETE:** Deny (immutable). `false`.
- **Permission:** inherits from `orders.*`. **Gap:** since there is no dedicated `orders.items` code, item mutations ride on `orders.create`/`orders.manage`. Acceptable.

### 13. `staff_activity` (audit timeline)
- **RLS:** ON.
- **SELECT:** `USING (staff_member_id = sid OR (restaurant-level and HP('staff.view')))`
  - Simplest: allow the actor to see their own activity + staff with `staff.view` to see any in-restaurant activity. Implement as `(staff_member_id = sid) OR (HP('staff.view') AND staff_member_id IN (SELECT id FROM staff_members WHERE restaurant_id = rid))`.
- **INSERT:** Deny to users (system/definer writes the timeline). `false`.
- **UPDATE/DELETE:** Deny (immutable audit). `false`.
- **Permission:** `staff.view` (read others); self always readable.

### 14. `customer_notes`
- **RLS:** ON.
- **SELECT:** `USING (EXISTS (SELECT 1 FROM customers c WHERE c.id = customer_id AND c.restaurant_id = rid AND HP('customers.view')))`
- **INSERT:** `WITH CHECK (EXISTS (... customers.manage ...))`
- **UPDATE/DELETE:** Deny (immutable notes, table has no `updated_at`). `false`.
- **Permission:** `customers.view` / `customers.manage` (inherited).

### 15. `notifications`
- **RLS:** ON.
- **SELECT:** `USING (recipient_staff_id = sid)` (a user sees **only their own** feed).
- **INSERT:** System/definer only. Deny. `false`.
- **UPDATE:** `USING (recipient_staff_id = sid) WITH CHECK (recipient_staff_id = sid)` — mark `read_at` only. Optionally restrict updatable columns to `read_at` to prevent editing message/type.
- **DELETE:** Deny (feed lifecycle via service). `false`.
- **Permission:** none (self-scoped).

### 16. `notification_prefs`
- **RLS:** ON.
- **SELECT:** `USING (staff_member_id = sid)`
- **INSERT:** `WITH CHECK (staff_member_id = sid)` (user creates their own prefs row; denied for others).
- **UPDATE:** `USING (staff_member_id = sid) WITH CHECK (staff_member_id = sid)`
- **DELETE:** `USING (staff_member_id = sid)`
- **Permission:** none (self-scoped).

---

## F. Permission mapping (existing seeded codes)

No new codes invented. Mapping decisions below; where a table lacks a natural code, it is explicitly flagged as a **gap requiring an architecture decision** — not silently invented.

| Code | Grants | Applied to tables |
|---|---|---|
| `customers.view` | read customers | `customers` SELECT; `customer_notes` SELECT (via join) |
| `customers.manage` | create/update/delete customers, add notes | `customers` INSERT/UPDATE/DELETE; `customer_notes` INSERT |
| `orders.view` | read orders + line items | `orders` SELECT; `order_items` SELECT |
| `orders.create` | place new orders (INSERT headers + items) | `orders` INSERT; `order_items` INSERT |
| `orders.manage` | update/delete orders | `orders` UPDATE/DELETE; (order_items immutable) |
| `reservations.view` | read reservations | `reservations` SELECT |
| `reservations.manage` | create/update/delete reservations | `reservations` INSERT/UPDATE/DELETE |
| `inventory.view` | read menu/inventory content | (menu is read broadly; optional `inventory.view` for restricted menus) |
| `inventory.manage` | mutate menu + inventory | `menu_categories`/`menu_items` INSERT/UPDATE/DELETE |
| `reports.view` | read aggregated reports | No table (reports are derived/computed) — **no direct table mapping** |
| `staff.view` | read staff + activity | `staff_members` SELECT; `staff_activity` SELECT (others) |
| `staff.manage` | create/update/delete staff, change roles | `staff_members` INSERT/UPDATE/DELETE |
| `settings.manage` | application/config settings | `restaurant_tables` CRUD (decision), restaurant config via operator |

**Role → code (matches 0001 seed):**
- **owner-admin:** all 13 codes → full access everywhere.
- **manager:** all except `settings.manage` → full ops, no settings.
- **waiter:** `customers.view`, `orders.view`, `orders.create`, `reservations.view` → can see customers/reservations, place orders; cannot update/delete.
- **chef:** `orders.view` only → can see the kitchen queue, cannot change status (see gap below).

**Architectural gaps (no suitable code exists — flagged, not invented):**
1. **Status transitions** (`orders.manage` covers update, but a chef can't advance `preparing→ready`, and a waiter can't toggle). If a "kitchen can advance state but not edit totals" role is wanted, that needs a *fine-grained* code like `orders.status` — **flag for product decision**. Recommend: for now, `orders.manage` (manager/owner) is the only transitioner; chefs remain read-only, matching 0001's seed.
2. **Menu permissions** — no `menu.*`; `/inventory.*` doubles for menu. Acceptable but a naming mismatch; document.
3. **Tables** — no `tables.*`; reuses `settings.manage`. Document.
4. **`reports.view`** maps to **no table** (reports are computed from orders/menu). It should gate a *future* analytics/report RPC, not a table. No policy change needed now.
5. **Frontend has extra roles** (`cashier`, `inventory staff`) and `ROLE_NAV` that the DB seed (4 roles) lacks. RLS is driven by DB `roles`/`role_permissions`, so the UI role picker must stay in sync with seeded DB roles. Flag as **sync gap**, not a RLS blocker.

---

## G. Bootstrap compatibility (CRITICAL)

Once RLS is ON, provisioning must still work with the SAME migrations/flow. Design ensures each bootstrap step is either self-scoped or definer-driven:

1. **Fresh Clerk sign-in (no profile).**
   - `getProfileState()` → `SELECT profiles ... WHERE id = sub`. Under RLS, `authenticated` SELECT policy `USING (id = sub)` returns **zero rows** for a user with no profile → service resolves to `none` → **onboarding** shown. ✅ (Empty result is safe and expected; no row needed to "see" absent state.)
   - `SessionGate` proceeds to onboarding. ✅

2. **Owner provisioning (`provision_owner`).**
   - `provision_owner` is **`SECURITY DEFINER`** with `search_path = public, pg_temp`. When the authenticated (or anon with token) user calls it via `rpc()`, the definer **bypasses RLS** on `restaurants`, `staff_members`, `profiles` to INSERT — so it creates the restaurant, owner staff row, and profile regardless of table policies. 🔒 (This is exactly why it's `SECURITY DEFINER`; do not strip it — §7.)
   - The caller must have `EXECUTE` on `provision_owner` (granted to `authenticated`; `0003` already grants functions broadly — tighten later, see §7).
   - **No direct `authenticated` INSERT policy on `profiles`** is required because creation is via the definer. Keeping INSERT `false` on `profiles` is the correct, secure stance.

3. **`getProfileState` after provisioning (owner login / SessionGate).**
   - Profile row now exists. SELECT policy `USING (id = sub)` returns the row. The embedded `staff_members(status)` join: the SELECT policy on `staff_members` must allow the caller to read their own staff row — `USING (restaurant_id = rid)` gives it (they're in their own restaurant), and `HP('staff.view')` also passes for owner/manager. The embedded join is evaluated under RLS, so the `staff_members` policy must admit the row. ✅ (Design §E #3 SELECT `restaurant_id = rid` covers the owner's own row with no extra policy.)

4. **Fresh owner provisioning path (post-phase-3):** unchanged — same `provision_owner` definer flow. Adding RLS does not alter it.

5. **Future invited-staff flow:** an admin creates a `staff_members` row (`staff.manage`), then a pending user claims/activates a profile. The claim must be a **`SECURITY DEFINER` RPC** (e.g. `claim_invited_staff()`) because it inserts/updates `profiles` + `staff_members` (which are otherwise non-writable by `authenticated` for security). The identity anchor is `auth.jwt()->>'sub'` matched by email on the staff row. Design this RPC like `provision_owner` (definer, pinned search_path, caller identity from JWT, idempotent). **Note for future phase** — RLS must not break it; it won't if implemented as definer.

**Net:** RLS is bootstrap-safe because the *only* write path is the `SECURITY DEFINER` RPC and the *only* read path before provisioning is an intentionally-empty self-scoped SELECT.

---

## H. Migration strategy

Recommended order (two migrations, matching the task's "likely" structure):

### `0005_rls_helpers.sql`
- Create the `SECURITY DEFINER` helpers with pinned `search_path`:
  - `current_clerk_user_id()`, `current_restaurant_id()`, `current_staff_id()`, `current_restaurant_role_slug()`, `has_permission(text)`.
- `REVOKE ALL ... FROM PUBLIC` on each; `GRANT EXECUTE ... TO authenticated` (and `anon` only if a signed-out helper is ever needed — generally not).
- Mark read-only helpers `STABLE`.
- **Do NOT enable RLS or create policies here.** Helpers are inert until referenced by policies.
- Rationale: helpers must exist before `0006`'s policies reference them; keeping them separate isolates the (recursion-sensitive) building block from the policy matrix.

### `0006_enable_rls_policies.sql`
- `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` on all 16 tables.
- `CREATE POLICY ... FOR SELECT/INSERT/UPDATE/DELETE` per §E.
- Optionally `ALTER TABLE ... FORCE ROW LEVEL SECURITY` on tables where even table owners must obey — but be careful it doesn't break `SECURITY DEFINER` writes (definer bypass is courtesy of the definer *role*, not FORCE; FORCE applies to table owner queries only). Recommend **NOT** using FORCE initially.
- Order within the file: create HELPERS-first is not needed (they're in 0005); create policies parent-before-child for readability, then grant/revoke function EXECUTE last.

### Safety notes for the migration pair
- `0003` already granted table privileges; enabling RLS layers row-filtering on top — no grant changes needed.
- `0004` disabled RLS; `0006` re-enables it (intended). `0004` remains as history; do not modify it.
- Idempotency: use `CREATE OR REPLACE FUNCTION` (helpers) and `DROP POLICY IF EXISTS` + `CREATE POLICY`, or name policies deterministically (`pol_<table>_select`, etc.).
- **Do not** disable RLS on `profiles`/`staff_members` to "make it work"; the bootstrap flow works with RLS on (§G).

---

## I. Avoid common RLS failures

1. **RLS recursion.** A SELECT policy on `profiles` that (transitively) selects `profiles` in its `USING` recurses (Postgres raises `infinite recursion detected in policy for relation`). All cross-table lookups go **through `SECURITY DEFINER` helpers** (`current_restaurant_id`, `current_staff_id`, `has_permission`), which read as the definer and bypass the caller's policies → **no recursion**. Never reference `profiles`/`staff_members` directly inside a policy's `USING` in a way that returns to the same table's policy.
2. **Profile-lookup recursion.** `getProfileState` embeds `staff_members(status)`; the `profiles` SELECT policy and `staff_members` SELECT policy both reference helpers, not each other → safe. Ensure the `staff_members` policy doesn't `SELECT profiles` (it uses `current_restaurant_id()`).
3. **SECURITY DEFINER risks.** Definer runs as the owner — if `search_path` is not pinned, a malicious object in an earlier schema could be resolved. **Always `SET search_path = public, pg_temp`.** Restrict EXECUTE to `authenticated` (default `PUBLIC` in 0003 grants is fine to leave, but tighten where sensitive). Limit helper body to minimal, non-writable reads.
4. **Clerk `sub` is TEXT.** Every comparison against `profiles.id`, `staff.email`, etc. must use TEXT-safe expressions and quoting in dynamic SQL (e.g. the `0002` DO-block `%L`). Never cast `sub` to UUID. `auth.jwt() ->> 'sub'` is `TEXT` already.
5. **Direct `restaurant_id` spoofing on INSERT.** `INSERT ... WITH CHECK (restaurant_id = rid)` re-derives `rid` from the session so a client-supplied `restaurant_id` in the payload is irrelevant — a spoofed value fails the WITH CHECK. **Every** side-effect INSERT/UPDATE must re-derive `restaurant_id`/owner from `current_*()`, not trust client fields.
6. **Cross-tenant UUID guessing.** Because every row policy filters `restaurant_id = rid`, guessing another tenant's UUID returns zero rows (SELECT) or violates WITH CHECK (write). UUIDs are unguessable-enough as the second layer, but RLS is the authoritative guard.
7. **Users changing their own role / self-promotion.** `staff_members` UPDATE/WITH CHECK is gated by `HP('staff.manage')`, so a user cannot flip their own `role_id`/`status` to `owner-admin` without that permission. Additionally, never let a `profiles` UPDATE change `staff_id`/`restaurant_id` (deny via column restrictions) so a user can't relink to another staff row/tenant.
8. **Provisioning before a profile exists.** Addressed in §G — `provision_owner` definer writes; the self-scoped SELECT is empty pre-provision; no dead-end.
9. **`service_role` bypass.** `service_role` has `BYPASSRLS` and will ignore policies. Ensure it is **never** used from the browser (only `anon` key is shipped); keep `provision_owner`/helpers owned by a privileged role. Document that `service_role` calls (e.g. server-side reporting) intentionally bypass tenant filters — a feature, not a bug.
10. **Not enough: grants alone.** RLS row filters are independent of GRANTs. With RLS ON, a grant allows the *attempt*, and the policy decides rows. Verify each action (SELECT/INSERT/UPDATE/DELETE) has a matching policy; a missing policy ⇒ implicit deny.

---

## J. Verification plan (post-implementation tests)

Design targets the real flows. Because real Clerk sign-in can't be fully automated in CI (Turnstile/CAPTCHA), split into (a) **RPC-level/PostgREST assertions** using synthetic JWTs and (b) **integration** using the existing E2E harness. Service-role used only to seed/validate test tenants.

**Setup fixtures:** create 2 independent restaurants (A, B), each with owner + (for B at least) a waiter/manager/chef, via `provision_owner`-style definer functions; capture ids.

1. **Owner can access own restaurant.** Authenticated owner-A SELECT `customers`, `orders`, `staff_members` → returns only rows with `restaurant_id = A`; profile row visible (`getProfileState` = `ready`).
2. **Cross-tenant read denied.** Caller in A selects `WHERE restaurant_id = B-uuid` → **0 rows** (PostgREST `content-range: */0`), no error.
3. **Cross-tenant write denied.** Caller in A INSERTs a `customers` row with `restaurant_id = B-uuid` → rejected by WITH CHECK (42501 RLS violation).
4. **Waiter restrictions.** Waiter-A: SELECT `customers` OK (`customers.view`), INSERT `orders` OK (`orders.create`), but INSERT `customers` denied (no `customers.manage`); UPDATE `orders` denied (no `orders.manage`).
5. **Manager permissions.** Manager-A: can INSERT/UPDATE/DELETE customers/orders/reservations/menu (`…manage`), but **cannot** mutate `restaurant_tables` if tables map to `settings.manage` (manager lacks it) — asserts the settings.manage boundary; and SELECT `staff`/UPDATE staff denied without `staff.manage` if manager lacks it (manager HAS `staff.manage` in 0001 → so it should succeed; adjust assertion to a role that lacks it, e.g. verify manager can't touch `settings.manage`-gated tables).
6. **Chef restrictions.** Chef-A: SELECT `orders` OK (`orders.view`); UPDATE `orders` (status) denied (no `orders.manage`); SELECT `customers` denied (no `customers.view`); `staff_members` read denied (no `staff.view`).
7. **Profile lookup after login.** Logged-in owner-A `getProfileState` → `ready` with correct `restaurantId`; embedded `staff_members.status='active'`. Assert no RLS error (rules out recursion on `profiles`+`staff_members`).
8. **Fresh provisioning.** New Clerk sub (no profile) → `getProfileState` = `none` (0 rows) → call `provision_owner` `rpc` as authenticated → returns `created`; second call returns `already`; afterwards `getProfileState` = `ready`. Assert exactly 1 restaurant/staff/profile created (no dupes) and that a second owner for the same restaurant is impossible (partial unique index).
9. **Google OAuth user identity.** Provision a test user whose Clerk `sub` is a Google-attributed id; assert `profiles.id = sub`, and the user can only access their own tenant (same assertions as #1–#3). Verifies TEXT-sub handling end-to-end.
10. **No recursive RLS errors.** Run a representative cross-join query (`orders JOIN order_items JOIN customers`) as owner-A and as waiter-A; assert no `infinite recursion detected in policy for relation` and correct row filtering.

**Automation approach:** use raw PostgREST HTTP calls with a **synthetic Clerk token** containing the desired `sub`/claims (the Third-Party Auth JWT shape) against the `authenticated` role, plus a health check that `0005`/`0006` applied. Keep the 11 existing E2E auth tests green.

---

## J-bis. Risks and architectural gaps (summary)

- **Chef status transitions** — chefs are read-only on `orders`; advancing kitchen status needs a new fine-grained code or `orders.manage`. **Decision needed.**
- **No `menu.*`/`tables.*` codes** — menu uses `inventory.*`, tables use `settings.manage`. Acceptable but naming drift. Document in code comments.
- **Frontend roles vs DB roles drift** (`cashier`, `inventory staff`, `ROLE_NAV`) — keep the DB `roles`/`role_permissions` seed authoritative; align UI picker or accept that extra UI roles are cosmetic until provisioned.
- **`reports.view` maps to no table** — gate a future analytics RPC, not a table.
- **Column-level sensitivity** (`profiles.email`, `staff_members.email`, `pay` fields) — the current model grants whole-row SELECT within the tenant. If PII/financial redaction is required for non-owner roles, add **column-level privileges** or row sub-policies later. Not required for Phase 3 scope, **flag as follow-up**.
- **Force RLS** intentionally deferred — keep table-owner bypass default; add `FORCE` only if an explicit owner-query policy is desired.
- **Helper EXECUTE grants** were over-broadened by `0003` (`GRANT ALL ON ALL FUNCTIONS ... TO anon, authenticated, service_role`). Tightening to `authenticated` + specific funcs is a recommended hardening in `0005`, not a blocker.

---

## Recommended next step

Review this plan. On approval: implement `0005_rls_helpers.sql` then `0006_enable_rls_policies.sql`, then run the §I/§J verification matrix. **RLS stays OFF until the plan is approved and the migrations are reviewed.**
