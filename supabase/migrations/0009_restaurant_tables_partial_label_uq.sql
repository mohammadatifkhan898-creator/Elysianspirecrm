-- ============================================================================
-- 0009 — Allow reusing a soft-deleted restaurant table label (CHECKPOINT D)
--
-- BUG: A deleted table's label could not be recreated. Root cause: migration
-- 0001 declares a FULL unique constraint on (restaurant_id, label):
--
--     CONSTRAINT restaurant_tables_restaurant_label_uq UNIQUE (restaurant_id, label)
--
-- FIX: Replace the full constraint with a PARTIAL UNIQUE INDEX over only the
-- ACTIVE rows (deleted_at IS NULL). A soft-deleted table no longer occupies
-- its label's unique slot, so a fresh table can reuse the same display code;
-- two ACTIVE tables still cannot share a label within a restaurant.
--
-- STRICTLY ADDITIVE for the policy surface (does NOT touch migrations 0001-0008,
-- does NOT weaken any RLS policy). The only schema change is to the uniqueness
-- structure on public.restaurant_tables. REVERSIBLE: re-running applies are
-- idempotent via DROP ... IF EXISTS / no prior index.
--
-- NOTE: The previous UNIQUE constraint also acted as the index backing the
-- FK/tenant lookup on (restaurant_id). The new partial index covers that shape
-- for active rows; the existing idx_restaurant_tables_restaurant (0001) remains
-- the non-unique index for all rows and is untouched.
-- ============================================================================

BEGIN;

-- 1. Drop the full UNIQUE constraint (name from 0001).
ALTER TABLE public.restaurant_tables
  DROP CONSTRAINT IF EXISTS restaurant_tables_restaurant_label_uq;

-- 2. Add a PARTIAL UNIQUE INDEX over active rows only, so soft-deleted tables
--    stop blocking label reuse within a restaurant. Mirrors the original
--    (restaurant_id, label) shape.
CREATE UNIQUE INDEX IF NOT EXISTS restaurant_tables_restaurant_label_active_uq
  ON public.restaurant_tables (restaurant_id, label)
  WHERE deleted_at IS NULL;

COMMIT;