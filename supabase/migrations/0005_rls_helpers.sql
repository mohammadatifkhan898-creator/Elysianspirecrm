-- ============================================================================
-- 0005 - RLS identity & authorization helpers (Phase 3A)
--
-- Adds the SECURITY DEFINER helper functions that 0006 (RLS policies) will
-- reference. These centralise identity/tenant/permission resolution so that
-- every RLS policy resolves "who am I / which restaurant / what can I do"
-- through ONE fixed, hardened path instead of repeating raw `auth.jwt()`
-- expressions.
--
-- This migration does NOT enable RLS, does NOT create any policy, does NOT
-- touch migrations 0001-0004, does NOT modify provision_owner, and does NOT
-- change any data. The helpers are inert until referenced by a policy.
--
-- AUTHORITATIVE IDENTITY CHAIN (verified against 0001 schema):
--   Clerk JWT sub  ->  profiles.id (TEXT PK)  ->  profiles.staff_id (UUID)
--   ->  staff_members.role_id  ->  role_permissions.permission  (code)
--
-- SECURITY PRINCIPLES:
--   * Identity is derived ONLY from auth.jwt() ->> 'sub' (Clerk user id, TEXT).
--     auth.uid() is NEVER used: it casts sub to UUID and fails for Clerk ids.
--   * No user/restaurant/staff/role/permission identity is ever accepted as a
--     client argument. All resolution is internal.
--   * Every function is SECURITY DEFINER so it reads the underlying tables as
--     the privileged owner, bypassing the caller's RLS -> this is what prevents
--     infinite recursion when 0006 policies call these helpers from a policy on
--     the very tables they read.
--   * Every function pins SET search_path = public, pg_temp to defeat
--     search-path hijacking (no shadowing of profiles/roles/role_permissions).
--   * Read-only helpers are marked STABLE (no writes; planner-safe).
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. current_clerk_user_id()
--    Returns the caller's Clerk user id (TEXT sub) or NULL when no
--    authenticated Clerk identity is present (no/signed-out session).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.current_clerk_user_id()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT auth.jwt() ->> 'sub';
$$;

-- ============================================================================
-- 2. current_restaurant_id()
--    Tenant key: the restaurant the current Clerk user belongs to, or NULL
--    when the user has no profile (never provisioned / not in a tenant).
--    Used by EVERY tenant-scoped policy: restaurant_id = current_restaurant_id().
-- ============================================================================
CREATE OR REPLACE FUNCTION public.current_restaurant_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p.restaurant_id
    FROM public.profiles p
   WHERE p.id = public.current_clerk_user_id();
$$;

-- ============================================================================
-- 3. current_staff_id()
--    The staff_members.id linked to the current Clerk user, or NULL when the
--    profile is not linked to a staff record.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.current_staff_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p.staff_id
    FROM public.profiles p
   WHERE p.id = public.current_clerk_user_id();
$$;

-- ============================================================================
-- 4. current_restaurant_role_slug()
--    The role SLUG (owner-admin/manager/waiter/chef) of the caller's staff
--    record, or NULL when unlinked. Used for any role-level orchestration
--    that needs the role identity itself rather than a permission check.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.current_restaurant_role_slug()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT r.slug
    FROM public.staff_members sm
    JOIN public.roles r ON r.id = sm.role_id
   WHERE sm.id = public.current_staff_id();
$$;

-- ============================================================================
-- 5. has_permission(p_permission text)
--    Returns TRUE iff the caller's staff record is ACTIVE (status='active',
--    not deleted) AND its role grants the given permission code.
--
--    Returns FALSE (never NULL) for every negative case by construction:
--      * unauthenticated   (current_clerk_user_id() -> NULL -> no rows)
--      * missing profile   (no profiles row for the sub)
--      * missing staff     (profile exists but staff_id is NULL / row gone)
--      * inactive/suspended/deleted staff (filtered out by the guards)
--      * unknown permission code (no matching role_permissions row)
--
--    Deliberately NON-RECURSIVE: it reads the underlying tables as the
--    SECURITY DEFINER owner, so a policy calling has_permission() does not
--    re-enter the caller's policy on profiles/staff_members/role_permissions.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.has_permission(p_permission text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.profiles p
      JOIN public.staff_members sm ON sm.id = p.staff_id
      JOIN public.role_permissions rp ON rp.role_id = sm.role_id
     WHERE p.id = public.current_clerk_user_id()
       AND sm.deleted_at IS NULL
       AND sm.status = 'active'
       AND rp.permission = p_permission
  );
$$;

-- ============================================================================
-- 6. Least-privilege EXECUTE grants
--
-- Migration 0003 granted EXECUTE broadly to (then-existing) functions via
-- `GRANT ALL ON ALL FUNCTIONS ... TO anon, authenticated, service_role`. That
-- statement cannot retro-apply to functions created later, so these five NEW
-- helpers start with PostgreSQL's DEFAULT: EXECUTE granted to PUBLIC.
--
-- Hardening applied here (per approved plan):
--   * REVOKE ... FROM PUBLIC  -> removes the default EXECUTE.
--   * REVOKE ... FROM anon    -> anonymous clients never need these helpers;
--                                 provisioning runs as `authenticated`.
--   * GRANT ... TO authenticated, service_role
--       - authenticated: the exact role under which RLS policies evaluate on
--                        PostgREST requests (required for 0006).
--       - service_role:  preserves administrative behavior (BYPASSRLS + any
--                        future server-side use); it is not PUBLIC, so it is
--                        unaffected by the revoke.
--
-- Verified: no existing RPC depends on these helpers, so revoking PUBLIC/anon
-- EXECUTE at creation time breaks nothing.
-- ============================================================================
REVOKE ALL ON FUNCTION public.current_clerk_user_id()                  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.current_restaurant_id()                  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.current_staff_id()                       FROM PUBLIC;
REVOKE ALL ON FUNCTION public.current_restaurant_role_slug()           FROM PUBLIC;
REVOKE ALL ON FUNCTION public.has_permission(text)                     FROM PUBLIC;

REVOKE ALL ON FUNCTION public.current_clerk_user_id()                  FROM anon;
REVOKE ALL ON FUNCTION public.current_restaurant_id()                  FROM anon;
REVOKE ALL ON FUNCTION public.current_staff_id()                       FROM anon;
REVOKE ALL ON FUNCTION public.current_restaurant_role_slug()           FROM anon;
REVOKE ALL ON FUNCTION public.has_permission(text)                     FROM anon;

GRANT EXECUTE ON FUNCTION public.current_clerk_user_id()               TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.current_restaurant_id()               TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.current_staff_id()                    TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.current_restaurant_role_slug()        TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_permission(text)                  TO authenticated, service_role;

COMMIT;
