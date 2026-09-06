# Elysian Spire CRM — Schema Design Review

**Scope:** Critical review of `docs/Database-Architecture-Audit.md` against the real TypeScript types, seed
data, and UI behaviour. No tables created, no SQL, no code changes. This is the last review before migrations.

---

## A. Critical schema corrections

These are the corrections the audit got wrong or left implicit. They **must** be resolved before writing SQL.

1. **Clerk `profiles.id` must be TEXT, not UUID.**
   Clerk user ids look like `user_2abc...` — they are opaque strings, not valid UUIDs. The audit proposed
   `profiles.id uuid PK = Clerk sub`, which is **incorrect**. `profiles.id` must be `text` (or `text
   PRIMARY KEY`) holding the Clerk `sub`. All references to a profile are then `text FK`. Do **not** cast
   or re-encode the Clerk id. (Staff members who haven't signed in yet still get a `uuid` id on
   `staff_members`; `profiles` is the *only* table keyed to Clerk.)

2. **Add a `restaurants` root tenant table.**
   The audit scoped everything by `restaurant_id` but never defined the table. Every restaurant-scoped row
   must reference `restaurants.id`. `restaurants` is root: not RLS-visible to end users directly, but the
   anchor every policy filters on.

3. **Surrogate UUID PKs everywhere + separate display codes.**
   `ORD-1042`, `RSV-308`, `T-01` are **display identifiers, never PKs**. Orders/reservations/tables get
   `uuid` PKs. Display `code`/`label` columns exist separately with a unique constraint *within the tenant*
   (not globally). The audit already said this in principle; make it a hard convention across **all** tables
   (customers, menu_items, staff — which today have no internal id at all).

4. **Money must be `numeric(12,2)`, not paise-bigint as the audit proposed.**
   The audit recommended storing paise as `bigint` to "avoid float error." That is unnecessary and
   non-idiomatic — the review instruction is explicit: use `numeric(12,2)`. `numeric` is exact (no float
   error), so subunits are not required. Store rupees as `numeric(12,2)`.
   - **Also flag:** the current seed `Order.amount` is **unreliable** — e.g. `ORD-1042` line items sum to
     `(1250·2)+(490·2)=3480` but that equals `amount` by coincidence; `ORD-1043` items sum to 1300 and
     amount is 1300; yet the Orders UI shows a **computed** total (`sub + 5% tax`), which never equals the
     stored `amount`. So `orders.total` is currently a fake/denormalized display number. In the DB, compute
     `orders.subtotal/tax/total` from `order_items.line_totals` at write time (or store all three) — never
     trust a single `amount` that the UI already recomputes differently.

5. **`order_items` are immutable historical snapshots.** (See section H of the review topics — the audit's
   `order_items` already snapshots `name/price/qty/line_total`, which is correct.) Reinforce: `order_items`
   never update when a `menu_item` changes; a completed order's rows are frozen. Add `created_at` on every
   `order_item`.

6. **Customer counters are derived, not stored-critical.**
   `customers.visits/orders/spent` in the seed are mock totals that don't match the (also mock) order data.
   Keep them as nullable/derived convenience columns refreshed by app logic or a trigger from real
   `orders`/`reservations`; never let them become the system of record, or reports will double-count.
   `customer_notes` belongs in its own table (audit has it) — do **not** reuse `customers.note` as the only
   store; keep a single source.

7. **Role architecture: keep it simpler than three tables.**
   The audit proposed `roles` + `role_permissions` as DB rows seeded from the static config
   (`ROLE_TYPES`/`ROLE_PERMS`/`PERMISSION_KEYS`). Review: the 4 required roles (Owner/Admin, Manager,
   Waiter, Chef) are stable application roles. **Recommend: fixed application roles as database rows**
   (`roles` table, seeded, not user-editable) so RLS policies can reference them cleanly, **plus** a minimal
   `role_permissions` for the *custom-role* feature the UI already supports (Staff & Roles "Create Custom
   Role"). Do not model per-user permission overrides. Seed the permission strings directly from
   `PERMISSION_KEYS` (e.g. `orders.create`, `staff.manage`) — a flat permission code per role.
   - Avoid a separate `permissions` dictionary table: permission codes are already enumerated in
     `PERMISSION_KEYS` and are stable. `role_permissions(role_id, permission)` with the code string is enough.

8. **`staff_members` vs `profiles` attachment.** The audit's "link via email or staff_id" is vague — pick
   **one** direction. Recommend: `staff_members` is the canonical staff record (uuid PK). `profiles` gets a
   nullable `staff_id uuid FK → staff_members`. A Clerk user signs in → `profiles` row (id = Clerk sub) →
   `staff_id` → their staff record + `role_id`. This avoids email-matching ambiguity and keeps staff who
   have not signed in (invited/pending) as `staff_members` rows without a `profiles` row.

9. **`restaurants` membership / invitation model.** The invite flow is `staff_members` with
   `inv_status`. Keep email unique per restaurant on `staff_members`; the Clerk sign-in then resolves
   `profiles → staff_id.emit` the role from `staff_members.role_id` (don't store role on both).

10. **`deleted_at` usage (soft delete).** Recommend `deleted_at timestamptz` only on **reference/lookup**
    tables where deletion is an administrative act and history matters: `menu_categories`, `menu_items`,
    `customers`, `restaurant_tables`, `staff_members`. Never on transactional/history tables
    (`orders`, `order_items`, `reservations`, `customer_notes`, `staff_activity`, `notifications`). Soft
    delete statuses already exist as explicit enum values (`Cancelled`, `Suspended`, `Revoked`) — prefer those
    over deletion where the domain already models lifecycle.

11. **RLS scoping is sound** — every tenant table gets `restaurant_id` (the audit already does this, good),
    except the new `restaurants` root and the auth-adjacent `profiles` (scoped via
    `profiles.id = auth.uid()` plus `restaurant_id` for membership checks). `notification_prefs` must carry
    `staff_member_id` (+ transitively `restaurant_id`) — the audit omitted `restaurant_id` there; add it for
    uniform policy wiring.

12. **Analytics: confirmed — derive, never store.** KPIs/reports/`REV/TOP_ITEMS/REP` are hardcoded constants.
    They must be computed from `orders`, `order_items`, `reservations`, `customers`. No KPI/summary tables in
    Phase 1; an optional materialized `daily_summary` can come in Phase 3 if query cost warrants it.

---

## B. Final recommended table list

| # | Table | Kind | PK | notes |
|---|---|---|---|---|
| 1 | `restaurants` | root tenant | uuid | single-row now, root for RLS scoping |
| 2 | `profiles` | auth/bridge | **text** (Clerk sub) | id = Clerk `user_...`; nullable `staff_id` |
| 3 | `roles` | reference (seeded) | uuid | Owner/Admin, Manager, Waiter, Chef (+ Cashier/Inventory Staff) |
| 4 | `role_permissions` | association | uuid | `(role_id, permission)` unique |
| 5 | `staff_members` | reference | uuid | canonical staff; email unique per restaurant |
| 6 | `staff_activity` | history | uuid | immutable timeline |
| 7 | `customers` | reference | uuid | name/phone/email + derived counters |
| 8 | `customer_notes` | history | uuid | immutable notes |
| 9 | `restaurant_tables` | reference | uuid | display `label`, capacity, status |
| 10 | `menu_categories` | reference | uuid | soft-deletable |
| 11 | `menu_items` | reference | uuid | soft-deletable; price `numeric(12,2)` |
| 12 | `reservations` | transactional | uuid | guest_name/phone snapshot + optional customer_id |
| 13 | `orders` | transactional | uuid | header; customer/table nullable FKs |
| 14 | `order_items` | transactional/history | uuid | immutable snapshots |
| 15 | `notifications` | history | uuid | recipient staff_id |
| 16 | `notification_prefs` | per-user config | uuid | one row per staff_member |

Excluded for now: `inventory_items`, `inventory_transactions`, `payments`, `daily_summary`,
`customer_activity` (derived), `staff_briefs` (legacy).

---

## C. Final relationship map

```
restaurants (root tenant)
   │
   ├── profiles (id = Clerk sub; staff_id → staff_members)
   ├── staff_members ── role_id ── roles ── role_permissions
   │        ├── staff_activity            (1:N)
   │        ├── notification_prefs        (1:1)
   │        └── profiles                  (1:0..1, via staff_id)
   ├── customers ── customer_notes        (1:N)
   ├── restaurant_tables
   ├── menu_categories ── menu_items
   ├── reservations (customer_id? table_id?)
   ├── orders       (customer_id? table_id?)
   │        └── order_items ── menu_item_id?  (snapshot name/price)
   └── notifications (recipient_staff_id)

customers
   ├── customer_notes   (1:N)
   ├── reservations     (1:N)
   └── orders           (1:N)

orders
   ├── customers        (N:1, nullable)
   ├── restaurant_tables(N:1, nullable)
   └── order_items      (1:N) ─ menu_items (N:1, nullable)

reservations
   ├── customers        (N:1, nullable)
   └── restaurant_tables(N:1, nullable)

staff_members
   └── roles (N:1) ─── role_permissions (1:N)
```

---

## D. Key column decisions

- **Clerk id:** `profiles.id` = `text` PK (`user_...`). Only table keyed to Clerk.
- **All other PKs:** `uuid` default `gen_random_uuid()`.
- **Money:** `numeric(12,2)` everywhere (menu price, order subtotal/tax/total, order_item unit_price/
  line_total, customer spent). Exact decimals, no floats.
- **Timestamps:** `created_at timestamptz NOT NULL default now()` and `updated_at timestamptz NOT NULL
  default now()` on mutable tables; **only** `created_at` on immutable historical tables (order_items,
  customer_notes, staff_activity, notifications). `deleted_at timestamptz` on soft-deletable reference
  tables (customers, menu_items, menu_categories, restaurant_tables, staff_members) — see A.10.
- **Order totals:** store `subtotal`, `tax`, `total` (all `numeric(12,2)`) computed from `order_items` at
  write time — do not store a single ambiguous `amount`.
- **`order_items.menu_item_id`** nullable FK; the `name`/`unit_price` columns are the frozen snapshot
  (historical record survives menu edits).
- **Customers:** `phone`/`email` nullable (walk-ins may only give a name); `visits/orders/spent` nullable
  derived counters.
- **Notifications:** `type` = reservation/order/system; `read_at timestamptz nullable` (null = unread).

---

## E. Primary key strategy

- `profiles.id` — **text** (Clerk sub). Unique, immutable, present before any app data exists.
- Every other table — **`uuid`** surrogate PK, generated server-side. No natural keys as PKs.
- Uniqueness of *display* identifiers is tenant-scoped:
  - `restaurant_tables.label UNIQUE(restaurant_id, label)` (`T-01`)
  - `orders.code UNIQUE(restaurant_id, code)` (`ORD-1042`)
  - `reservations.code UNIQUE(restaurant_id, code)` (`RSV-308`)
  - `menu_categories.name UNIQUE(restaurant_id, name)`
  - `staff_members.email UNIQUE(restaurant_id, email)`
- Display codes are convenience columns, **never** used as FK targets.

---

## F. Foreign key + delete strategy

| Relationship | FK | on delete |
|---|---|---|
| profiles.staff_id → staff_members.id | uuid (nullable) | `SET NULL` |
| staff_members.role_id → roles.id | uuid | `RESTRICT` |
| staff_members.restaurant_id → restaurants.id | uuid | `RESTRICT` |
| role_permissions.role_id → roles.id | uuid | `CASCADE` |
| staff_activity.staff_member_id → staff_members.id | uuid | `CASCADE` |
| customer_notes.customer_id → customers.id | uuid | `CASCADE` |
| customer_notes.author_staff_id → staff_members.id | uuid (nullable) | `SET NULL` |
| reservations.customer_id → customers.id | uuid (nullable) | `SET NULL` (preserve walk-in record) |
| reservations.table_id → restaurant_tables.id | uuid (nullable) | `SET NULL` |
| orders.customer_id → customers.id | uuid (nullable) | `SET NULL` |
| orders.table_id → restaurant_tables.id | uuid (nullable) | `SET NULL` |
| order_items.order_id → orders.id | uuid | `CASCADE` |
| order_items.menu_item_id → menu_items.id | uuid (nullable) | `SET NULL` (snapshot keeps name/price) |
| menu_items.category_id → menu_categories.id | uuid | `RESTRICT` (or SET NULL) |
| notifications.recipient_staff_id → staff_members.id | uuid | `CASCADE` |
| notification_prefs.staff_member_id → staff_members.id | uuid | `CASCADE` |

Rules:
- **Transactional/history tables are never deleted via FK** — `orders`,`order_items`,`reservations`,
  `customer_notes`, `staff_activity` get `RESTRICT`/`SET NULL`/soft-delete on the owner, so financial
  history is **immutable**.
- Reference `roles` use `RESTRICT`: you cannot delete a role assigned to staff.
- `CASCADE` only where the child is meaningless without the parent and is pure history (order_items,
  customer_notes, staff_activity, role_permissions).
- `SET NULL` where the parent is optional context (customer/table on a transactional record) so history
  rows survive even if a reference row is removed/merged.

---

## G. Status / type strategy

Keep enums minimal — prefer `TEXT` + `CHECK` (or Postgres enum only where the set is closed and stable).
Recommendation: use **native Postgres enums** for the *core lifecycle* statuses because they are used in
RLS/query filters and unlikely to iterate mid-flight, and plain `TEXT` for everything else.

Proposed enum usage:
- `order_status` — enum `new, preparing, ready, completed, cancelled` (matches `OrderStatus` exactly).
- `order_pay_status` — enum `paid, unpaid, refunded` (`PaymentStatus`).
- `reservation_status` — enum `pending, confirmed, completed, cancelled` (`ResStatus`).
- `table_status` — enum `available, occupied, reserved` (`TableStatus`).
- `staff_status` — enum `active, pending, suspended` (`MemberStatus`).
- `notification_type` — **TEXT + CHECK** (`reservation|order|system`) — may grow, keep TEXT.
- `inv_status` — **TEXT + CHECK** (`pending|accepted|expired|revoked`).
- `permission` — **TEXT**; values come from the seeded `PERMISSION_KEYS`, enforced by FK to `role_permissions`
  being role-scoped, not by a new enum.

Avoid: do **not** create enums for permission codes, notification type (unless locked), or anything the
app already treats as free-form config.

---

## H. Tables to exclude for now

- `inventory_items`, `inventory_transactions` — no inventory feature in the UI (only a role + perms exist).
- `payments` / payment-intent tables — `orders.pay_status` enum covers it until a real POS/payment provider
  integration exists.
- `daily_summary` / materialized analytics — derive from transactions; add only in Phase 3 if cost warrants.
- `customer_activity` — derive from `orders`/`reservations`; the audit already recommends this.
- `staff_briefs` — legacy mock list, superseded by `staff_members`.
- A separate `permissions` dictionary table — codes already enumerated in `PERMISSION_KEYS`.

---

## I. Implementation order (corrected)

1. **Root + identity:** `restaurants` → `profiles` (text id, Clerk bridge) → `roles`, `role_permissions` (seed
   from `ROLE_TYPES`/`PERMISSION_KEYS`).
2. **Reference data:** `menu_categories`, `menu_items` → `restaurant_tables` → `customers`.
3. **Transactional core:** `reservations` → `orders`, `order_items` (with snapshots + computed totals).
4. **Staff & RBAC:** `staff_members` (inv_status), `staff_activity`, `customer_notes`, `notifications`,
   `notification_prefs` (each scoped by restaurant / staff member).
5. **Enable RLS** on all tenant tables using `restaurant_id` + role from `profiles.staff_id → role_id`.
6. **Phase 2:** wire `src/services` to Supabase, real Clerk invitations, Realtime → `notify()`.
7. **Phase 3:** derived analytics for Dashboard/Reports; add inventory only if the feature is built.

---

## Notable audit corrections (one-line summary)

1. `profiles.id` → **TEXT** (Clerk sub), not uuid.  ❌→ fixed
2. Add a **`restaurants`** root table.  (missing)
3. Money → **`numeric(12,2)`**, not paise-bigint.  ❌→ fixed
4. `orders` totals computed from `order_items`; current `amount` is inconsistent with UI.  (flagged)
5. `role_permissions` flat permission codes (from `PERMISSION_KEYS`); drop a `permissions` dictionary.  (simplify)
6. Link `profiles.staff_id → staff_members` (single direction), role lives on `staff_members`.  (pick one)
7. Add `restaurant_id` to `notification_prefs`.  (missing)
8. `deleted_at` only on reference tables; lifecycle statuses (`Cancelled`/`Suspended`/`Revoked`) where already modeled.
9. Analytics: derive, never store — confirmed.
