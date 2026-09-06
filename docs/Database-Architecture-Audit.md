# Elysian Spire CRM — Database Architecture Audit

**Scope:** Research + planning only. No code modified, no tables created, no SQL written.
**Purpose:** Establish the Supabase persistence layer to sit behind the existing React + Vite frontend, with Clerk as the single auth authority.
**Method:** Full inspection of `src/` (pages, routes, types, store, seed data, services, layout, auth wiring).

---

## 0. What the codebase is today

A single-restaurant management CRM with 9 authenticated routes + 4 auth routes. All business data lives
**in-memory** in a mutable singleton store (`src/store/store.tsx`) hydrated from hardcoded seed data
(`src/data/seed.ts`). There is **no backend, no persistence, no realtime, no user-per-restaurant scoping** yet.
Every write mutates the in-memory object and bumps a version counter to re-render React consumers.

**Auth:** Clerk (`@clerk/react`). `useAuth`/`useUser` gates routes via `RequireAuth`/`GuestOnly`.
`s.user` (name + email) is a cosmetic mirror hydrated from the Clerk user — it is **not** a persistence
mechanism. Clerk is and must remain the auth authority.

**Supabase:** `src/lib/supabase.ts` exists (singleton `supabase` client, `isSupabaseConfigured` flag).
Not yet consumed anywhere. The `src/services/index.ts` layer is an explicitly marked "future integration
seam" for Supabase persistence, currently throwing `persistSnapshot` "not wired yet."

---

## 1. Pages and routes

| Route | Page | Reads from store | Writes to store | Data form |
|---|---|---|---|---|
| `/login` `/signup` `/forgot` `/sso-callback` | auth (Clerk) | — | — | Clerk only |
| `/dashboard` | Dashboard | all (KPIs, orders, reservations, tables) | — | mock seed + hardcoded analytics |
| `/orders` | Orders | `orders` | status/payment advance | mock |
| `/reservations` | Reservations | `reservations`, `tables` | create/edit reservation | mock |
| `/tables` | Tables | `tables`, `reservations` | table status | mock |
| `/customers` | Customers | `customers`, `orders` | customer note | mock |
| `/menu` | Menu | `menu` (categories → items) | CRUD items, toggle | mock |
| `/staff` | Staff & Roles | `ss.members`, `customRoles`, role tables | invite, role, suspend, remove, perms | mock |
| `/reports` | Reports | — | — | hardcoded analytics arrays |
| `/settings` | Settings | `settings`, `notifs`, `user` | settings, notif prefs | mock |

---

## 2. Dashboard widgets and metrics

All dashboard/report numbers are **hardcoded constants** exported from `src/data/seed.ts`:
`KPIS`, `REV`, `WEEK_ORDERS`, `WEEK_REV`, `TOP_ITEMS`, `REP`, `NOTIF_POOL`. The only live data are the
"Recent Orders" table (reads `s.orders`) and the "Available Tables" KPI (derived from `s.tables`).

**Analytics should NOT get their own tables.** They are aggregate projections that must be *computed from
the persisted transactional tables* (orders, reservations, customers). Today they are fake; once orders/
reservations/customers persist, the dashboard queries those tables directly (or a materialized rollup in
Phase 3).

---

## 3. Existing mock / static / local data inventory

All in `src/data/seed.ts` unless noted:

| Dataset | Location | Notes |
|---|---|---|
| Orders ×10 | `seedState.orders` | id string `ORD-####` |
| Reservations ×7 | `seedState.reservations` | id string `RSV-###` |
| Tables ×13 | `seedState.tables` | id `T-##`, cap, status |
| Customers ×10 | `seedState.customers` | **no id field** |
| Menu (4 cats, 15 items) | `seedState.menu` | categorical object |
| Staff briefs ×7 | `seedState.staff` | legacy dashboard staff list |
| Settings | `seedState.settings` | restaurant profile |
| Notif prefs | `seedState.notifs` | 3 flags |
| Notifications ×4 | `seedState.notifications` | msg/time/read only |
| Staff members ×7 | `states` via `seedStaffState()` | `StaffMember[]` w/ activity |
| Custom roles | `customRoles` (empty) | `CustomRole[]` |
| Role definitions | `ROLE_TYPES`, `ROLE_PERMS`, `ROLE_DESC`, `ROLE_NAV`, `PERM_CATS`, `ALL_PERMS`, `PERMISSION_KEYS` | **static config, not data** |
| Analytics | `KPIS`, `REV`, `TOP_ITEMS`, `REP`, `WEEK_*`, `NOTIF_POOL` | hardcoded |

---

## 4. TypeScript entity definitions (source of truth for columns)

From `src/types/index.ts` and `src/types/staff.ts`:

- **Order** — id, cust(string), table(string), items`{n,q,p}[]`, amount, pay, status, time
- **Reservation** — id, cust, phone, date, time, guests, table, status, notes
- **DiningTable** — id, cap, status
- **Customer** — name, phone, email, visits, orders, spent, last, fav, note?
- **MenuItem** — name, price, on, icon, cat?
- **Menu** — `Record<category, MenuItem[]>`
- **StaffBrief** — name, role, phone, email, status, last (legacy)
- **Settings** — name, contact, address, open, tables, config
- **NotifPrefs** — reserve, order, system (flags)
- **Notification** — msg, time, read
- **AppUser** — name, email (Clerk mirror)
- **StaffMember** — name, email, role, status, inv?, last, joined, sent?, activity`[]`
- **CustomRole** — name, desc, perms`[]`
- **ActivityEntry** — t, d

**Key gap:** `Customer`, `MenuItem`, `StaffMember`, `Settings`, `Notification`, `CustomRole` all lack a
stable primary key. Orders/reservations/tables use human-facing string ids (`ORD-1042`, `T-01`). Any schema
migration must introduce surrogate keys while preserving these display strings.

---

## 5. Forms and their fields (per feature)

| Form/Modal | Fields | Persist-worthy |
|---|---|---|
| Reservation add/edit | cust, phone, date, time, guests, table, status, notes | ✅ reservations |
| Customer note | note textarea (customer drawer) | ✅ customer_notes |
| Menu item add/edit | name, category, price, on, icon | ✅ menu_items + categories |
| Invite staff | full name, email, role | ✅ staff/invitations |
| Change role | new role | ✅ staff_member.role_id |
| Create custom role | name, desc, permissions[] | ✅ roles + role_permissions |
| Settings (restaurant) | name, contact, address, open | ✅ restaurant/settings |
| Settings (tables) | tables count, config | ✅ tables (derived) |
| Settings (notifs) | reserve/order/system toggles | ✅ notification_prefs |
| Account (settings) | name, email, password | Clerk-owned (NOT Supabase) |

---

## 6. Existing services / data layers

- `src/store/store.tsx` — mutable in-memory singleton + `notify()`, `toast()`, React context. **The current DB.**
- `src/services/index.ts` — declared future Supabase integration seam (`persistSnapshot` throws "not wired yet"; `inviteMember`/`onRealtimeEvent` are local placeholders).
- `src/lib/supabase.ts` — unconfigured-but-ready singleton client.
- `src/lib/clerk.ts` — Clerk frontend seam (publishable key only; secret never in frontend).
- Clerk renders/guards auth; OAuth is Google via Clerk.

---

## 7. Feature → entity mapping (mock vs persist)

| Feature | Entity name | Required fields (from UI/interfaces) | Relationships | Currently mock? | Persist in Supabase? |
|---|---|---|---|---|---|
| Customers | `customers` | name, phone (email, visits, orders, spent, last, fav, note) | → orders, reservations, notes, activity | ✅ mock | ✅ yes |
| Reservations | `reservations` | cust, date, time, guests, table, status (phone, notes) | → customer, table | ✅ mock | ✅ yes |
| Tables | `tables` | id, cap, status | → reservations, orders | ✅ mock | ✅ yes |
| Orders / POS | `orders` | id, cust, table, items[], amount, pay, status, time | → customer, table, order_items | ✅ mock | ✅ yes (+ `order_items`) |
| Menu | `menu_categories` / `menu_items` | name, price, on, icon (category) | → categories→items→order_items→menu(2 halves) | ✅ mock | ✅ yes |
| Inventory | *(none — feature not implemented; `Inventory Staff` role + perms exist only as config)* | — | — | n/a | ⚠️ Phase 3 (only if built) |
| Staff | `staff_members` | name, email, role, status (inv, joined, last, activity) | → roles, → Clerk user/profile | ✅ mock | ✅ yes |
| Roles / permissions | `roles`, `role_permissions` | name, desc, perms[] | → staff_members; static role tables → seeded config | ✅ mock | ✅ yes (config seed) |
| Notifications | `notifications` | msg, time, read (message text, created_at, read_at) | → generated per-entity (order/reservation events) | ✅ mock | ✅ yes |
| Settings | `settings` (restaurant) | name, contact, address, open, tables, config | 1:1 with restaurant/workspace | ✅ mock | ✅ yes |
| Notification prefs | `notification_prefs` | reserve, order, system | → user/profile | ✅ mock | ✅ yes |
| Analytics | *(none)* | — | aggregate of orders/reservations/customers | ✅ fake constants | ❌ no table — compute |

---

## A. Complete list of database entities

1. profiles (Clerk-linked user identity + display name/email)
2. roles (built-in + custom roles, name+description)
3. role_permissions (role → permission mapping)
4. staff_members (role, status, joined, last-active; links profile + role)
5. staff_activity (staff audit timeline entries)
6. customers (with derived columns / split aggregates)
7. customer_notes (freeform guest notes)
8. reservations (bookings, table + customer refs)
9. tables (restaurant seating)
10. orders (POS/service headers)
11. order_items (line items linking orders ↔ menu_items)
12. menu_categories (menu groupings)
13. menu_items (dishes/prices/availability/icon)
14. notifications (in-app feed + read state)
15. notification_prefs (per-user toggles)
16. restaurant_settings (single-row workspace config)
17. inventory_items + inventory_transactions (Phase 3, only if feature is built — see note)

---

## B. Proposed tables

Naming: `snake_case`, `id uuid PK default gen_random_uuid()`, `created_at/updated_at timestamptz`.
Money stored as `bigint` in **paise** (₹ integer subunits) to avoid float error. Refs as `uuid`.

### 1. `profiles`
- **Purpose:** Supabase-side identity record keyed 1:1 to a Clerk user. Clerk is source of truth for auth/password; this holds the CRM display identity + role pointer.
- Columns:
  | col | type | null? | notes |
  |---|---|---|---|
  | id | uuid | PK | = Clerk `sub` (user id) |
  | restaurant_id | uuid | NOT NULL | workspace scope (Phase-1 default single-row) |
  | email | text | NOT NULL | from Clerk |
  | full_name | text | nullable | from Clerk |
  | role_id | uuid | FK → roles.id | the user's role |
  | status | text | NOT NULL default 'Active' | Active/Pending/Suspended |
  | created_at / updated_at | timestamptz | NOT NULL | |

### 2. `roles`
- **Purpose:** Built-in (Admin, Manager, Waiter, Chef, Cashier, Inventory Staff) + custom roles.
- Columns: `id uuid PK`, `restaurant_id uuid FK`, `name text NOT NULL`, `description text`, `is_custom boolean default false`, `created_at/updated_at`.
- Seeds: the 6 built-ins are created at setup; custom ones are user-created.

### 3. `role_permissions`
- **Purpose:** The permission matrix (`PERMISSION_KEYS` — e.g. `orders.create`, `staff.manage`).
- Columns: `id uuid PK`, `role_id uuid FK → roles`, `permission text NOT NULL`, `UNIQUE(role_id, permission)`.
- Seeds from `PERMISSION_KEYS`/`ROLE_PERMS`.

### 4. `staff_members`
- **Purpose:** Staff record per person (mirrors `StaffMember`), regardless of whether they've created a Clerk account yet.
- Columns: `id uuid PK`, `restaurant_id uuid FK`, `name text NOT NULL`, `email text NOT NULL`, `role_id uuid FK → roles`, `status text ('Active'|'Pending'|'Suspended')`, `inv_status text ('Pending'|'Accepted'|'Expired'|'Revoked')`, `last_active_at timestamptz`, `joined_at timestamptz`, `UNIQUE(email, restaurant_id)`.
- **Note:** once a `profiles` row exists for the same email, link via `profiles.staff_id` (or staff.profile_id) so a Clerk sign-in resolves to a staff record.

### 5. `staff_activity`
- **Purpose:** `StaffMember.activity[]` timeline entries (role changed, logged in, invitation sent…).
- Columns: `id uuid PK`, `staff_member_id uuid FK`, `title text`, `detail text`, `created_at timestamptz`.

### 6. `customers`
- **Purpose:** Guest directory. Add a surrogate `id` (seed customers have none).
- Columns: `id uuid PK`, `restaurant_id uuid FK`, `name text NOT NULL`, `phone text nullable`, `email text nullable`, `visits int default 0`, `orders int default 0`, `spent bigint default 0` (paise), `last_visit_at timestamptz`, `favorite_item text nullable`, `note text nullable`, `created_at/updated_at`.
- **Derived:** `visits/orders/spent` are maintainable counters; prefer recomputing from `orders` via trigger or app logic later (Phase 3).

### 7. `customer_notes`
- **Purpose:** Freeform notes (the customer drawer textarea).
- Columns: `id uuid PK`, `customer_id uuid FK`, `author_staff_id uuid FK → staff_members`, `note text NOT NULL`, `created_at timestamptz`.

### 8. `tables`
- **Purpose:** Seating plan (`DiningTable`).
- Columns: `id uuid PK`, `restaurant_id uuid FK`, `label text NOT NULL UNIQUE` (the `T-01` display string), `capacity int NOT NULL`, `status text ('available'|'occupied'|'reserved')`, `created_at/updated_at`.

### 9. `reservations`
- **Purpose:** Bookings.
- Columns: `id uuid PK`, `restaurant_id uuid FK`, `customer_id uuid FK → customers` (nullable; name fallback), `guest_name text`, `phone text nullable`, `table_id uuid FK → tables` (nullable), `date date NOT NULL`, `time time NOT NULL`, `guests int NOT NULL`, `status text ('Pending'|'Confirmed'|'Completed'|'Cancelled')`, `notes text`, `created_at/updated_at`.
- Keep `code text UNIQUE` (`RSV-308`) as the display reference.

### 10. `orders`
- **Purpose:** POS/service header.
- Columns: `id uuid PK`, `restaurant_id uuid FK`, `code text UNIQUE` (`ORD-1042`), `customer_id uuid FK → customers` (nullable), `table_id uuid FK → tables` (nullable), `pay_status text ('Paid'|'Unpaid'|'Refunded')`, `status text ('New'|'Preparing'|'Ready'|'Completed'|'Cancelled')`, `amount bigint NOT NULL` (paise, total), `placed_at timestamptz`, `created_at/updated_at`.

### 11. `order_items`
- **Purpose:** Line items (`Order.items[]{n,q,p}`).
- Columns: `id uuid PK`, `order_id uuid FK → orders`, `menu_item_id uuid FK → menu_items` (nullable), `name text NOT NULL` (snapshot for history), `price bigint NOT NULL` (paise, unit), `qty int NOT NULL`, `line_total bigint NOT NULL`.

### 12. `menu_categories`
- **Purpose:** Menu groupings (Starters, Main Course, Drinks, Desserts).
- Columns: `id uuid PK`, `restaurant_id uuid FK`, `name text NOT NULL`, `sort_order int default 0`, `UNIQUE(restaurant_id, name)`.

### 13. `menu_items`
- **Purpose:** Dishes.
- Columns: `id uuid PK`, `restaurant_id uuid FK`, `category_id uuid FK → menu_categories`, `name text NOT NULL`, `price bigint NOT NULL` (paise), `available boolean default true`, `icon text nullable` (icon key), `created_at/updated_at`.

### 14. `restaurant_settings`
- **Purpose:** Single-row (or per-restaurant) configuration (`Settings`).
- Columns: `id uuid PK`, `restaurant_id uuid FK UNIQUE`, `name text NOT NULL`, `contact text`, `address text`, `open_hours text`, `tables_count int`, `config text`, `updated_at timestamptz`.

### 15. `notifications`
- **Purpose:** In-app feed (`Notification`).
- Columns: `id uuid PK`, `restaurant_id uuid FK`, `recipient_staff_id uuid FK → staff_members`, `message text NOT NULL`, `type text ('reservation'|'order'|'system')`, `read_at timestamptz nullable`, `created_at timestamptz`.

### 16. `notification_prefs`
- **Purpose:** Per-user toggles (`NotifPrefs`).
- Columns: `id uuid PK`, `staff_member_id uuid FK UNIQUE`, `reserve boolean default true`, `order boolean default true`, `system boolean default false`.

### 17 / 18. `inventory_items`, `inventory_transactions` — **DEFERRED (Phase 3)**
- There is **no inventory feature** in the CRM today. Inventory exists only as an `Inventory Staff` role + `inventory.*` permissions in seed config. Recommend **not creating these tables** until the feature is built, per the "no generic tables" constraint.

---

## C. Relationship map

```
restaurant (workspace scope)
   │
   ├── profiles ────────────── staff_members (via email/staff_id) ── staff_activity
   │        └── role_id ── roles ── role_permissions
   │                              └── notification_prefs
   ├── customers
   │      ├── customer_notes
   │      ├── reservations
   │      └── orders
   ├── tables
   │      ├── reservations
   │      └── orders
   ├── menu_categories
   │      └── menu_items ───── order_items ── orders
   ├── orders ───────────────── order_items
   ├── notifications
   └── restaurant_settings
```

```
customers
   ├── customer_notes        (1:N)
   ├── reservations          (1:N)
   ├── orders                (1:N)
   └── (activity)            → derived from orders/reservations

orders
   ├── customers             (N:1)
   ├── tables                (N:1)
   └── order_items           (1:N) ── menu_items (N:1)

reservations
   ├── customers             (N:1)
   └── tables                (N:1)

staff_members
   ├── roles                 (N:1)
   ├── staff_activity        (1:N)
   ├── notification_prefs    (1:1)
   └── profiles              (1:1 when signed in)

roles ── role_permissions    (1:N)
```

---

## D. Multi-user architecture (Clerk → Supabase mapping)

**Principle:** Clerk owns *authentication* (who can sign in, credentials, OAuth, sessions, 2FA).
Supabase owns *data + authorization* (what a signed-in user may read/write). Clerk's stable
`user.id` (= the `sub` claim in the Clerk JWT) is the `profiles.id` PK. This makes an unbroken
link: the Clerk session JWT → `auth.uid()` → profiles → role → data access.

**Mapping flow:**
1. User signs in via Clerk. The frontend has `user.id`, `email`, `fullName`.
2. On first load, the app calls a Supabase `handle_new_user()` trigger/SP (or checks) that upserts a
   `profiles` row with `id = clerk_user_id`.
3. `profiles.staff_id` (or matching by email in `staff_members`) attaches the person to their staff record
   and role. An invited staff member who signs up gets linked to their pre-created `staff_members` row.
4. `profiles.role_id → roles → role_permissions` resolves the permission set. The frontend still enforces
   nav/UI gating (as today), but **Row Level Security uses the same role to enforce data access server-side**.

**Role → access model (from `ROLE_NAV` + `ROLE_PERMS`):**
- **Owner/Admin**: full access to all CRM modules/tables.
- **Manager**: operations + staff + reports; no Settings-only actions not granted.
- **Waiter**: view/create orders, view reservations + customers.
- **Chef**: view orders (kitchen pipeline) only.
- *Cashier / Inventory Staff / custom roles* are modelled the same way via `role_permissions`.

**Scoping:** every business table carries `restaurant_id`. All RLS policies filter on the caller's
`restaurant_id` (from their profile) so data is never shared across restaurants — even though the app is
currently single-restaurant, the column future-proofs multi-tenant.

---

## E. Security plan — Row Level Security (NOT implemented)

- Enable RLS on **every table**; default-deny.
- Resident auth: `WITH CHECK` / `USING` policies driven by `auth.uid()`.
- Policies reference `profiles` (role) + `restaurant_id`:

| Table | Read | Write |
|---|---|---|
| profiles | own row (`id = auth.uid()`); admin/manager sees staff | owner/self edits limited fields; role changes admin-only |
| roles, role_permissions | any auth'd member | Admin/Manager only |
| staff_members, staff_activity | Admin/Manager; member sees own | Admin/Manager (Owner for suspend/remove) |
| customers, customer_notes | any member | waiter+ create; manager+ edit |
| reservations | any member | create waiter+; edit/cancel manager+ |
| tables | any member | manager+ status |
| orders, order_items | any member (kitchen needs view) | create waiter+; status update kitchen/waiter; refund admin |
| menu_categories, menu_items | any member | manager+ edit |
| notifications | recipient only (`recipient_staff_id` = caller's staff id) | system-generated inserts |
| notification_prefs | own row only | own row only |
| restaurant_settings | any member | Admin/Manager only |

- **Helper:** a `security definer` function `current_staff()` / `current_role()` returning the caller's
  `staff_members` row / role_id reduces repeated joins in policies.
- DB-level permission grants (GRANT) kept minimal; the anon key uses RLS, never bypasses it.
- Never store Clerk SECRET or Supabase service-role key client-side (already enforced).
- Sensitive cols (phone/email) visible per-role, not blanket.

**Guardrail:** all writes go through authenticated sessions (Clerk-gated client); the service-role key is
server-only and never in the browser.

---

## F. Migration priority

### PHASE 1 — Core functionality (the app cannot persist anything without these)
1. `profiles`
2. `roles`, `role_permissions`
3. `staff_members`, `staff_activity`
4. `restaurant_settings`
5. `tables`
6. `menu_categories`, `menu_items`
7. `customers`, `customer_notes`
8. `reservations`
9. `orders`, `order_items`
10. `notification_prefs`, `notifications`

*(Phase 1 == everything the current UI actually touches, in dependency order: identity/roles → reference
data (settings/tables/menu) → transactional (customers/orders/reservations) → notifications.)*

### PHASE 2 — Operations
- **Invitations:** real Clerk invitations wired through `staff_members.inv_status` (currently a local
  placeholder `inviteMember`).
- **Realtime:** Supabase Realtime subscriptions mapped to the existing `notify()` loop and the
  `ORDER_NOTIF_POOL`/notification drawer (cross-device status updates, reservation alerts).
- **Customer activity stream:** materialized `customer_activity` derived from orders + reservations
  (currently computed ad-hoc in the customer drawer).
- **Notifications as first-class:** per-entity notification generation + read-state syncing.

### PHASE 3 — Advanced analytics/features
- **Analytics rollups:** replace hardcoded `KPIS`/`REV`/`TOP_ITEMS` with queries against persisted
  `orders`/`order_items`/`reservations` + a `daily_summary` or materialized view for dashboard/reports.
  No separate generic analytics tables.
- **Inventory** (`inventory_items`, `inventory_transactions`): **only if the Inventory feature is built** —
  currently nothing in the UI reads/writes it, so it stays out.
- **Multi-restaurant tenant rollout:** activate `restaurant_id` scoping end-to-end; admin/manager console.
- **POS/payments:** payment provider integration extending `orders.pay_status` (payment intents/tenders).

---

## Implementation order (recommended)

1. **Foundation** — `profiles` + Clerk↔Supabase identity bridge (`handle_new_user`), roles/permissions seeded.
2. **Reference data** — `restaurant_settings`, `tables`, `menu_categories`, `menu_items`.
3. **Transactional core** — `customers`+`notes`, `reservations`, `orders`+`order_items`; wire `src/services`
   to read/write Supabase instead of the in-memory seed, keeping `notify()` as the reactivity glue.
4. **Staff & RBAC** — `staff_members`+`activity`, `notification_prefs`, `notifications`; apply RLS policies.
5. **Phase 2 ops** — real invitations (Clerk), Realtime, notification generation.
6. **Phase 3 analytics** — persisted aggregations for Dashboard/Reports; inventory only if/when built.

---

## Not in scope (explicitly preserved)
- Clerk auth, Google OAuth, routing, all existing UI/design, existing CRM functionality — unchanged.
- No customer activity lookup table is fabricated beyond what the UI shows (notes + derived history).
- No generic/inventory/analytics tables that aren't backed by a real feature today.
