-- 0003: Grant standard API role access (bug-fix for onboarding dead-end).
--
-- Migration 0001 created the schema/tables and seeded roles but never issued
-- GRANTs to Supabase's API roles. Consequence: the frontend token-aware client
-- (anon key, elevated to `authenticated` when a Clerk token is attached) could
-- read ZERO rows from every table — no error, just empty results. This made
-- getProfileState() return `none` for an already-provisioned user, so
-- SessionGate permanently redirected back to /onboarding ("Already set up"
-- dead-end). The provision_owner RPC kept working because it is SECURITY
-- DEFINER (runs as the owner).
--
-- This migration grants the standard REST role privileges. It does NOT enable
-- Row Level Security (that is intentionally deferred to a later migration) and
-- does not change any data or function logic. It is idempotent.

BEGIN;

-- Allow the API roles to resolve the schema object namespace.
GRANT USAGE ON SCHEMA public TO anon, authenticated;

-- Table-level CRUD for both anonymous and authenticated requests.
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;

-- Sequence privileges (in case any table uses serial/bigserial later).
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;

-- These roles are frequently used by admin tooling; grant for parity.
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- Grant usage on functions too, so roles can call public functions (e.g. the
-- provision_owner RPC when not SECURITY DEFINER in future RLS phases).
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated, service_role;

COMMIT;
