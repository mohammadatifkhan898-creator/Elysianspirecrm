-- ============================================================================
-- 0006 - Enable RLS + tenant/role/self policy matrix (Phase 3B)
--
-- Enables ROW LEVEL SECURITY on all 16 application tables and creates the
-- RLS policies per the APPROVED architecture (docs/Phase-3-RLS-Architecture-Plan.md
-- section E). Depends on the SECURITY DEFINER helpers from migration 0005
-- (current_clerk_user_id / current_restaurant_id / current_staff_id /
-- current_restaurant_role_slug / has_permission).
--
-- This migration does NOT modify 0001-0005, does NOT change provision_owner,
-- does NOT touch the frontend, inserts NO data, and does NOT reset anything.
--
-- ---------------------------------------------------------------------------
-- SECURITY MODEL (one paragraph each axis)
--
-- * TENANT ISOLATION: every tenant-owned row carries restaurant_id. Each
--   policy re-derives the tenant from the SESSION via current_restaurant_id()
--   (Clerk JWT sub -> profiles.restaurant_id). restaurant_id supplied by the
--   client is NEVER trusted as authorization; WITH CHECK re-validates the new
--   row's restaurant_id against the session so a row can never be created or
--   moved into another tenant.
--
-- * ROLE-BASED AUTH: writes on sensitive tables require has_permission('<permission_code>')
--   using ONLY the existing 13 seeded permission codes. No new codes invented.
--
-- * SELF-SCOPED: profiles / notifications / notification_prefs / staff_activity
--   filter by the caller's own identity (id = current_clerk_user_id() OR
--   recipient_staff_id = current_staff_id()).
--
-- * GLOBAL REFERENCE: roles / role_permissions are read-only (SELECT true) to
--   authenticated; all writes denied. Writes remain only via service_role/owner.
--
-- ---------------------------------------------------------------------------
-- RECURSION SAFETY
--   All cross-table lookups inside policy USING/WITH CHECK go through the
--   SECURITY DEFINER helpers (0005), which read as the definer and BYPASS the
--   caller's RLS -> no policy can recursively re-enter its own table's policy.
--   The only direct subqueries are parent->child (order_items->orders,
--   customer_notes->customers, staff_activity->staff_members), which are
--   one-level and these parents are themselves filtered only through helpers +
--   their own session-derived predicates (no loop back to the referencing
--   table). Therefore no infinite recursion is possible.
--
-- NO FORCE ROW LEVEL SECURITY is used: table owner keeps its bypass so the
-- SECURITY DEFINER helpers and provision_owner keep working. (FORCE would make
-- the owner subject to RLS and break bootstrap/helpers.)
--
-- Policy role: EVERY policy is scoped `TO authenticated` (Clerk-tokened
-- PostgREST requests). `anon` has no policies here and is therefore denied by
-- default on these tables once RLS is enabled.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 16. notification_prefs  [SELF-SCOPED]
-- ============================================================================
ALTER TABLE public.notification_prefs ENABLE ROW LEVEL SECURITY;

CREATE POLICY pol_notification_prefs_select
  ON public.notification_prefs FOR SELECT TO authenticated
  USING (staff_member_id = public.current_staff_id());

CREATE POLICY pol_notification_prefs_insert
  ON public.notification_prefs FOR INSERT TO authenticated
  WITH CHECK (staff_member_id = public.current_staff_id());

CREATE POLICY pol_notification_prefs_update
  ON public.notification_prefs FOR UPDATE TO authenticated
  USING (staff_member_id = public.current_staff_id())
  WITH CHECK (staff_member_id = public.current_staff_id());

CREATE POLICY pol_notification_prefs_delete
  ON public.notification_prefs FOR DELETE TO authenticated
  USING (staff_member_id = public.current_staff_id());

-- ============================================================================
-- 15. notifications  [SELF-SCOPED]  (feed: user sees ONLY own feed; mark read)
-- ============================================================================
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY pol_notifications_select
  ON public.notifications FOR SELECT TO authenticated
  USING (recipient_staff_id = public.current_staff_id());

-- INSERT: system/definer only (a user never creates their own feed rows).
CREATE POLICY pol_notifications_insert
  ON public.notifications FOR INSERT TO authenticated
  WITH CHECK (false);

CREATE POLICY pol_notifications_update
  ON public.notifications FOR UPDATE TO authenticated
  USING (recipient_staff_id = public.current_staff_id())
  WITH CHECK (recipient_staff_id = public.current_staff_id());

-- DELETE: feed lifecycle via service/definer only.
CREATE POLICY pol_notifications_delete
  ON public.notifications FOR DELETE TO authenticated
  USING (false);

-- ============================================================================
-- 14. customer_notes  [TENANT-SCOPED, via parent customers]  (immutable)
-- ============================================================================
ALTER TABLE public.customer_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY pol_customer_notes_select
  ON public.customer_notes FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.customers c
       WHERE c.id = customer_id
         AND c.restaurant_id = public.current_restaurant_id()
         AND public.has_permission('customers.view')
    )
  );

CREATE POLICY pol_customer_notes_insert
  ON public.customer_notes FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.customers c
       WHERE c.id = customer_id
         AND c.restaurant_id = public.current_restaurant_id()
         AND public.has_permission('customers.manage')
    )
  );

-- Immutable historical note: no UPDATE.
CREATE POLICY pol_customer_notes_update
  ON public.customer_notes FOR UPDATE TO authenticated
  USING (false);

-- Immutable historical note: DELETE denied.
CREATE POLICY pol_customer_notes_delete
  ON public.customer_notes FOR DELETE TO authenticated
  USING (false);

-- ============================================================================
-- 13. staff_activity  [SELF / STAFF.VIEW]  (audit timeline, immutable)
-- ============================================================================
ALTER TABLE public.staff_activity ENABLE ROW LEVEL SECURITY;

CREATE POLICY pol_staff_activity_select
  ON public.staff_activity FOR SELECT TO authenticated
  USING (
    staff_member_id = public.current_staff_id()
    OR
    (
      public.has_permission('staff.view')
      AND staff_member_id IN (
        SELECT id FROM public.staff_members
         WHERE restaurant_id = public.current_restaurant_id()
      )
    )
  );

-- Audit timeline written by system/definer only.
CREATE POLICY pol_staff_activity_insert
  ON public.staff_activity FOR INSERT TO authenticated
  WITH CHECK (false);

CREATE POLICY pol_staff_activity_update
  ON public.staff_activity FOR UPDATE TO authenticated
  USING (false);

CREATE POLICY pol_staff_activity_delete
  ON public.staff_activity FOR DELETE TO authenticated
  USING (false);

-- ============================================================================
-- 12. order_items  [TENANT-SCOPED, via parent orders]  (immutable snapshot)
-- ============================================================================
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY pol_order_items_select
  ON public.order_items FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.orders o
       WHERE o.id = order_id
         AND o.restaurant_id = public.current_restaurant_id()
         AND public.has_permission('orders.view')
    )
  );

CREATE POLICY pol_order_items_insert
  ON public.order_items FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.orders o
       WHERE o.id = order_id
         AND o.restaurant_id = public.current_restaurant_id()
         AND public.has_permission('orders.create')
    )
  );

-- order_items are immutable historical snapshots.
CREATE POLICY pol_order_items_update
  ON public.order_items FOR UPDATE TO authenticated
  USING (false);

CREATE POLICY pol_order_items_delete
  ON public.order_items FOR DELETE TO authenticated
  USING (false);

-- ============================================================================
-- 11. orders  [TENANT-SCOPED]
-- ============================================================================
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY pol_orders_select
  ON public.orders FOR SELECT TO authenticated
  USING (
    restaurant_id = public.current_restaurant_id()
    AND public.has_permission('orders.view')
  );

CREATE POLICY pol_orders_insert
  ON public.orders FOR INSERT TO authenticated
  WITH CHECK (
    restaurant_id = public.current_restaurant_id()
    AND public.has_permission('orders.create')
  );

CREATE POLICY pol_orders_update
  ON public.orders FOR UPDATE TO authenticated
  USING (
    restaurant_id = public.current_restaurant_id()
    AND public.has_permission('orders.manage')
  )
  WITH CHECK (
    restaurant_id = public.current_restaurant_id()
    AND public.has_permission('orders.manage')
  );

CREATE POLICY pol_orders_delete
  ON public.orders FOR DELETE TO authenticated
  USING (
    restaurant_id = public.current_restaurant_id()
    AND public.has_permission('orders.manage')
  );

-- ============================================================================
-- 10. reservations  [TENANT-SCOPED]
-- ============================================================================
ALTER TABLE public.reservations ENABLE ROW LEVEL SECURITY;

CREATE POLICY pol_reservations_select
  ON public.reservations FOR SELECT TO authenticated
  USING (
    restaurant_id = public.current_restaurant_id()
    AND public.has_permission('reservations.view')
  );

CREATE POLICY pol_reservations_insert
  ON public.reservations FOR INSERT TO authenticated
  WITH CHECK (
    restaurant_id = public.current_restaurant_id()
    AND public.has_permission('reservations.manage')
  );

CREATE POLICY pol_reservations_update
  ON public.reservations FOR UPDATE TO authenticated
  USING (
    restaurant_id = public.current_restaurant_id()
    AND public.has_permission('reservations.manage')
  )
  WITH CHECK (
    restaurant_id = public.current_restaurant_id()
    AND public.has_permission('reservations.manage')
  );

CREATE POLICY pol_reservations_delete
  ON public.reservations FOR DELETE TO authenticated
  USING (
    restaurant_id = public.current_restaurant_id()
    AND public.has_permission('reservations.manage')
  );

-- ============================================================================
-- 9. menu_items  [TENANT-SCOPED]
-- ============================================================================
ALTER TABLE public.menu_items ENABLE ROW LEVEL SECURITY;

-- Menu is broadly visible to staff in the tenant (no permission gate on read).
CREATE POLICY pol_menu_items_select
  ON public.menu_items FOR SELECT TO authenticated
  USING (restaurant_id = public.current_restaurant_id());

CREATE POLICY pol_menu_items_insert
  ON public.menu_items FOR INSERT TO authenticated
  WITH CHECK (
    restaurant_id = public.current_restaurant_id()
    AND public.has_permission('inventory.manage')
  );

CREATE POLICY pol_menu_items_update
  ON public.menu_items FOR UPDATE TO authenticated
  USING (
    restaurant_id = public.current_restaurant_id()
    AND public.has_permission('inventory.manage')
  )
  WITH CHECK (
    restaurant_id = public.current_restaurant_id()
    AND public.has_permission('inventory.manage')
  );

CREATE POLICY pol_menu_items_delete
  ON public.menu_items FOR DELETE TO authenticated
  USING (
    restaurant_id = public.current_restaurant_id()
    AND public.has_permission('inventory.manage')
  );

-- ============================================================================
-- 8. menu_categories  [TENANT-SCOPED]
-- ============================================================================
ALTER TABLE public.menu_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY pol_menu_categories_select
  ON public.menu_categories FOR SELECT TO authenticated
  USING (restaurant_id = public.current_restaurant_id());

CREATE POLICY pol_menu_categories_insert
  ON public.menu_categories FOR INSERT TO authenticated
  WITH CHECK (
    restaurant_id = public.current_restaurant_id()
    AND public.has_permission('inventory.manage')
  );

CREATE POLICY pol_menu_categories_update
  ON public.menu_categories FOR UPDATE TO authenticated
  USING (
    restaurant_id = public.current_restaurant_id()
    AND public.has_permission('inventory.manage')
  )
  WITH CHECK (
    restaurant_id = public.current_restaurant_id()
    AND public.has_permission('inventory.manage')
  );

CREATE POLICY pol_menu_categories_delete
  ON public.menu_categories FOR DELETE TO authenticated
  USING (
    restaurant_id = public.current_restaurant_id()
    AND public.has_permission('inventory.manage')
  );

-- ============================================================================
-- 7. restaurant_tables  [TENANT-SCOPED]  (seating plan)
-- ============================================================================
ALTER TABLE public.restaurant_tables ENABLE ROW LEVEL SECURITY;

-- Floor plan broadly visible to staff in the tenant.
CREATE POLICY pol_restaurant_tables_select
  ON public.restaurant_tables FOR SELECT TO authenticated
  USING (restaurant_id = public.current_restaurant_id());

-- Table layout is a settings/configuration action -> settings.manage.
CREATE POLICY pol_restaurant_tables_insert
  ON public.restaurant_tables FOR INSERT TO authenticated
  WITH CHECK (
    restaurant_id = public.current_restaurant_id()
    AND public.has_permission('settings.manage')
  );

CREATE POLICY pol_restaurant_tables_update
  ON public.restaurant_tables FOR UPDATE TO authenticated
  USING (
    restaurant_id = public.current_restaurant_id()
    AND public.has_permission('settings.manage')
  )
  WITH CHECK (
    restaurant_id = public.current_restaurant_id()
    AND public.has_permission('settings.manage')
  );

CREATE POLICY pol_restaurant_tables_delete
  ON public.restaurant_tables FOR DELETE TO authenticated
  USING (
    restaurant_id = public.current_restaurant_id()
    AND public.has_permission('settings.manage')
  );

-- ============================================================================
-- 6. customers  [TENANT-SCOPED]
-- ============================================================================
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

CREATE POLICY pol_customers_select
  ON public.customers FOR SELECT TO authenticated
  USING (
    restaurant_id = public.current_restaurant_id()
    AND public.has_permission('customers.view')
  );

CREATE POLICY pol_customers_insert
  ON public.customers FOR INSERT TO authenticated
  WITH CHECK (
    restaurant_id = public.current_restaurant_id()
    AND public.has_permission('customers.manage')
  );

CREATE POLICY pol_customers_update
  ON public.customers FOR UPDATE TO authenticated
  USING (
    restaurant_id = public.current_restaurant_id()
    AND public.has_permission('customers.manage')
  )
  WITH CHECK (
    restaurant_id = public.current_restaurant_id()
    AND public.has_permission('customers.manage')
  );

CREATE POLICY pol_customers_delete
  ON public.customers FOR DELETE TO authenticated
  USING (
    restaurant_id = public.current_restaurant_id()
    AND public.has_permission('customers.manage')
  );

-- ============================================================================
-- 5. role_permissions  [GLOBAL reference; read-only]
-- ============================================================================
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY pol_role_permissions_select
  ON public.role_permissions FOR SELECT TO authenticated
  USING (true);

CREATE POLICY pol_role_permissions_insert
  ON public.role_permissions FOR INSERT TO authenticated
  WITH CHECK (false);

CREATE POLICY pol_role_permissions_update
  ON public.role_permissions FOR UPDATE TO authenticated
  USING (false);

CREATE POLICY pol_role_permissions_delete
  ON public.role_permissions FOR DELETE TO authenticated
  USING (false);

-- ============================================================================
-- 4. profiles  [SELF-SCOPED; identity anchor]
--    SELECT: user sees ONLY their own profile row (id = Clerk sub).
--    INSERT/UPDATE/DELETE: universally denied to authenticated. Profile
--    creation/claims go ONLY through SECURITY DEFINER RPCs (provision_owner,
--    future claim_invited_staff). UPDATE is denied to prevent a user from
--    relinking their own row to another tenant/staff (privilege escalation).
-- ============================================================================
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY pol_profiles_select
  ON public.profiles FOR SELECT TO authenticated
  USING (id = public.current_clerk_user_id());

CREATE POLICY pol_profiles_insert
  ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (false);

CREATE POLICY pol_profiles_update
  ON public.profiles FOR UPDATE TO authenticated
  USING (false);

CREATE POLICY pol_profiles_delete
  ON public.profiles FOR DELETE TO authenticated
  USING (false);

-- ============================================================================
-- 3. staff_members  [TENANT-SCOPED]
-- ============================================================================
ALTER TABLE public.staff_members ENABLE ROW LEVEL SECURITY;

-- All staff in the caller's OWN restaurant are readable. (The owner's own row
-- passes restaurant_id = current_restaurant_id(), so getProfileState's embedded
-- staff_members(status) join keeps working with no extra policy.)
CREATE POLICY pol_staff_members_select
  ON public.staff_members FOR SELECT TO authenticated
  USING (restaurant_id = public.current_restaurant_id());

CREATE POLICY pol_staff_members_insert
  ON public.staff_members FOR INSERT TO authenticated
  WITH CHECK (
    restaurant_id = public.current_restaurant_id()
    AND public.has_permission('staff.manage')
  );

-- UPDATE requires staff.manage so a non-manager cannot self-promote; WITH CHECK
-- re-derives restaurant_id from the session so a row can never move tenants.
CREATE POLICY pol_staff_members_update
  ON public.staff_members FOR UPDATE TO authenticated
  USING (
    restaurant_id = public.current_restaurant_id()
    AND public.has_permission('staff.manage')
  )
  WITH CHECK (
    restaurant_id = public.current_restaurant_id()
    AND public.has_permission('staff.manage')
  );

CREATE POLICY pol_staff_members_delete
  ON public.staff_members FOR DELETE TO authenticated
  USING (
    restaurant_id = public.current_restaurant_id()
    AND public.has_permission('staff.manage')
  );

-- ============================================================================
-- 2. roles  [GLOBAL reference; read-only]
-- ============================================================================
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY pol_roles_select
  ON public.roles FOR SELECT TO authenticated
  USING (true);

CREATE POLICY pol_roles_insert
  ON public.roles FOR INSERT TO authenticated
  WITH CHECK (false);

CREATE POLICY pol_roles_update
  ON public.roles FOR UPDATE TO authenticated
  USING (false);

CREATE POLICY pol_roles_delete
  ON public.roles FOR DELETE TO authenticated
  USING (false);

-- ============================================================================
-- 1. restaurants  [TENANT root]  (structural; operated by service_role/definer)
-- ============================================================================
ALTER TABLE public.restaurants ENABLE ROW LEVEL SECURITY;

CREATE POLICY pol_restaurants_select
  ON public.restaurants FOR SELECT TO authenticated
  USING (id = public.current_restaurant_id());

-- Restaurants are created only via provision_owner (SECURITY DEFINER).
CREATE POLICY pol_restaurants_insert
  ON public.restaurants FOR INSERT TO authenticated
  WITH CHECK (false);

CREATE POLICY pol_restaurants_update
  ON public.restaurants FOR UPDATE TO authenticated
  USING (false);

CREATE POLICY pol_restaurants_delete
  ON public.restaurants FOR DELETE TO authenticated
  USING (false);

COMMIT;
