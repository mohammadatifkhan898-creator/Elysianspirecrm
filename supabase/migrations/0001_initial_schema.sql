-- ============================================================================
-- Elysian Spire CRM — Initial Schema (0001)
--
-- Source of truth:
--   docs/Database-Architecture-Audit.md
--   docs/Schema-Design-Review.md
--
-- Scope: GENERATION ONLY. This migration is NOT executed here.
-- It creates the 16 approved tables, constraints, indexes, and seeds the
-- fixed application roles + role_permissions.
--
-- Deliberately NOT included (per approved review):
--   * RLS policies / ROW LEVEL SECURITY   (added in a later migration)
--   * inventory / payments / analytics / KPI / daily_summary tables
--   * fake restaurant / customer / order demo data
--   * a separate `permissions` dictionary table (codes are flat strings)
--
-- ARCHITECTURAL DECISIONS / ASSUMPTIONS:
--   1. profiles.id is TEXT PRIMARY KEY holding the Clerk user.id
--      ("user_xxxxxxxxx"). Clerk ids are opaque strings and are NEVER
--      converted to UUID.
--   2. Roles are FIXED APPLICATION ROLES (Owner/Admin, Manager, Waiter,
--      Chef). They are identical across tenants, so the `roles` and
--      `role_permissions` tables are NOT restaurant-scoped. Custom roles
--      (a future Staff & Roles feature) would be added restaurant-scoped
--      later if required.
--   3. Because roles are not restaurant-scoped, the fixed role seed does
--      not require a `restaurants` row, so no fake restaurant data is
--      inserted (required: only seed roles + approved permission mappings).
--   4. Money is NUMERIC(12,2) everywhere — never FLOAT/REAL/DOUBLE PRECISION.
--   5. Display codes (ORD-1042, RSV-308, T-01) are separate columns with
--      tenant-scoped unique constraints. They are NEVER primary keys.
--   6. order_items are immutable historical snapshots (item_name,
--      unit_price, quantity, line_total) so completed orders survive
--      later menu price changes. orders stores computed subtotal /
--      tax_amount / total_amount, NOT the legacy unreliable `amount`.
--   7. Statuses are TEXT + CHECK constraints (flexible), not excessive
--      PostgreSQL enums.
--   8. deleted_at is used ONLY on approved reference entities (customers,
--      restaurant_tables, menu_categories, menu_items, staff_members).
--      Transactional/history tables use lifecycle statuses instead.
--   9. FK delete strategy (approved):
--        RESTRICT  -> protected references (roles, restaurant, category)
--        SET NULL  -> optional customer/table refs (preserve history)
--        CASCADE   -> pure child/history rows only
--  10. updated_at maintained by a shared set_updated_at() trigger.
-- ============================================================================

BEGIN;

-- ============================================================================
-- A. EXTENSIONS / FUNCTIONS
-- ============================================================================

-- gen_random_uuid() ships with Postgres 13+ (pgcrypto optional on Supabase,
-- which has it built in). Keep the extension for portability/older PG.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Shared updated_at trigger function.
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

-- ============================================================================
-- C+D. TABLES + PRIMARY KEYS
-- (ordered parent-before-child for clean dependency resolution)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. restaurants — root tenant entity. (Single row in Phase 1; the anchor
-- every tenant-owned row and future RLS policy filters on.)
-- ---------------------------------------------------------------------------
CREATE TABLE public.restaurants (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- 2. roles — fixed application roles. Global (not tenant-scoped), see
-- decision #2 above.
-- ---------------------------------------------------------------------------
CREATE TABLE public.roles (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL UNIQUE,
  slug        TEXT NOT NULL UNIQUE,
  description TEXT,
  is_custom   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- 3. staff_members — canonical staff record (exists even before the person
-- has a Clerk account, i.e. invited/pending). Restaurant-scoped.
-- ---------------------------------------------------------------------------
CREATE TABLE public.staff_members (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id  UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE RESTRICT,
  name           TEXT NOT NULL,
  email          TEXT NOT NULL,
  role_id        UUID NOT NULL REFERENCES public.roles(id) ON DELETE RESTRICT,
  status         TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('active','pending','suspended')),
  inv_status     TEXT
                   CHECK (inv_status IN ('pending','accepted','expired','revoked')),
  last_active_at TIMESTAMPTZ,
  joined_at      TIMESTAMPTZ,
  deleted_at     TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT staff_members_restaurant_email_uq UNIQUE (restaurant_id, email)
);

-- ---------------------------------------------------------------------------
-- 4. profiles — Clerk bridge. id = Clerk user.id (TEXT). Links to the
-- staff_members record via staff_id. Clerk remains the AUTH source of
-- truth; this holds application identity + restaurant membership.
-- ---------------------------------------------------------------------------
CREATE TABLE public.profiles (
  id             TEXT PRIMARY KEY,           -- Clerk user.id, e.g. user_2abc...
  restaurant_id  UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE RESTRICT,
  staff_id       UUID UNIQUE REFERENCES public.staff_members(id) ON DELETE SET NULL,
  email          TEXT NOT NULL,
  full_name      TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- 5. role_permissions — flat permission codes (e.g. 'orders.create',
-- 'staff.manage') sourced from the existing PERMISSION_KEYS. No separate
-- permissions dictionary table.
-- ---------------------------------------------------------------------------
CREATE TABLE public.role_permissions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id     UUID NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  permission  TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT role_permissions_role_perm_uq UNIQUE (role_id, permission)
);

-- ---------------------------------------------------------------------------
-- 6. customers — guest directory. visits/orders/spent are DERIVED counters
-- (recomputed from orders), not the system of record.
-- ---------------------------------------------------------------------------
CREATE TABLE public.customers (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id  UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE RESTRICT,
  name           TEXT NOT NULL,
  phone          TEXT,
  email          TEXT,
  visits         INTEGER NOT NULL DEFAULT 0,
  orders         INTEGER NOT NULL DEFAULT 0,
  spent          NUMERIC(12,2) NOT NULL DEFAULT 0,
  last_visit_at  TIMESTAMPTZ,
  favorite_item  TEXT,
  deleted_at     TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- 7. restaurant_tables — seating plan. `label` is the display code (T-01),
-- NOT the primary key.
-- ---------------------------------------------------------------------------
CREATE TABLE public.restaurant_tables (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id  UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE RESTRICT,
  label          TEXT NOT NULL,              -- display code, e.g. 'T-01'
  capacity       INTEGER NOT NULL CHECK (capacity > 0),
  status         TEXT NOT NULL DEFAULT 'available'
                   CHECK (status IN ('available','occupied','reserved')),
  deleted_at     TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT restaurant_tables_restaurant_label_uq UNIQUE (restaurant_id, label)
);

-- ---------------------------------------------------------------------------
-- 8. menu_categories — menu groupings (Starters, Main Course, Drinks, ...).
-- ---------------------------------------------------------------------------
CREATE TABLE public.menu_categories (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id  UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE RESTRICT,
  name           TEXT NOT NULL,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  deleted_at     TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT menu_categories_restaurant_name_uq UNIQUE (restaurant_id, name)
);

-- ---------------------------------------------------------------------------
-- 9. menu_items — dishes. price is NUMERIC(12,2).
-- ---------------------------------------------------------------------------
CREATE TABLE public.menu_items (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id  UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE RESTRICT,
  category_id    UUID REFERENCES public.menu_categories(id) ON DELETE RESTRICT,
  name           TEXT NOT NULL,
  price          NUMERIC(12,2) NOT NULL CHECK (price >= 0),
  available      BOOLEAN NOT NULL DEFAULT TRUE,
  icon           TEXT,                        -- icon key string
  deleted_at     TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- 10. reservations — bookings. Optional customer/table refs (SET NULL keeps
-- the transactional history if a reference is removed). `code` is the
-- display reference (RSV-308), never a PK.
-- ---------------------------------------------------------------------------
CREATE TABLE public.reservations (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id  UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE RESTRICT,
  code           TEXT NOT NULL,               -- display code, e.g. 'RSV-308'
  customer_id    UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  guest_name     TEXT NOT NULL,               -- snapshot; walk-ins may have no customer row
  phone          TEXT,
  table_id       UUID REFERENCES public.restaurant_tables(id) ON DELETE SET NULL,
  reservation_date DATE NOT NULL,
  reservation_time TIME NOT NULL,
  guests         INTEGER NOT NULL CHECK (guests > 0),
  status         TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','confirmed','completed','cancelled')),
  notes          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT reservations_restaurant_code_uq UNIQUE (restaurant_id, code)
);

-- ---------------------------------------------------------------------------
-- 11. orders — POS/service header. `code` is the display reference
-- (ORD-1042), never a PK. Totals are computed from order_items at write time
-- and stored explicitly (subtotal / tax_amount / total_amount) — the legacy
-- `amount` field is deliberately not reused.
-- ---------------------------------------------------------------------------
CREATE TABLE public.orders (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id  UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE RESTRICT,
  code           TEXT NOT NULL,               -- display code, e.g. 'ORD-1042'
  customer_id    UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  table_id       UUID REFERENCES public.restaurant_tables(id) ON DELETE SET NULL,
  status         TEXT NOT NULL DEFAULT 'new'
                   CHECK (status IN ('new','preparing','ready','completed','cancelled')),
  pay_status     TEXT NOT NULL DEFAULT 'unpaid'
                   CHECK (pay_status IN ('paid','unpaid','refunded')),
  subtotal       NUMERIC(12,2) NOT NULL DEFAULT 0,
  tax_amount     NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_amount   NUMERIC(12,2) NOT NULL DEFAULT 0,
  placed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT orders_restaurant_code_uq UNIQUE (restaurant_id, code)
);

-- ---------------------------------------------------------------------------
-- 12. order_items — immutable historical snapshots. item_name/unit_price are
-- frozen at order time so menu price changes never alter completed orders.
-- menu_item_id is a soft (nullable) link only.
-- ---------------------------------------------------------------------------
CREATE TABLE public.order_items (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id       UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  menu_item_id   UUID REFERENCES public.menu_items(id) ON DELETE SET NULL,
  item_name      TEXT NOT NULL,                -- historical snapshot
  unit_price     NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0),
  quantity       INTEGER NOT NULL CHECK (quantity > 0),
  line_total     NUMERIC(12,2) NOT NULL CHECK (line_total >= 0),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- 13. staff_activity — immutable staff audit timeline.
-- ---------------------------------------------------------------------------
CREATE TABLE public.staff_activity (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_member_id UUID NOT NULL REFERENCES public.staff_members(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,               -- e.g. 'Role changed'
  detail          TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- 14. customer_notes — immutable guest notes (customer drawer textarea).
-- ---------------------------------------------------------------------------
CREATE TABLE public.customer_notes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id     UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  author_staff_id UUID REFERENCES public.staff_members(id) ON DELETE SET NULL,
  note            TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- 15. notifications — in-app feed. read_at NULL = unread (lifecycle, no
-- deleted_at).
-- ---------------------------------------------------------------------------
CREATE TABLE public.notifications (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id      UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE RESTRICT,
  recipient_staff_id UUID NOT NULL REFERENCES public.staff_members(id) ON DELETE CASCADE,
  message            TEXT NOT NULL,
  type               TEXT NOT NULL DEFAULT 'system'
                       CHECK (type IN ('reservation','order','system')),
  read_at            TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- 16. notification_prefs — one row per staff member (per-user toggles).
-- ---------------------------------------------------------------------------
CREATE TABLE public.notification_prefs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_member_id UUID NOT NULL UNIQUE
                   REFERENCES public.staff_members(id) ON DELETE CASCADE,
  reserve        BOOLEAN NOT NULL DEFAULT TRUE,
  order_pref     BOOLEAN NOT NULL DEFAULT TRUE,
  system_pref    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- updated_at TRIGGERS (mutable tables only)
-- ============================================================================
CREATE TRIGGER trg_restaurants_updated_at
  BEFORE UPDATE ON public.restaurants
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_roles_updated_at
  BEFORE UPDATE ON public.roles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_staff_members_updated_at
  BEFORE UPDATE ON public.staff_members
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_customers_updated_at
  BEFORE UPDATE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_restaurant_tables_updated_at
  BEFORE UPDATE ON public.restaurant_tables
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_menu_categories_updated_at
  BEFORE UPDATE ON public.menu_categories
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_menu_items_updated_at
  BEFORE UPDATE ON public.menu_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_reservations_updated_at
  BEFORE UPDATE ON public.reservations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_orders_updated_at
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_notification_prefs_updated_at
  BEFORE UPDATE ON public.notification_prefs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================================
-- H. INDEXES
-- ============================================================================

-- Tenant scoping indexes (every restaurant_id column)
CREATE INDEX idx_staff_members_restaurant  ON public.staff_members(restaurant_id);
CREATE INDEX idx_customers_restaurant      ON public.customers(restaurant_id);
CREATE INDEX idx_restaurant_tables_restaurant ON public.restaurant_tables(restaurant_id);
CREATE INDEX idx_menu_categories_restaurant ON public.menu_categories(restaurant_id);
CREATE INDEX idx_menu_items_restaurant     ON public.menu_items(restaurant_id);
CREATE INDEX idx_reservations_restaurant   ON public.reservations(restaurant_id);
CREATE INDEX idx_orders_restaurant         ON public.orders(restaurant_id);
CREATE INDEX idx_notifications_restaurant  ON public.notifications(restaurant_id);

-- Foreign-key lookup indexes
CREATE INDEX idx_profiles_restaurant       ON public.profiles(restaurant_id);
CREATE INDEX idx_profiles_staff_id         ON public.profiles(staff_id);
CREATE INDEX idx_staff_members_role_id     ON public.staff_members(role_id);
CREATE INDEX idx_role_permissions_role_id  ON public.role_permissions(role_id);
CREATE INDEX idx_customers_phone           ON public.customers(phone);
CREATE INDEX idx_menu_items_category_id    ON public.menu_items(category_id);

-- Reservation / order date-range queries
CREATE INDEX idx_reservations_date         ON public.reservations(reservation_date);
CREATE INDEX idx_reservations_customer     ON public.reservations(customer_id);
CREATE INDEX idx_reservations_table        ON public.reservations(table_id);
CREATE INDEX idx_orders_customer           ON public.orders(customer_id);
CREATE INDEX idx_orders_table              ON public.orders(table_id);
CREATE INDEX idx_orders_placed_at          ON public.orders(placed_at);
CREATE INDEX idx_orders_status             ON public.orders(status);

-- order_items parent lookup
CREATE INDEX idx_order_items_order_id      ON public.order_items(order_id);
CREATE INDEX idx_order_items_menu_item_id  ON public.order_items(menu_item_id);

-- staff/history
CREATE INDEX idx_staff_activity_member     ON public.staff_activity(staff_member_id);
CREATE INDEX idx_customer_notes_customer   ON public.customer_notes(customer_id);
CREATE INDEX idx_customer_notes_author     ON public.customer_notes(author_staff_id);

-- notification feed (unread-first ordering)
CREATE INDEX idx_notifications_recipient   ON public.notifications(recipient_staff_id, read_at, created_at DESC);

-- ============================================================================
-- I. FIXED ROLE SEED DATA
-- ============================================================================
INSERT INTO public.roles (name, slug, description, is_custom) VALUES
  ('Owner/Admin', 'owner-admin', 'Full access to restaurant operations, billing and settings.', FALSE),
  ('Manager',     'manager',     'Manages restaurant operations and team activity.',            FALSE),
  ('Waiter',      'waiter',      'Takes orders and assists guests in the dining room.',         FALSE),
  ('Chef',        'chef',        'Accesses the kitchen queue and order pipeline.',              FALSE);

-- ============================================================================
-- J. role_permissions SEED (flat permission codes from PERMISSION_KEYS)
-- Permission codes are application-level, resolved by role NAME so no
-- hardcoded role UUIDs are needed.
-- Approved permissions map (from src/data/seed.ts PERMISSION_KEYS + ROLE_PERMS):
--   customers.view / customers.manage
--   orders.view / orders.create / orders.manage
--   reservations.view / reservations.manage
--   inventory.view / inventory.manage
--   reports.view
--   staff.view / staff.manage
--   settings.manage
-- ============================================================================

-- OWNER/ADMIN — everything
INSERT INTO public.role_permissions (role_id, permission)
SELECT r.id, p.permission
FROM public.roles r
CROSS JOIN (VALUES
  ('customers.view'), ('customers.manage'),
  ('orders.view'), ('orders.create'), ('orders.manage'),
  ('reservations.view'), ('reservations.manage'),
  ('inventory.view'), ('inventory.manage'),
  ('reports.view'),
  ('staff.view'), ('staff.manage'),
  ('settings.manage')
) AS p(permission)
WHERE r.slug = 'owner-admin';

-- MANAGER — full operations, no Settings controls
INSERT INTO public.role_permissions (role_id, permission)
SELECT r.id, p.permission
FROM public.roles r
CROSS JOIN (VALUES
  ('customers.view'), ('customers.manage'),
  ('orders.view'), ('orders.create'), ('orders.manage'),
  ('reservations.view'), ('reservations.manage'),
  ('inventory.view'), ('inventory.manage'),
  ('reports.view'),
  ('staff.view'), ('staff.manage')
) AS p(permission)
WHERE r.slug = 'manager';

-- WAITER — take orders, view reservations + customers
INSERT INTO public.role_permissions (role_id, permission)
SELECT r.id, p.permission
FROM public.roles r
CROSS JOIN (VALUES
  ('customers.view'),
  ('orders.view'), ('orders.create'),
  ('reservations.view')
) AS p(permission)
WHERE r.slug = 'waiter';

-- CHEF — kitchen queue only
INSERT INTO public.role_permissions (role_id, permission)
SELECT r.id, p.permission
FROM public.roles r
CROSS JOIN (VALUES
  ('orders.view')
) AS p(permission)
WHERE r.slug = 'chef';

COMMIT;
