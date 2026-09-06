-- ============================================================================
-- 0007 — Reservations concurrency & collision-safe codes (Phase 4D, 0007)
--
-- ADDS three objects to support the Phase 4D reservations integration.
-- This migration is STRICTLY ADDITIVE: it does NOT touch migrations 0001-0006,
-- does NOT alter the reservations/restaurant_tables tables, does NOT weaken any
-- RLS policy, does NOT insert demo data, and does NOT enable service_role
-- client-side. It introduces no new statuses (only the DB-supported
-- pending/confirmed/completed/cancelled from 0001 are used).
--
-- 1. reservation_code_seq (SEQUENCE)
--    Collision-safe source of reservation display codes. nextval() is enforced
--    concurrently-safe by PostgreSQL: it NEVER hands out a duplicate, so two
--    concurrent code requests can never collide regardless of restaurant. This
--    replaces the client-side length-based generator ('RSV-' + array length),
--    which is not concurrency-safe. START 1000 is an intentional product /
--    display decision (a neat lower bound for human-readable codes), NOT tied
--    to any existing production data — the production database is clean.
--
-- 2. next_reservation_code() (SECURITY DEFINER RPC)
--    The ONLY sanctioned way to allocate a reservation display code. It:
--      * derives NO restaurant_id from client input  (tenant is not even used
--        for allocation — the global sequence is inherently non-colliding)
--      * self-gates on has_permission('reservations.manage') so only active
--        staff who may manage reservations can obtain a code
--      * returns NULL (not an exception) when permission is denied, so
--        PostgREST returns a clean controllable result instead of a 500
--      * pins SET search_path = public, pg_temp (defeats search-path hijacking)
--      * consumes a sequence value ONLY when permission is granted
--      * is SECURITY DEFINER so nextval runs as the sequence owner (the
--        sequence itself has NO USAGE grant to any client role — it is only
--        reachable through this hardened function)
--    It stays compatible with the existing RLS helpers (0005): it calls
--    public.has_permission(), which is itself SECURITY DEFINER and reads the
--    caller's JWT internally, never from an argument.
--
-- 3. reservations_no_double_book (partial UNIQUE index) — SLOT granularity
--    DB-level double-booking enforcement (locked decision #2). A restaurant
--    cannot hold TWO active (pending OR confirmed) reservations on the SAME
--    restaurant + table + DATE + TIME slot. Verified against the real 0001
--    schema (all columns NOT NULL, so the index is total on its columns):
--      * reservation_date DATE NOT NULL      (line 230)
--      * reservation_time TIME NOT NULL      (line 231)
--      * status CHECK IN ('pending','confirmed','completed','cancelled')
--                                            (line 233-234)
--      * table_id UUID NULL ON DELETE SET NULL (line 229)
--      * restaurant_id UUID NOT NULL         (line 224)
--    The uniqueness unit is the exact (table, date, time) reservation slot,
--    NOT the whole day. Two active reservations may coexist on the same table
--    on the same date at DIFFERENT times. No interval/duration overlap is
--    modeled because the schema has a single TIME field and no start/end pair
--    — per the Phase 4D review, exact date+time uniqueness is the correct
--    constraint for this schema.
--    A UNIQUE index is the DB-native serialization point: under concurrency,
--    the first writer committing the (restaurant, table, date, time) slot wins
--    and a concurrent duplicate gets a unique_violation the app maps to a
--    friendly "already booked" error — no app-level locking needed.
--      * NULL table_id (walk-ins / no-table reservations) are EXCLUDED because
--        PostgreSQL treats NULLs as distinct in a unique index, so they never
--        collide with one another or with a table'd reservation. This is
--        correct: a table-less booking cannot double-book a table.
--      * completed/cancelled are EXCLUDED, so the SAME slot can be re-booked
--        after a reservation is completed or cancelled (freeing the slot).
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Collision-safe display-code sequence.
-- START 1000 is an intentional product/display decision, not derived from any
-- production codes (the database is clean of reservations). Sequence is
-- integer; the range (to 2.1e9) is ample for display codes.
-- ---------------------------------------------------------------------------
CREATE SEQUENCE public.reservation_code_seq
  AS integer
  START WITH 1000
  INCREMENT BY 1
  NO MINVALUE
  NO MAXVALUE
  CACHE 1
  OWNED BY NONE;

-- No client role may call nextval directly. The sequence is reachable ONLY
-- through the SECURITY DEFINER next_reservation_code(). A new sequence created
-- after migration 0003 is NOT covered by 0003's `GRANT ALL ON ALL SEQUENCES
-- ... TO anon, authenticated` (that statement applied only to sequences that
-- existed at the time), so it starts with PostgreSQL's default EXECUTE/USAGE
-- to PUBLIC. Revoke that default and anon explicitly.
REVOKE ALL ON SEQUENCE public.reservation_code_seq FROM PUBLIC, anon;

-- ---------------------------------------------------------------------------
-- 2. next_reservation_code() — hardened collision-safe code allocator.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.next_reservation_code()
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Permission gate: only active staff with reservations.manage may allocate
  -- a code. Denied => NULL (controllable result, no sequence burn, no error).
  IF public.has_permission('reservations.manage') THEN
    RETURN 'RSV-' || nextval('public.reservation_code_seq')::text;
  END IF;
  RETURN NULL;
END;
$$;

-- Least-privilege EXECUTE grants, mirroring 0005. 0003's blanket
-- `GRANT ALL ON ALL FUNCTIONS` does not retro-apply to this newer function, so
-- it starts with the PostgreSQL default (EXECUTE to PUBLIC) and is hardened
-- here explicitly. anon is never granted: anonymous clients must not allocate
-- codes. authenticated + service_role are the only callers.
REVOKE ALL ON FUNCTION public.next_reservation_code() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.next_reservation_code() FROM anon;
GRANT EXECUTE ON FUNCTION public.next_reservation_code() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Partial UNIQUE index — DB-enforced double-booking prevention at the
--    exact (table, date, time) reservation-slot granularity.
--    One ACTIVE (pending/confirmed) reservation per (restaurant, table,
--    date, time) slot. Predicate uses only literal statuses (from the real
--    CHECK constraint) and an IS NOT NULL -- both IMMUTABLE, so no DO-block
--    dynamic DDL is needed (unlike the 0002 owner index which required a
--    subquery for a role lookup).
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX reservations_no_double_book
  ON public.reservations (restaurant_id, table_id, reservation_date, reservation_time)
  WHERE status IN ('pending','confirmed') AND table_id IS NOT NULL;

COMMIT;
