/* ═══════════════════════════════════════════════════════════════
   useCustomers — real-data read adapter for the Customers page.

   Hydration contract:
     - No Supabase configured -> `s.customers` cleared to [] and status
       'empty' (never seeded).
     - Supabase configured, error -> status 'error' with the surfaced
       ServiceError; store not touched.
     - Real rows exist -> replace `s.customers` wholesale with real rows
       (view models carrying DB uuids), then notify(). Never mixed.
     - Zero rows (clean DB) -> clear to [] / status 'empty'.

   No create/update/delete is performed here. Identity is resolved
   best-effort and surfaced for context; tenant is always derived by
   RLS inside listCustomers.
   ═══════════════════════════════════════════════════════════════ */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useUser } from '@clerk/react';
import { useStore } from '../store/store';
import { useSupabase } from '../lib/useSupabase';
import { listCustomers } from '../services/customers';
import { getCurrentIdentity } from '../services';
import { identityHasAny } from '../routing/routes';
import type { ServiceError } from '../services/shared';
import type { Customer } from '../types';

export interface UseCustomersContext {
  restaurantId: string | null;
  staffId: string | null;
  roleSlug: string | null;
}

export type CustomersStatus = 'idle' | 'loading' | 'loaded' | 'empty' | 'error';

export interface UseCustomersResult {
  /** Current customers from the store (real rows once hydrated, otherwise empty). */
  customers: Customer[];
  status: CustomersStatus;
  error: ServiceError | null;
  /** Best-effort resolved identity for UI context (may be null). */
  context: UseCustomersContext | null;
  /** True when the resolved identity has customers.manage — customer write actions. */
  canManageCustomers: boolean;
  /** Re-run the Hydration/slice read. */
  refetch: () => void;
}

export function useCustomers(): UseCustomersResult {
  const { s, notify } = useStore();
  const { supabase, isSupabaseConfigured } = useSupabase();
  const { user } = useUser();
  const [status, setStatus] = useState<CustomersStatus>('idle');
  const [error, setError] = useState<ServiceError | null>(null);
  const [context, setContext] = useState<UseCustomersContext | null>(null);
  const ran = useRef(false);

  const load = useCallback(() => {
    if (!isSupabaseConfigured || !supabase) {
      // Never keep mock/seed data in the runtime path: clear + empty state.
      s.customers = [];
      notify();
      setStatus('empty');
      setError(null);
      return;
    }

    let cancelled = false;
    setStatus('loading');
    setError(null);

    (async () => {
      // Step 4 — identity (best-effort; never blocks the read path).
      let ctx: UseCustomersContext | null = null;
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

      // Step 6 — real-data read.
      const result = await listCustomers(supabase);
      if (cancelled) return;

      if (!result.ok) {
        setStatus('error');
        setError(result.error);
        return;
      }

      // Replace wholesale — real rows (with DB uuids) only, never mixed
      // with seed rows. Zero rows -> genuine empty state (no demo data).
      s.customers = result.data;
      notify();
      setStatus(result.data.length > 0 ? 'loaded' : 'empty');
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
    customers: s.customers,
    status,
    error,
    context,
    canManageCustomers: identityHasAny(
      s.identity?.roleSlug ?? null,
      s.identity?.permissions ?? [],
      ['customers.manage'],
    ),
    refetch: load,
  };
}
