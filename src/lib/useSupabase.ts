/* useSupabase — React hook bridging Clerk's session to a token-aware
   Supabase client (Phase 2A).

   Clerk is the single auth authority. The hook reads the active Clerk session
   via useSession() and builds a Supabase client whose accessToken callback
   returns the live Clerk session token, so PostgREST treats every request as
   the signed-in Clerk user. Rebuilds the client only when Supabase config or
   the session object's identity changes. Must be used inside ClerkProvider.

   RLS is LIVE (0006): every policy resolves the caller via
   `auth.jwt() ->> 'sub'` (text) against profiles.id, not auth.uid(). */

import { useMemo } from 'react';
import { useSession } from '@clerk/react';
import { createTokenAwareSupabase, isSupabaseConfigured, type AppSupabaseClient } from './supabase';

export interface UseSupabaseResult {
  /** Token-aware, Clerk-integrated client, or null when unconfigured. */
  supabase: AppSupabaseClient | null;
  isSupabaseConfigured: boolean;
  /** Current Clerk session token, or null when signed out. */
  getSessionToken: () => Promise<string | null> | string | null;
}

export function useSupabase(): UseSupabaseResult {
  const { session } = useSession();

  const tokenGetter = useMemo(
    () => () => session?.getToken() ?? null,
    // session identity drives the getToken closure; recreate when it changes
    [session],
  );

  const client = useMemo(
    () => createTokenAwareSupabase(tokenGetter),
    [tokenGetter],
  );

  return {
    supabase: client,
    isSupabaseConfigured,
    /** Current Clerk session token, or null when signed out. */
    getSessionToken: tokenGetter,
  };
}
