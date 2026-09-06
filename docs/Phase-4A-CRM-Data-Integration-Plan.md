# Elysian Spire CRM — Phase 4A: CRM Data Integration Audit + Architecture

**Scope:** Audit + architecture ONLY. No code written, no migrations created, no Supabase commands run.
RLS (0001–0006) is live and verified; 4B will implement the CRUD/CRUD service layer on top of it.
**Phase 4B is deliberately out of scope here** except for a recommended scope (section H).

**Grounding:** This report reflects the **actual executed schema** in `supabase/migrations/0001–0006`,
the live helper functions (0005) and RLS policies (0006), the frontend under `src/`, and the seed data in
`src/data/seed.ts`. Where the older `docs/Database-Architecture-Audit.md` differs from the deployed schema
(e.g. money as `bigint` paise vs `NUMERIC(12,2)`, `profiles.role_id` vs `profiles.staff_id`, a separate
`restaurant_settings` table vs settings on `restaurants`, `auth.uid()` vs `auth.jwt() ->> 'sub'`), this
report follows the **deployed schema**, which is the system of record.

---

## A. Frontend audit (data flows, no persistence today)

### A.1 Architecture today

All business data is an in-memory mutable singleton hydrated from hardcoded seed data:

- `src/store/store.tsx` — `store.s: AppState` + `store.ss: StaffState`. Mutated imperatively by action
  helpers. `notify()` bumps a version counter to re-render subscribed React consumers. **Nothing is
  persisted** — `replaceState()` exists (store.tsx:88) but is invoked by no page; it is reserved for the
  service layer ("used by services in future phases" per the comment).
- `src/data/seed.ts` — `seedState` (orders, reservations, tables, customers, menu, staff briefs, settings,
  notif prefs, notifications) + `seedStaffState()` (staff members, custom roles, UI state) + a family of
  **hardcoded analytics constants** (`KPIS`, `REV`, `WEEK_ORDERS`, `WEEK_REV`, `TOP_ITEMS`, `REP`, `TODAY`,
  `NOTIF_POOL`) + the permission/role config tables (`PERMISSION_KEYS`, `ROLE_PERMS`, `ROLE_TYPES`,
  `ROLE_DESC`, `ROLE_NAV`, `PERM_CATS`, `ALL_PERMS`, `PREV`).
- `src/types/index.ts` + `src/types/staff.ts` — frontend entity shapes (see B.1).
- `src/pages/*`, `src/components/layout/*` — read the store via `useStore()`/`useApp()`; mutate in place and
  call `notify()`.

### A.2 Supabase touchpoints today

Only **auth-scoped** code touches Supabase — none of the CRM pages do:

| File | Role |
|---|---|
| `src/lib/supabase.ts` | `createTokenAwareSupabase(getToken)` factory; `isSupabaseConfigured`. The ONLY browser credential is the anon key. |
| `src/lib/useSupabase.ts` | `useSupabase()` → `{supabase, isSupabaseConfigured, getSessionToken}`; accessToken = Clerk session token. |
| `src/services/index.ts` | `getProfileState()` + `provisionRestaurant()` (Phase 2B onboarding/RPC). `persistSnapshot()` **throws** "not wired yet". `inviteMember()`/`onRealtimeEvent()` are local placeholders. |
| `src/components/auth/SessionGate.tsx` | provisioning state machine (uses `getProfileState`). |
| `src/pages/auth/Onboarding.tsx` | 3-field form → `provision_owner` RPC → re-fetch → dashboard. |
| `src/components/dev/DevSupabaseCheck.tsx` | dev-only connectivity check. |

**Confirmed (explore-agent audit of all 9 CRM pages):** no `src/pages/*` CRM page imports `useSupabase`,
`lib/supabase`, or `services/index`; none issues `supabase.from(...)`/`.rpc(...)`. All reads/mutations are
against the in-memory store. Analytics/chart numbers are hardcoded seed constants.

### A.3 Store-slice → page reader/writer matrix

| Slice | Reads (file:line) | Writes / mutations (file:line) |
|---|---|---|
| `s.user` | Dashboard:61, Settings:88/92, Topbar | — (read-only; hydrated by `ClerkHydrator` in App.tsx:78-102) |
| `s.orders` | Dashboard:185, Orders:20/180-203, Customers:32, Sidebar:38 | **Orders** `o.status` (34), `o.pay` (41) |
| `s.reservations` | Reservations, Tables:51, Sidebar:39, Dashboard(counts) | **Reservations** `unshift` (195), `Object.assign` (193) |
| `s.tables` | Tables, Reservations:96/144-148 | **Tables** `t.status` (42) |
| `s.customers` | Customers | **Customers** `c.note` (94) — **no `notify()` (silent bug)** |
| `s.menu` | Menu | **Menu** `push`/`splice`/`Object.assign` (46-57), `it.on` (129) |
| `s.settings` | Settings | **Settings** `s.settings.*` (15-18, 24-25) |
| `s.notifs` | Settings:109-123 | **Settings** `toggleNotif` (30-33) |
| `s.notifications` | Topbar, NotificationsDrawer | **NotificationsDrawer** `read` (21), `splice` (27), `markAll` (32) |
| `ss.members` | StaffRoles + staff/parts + staff/modals | **StaffRoles/modals** `push`(modals:62), `splice`(StaffRoles:156), field writes (resend/suspend/revoke/role) |
| `ss.customRoles` | StaffRoles/modals | **StaffRoles/modals** `push`, `perms.push/splice` |
| `ROLE_PERMS` (seed const) | StaffRoles:4/71/94-97, parts:16 | **StaffRoles** `togglePerm`/`toggleCatAll` mutate the shared constant in place |

### A.4 Hardcoded analytics constants and where consumed

| Constant | seed.ts | Consumed by |
|---|---|---|
| `TODAY` ('2026-08-27') | :116 | Dashboard:66, Reservations (calendar today) |
| `TOP_ITEMS` | :118 | Dashboard:218, Reports:119 |
| `REV` | :126 | Dashboard:33/122-127 (chart) |
| `WEEK_ORDERS`/`WEEK_REV` | :133/134 | Dashboard:34/146 (week chart) |
| `REP` | :136 | Reports:24-27/87/98/112 |
| `KPIS` | :152 | Dashboard:74-96 |
| `NOTIF_POOL` | :162 | live-notification runtime (not a page) |
| `ROLE_TYPES`/`PERM_CATS`/`ALL_PERMS`/`ROLE_PERMS`/`ROLE_DESC`/`ROLE_NAV`/`ROLE_ALL_NAV`/`PREV` | :202-252 | StaffRoles + parts + modals |
| `PERMISSION_KEYS` | :254 | config only (maps UI perm → code) |

Only the **"Recent Orders" table**, **"Available Tables" KPI**, and reservation/order counts read live store
data; every KPI/chart/report figure is a hardcoded constant. This matches `docs/Database-Architecture-Audit.md` §2.

### A.5 Observable defects / inconsistencies (carry into 4B)

1. **Customers note mutation is silent** — Customers.tsx:94 writes `c.note` without `notify()`, and the "Save
   Note" button never calls `notify()`. The only mutation not triggering a re-render.
2. **`ROLE_PERMS` is mutated in place as a shared seed constant** (StaffRoles.tsx:72-97) — survives page
   switches, affects parts.tsx reads; not a per-session slice.
3. **Reservation new-id uses running length** — `'RSV-' + (315 + s.reservations.length)` (Reservations.tsx:195)
   can collide after deletions. The DB uses a true `code` (tenant-scoped unique) + uuid PK, so this resolves.
4. **Sidebar nav is not role-gated** — Sidebar.tsx renders Dashboard/Orders/Reservations/Tables/Customers/
   Menu/Staff/Reports/Settings for every user regardless of `ROLE_NAV`/permission. RBAC UI gating is not
   applied server-visible; RLS protects data, but the nav surface ignores role.
5. **Settings `s.settings.tables`** is a count setting; actual table objects live in `s.tables` and are not
   reconciled (Settings.tsx:77 notes "Apply table changes on the Table Management page"). Hardcoded `|| 13`
   fallback (Settings.tsx:24).
6. **Account card fields in Settings are uncontrolled** (`defaultValue`) — password/name/email edits are not
   persisted and are Clerk-owned (correct — never goes to Supabase).
7. **Dashboard/Reports ×1000 scaling** — Dashboard.tsx:105, Reports.tsx:53 multiply seed arrays by 1000.
8. Legacy `seedState.staff` (StaffBrief ×7) is a **separate, dead dataset** distinct from `ss.members`
   (StaffMember ×7) used by Staff & Roles. Maps to nothing directly; reconcile/drop.

---

## B. Frontend → DB table → permission → CRUD mapping

B.1 is the definitive frontend-entity → DB-table map. Permission codes are the 13 seeded codes; they are
unchanged (no new codes invented). CRUD verbs that RLS + policy allow are called out; keep the RLS decision
(database is the enforcement point; frontend gating is cosmetic UX).

### B.1 Entity → table map

| Frontend entity (type/struct) | DB table (0001) | Key column mapping | Surrogate key | Permission (code) | CRUD allowed by RLS |
|---|---|---|---|---|---|
| `Customer` (name, phone, email, visits, orders, spent, last, fav, note?) | `customers` | name→`name`, phone→`phone`, email→`email`, visits→`visits`, orders→`orders`, spent→`spent`, last→`last_visit_at`, fav→`favorite_item`; **note→ NOT on customers** (→ `customer_notes`) | uuid PK (frontend `Customer` has NO id) | `customers.view`, `customers.manage` | view: all tenant members w/ `customers.view`; create/edit/delete: `customers.manage` |
| `OrderItem` (n,q,p) | `order_items` | n→`item_name`, q→`quantity`, p→`unit_price`, (n·p)→`line_total` | uuid PK | via `orders.*` | RLS `orders` combined w/ `order_items`; assignable under tenant |
| `Order` (id, cust, table, items[], amount, pay, status, time) | `orders` + `order_items` | id→`code`, cust→`customer_id`/`guest snapshot`, table→`table_id`, items[]→`order_items`, amount→`subtotal`+`tax_amount`+`total_amount` (computed), pay→`pay_status`, status→`status`, time→`placed_at` | uuid PK; `code` display (ORD-1042) tenant-unique | `orders.view`, `orders.create`, `orders.manage` | view: `orders.view`; create: `orders.create`; advance status: needs `orders.manage` (see C.2 gap) |
| `Reservation` (id, cust, phone, date, time, guests, table, status, notes) | `reservations` | id→`code` (RSV-308), cust→`guest_name`+`customer_id`, phone→`phone`, date→`reservation_date`, time→`reservation_time`, guests→`guests`, table→`table_id`, status→`status`, notes→`notes` | uuid PK; `code` display tenant-unique | `reservations.view`, `reservations.manage` | view: `reservations.view`; create/edit/status: `reservations.manage` |
| `DiningTable` (id, cap, status) | `restaurant_tables` | id→`label` (T-01), cap→`capacity`, status→`status` | uuid PK; `label` display tenant-unique | `inventory.view`? **no** — tables are NOT under inventory | view: any tenant member (not gated by a permission code today); status change: manager+ via `staff.manage`-adjacent or operational policy (see C.3) |
| `MenuItem` (name, price, on, icon, cat?) | `menu_items` + `menu_categories` | name→`name`, price→`price`, on→`available`, icon→`icon`, cat→`category_id` (via `menu_categories`) | uuid PK | no dedicated menu code — menu edits are `inventory.manage`/`staff.manage`-adjacent; **see C.4** | view: any member; edit/CRUD: restricted by policy |
| `Menu` (Record<cat, MenuItem[]>) | `menu_categories` → `menu_items` | category object → `menu_categories` (+`sort_order`); items → `menu_items` | uuid PKs | — | — |
| `StaffBrief` (legacy) | — | **dead dataset**; superseded by `ss.members`/`staff_members` | — | — | drop |
| `StaffMember` (name, email, role, status, inv?, last, joined, sent?, activity[]) | `staff_members` + `staff_activity` + `roles` + `role_permissions` | name→`name`, email→`email`, role→`role_id`, status→`status`, inv→`inv_status`, last→`last_active_at`, joined→`joined_at`, activity[]→`staff_activity` | uuid PK; role by slug | `staff.view`, `staff.manage` | view: `staff.view`; invite/suspend/revoke/role-change: `staff.manage` |
| `CustomRole` (name, desc, perms[]) | `roles` (`is_custom=true`) + `role_permissions` | name→`name`, desc→`description`, perms[]→`role_permissions` rows | uuid PK (restaurant-scoped for custom) | `staff.manage` | custom-role create/assign: `staff.manage` |
| `Settings` (name, contact, address, open, tables, config) | **`restaurants`** (+ derived `restaurant_tables` count) | name→`restaurants.name`, contact→restaurant contact, address→restaurant address, open→open_hours, tables→count of `restaurant_tables`, config→seating config | restaurant.id (already exists) | `settings.manage` | edit restaurant profile: `settings.manage` |
| `NotifPrefs` (reserve, order, system) | `notification_prefs` | reserve→`reserve`, order→`order_pref`, system→`system_pref` | staff_member_id (UNIQUE) | — (own row) | own-row only |
| `Notification` (msg, time, read) | `notifications` | msg→`message`, time→`created_at`, read→`read_at` (NULL=unread) | uuid PK | — (recipient-scoped) | recipient only; read state update (see known gap: column-grant restriction) |
| `AppUser` (name, email) | `profiles` (+supports display via `full_name`,`email`) | name→`full_name`, email→`email` | profiles.id (TEXT = Clerk sub) | — | self row (via auth.sub) |

### B.2 Permission-code coverage check (13 codes vs seeded)

All 13 seeded codes are represented in `role_permissions` (owner-admin=13, manager=11, waiter=4, chef=1).
Frontend `ROLE_PERMS` uses **human labels**, mapped to codes via `PERMISSION_KEYS` (e.g. "Edit Orders" →
`orders.manage`). This is the single source both seed.ts and 0001 mirror. **No new codes are introduced.**

**Known coverage gaps (carry from Phase 3, unchanged):** `inventory.view`/`inventory.manage`/`reports.view`
exist as valid seeded codes but have **no table/policy bound to them** in the current app because: inventory
has no feature (roles `Cashier`/`Inventory Staff` are config-only, not DB roles), and reports are computed
(no `reports` table). This is intentional — the codes are reserved for future features, not dead.

### B.3 Identification resolution principles (for the service layer)

- `profiles.id` (= Clerk `sub`, TEXT) → `staff_members.id` via `profiles.staff_id` (UUID UNIQUE).
- `staff_members.role_id` → `roles.id`; role slug (`owner-admin/reserved`) is the policy key.
- Display codes (`ORD-1042`, `RSV-308`, `T-01`) are **columns with tenant-scoped unique constraints, never
  PKs**. The service layer must generate them (see D.4 code-generation), not reuse legacy sequential logic.
- Derive `restaurant_id` from `current_restaurant_id()` (0005 helper) for any query/mutation; never trust a
  client-supplied `restaurant_id`.

---

## C. Permission / RLS → frontend-operation mapping + gaps

C.1 states the live RLS behavior (verified after 0006) the 4B service layer must write against.

### C.1 Live RLS / policy posture (post-0006)

- All 16 tables: `relrowsecurity=true`, `relforcerowsecurity=false`. 64 policies, all `TO authenticated`.
- anon has no access (empty read arrays proven).
- Identity helpers (0005): `current_clerk_user_id()`, `current_restaurant_id()`, `current_staff_id()`,
  `current_restaurant_role_slug()`, `has_permission(text)` — SECURITY DEFINER, stable, auth-path only.
- **ALL** business-table policies filter on the caller's `restaurant_id` (multi-tenant-safe).

### C.2 Confirmed functional gaps (must inform 4B scope)

1. **Chef cannot advance order status** — chef has only `orders.view`; "advance status"
   (New→Preparing→Ready→Completed) is a write on `orders`. Frontend Orders.tsx:34 does `o.status = SEQ[i+1]`
   for the logged-in user regardless of role. Under RLS this write requires a policy the chef lacks.
   **Decision needed in 4B:** grant chef a narrow "advance status" capability without full `orders.manage`,
   or restrict the UI so chef only views. (Recommend: do not invent a new code; reuse `orders.manage` and
   gate the UI, OR add a scoped `orders.update_status` policy — flag for user decision.)
2. **`profiles` UPDATE is denied entirely** (by design, prevents cross-tenant relink escalation). The 4B
   service layer must NOT attempt profile edits from the client beyond what RLS allows; profile display
   name/email sync should stay Clerk-driven (as today).
3. **`notifications.read_at` can't be column-restricted via RLS** — needs column-level grants (follow-up from
   Phase 3). The drawer's markRead (frontend) maps to updating `notifications.read_at`; the service layer
   may need a SECURITY DEFINER RPC or column grant to allow recipient-scoped read-state updates (see E.4).

### C.3 Tables with no direct permission code (design note)

`restaurant_tables`, `menu_categories`, `menu_items`, `order_items`, `staff_activity`, `customer_notes`,
`notifications`, `notification_prefs` are reached **through their parent feature's permission**, not a
dedicated code. The 4B service layer should gate at the **feature/module** boundary using the parent code
(e.g. a table-status write is a manager/operational action; menu edit is under `staff.manage`/manager+; a
customer note write is under `customers.manage`).

**Flag:** there is currently **no `menu.manage` code**. Menu CRUD (Menu.tsx) must be bound to an existing
operational code or policy. Since menu edits are today unrestricted in the UI, recommend mapping menu CRUD
to a manager+ policy (like `roles`/`role_permissions` admin roles) — **decision for user** (option: add a
seeded `menu.manage`/reuse `staff.manage`; no new magic codes).

### C.4 Frontend RBAC gating gap

`ROLE_NAV`/`ROLE_PERMS` exist but **Sidebar.tsx ignores them** — every signed-in user sees all nav items and
pages render regardless of role. RLS prevents data leakage, but a waiter hitting `/staff` would get an
empty/auth-denied view rather than a clean gate. 4B should add **frontend route/menu gating from the DB
permission set** (via `has_permission`/role slug) as a UX layer on top of RLS.

---

## D. Mock-data migration plan (seed → persisted, no fake data in DB)

0001 deliberately **seeds no demo data** (per its header). The mock datasets are frontend-only today
(`src/data/seed.ts`). The migration plan is a **service-layer loading strategy**, NOT a DB backfill that
writes fake rows into production.

### D.1 Principle

- **Production DB stays clean** — no ORD-1042, RSV-308, "Arjun Mehta" demo customers, or fake analytics are
  inserted into `customers`/`orders`/etc. The current empty CRM tables (=0 rows, verified) remain the real
  state; the app will show empty views until real data is entered.
- Seed.ts becomes a **cold-start/fallback only** while the service layer is being wired, then is removed.
- Analytics are **never stored** — they are computed from persisted transactional tables (matches
  Database-Architecture-Audit §2 / no-generic-analytics-tables).

### D.2 Migration path

| Phase-step | Action |
|---|---|
| 1. Service adapters per entity | Add `src/services/<entity>.ts` returning real rows from Supabase (no write of mock). |
| 2. Keep seed as fallback | During transition, `replaceState(...)` hydrates from Supabase when available; otherwise current seed for dev. |
| 3. Load-then-write | On first real interaction, the service writes real rows; store reflects Supabase, not seed. |
| 4. Remove seed slices | Once all services hydrate, retire the mock slices from `seedState`/`seedStaffState` and the analytics constants. |
| 5. Optional dev seeding (NOT prod) | For local/dev only, an opt-in `npm run seed:dev` could insert demo rows; never runs against the linked prod project. *(Decision needed: include dev-only seeding?)* |

### D.3 Identity/key remap (mock → real)

| Mock id | Real key |
|---|---|
| `ORD-1042` | `orders.code` (generated, tenant-unique) + uuid PK |
| `RSV-308` | `reservations.code` (generated, tenant-unique) + uuid PK |
| `T-01` | `restaurant_tables.label` (tenant-unique) + uuid PK |
| `Customer` (no id) | `customers` uuid PK |
| customer refs by **name string** (e.g. `Orders.cust === 'Arjun Mehta'`) | `customer_id` uuid FK (resolve name→row; fall back to `guest_name` snapshot) |
| table refs by label string | `table_id` uuid FK |
| staff role by display name ("Waiter") | `role_id` via `roles.slug` |

**Critical refactor note:** the frontend compares orders/reservations/customers **by display string**
(`Orders.tsx` `o.cust`, `Customers.tsx` `c.name`, `Tables.tsx` `r.table`). The service layer must replace
these string joins with FK joins (or the page selectors must, via a hydrated map) — see F.2.

### D.4 Display-code generation

The service layer must generate `ORD-####` / `RSV-###` / `T-##` codes tenant-scoped. Two options:
(a) app-side read latest `code` then +1 (racy), or (b) a small SECURITY DEFINER function/RPC returning the
next code atomically using the tenant-scoped unique constraint. **Recommend (b)** to avoid the Reservation
.tsx:195 length-based collision bug. *(See H for whether this is 4B-included.)*

---

## E. Service / hook / type architecture

### E.1 Layering

Keep the existing seam pattern (`src/services/index.ts`, `src/lib/useSupabase.ts`) and extend it. Files:

```
src/lib/supabase.ts        (unchanged — factory; keep as-is)
src/lib/useSupabase.ts     (unchanged — hook returns the token-aware client)
src/types/index.ts         (extend: add id/DB-mapped fields, permission gating helper types)
src/types/staff.ts         (extend: add staff_member id/role_id mapping)
src/store/store.tsx        (unchanged shape; replaceState is the hydration entry)
src/services/
  index.ts                 (keep provisioning; re-export entity services)
  profiles.ts              (getProfileInfo — display read, Clerk-driven)
  customers.ts             (list/get/create/update, addNote via customer_notes)
  reservations.ts          (list/create/update/status, code gen)
  tables.ts                (list/setStatus)
  orders.ts                (list + items/create/advanceStatus/markPaid)
  menu.ts                  (categories+items list/CRUD/toggle)
  staff.ts                 (members list, invite/suspend/revoke/role-change/activity, custom roles)
  notifications.ts         (list own/markRead/remove/generate)
  settings.ts              (get/update restaurant profile + notif prefs)
  analytics.ts             (dashboard/reports aggregates computed from orders/reservations)
src/hooks/
  useCustomers.ts, useReservations.ts, ...   (thin data hooks over services + useSupabase)
```

### E.2 Data-hook pattern

- Each `use<Entity>()` hook uses `useSupabase()` to get the token-aware client, calls the matching service on
  mount (and on refetch triggers), returns `{data, loading, error, refetch}`.
- On load the hook calls `replaceState(nextS, nextSS)` (store.tsx:88) to hydrate the store once; page
  mutations continue to mutate store + `notify()` for instant UI, then the service persists the change to
  Supabase (optimistic update with reconcile-on-error).
- Realtime (`onRealtimeEvent`, currently a no-op) can later push triggered updates through the same hydrate.

### E.3 Types

- Keep UI/display shapes for pages (minimal churn).
- Add **DB-shaped types** (e.g. `CustomerRow`, `OrderRow`, `OrderItemRow`) with FK ids + `code`/`label`.
- Add a `has(perm)`/`roleSlug()` helper derived from `current_restaurant_role_slug()`/`has_permission()`
  served once at session load to drive route/menu gating (C.4) — not per-render DB calls.

### E.4 Write-safety against live RLS

Every client write must comply with 0006:
- Use the token-aware client (Clerk session on every request) — never the anon/service-role key.
- Scope reads/writes via `current_restaurant_id()`; never trust client-supplied `restaurant_id`.
- `orders` status advance + `notifications.read_at`: if RLS forbids the direct write, add a narrow
  SECURITY DEFINER RPC (post-0006, additive migration) — see C.2/C.3 and known gaps. **No modification to
  0001–0006.**

---

## F. Module order / migration sequence (recommended build order for 4B)

Dependency-ordered: identity helpers already exist; build reference data before transactional, notifications
last. Each module = 1 service + 1 hook + page wiring.

1. **Identity & session** — confirm `useSupabase` client, expose `roleSlug`/`has(perm)` once from
   `current_restaurant_role_slug()` at gate; wire **route/menu RBAC gating** (C.4). No new table.
2. **Reference data**
   - `restaurant_tables` (list/setStatus; fix string→FK) — Tables page.
   - `menu_categories` + `menu_items` (list/CRUD/toggle) — Menu page. *(Needs C.3 menu-permission decision.)*
3. **Customers + customer_notes** — Customers page; hydrate `customers` and notes; fix silent-note bug (A.5.1).
4. **Reservations** (list/create/update/status + code gen) — Reservations page; fix id collision (A.5.3).
5. **Orders + order_items** (list/create/advanceStatus/markPaid; subtotal/tax/total computed at write) —
   Orders page. *(Needs C.2 chef-advance decision.)*
6. **Staff & Roles** — `staff_members` + `staff_activity` + roles/role_permissions read; invite/suspend/
   revoke/role-change (+ custom roles) under `staff.manage` — StaffRoles page; reconcile legacy `staff`
   briefs (A.5.8).
7. **Notification prefs + notifications** — Settings notif toggles → `notification_prefs`; drawer →
   `notifications` (read state via E.4). *(Needs read_at column-grant/RPC.)*
8. **Settings/restaurant profile** — map `s.settings` → `restaurants` (+ derived table count) — Settings page.
9. **Analytics (computed)** — replace `KPIS`/`REV`/`WEEK_*`/`TOP_ITEMS`/`REP` with queries over
   orders/reservations/customers — Dashboard + Reports. *(No analytics tables.)*
10. **Seed retirement** — drop mock slices + analytics constants once 7/8/9 hydrate (D.2 step 4).

**Sequence rationale:** 1 unlocks gating; 2–5 are the transactional core the dashboard depends on; 6–8 are
ops/settings; 9 depends on 3–5; 10 is cleanup. Steps 2–5 unblock the currently mock-heavy day-to-day pages first.

---

## G. Compatibility audit (what must stay green / not break)

### G.1 Backend invariants (do not violate in 4B)
- Do **not** modify 0001–0006. Any new DB objects are **additive** (new RPCs/column-grants only), created
  in migration 0007+.
- Keep `auth.jwt() ->> 'sub'` identity; never `auth.uid()` for Clerk subs.
- `provision_owner` and helpers stay SECURITY DEFINER with pinned `search_path`; least-privilege grants.
- No service-role key in frontend; token-aware client only.
- No new permission codes; no duplicate tables; no RLS disable/weakening.

### G.2 Frontend / build / test compatibility
- Keep `src/types/index.ts`/`staff.ts` UI shapes working for pages; add DB types alongside (avoid churn).
- Keep `seedState`/`seedStaffState` importable during transition so dev/e2e still render before hydration.
- `tests/e2e/auth.spec.ts` (11 tests) must remain green — auth/onboarding flow unaffected by CRM service
  wiring; do not change `SessionGate`/`Onboarding`/`provision_owner` behavior.
- `tsc` and `vite build` must exit 0 after each module.
- Store contract: pages mutate `s`/`ss` + `notify()`; the service layer persists via `replaceState()` on load
  and optimistic write-through on mutation. Do not change the `useStore()`/`useApp()` shape that pages rely on.

### G.3 Data-compat notes
- `customers.visits/orders/spent` are DERIVED counters — 4B should recompute from `orders` (not hand-write),
  matching Database-Architecture-Audit design.
- Money: store/read `NUMERIC(12,2)`; the service computes `subtotal`/`tax_amount`/`total_amount` at write.
- String→FK refactor (D.3) is the highest-touch compatibility risk (Orders/Customers/Tables/Reservations all
  join by display string); do it within each module, not as one sweeping change.

### G.4 UI/RBAC
- Sidebar/page gating (C.4) is additive UX and must degrade gracefully (a user without a page's permission
  gets RLS-denied empty data, not a crash).
- `rolePermissions`/`ROLE_PERMS` mutation (A.5.2) should be migrated to `role_permissions` reads/writes so
  the shared constant is no longer mutated.

---

## H. Phase 4B recommended scope

### In scope (first slice, highest value/lowest risk)
1. **Identity session wiring + RBAC gating** (F.1) — expose `roleSlug`/`has(perm)`, gate sidebar/routes from
   the DB permission set. Purely additive; unlocks safe multi-role UI.
2. **Reference data**: `restaurant_tables` + `menu` (F.2) — full list/CRUD against Supabase. Unblocks two
   pages; clear schema; no cross-entity string joins except table/menu labels.
3. **Customers + customer_notes** (F.3) — list/create + note; fix silent-note bug; hydrate + optimistic
   write. Establishes the service/hook pattern for the rest.
4. **Reservations** (F.4) — list/create/update/status + **code generation RPC**; fix id collision.
5. **Orders + order_items** (F.5) — list/create/advanceStatus/markPaid; computed totals. *(Resolve chef-
   advance decision in C.2 first.)*
6. Additive DB migration (0007) containing only: order-status RPC (if decided), menu-permission policy (if
   decided), code-generation function, and optional `notifications.read_at` column grant / RPC — **no schema
   change to existing tables, no RLS weakening.**

### Deferred to later phases (explicitly NOT 4B)
- **Analytics computation** for Dashboard/Reports (F.9) — depends on orders/reservations being fully
   hydrated; keep hardcoded constants until 2–5 ship.
- **Realtime subscriptions** (replacing `onRealtimeEvent` no-op), notifications generation, invitation
   lifecycle through Clerk, custom-role full management — ops/advance features.
- **Dev-only demo seeding** and legacy `staff`/analytics seed retirement cleanup.

### Decisions requested before 4B code starts
1. **Chef order-status advance** (C.2.1): scope-narrow RPC/policy vs UI-gate-only.
2. **Menu permission code** (C.3): reuse `staff.manage`/manager+ policy vs additive `menu.manage` seeded code.
3. **Dev-only seeding** (D.2.5): include `npm run seed:dev` (non-prod) or keep prod-clean only.
4. **Notifications read_at** (C.2.3/E.4): column grant vs SECURITY DEFINER RPC.

---

*Phase 4A complete. No code, no migrations, no Supabase commands were run. 4B implementation awaits the four
decisions above.*
