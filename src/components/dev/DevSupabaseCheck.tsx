/* DevSupabaseCheck — development-only diagnostic (Phase 2A).

   Verifies that a Clerk-authenticated Supabase request reaches the backend
   with the Clerk session token, so `auth.jwt() ->> 'sub'` can resolve to the
   Clerk user id (TEXT). It performs a single read-only, no-op query
   (select from the already-seeded `roles` table; RLS is not yet enabled) and
   logs the result to the browser console. It renders nothing and only runs
   when `import.meta.env.DEV` is true, so it is statically eliminated from
   production builds. Mounted inside ClerkProvider in App.tsx.

   This is a *diagnostic only* — it performs no writes, no CRUD, and touches
   no user data. It must be removed once real persistence wiring lands. */

import { useEffect } from 'react';
import { useSupabase } from '../../lib/useSupabase';

export function DevSupabaseCheck() {
  const { supabase, getSessionToken } = useSupabase();

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    if (!supabase) {
      console.warn('[supabase:dev] Not configured — skipping authenticated request check.');
      return;
    }

    let cancelled = false;

    (async () => {
      let sub: string | null = null;
      try {
        const token = await getSessionToken();
        if (token) {
          // Decode only the payload (middle section); never log the token.
          const payload = token.split('.')[1];
          if (payload) {
            try {
              sub = (JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))).sub as string) ?? null;
            } catch {
              sub = null;
            }
          }
        } else {
          console.info('[supabase:dev] No Clerk session token (signed out). Skipping.');
          return;
        }
      } catch (e) {
        console.warn('[supabase:dev] Could not obtain Clerk session token.', e);
        return;
      }

      try {
        // Read-only probe: succeeds when Supabase accepts the Clerk token as
        // an authenticated request. RLS is off, so this returns seeded rows.
        const { data, error } = await supabase
          .from('roles')
          .select('name')
          .limit(1);
        if (!cancelled) {
          if (error) {
            console.warn('[supabase:dev] Authenticated request FAILED:', error.message);
          } else {
            console.info(
              '[supabase:dev] Clerk-authenticated Supabase request OK.',
              `resolved sub="${sub}"`,
              `sample row=${data?.[0] ? (data[0] as { name?: string }).name : '(none)'}`,
            );
          }
        }
      } catch (e) {
        if (!cancelled) console.warn('[supabase:dev] Authenticated request threw:', e);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [supabase, getSessionToken]);

  return null;
}
