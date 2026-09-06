-- ============================================================================
-- 0008 — Orders atomic creation (Phase 5A, 0008)
--
-- STRICTLY ADDITIVE: does NOT touch migrations 0001-0007, does NOT alter any
-- table, does NOT weaken any RLS policy, does NOT insert demo data, and does
-- NOT enable service_role client-side. It adds exactly two objects that make
-- order creation collision-safe AND atomic:
--
--   1. order_code_seq (SEQUENCE)
--      Collision-safe source of order display codes. nextval() is concurrency
--      safe: it never hands out a duplicate, so two concurrent order creations
--      cannot collide regardless of restaurant. START 1000 is an intentional
--      product/display decision (a neat lower bound for human-readable codes),
--      NOT derived from existing production data. A new sequence created after
--      migration 0003 is NOT covered by 0003's blanket `GRANT ALL ON ALL
--      SEQUENCES ... TO anon, authenticated` (that applied only to sequences
--      that existed then), so it starts with PostgreSQL's default USAGE to
--      PUBLIC — REVOKE that, and anon explicitly. It is reachable ONLY through
--      the create_order() SECURITY DEFINER function below.
--
--   2. create_order(uuid, uuid, jsonb) (SECURITY DEFINER RPC)
--      The ONLY sanctioned way to create an order + its immutable line items
--      atomically. It:
--        * derives the caller's identity/tenant/permission server-side from the
--          Clerk JWT (via the hardened 0005 helpers) — restaurant_id is NEVER
--          taken from the client.
--        * rejects unauthorized callers after verifying has_permission('orders.create')
--        * validates: p_items is a non-empty JSON array; every item has a
--          menu_item_id; every quantity is an integer > 0; optional
--          customer_id / table_id belong to the caller's restaurant.
--        * resolves each menu item tenant-scoped from the DB (name + price) and
--          rejects nonexistent / cross-tenant / soft-deleted / unavailable items —
--          the client NEVER supplies name or price.
--        * computes ALL monetary totals server-side (line_total = price*qty,
--          subtotal, tax at a server CONSTANT rate 0.05, total).
--        * allocates the collision-safe code from order_code_seq.
--        * inserts the order header + all order_items in ONE transaction. Any
--          validation or insertion failure rolls back every written row — a
--          partial order header or orphaned order_items row is impossible.
--          NOTE: only the DML rolls back; nextval() is NON-transactional and
--          advances permanently even on rollback, so a failed create_order()
--          consumes an ORD- code and codes may contain gaps. Gaps are expected;
--          the contract is uniqueness/concurrency safety (never a duplicate
--          code), NOT gapless numbering. Architecture is NOT changed to be
--          gapless.
--        * pins SET search_path = public, pg_temp (defeats search-path hijack)
--        * is SECURITY DEFINER so nextval() runs as the sequence owner and the
--          table inserts run as the owner (RLS-bypassing) — the function
--          therefore self-enforces tenant + permission and never trusts RLS or
--          the client for authorization.
--
--   Table status and customer counters are deliberately NOT touched (orders.create
--   and settings.manage are separate permission domains — no hidden privilege
--   escalation; customer visits/spending stay unchanged). No delete functionality.
--   There is intentionally NO standalone next_order_code() RPC: allocation is
--   embedded inside create_order() so that a code is only ever consumed as part
--   of a successful atomic commit.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Collision-safe display-code sequence.
-- ---------------------------------------------------------------------------
CREATE SEQUENCE public.order_code_seq
  AS integer
  START WITH 1000
  INCREMENT BY 1
  NO MINVALUE
  NO MAXVALUE
  CACHE 1
  OWNED BY NONE;

-- No client role may call nextval directly — reachable ONLY via create_order().
REVOKE ALL ON SEQUENCE public.order_code_seq FROM PUBLIC, anon;

-- ---------------------------------------------------------------------------
-- 2. create_order(uuid, uuid, jsonb) — atomic, server-authoritative creation.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_order(
  p_customer_id uuid,
  p_table_id    uuid,
  p_items       jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_clerk        text;
  v_restaurant   uuid;
  v_item         jsonb;
  v_menu_id      uuid;
  v_qty          numeric;
  v_line_total   numeric;
  v_subtotal     numeric := 0;
  v_tax          numeric;
  v_total        numeric;
  v_code         text;
  v_order_id     uuid;
  v_placed_at    timestamptz;
  v_tax_rate     numeric := 0.05;   -- server-side CONSTANT (no settings table)
  v_item_idx     integer := 0;
  v_n_items      integer;
  v_found_name   text;
  v_found_price  numeric;
BEGIN
  -- ---- 1. Server-side authenticated identity -------------------------------
  v_clerk := public.current_clerk_user_id();
  IF v_clerk IS NULL OR v_clerk = '' THEN
    RAISE EXCEPTION 'create_order: authentication required';
  END IF;

  -- ---- 2. Permission gate (orders.create) ---------------------------------
  IF NOT public.has_permission('orders.create') THEN
    RAISE EXCEPTION 'create_order: permission denied';
  END IF;

  -- ---- 3. Tenant derived from identity, never from the client --------------
  v_restaurant := public.current_restaurant_id();
  IF v_restaurant IS NULL THEN
    RAISE EXCEPTION 'create_order: no restaurant tenant for this account';
  END IF;

  -- ---- 4. Validate p_items ------------------------------------------------
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'create_order: items must be a JSON array';
  END IF;
  v_n_items := jsonb_array_length(p_items);
  IF v_n_items < 1 THEN
    RAISE EXCEPTION 'create_order: at least one item is required';
  END IF;

  -- ---- 5. Optional customer must belong to this restaurant ----------------
  IF p_customer_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.customers c
       WHERE c.id = p_customer_id
         AND c.restaurant_id = v_restaurant
         AND c.deleted_at IS NULL
    ) THEN
      RAISE EXCEPTION 'create_order: invalid customer';
    END IF;
  END IF;

  -- ---- 6. Optional table must belong to this restaurant -------------------
  IF p_table_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.restaurant_tables t
       WHERE t.id = p_table_id
         AND t.restaurant_id = v_restaurant
         AND t.deleted_at IS NULL
    ) THEN
      RAISE EXCEPTION 'create_order: invalid table';
    END IF;
  END IF;

  -- ---- 7. First pass: validate item shape + resolve each menu item --------
  -- Resolve name/price from the DB, tenant-scoped. Reject nonexistent,
  -- cross-tenant, soft-deleted, or unavailable items. Client name/price are
  -- never trusted. Totals accumulate but are not committed until the header
  -- insert succeeds (single transaction).
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_item_idx := v_item_idx + 1;

    -- menu_item_id: must be present and a valid UUID
    IF NOT (v_item ? 'menu_item_id')
       OR v_item->>'menu_item_id' IS NULL
       OR v_item->>'menu_item_id' = ''
       OR v_item->>'menu_item_id' !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
      RAISE EXCEPTION 'create_order: item % has an invalid menu_item_id', v_item_idx;
    END IF;

    -- quantity: must be a JSON number that is an integer > 0
    IF NOT (v_item ? 'quantity')
       OR jsonb_typeof(v_item->'quantity') <> 'number' THEN
      RAISE EXCEPTION 'create_order: item % has an invalid quantity', v_item_idx;
    END IF;
    v_qty := (v_item->>'quantity')::numeric;
    IF v_qty <> floor(v_qty) OR v_qty < 1 THEN
      RAISE EXCEPTION 'create_order: item % quantity must be a positive integer', v_item_idx;
    END IF;

    v_menu_id := (v_item->>'menu_item_id')::uuid;

    -- Tenant-scoped, non-deleted menu item, server-verified.
    SELECT m.name, m.price
      INTO v_found_name, v_found_price
      FROM public.menu_items m
     WHERE m.id = v_menu_id
       AND m.restaurant_id = v_restaurant
       AND m.deleted_at IS NULL;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'create_order: item % is not available in this restaurant', v_item_idx;
    END IF;

    -- Reject unavailable items.
    IF NOT (SELECT m.available FROM public.menu_items m WHERE m.id = v_menu_id) THEN
      RAISE EXCEPTION 'create_order: item % is currently unavailable', v_item_idx;
    END IF;

    -- Server-calculated line total (NUMERIC(12,2)).
    v_line_total := round(v_found_price * v_qty, 2);
    v_subtotal   := v_subtotal + v_line_total;
  END LOOP;

  -- ---- 8. Server-authoritative totals -------------------------------------
  v_tax  := round(v_subtotal * v_tax_rate, 2);
  v_total := round(v_subtotal + v_tax, 2);

  -- ---- 9. Collision-safe code (embedded; no standalone allocator) ---------
  v_code := 'ORD-' || nextval('public.order_code_seq')::text;

  -- ---- 10. Single-transaction header insert -------------------------------
  INSERT INTO public.orders
    (restaurant_id, code, customer_id, table_id, status, pay_status,
     subtotal, tax_amount, total_amount)
  VALUES
    (v_restaurant, v_code, p_customer_id, p_table_id,
     'new', 'unpaid', v_subtotal, v_tax, v_total)
  RETURNING id, placed_at INTO v_order_id, v_placed_at;

  -- ---- 11. Insert every immutable line item (same transaction) ------------
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_menu_id := (v_item->>'menu_item_id')::uuid;
    v_qty     := (v_item->>'quantity')::numeric;
    v_qty     := v_qty::bigint;               -- integer quantity for the row

    -- Re-resolve name/price (validated in pass 1; values cannot change in-txn).
    -- Restaurant filter kept for explicit tenant isolation.
    SELECT m.name, m.price
      INTO v_found_name, v_found_price
      FROM public.menu_items m
     WHERE m.id = v_menu_id
       AND m.restaurant_id = v_restaurant;

    v_line_total := round(v_found_price * v_qty, 2);

    INSERT INTO public.order_items
      (order_id, menu_item_id, item_name, unit_price, quantity, line_total)
    VALUES
      (v_order_id, v_menu_id, v_found_name, v_found_price, v_qty, v_line_total);
  END LOOP;

  -- ---- 12. Structured JSON result -----------------------------------------
  RETURN jsonb_build_object(
    'order_id',   v_order_id::text,
    'code',       v_code,
    'status',     'new',
    'pay_status', 'unpaid',
    'subtotal',   v_subtotal,
    'tax_amount', v_tax,
    'total_amount', v_total,
    'placed_at',  to_char(v_placed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Least-privilege EXECUTE grants (mirror the 0005 hardening pattern).
-- A new function is NOT covered by 0003's blanket `GRANT ... ON ALL
-- FUNCTIONS ... TO anon, authenticated, service_role`, so it starts with
-- PostgreSQL's DEFAULT (EXECUTE to PUBLIC). Revoke that and anon, then grant
-- only to the roles that need it: authenticated (the browser, via PostgREST)
-- and service_role (parity for future server-side use; not PUBLIC, so it is
-- unaffected by the revokes).
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.create_order(uuid, uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_order(uuid, uuid, jsonb) FROM anon;
GRANT  EXECUTE ON FUNCTION public.create_order(uuid, uuid, jsonb) TO authenticated, service_role;

COMMIT;
