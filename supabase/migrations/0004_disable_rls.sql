-- 0004: Disable Row Level Security (restore intended phase state).
--
-- Root cause of the onboarding dead-end: the live database has ROW LEVEL
-- SECURITY ENABLED on the business tables with zero policies. Because there
-- are no policies authorising the Supabase API roles, PostgREST silently
-- returns ZERO rows to the frontend token-aware client (anon key, elevated to
-- `authenticated` with a Clerk token) — no error, just empty results. So
-- getProfileState() resolved to `none` for an already-provisioned user and
-- SessionGate permanently redirected back to /onboarding ("Already set up"
-- dead-end), even though the profile/restaurant/staff rows exist (only
-- service_role / SECURITY DEFINER functions — incl. provision_owner — could
-- see them).
--
-- Migration 0001 explicitly documents RLS as DEPERRED ("RLS policies / ROW
-- LEVEL SECURITY (added in a later migration)"), i.e. the intended state for
-- THIS phase is RLS OFF with plain table grants (migration 0003) for the API
-- roles. This migration restores that documented phase state by disabling RLS
-- on the business tables. It does NOT add any RLS policies and does NOT touch
-- any CRUD logic; it is idempotent and safe to re-run.
--
-- A dedicated future migration (outside this phase) will enable RLS and add
-- the real `auth.jwt()->>'sub'`-based policies.

BEGIN;

ALTER TABLE public.restaurants          DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.roles                DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_members        DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles             DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_permissions     DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers            DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.restaurant_tables    DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.menu_categories      DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.menu_items           DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.reservations         DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders               DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items          DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_activity       DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_notes       DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications        DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_prefs   DISABLE ROW LEVEL SECURITY;

COMMIT;
