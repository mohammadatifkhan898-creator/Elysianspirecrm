-- ============================================================================
-- 0002 — Owner provisioning & restaurant bootstrap.
--
-- Adds the atomic `provision_owner` RPC used by the onboarding flow (Phase 2B)
-- and a partial unique index preventing more than one ACTIVE owner per
-- restaurant. This migration does NOT touch 0001, does NOT enable RLS, and
-- inserts NO demo data. Roles (owner-admin/manager/waiter/chef) + permission
-- mappings remain the only seeded rows (from 0001).
--
-- Security principles honoured here:
--  * The caller's identity is derived INSIDE the function from
--    auth.jwt() -> 'sub' (the Clerk user id, TEXT) — never from client input,
--    so the browser cannot provision a profile for someone else.
--  * Role assignment is chosen by the function (seeded owner-admin slug),
--    never supplied by the frontend.
--  * The browser calls this via PostgREST with the anon/publishable key + the
--    Clerk session token only; service_role is never used client-side.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Partial unique index: at most one ACTIVE owner per restaurant.
-- A plain partial predicate cannot contain a subquery, so resolve the seeded
-- owner-admin role id in a DO block and create the index dynamically.
-- Only owner rows satisfy the predicate, so managers/waiters/chefs are NOT
-- restricted by this index.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_owner uuid;
BEGIN
  SELECT id INTO v_owner FROM public.roles WHERE slug = 'owner-admin';
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'roles.owner-admin not seeded — cannot create owner index';
  END IF;

  EXECUTE format(
    'CREATE UNIQUE INDEX staff_members_one_owner_per_restaurant
        ON public.staff_members (restaurant_id)
       WHERE role_id = %L::uuid AND status = %L',
    v_owner, 'active'
  );
END $$;

-- ---------------------------------------------------------------------------
-- provision_owner — atomic first-restaurant bootstrap for the FIRST OWNER.
-- Creates restaurants -> staff_members (owner) -> profiles in ONE transaction.
--
-- Returns a JSON document:
--   {"status":"created","restaurant_id":...,"profile_id":...}
--   {"status":"already","restaurant_id":...,"profile_id":...}  (idempotent)
--   {"status":"claimed","restaurant_id":...,"profile_id":...,"staff_id":...}
--
-- Arguments are DISPLAY/auxiliary data only (restaurant name/contact, and the
-- user's name + email for the staff/profile rows). The binding identity key is
-- auth.jwt()->>'sub' resolved inside the function.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.provision_owner(
  p_restaurant_name text,
  p_restaurant_email text DEFAULT NULL,
  p_restaurant_phone text DEFAULT NULL,
  p_user_name text DEFAULT NULL,
  p_user_email text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sub          text := (auth.jwt() ->> 'sub');
  v_owner_role   uuid;
  v_restaurant   uuid;
  v_staff        uuid;
  v_existing     record;
  v_email        text;
  v_name         text;
BEGIN
  -- Identity gate: a Clerk session MUST be present.
  IF v_sub IS NULL OR v_sub = '' THEN
    RAISE EXCEPTION 'No authenticated Clerk user (auth.jwt()->>''sub'' is empty)';
  END IF;

  -- Display identity for staff/profile rows: prefer Clerk claims, fall back to
  -- the passed args. These are non-authoritative display values.
  v_email := COALESCE(NULLIF(auth.jwt() ->> 'email', ''), NULLIF(p_user_email, ''), v_sub);
  v_name  := COALESCE(NULLIF(auth.jwt() ->> 'name', ''), NULLIF(p_user_name, ''), v_sub);

  -- 1) Already provisioned? Idempotent return (also stops duplicate inserts).
  SELECT r.id AS restaurant_id, p.id AS profile_id
    INTO v_existing
    FROM public.profiles p
    JOIN public.restaurants r ON r.id = p.restaurant_id
   WHERE p.id = v_sub;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'status', 'already',
      'restaurant_id', v_existing.restaurant_id,
      'profile_id', v_existing.profile_id
    );
  END IF;

  -- 2) Future-invitation compatibility: if a pending/active staff seat already
  --    exists for this email, CLAIM it instead of creating a new owner.
  SELECT sm.id, sm.restaurant_id, sm.role_id
    INTO v_staff, v_restaurant, v_owner_role
    FROM public.staff_members sm
   WHERE lower(sm.email) = lower(v_email)
     AND sm.deleted_at IS NULL
   ORDER BY sm.created_at ASC
   LIMIT 1;

  IF FOUND THEN
    INSERT INTO public.profiles (id, restaurant_id, staff_id, email, full_name)
    VALUES (v_sub, v_restaurant, v_staff, v_email, v_name);

    RETURN jsonb_build_object(
      'status', 'claimed',
      'restaurant_id', v_restaurant,
      'staff_id', v_staff,
      'profile_id', v_sub
    );
  END IF;

  -- 3) First owner path: resolve the seeded owner-admin role.
  SELECT id INTO v_owner_role FROM public.roles WHERE slug = 'owner-admin';
  IF v_owner_role IS NULL THEN
    RAISE EXCEPTION 'roles.owner-admin not seeded';
  END IF;

  -- restaurants (0001) has only a `name` column — no email/phone there.
  INSERT INTO public.restaurants (name)
  VALUES (COALESCE(NULLIF(btrim(p_restaurant_name), ''), 'Elysian Spire Restaurant'))
  RETURNING id INTO v_restaurant;

  INSERT INTO public.staff_members (restaurant_id, name, email, role_id, status, inv_status, joined_at, last_active_at)
  VALUES (v_restaurant, v_name, v_email, v_owner_role, 'active', 'accepted', NOW(), NOW())
  RETURNING id INTO v_staff;

  INSERT INTO public.profiles (id, restaurant_id, staff_id, email, full_name)
  VALUES (v_sub, v_restaurant, v_staff, v_email, v_name);

  RETURN jsonb_build_object(
    'status', 'created',
    'restaurant_id', v_restaurant,
    'staff_id', v_staff,
    'profile_id', v_sub
  );
END;
$$;
