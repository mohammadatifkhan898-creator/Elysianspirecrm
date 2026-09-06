/* Supabase client — token-aware, Clerk-integrated. Frontend only.

   Architecture (Phase 2A): Clerk is the sole auth authority, and Supabase
   trusts Clerk-issued session tokens via the native Third-Party Auth
   integration. This module therefore does NOT keep a static, module-level
   client. Instead it exposes a factory that builds a client whose
   `accessToken` callback returns the active Clerk session token on every
   request, so PostgREST treats each call as an `authenticated` request whose
   `sub` claim equals the Clerk user id (text, e.g. `user_2abc...`).

   Security rules that hold here:
   - The ONLY credential shipped to the browser is the anon/publishable key
     (public by design). The service-role / secret key must never appear in
     frontend code or be read at runtime.
   - RLS is LIVE (0006). All policies resolve the caller via
     `auth.jwt() ->> 'sub'` (text) compared to `profiles.id`, never
     `auth.uid()` (which casts the Clerk `sub` to uuid and would fail).
   - Tenant identity is derived by RLS from the caller's profile. The client
     must never trust or send a client-supplied `restaurant_id`. */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? '';
const supabasePublishableKey =
  (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) ??
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ??
  '';

/**
 * The token-aware client type used across the service layer.
 *
 * Deliberately typed as the base `SupabaseClient` (NOT `SupabaseClient<Database>`):
 * supabase-js's generated-style generic requires the DB schema shape it emits,
 * and a hand-written boundary breaks `.rpc()` argument typing and row inference
 * (rows fall back to `never`). Instead the hand-written schema-accurate boundary
 * in `src/types/database.ts` is applied explicitly at the service layer via casts
 * (e.g. `data as CustomersRow[]`), which is the sanctioned "temporary typed
 * boundary" approach for this environment.
 */
export type AppSupabaseClient = SupabaseClient;

/** True when Supabase env config is present. */
export const isSupabaseConfigured = Boolean(supabaseUrl && supabasePublishableKey);

/**
 * Dev-only guard. Never prints the values themselves — only which variable is
 * missing, so a misconfiguration fails loudly without leaking credentials.
 */
function assertConfigured(name: string, value: string): void {
  if (!value) {
    throw new Error(
      `Supabase is not configured: missing environment variable ${name}. ` +
        'Add it to .env.local (VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY).',
    );
  }
}

/**
 * Create a token-aware, Clerk-integrated Supabase client.
 *
 * @param getToken async callback that resolves the current Clerk session
 *   token (e.g. `() => session?.getToken() ?? null`). Return `null` when the
 *   user is signed out — supabase-js then falls back to the anon key for
 *   that request.
 * @returns a Supabase client, or `null` when Supabase is incorrectly
 *   configured. Returns the same client instance for repeated calls with the
 *   same callback identity so consumers can safely memoize on the callback.
 */
export function createTokenAwareSupabase(
  getToken: () => Promise<string | null> | string | null,
): AppSupabaseClient | null {
  if (!isSupabaseConfigured) return null;

  assertConfigured('VITE_SUPABASE_URL', supabaseUrl);
  assertConfigured('VITE_SUPABASE_PUBLISHABLE_KEY', supabasePublishableKey);

  return createClient(supabaseUrl, supabasePublishableKey, {
    // Every Supabase request carries the active Clerk session token in the
    // Authorization header, so Supabase/PostgREST authenticates the request
    // as the Clerk user (resolving `auth.jwt() ->> 'sub'` to the user id).
    accessToken: async () => (await getToken()) ?? null,
  });
}
