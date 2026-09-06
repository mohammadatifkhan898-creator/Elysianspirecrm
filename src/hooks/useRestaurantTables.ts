/* ═══════════════════════════════════════════════════════════════
   useRestaurantTables — real-data read adapter for the Tables page.

   Hydration contract:
     - No Supabase configured -> `s.tables` cleared to [] / status
       'empty' (never seeded).
     - Supabase configured, error -> status 'error'.
     - Real rows -> replace `s.tables` wholesale (view models carrying DB
       uuids + display label), notify(). Never mixed with mock rows.
     - Zero rows (clean DB) -> clear to [] / status 'empty'.

   Writes are never performed here. Identity is resolved best-effort and
   surfaces roleSlug for UX gating (settings.manage); RLS is authoritative.
   ═══════════════════════════════════════════════════════════════ */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useUser } from '@clerk/react';
import { useStore } from '../store/store';
import { useSupabase } from '../lib/useSupabase';
import { listRestaurantTables } from '../services/restaurantTables';
import { getCurrentIdentity } from '../services';
import { identityHasAny } from '../routing/routes';
import type { ServiceError } from '../services/shared';
import type { DiningTable } from '../types';

export interface UseRestaurantTablesContext {
  restaurantId: string | null;
  staffId: string | null;
  roleSlug: string | null;
}

export type RestaurantTablesStatus = 'idle' | 'loading' | 'loaded' | 'empty' | 'error';

export interface UseRestaurantTablesResult {
  /** Current tables from the store (real rows once hydrated, otherwise empty). */
  tables: DiningTable[];
  status: RestaurantTablesStatus;
  error: ServiceError | null;
  context: UseRestaurantTablesContext | null;
  /** True when the resolved identity has settings.manage — table write actions. */
  canManageTables: boolean;
  refetch: () => void;
}

export function useRestaurantTables(): UseRestaurantTablesResult {
  const { s, notify } = useStore();
  const { supabase, isSupabaseConfigured } = useSupabase();
  const { user } = useUser();
  const [status, setStatus] = useState<RestaurantTablesStatus>('idle');
  const [error, setError] = useState<ServiceError | null>(null);
  const [context, setContext] = useState<UseRestaurantTablesContext | null>(null);
  const ran = useRef(false);

  const load = useCallback(() => {
    if (!isSupabaseConfigured || !supabase) {
      // Never keep mock/seed data in the runtime path: clear + empty state.
      s.tables = [];
      notify();
      setStatus('empty');
      setError(null);
      return;
    }

    let cancelled = false;
    setStatus('loading');
    setError(null);

    (async () => {
      let ctx: UseRestaurantTablesContext | null = null;
      const userId = user?.id ?? '';
      if (userId) {
        const ident = await getCurrentIdentity(supabase, userId);
        if (cancelled) return;
        if (ident.ok) {
          ctx = {
            restaurantId: ident.identity.restaurantId,
            staffId: ident.identity.staffId,
            roleSlug: ident.identity.roleSlug,
          };
          setContext(ctx);
        }
      }

      const result = await listRestaurantTables(supabase);
      if (cancelled) return;

      if (!result.ok) {
        setStatus('error');
        setError(result.error);
        return;
      }

      if (result.data.length > 0) {
        // Real rows (with DB uuids + label) only — never mixed with seed.
        s.tables = result.data;
        notify();
        setStatus('loaded');
      } else {
        // Clean DB (0 rows): genuine empty state, no demo injection.
        s.tables = [];
        notify();
        setStatus('empty');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [supabase, isSupabaseConfigured, user?.id, s, notify]);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    load();
  }, [load]);

  return {
    tables: s.tables,
    status,
    error,
    context,
    canManageTables: identityHasAny(
      s.identity?.roleSlug ?? null,
      s.identity?.permissions ?? [],
      ['settings.manage'],
    ),
    refetch: load,
  };
}
