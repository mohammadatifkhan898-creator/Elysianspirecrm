/* ═══════════════════════════════════════════════════════════════
   0010 — Extend role system + custom role CRUD RPCs.

   Additive migration only. Does NOT modify historical migrations
   or seed data.

   1. Seeds 4 new default roles (Cashier, Inventory Manager,
      Host/Hostess, Kitchen Staff) with their permission sets.
   2. Creates SECURITY DEFINER RPCs for custom role CRUD:
      create_custom_role, update_custom_role, delete_custom_role.
   3. All new roles have is_custom = false (system-managed).
      Only roles with is_custom = true can be deleted.
   ═══════════════════════════════════════════════════════════════ */

-- ── 1. Seed new default roles ───────────────────────────────────

INSERT INTO roles (name, slug, description, is_custom)
VALUES
  ('Cashier',          'cashier',          'Handles billing, POS and payments at the counter.', false),
  ('Inventory Manager','inventory-manager', 'Manages menu inventory, stock levels and suppliers.', false),
  ('Host/Hostess',     'host-hostess',     'Manages reservations, guest seating and table assignments.', false),
  ('Kitchen Staff',    'kitchen-staff',    'Kitchen order visibility and preparation workflow with limited management access.', false)
ON CONFLICT (name) DO NOTHING;

-- ── 2. Seed permissions for new roles ───────────────────────────

-- Cashier: billing, payments, POS-focused
INSERT INTO role_permissions (role_id, permission)
SELECT r.id, p.permission
FROM roles r
JOIN (VALUES
  ('orders.view'),
  ('orders.create'),
  ('orders.manage'),
  ('reservations.view'),
  ('customers.view'),
  ('reports.view')
) AS p(permission) ON true
WHERE r.name = 'Cashier'
ON CONFLICT (role_id, permission) DO NOTHING;

-- Inventory Manager: menu and stock operations
INSERT INTO role_permissions (role_id, permission)
SELECT r.id, p.permission
FROM roles r
JOIN (VALUES
  ('inventory.view'),
  ('inventory.manage'),
  ('reports.view')
) AS p(permission) ON true
WHERE r.name = 'Inventory Manager'
ON CONFLICT (role_id, permission) DO NOTHING;

-- Host/Hostess: reservations and guest management
INSERT INTO role_permissions (role_id, permission)
SELECT r.id, p.permission
FROM roles r
JOIN (VALUES
  ('reservations.view'),
  ('reservations.manage'),
  ('customers.view'),
  ('customers.manage'),
  ('orders.view')
) AS p(permission) ON true
WHERE r.name = 'Host/Hostess'
ON CONFLICT (role_id, permission) DO NOTHING;

-- Kitchen Staff: order visibility and status updates
INSERT INTO role_permissions (role_id, permission)
SELECT r.id, p.permission
FROM roles r
JOIN (VALUES
  ('orders.view'),
  ('orders.manage')
) AS p(permission) ON true
WHERE r.name = 'Kitchen Staff'
ON CONFLICT (role_id, permission) DO NOTHING;

-- ── 3. Custom role CRUD RPCs ────────────────────────────────────

-- Create a custom role with permissions
CREATE OR REPLACE FUNCTION create_custom_role(
  p_name text,
  p_description text DEFAULT '',
  p_permissions text[] DEFAULT '{}'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role_id uuid;
BEGIN
  IF NOT has_permission('staff.manage') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Permission denied.');
  END IF;

  IF current_restaurant_id() IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'No restaurant context.');
  END IF;

  -- Check name uniqueness
  IF EXISTS (SELECT 1 FROM roles WHERE lower(name) = lower(p_name)) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'A role with this name already exists.');
  END IF;

  INSERT INTO roles (name, slug, description, is_custom)
  VALUES (
    p_name,
    lower(regexp_replace(p_name, '[^a-zA-Z0-9]+', '-', 'g')),
    p_description,
    true
  )
  RETURNING id INTO v_role_id;

  -- Insert permissions (ignore unknown codes gracefully)
  INSERT INTO role_permissions (role_id, permission)
  SELECT v_role_id, unnest(p_permissions)
  WHERE unnest(p_permissions) IN (
    SELECT DISTINCT permission FROM role_permissions
    UNION
    VALUES
      ('customers.view'), ('customers.manage'),
      ('orders.view'), ('orders.create'), ('orders.manage'),
      ('reservations.view'), ('reservations.manage'),
      ('inventory.view'), ('inventory.manage'),
      ('reports.view'),
      ('staff.view'), ('staff.manage'),
      ('settings.manage')
  );

  RETURN jsonb_build_object('ok', true, 'role_id', v_role_id, 'name', p_name);
END;
$$;

-- Update a custom role (name, description, permissions)
CREATE OR REPLACE FUNCTION update_custom_role(
  p_role_id uuid,
  p_name text,
  p_description text DEFAULT '',
  p_permissions text[] DEFAULT '{}'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role roles%ROWTYPE;
BEGIN
  IF NOT has_permission('staff.manage') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Permission denied.');
  END IF;

  IF current_restaurant_id() IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'No restaurant context.');
  END IF;

  SELECT * INTO v_role FROM roles WHERE id = p_role_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Role not found.');
  END IF;

  IF NOT v_role.is_custom THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Cannot modify a system role.');
  END IF;

  -- Check name uniqueness (excluding self)
  IF EXISTS (SELECT 1 FROM roles WHERE lower(name) = lower(p_name) AND id != p_role_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'A role with this name already exists.');
  END IF;

  UPDATE roles SET
    name = p_name,
    slug = lower(regexp_replace(p_name, '[^a-zA-Z0-9]+', '-', 'g')),
    description = p_description,
    updated_at = NOW()
  WHERE id = p_role_id;

  -- Replace permissions: delete old, insert new
  DELETE FROM role_permissions WHERE role_id = p_role_id;
  INSERT INTO role_permissions (role_id, permission)
  SELECT p_role_id, unnest(p_permissions)
  WHERE unnest(p_permissions) IN (
    'customers.view', 'customers.manage',
    'orders.view', 'orders.create', 'orders.manage',
    'reservations.view', 'reservations.manage',
    'inventory.view', 'inventory.manage',
    'reports.view',
    'staff.view', 'staff.manage',
    'settings.manage'
  );

  RETURN jsonb_build_object('ok', true, 'role_id', p_role_id);
END;
$$;

-- Delete a custom role (only if no staff members reference it)
CREATE OR REPLACE FUNCTION delete_custom_role(p_role_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role roles%ROWTYPE;
  v_member_count integer;
BEGIN
  IF NOT has_permission('staff.manage') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Permission denied.');
  END IF;

  IF current_restaurant_id() IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'No restaurant context.');
  END IF;

  SELECT * INTO v_role FROM roles WHERE id = p_role_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Role not found.');
  END IF;

  IF NOT v_role.is_custom THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Cannot delete a system role.');
  END IF;

  -- Check if any staff member uses this role
  SELECT count(*) INTO v_member_count
  FROM staff_members
  WHERE role_id = p_role_id
    AND deleted_at IS NULL
    AND restaurant_id = current_restaurant_id();

  IF v_member_count > 0 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'Cannot delete: ' || v_member_count || ' staff member(s) still use this role. Reassign them first.'
    );
  END IF;

  -- Permissions are CASCADE-deleted via FK
  DELETE FROM roles WHERE id = p_role_id;

  RETURN jsonb_build_object('ok', true, 'role_id', p_role_id);
END;
$$;

-- ── 4. Grant EXECUTE to authenticated ────────────────────────────

GRANT EXECUTE ON FUNCTION create_custom_role(text, text, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION update_custom_role(uuid, text, text, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION delete_custom_role(uuid) TO authenticated;
