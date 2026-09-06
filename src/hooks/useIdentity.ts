/* ═══════════════════════════════════════════════════════════════
   useIdentity — single source of truth for the current user's
   resolved identity (profile → staff → role → permissions).

   Calls getCurrentIdentity once on mount and caches the result in
   s.identity. Provides a refresh() method to re-fetch after role
   changes. All downstream consumers (Topbar, ProfileDrawer, Sidebar,
   permission gates) should read from s.identity rather than
   resolving their own identity chain.
   ═══════════════════════════════════════════════════════════════ */

import { useEffect, useRef } from 'react';
import type { AppIdentity } from '../types';
import { useStore } from '../store/store';
import { useSupabase } from '../lib/useSupabase';
import { getCurrentIdentity } from '../services/index';
import { useAuth } from '@clerk/react';
import { effectivePermissions, identityHasAny } from '../routing/routes';

export function useIdentity() {
  const { s, notify } = useStore();
  const { supabase, isSupabaseConfigured } = useSupabase();
  const { userId } = useAuth();
  const ran = useRef(false);

  const refresh = async () => {
    if (!isSupabaseConfigured || !supabase || !userId) {
      if (s.identity) {
        s.identity = null;
        notify();
      }
      return;
    }

    const result = await getCurrentIdentity(supabase, userId);
    if (result.ok) {
      s.identity = {
        ...result.identity,
        permissions: effectivePermissions(result.identity.roleSlug, result.identity.permissions),
      };
    } else {
      s.identity = null;
    }
    notify();
  };

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    void refresh();
    // refresh intentionally runs once per AppShell mount — matches previous
    // behavior (only depended on the mount guard, not on notify).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const identity: AppIdentity | null = s.identity;

  return {
    identity,
    loading: s.identity === null && isSupabaseConfigured,
    refresh,
    hasPermission: (perm: string) =>
      !!identity && identityHasAny(identity.roleSlug, identity.permissions, [perm]),
    hasAnyPermission: (...perms: string[]) =>
      !!identity && identityHasAny(identity.roleSlug, identity.permissions, perms),
  };
}
