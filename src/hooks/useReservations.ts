/* ═══════════════════════════════════════════════════════════════
   useReservations — real-data read adapter for the Reservations page.

   Hydration contract:
     - No Supabase configured -> `s.reservations` cleared to [] / status
       'empty' (never seeded).
     - Supabase configured, error -> status 'error'.
     - Real rows -> replace `s.reservations` wholesale (view models),
       notify(). Never mixed.
     - Zero rows (clean DB) -> clear to [] / status 'empty'.

   Table display labels are resolved from s.tables (populated by
   useRestaurantTables). Because hooks fire in parallel on mount, the
   label map is rebuilt whenever s.tables changes.

   Permission: canManageReservations derives from the resolved identity's
   effective permissions (reservations.manage) in s.identity — the single
   identity source shared with the Sidebar/guards. RLS remains authoritative.
   ═══════════════════════════════════════════════════════════════ */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useUser } from '@clerk/react';
import { useStore } from '../store/store';
import { useSupabase } from '../lib/useSupabase';
import { listReservations, reservationRowToView } from '../services/reservations';
import { getCurrentIdentity } from '../services';
import { identityHasAny } from '../routing/routes';
import type { ServiceError } from '../services/shared';

export interface UseReservationsContext {
  restaurantId: string | null;
  staffId: string | null;
  roleSlug: string | null;
}

export type ReservationsStatus = 'idle' | 'loading' | 'loaded' | 'empty' | 'error';

export interface UseReservationsResult {
  status: ReservationsStatus;
  error: ServiceError | null;
  context: UseReservationsContext | null;
  /** True when the resolved identity has reservations.manage. */
  canManageReservations: boolean;
  refetch: () => void;
}

/** Build a table-id → display-label map from the store. */
function buildTableMap(tables: { id: string; label?: string }[]): Map<string, string> {
  return new Map(tables.map((t) => [t.id, t.label ?? t.id]));
}

export function useReservations(): UseReservationsResult {
  const { s, notify } = useStore();
  const { supabase, isSupabaseConfigured } = useSupabase();
  const { user } = useUser();
  const [status, setStatus] = useState<ReservationsStatus>('idle');
  const [error, setError] = useState<ServiceError | null>(null);
  const [context, setContext] = useState<UseReservationsContext | null>(null);
  const ran = useRef(false);
  const loadedRef = useRef(false);

  const load = useCallback(() => {
    if (!isSupabaseConfigured || !supabase) {
      // Never keep mock/seed data in the runtime path: clear + empty state.
      s.reservations = [];
      notify();
      setStatus('empty');
      setError(null);
      return;
    }

    let cancelled = false;
    setStatus('loading');
    setError(null);

    (async () => {
      let ctx: UseReservationsContext | null = null;
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

      const result = await listReservations(supabase);
      if (cancelled) return;

      if (!result.ok) {
        setStatus('error');
        setError(result.error);
        return;
      }

      if (result.data.length > 0) {
        const tableMap = buildTableMap(s.tables);
        s.reservations = result.data.map((r) => reservationRowToView(r, tableMap));
        notify();
        setStatus('loaded');
        loadedRef.current = true;
      } else {
        s.reservations = [];
        notify();
        setStatus('empty');
        loadedRef.current = true;
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

  /* ── Re-resolve table labels when s.tables changes ───────────── */
  useEffect(() => {
    if (status !== 'loaded') return;
    const tableMap = buildTableMap(s.tables);
    const resolved = s.reservations.map((r) => ({
      ...r,
      table: r.tableId ? (tableMap.get(r.tableId) ?? r.table) : r.table,
    }));
    const changed = resolved.some((r, i) => r.table !== s.reservations[i]?.table);
    if (changed) {
      s.reservations = resolved;
      notify();
    }
  }, [s.tables, status, s, notify]);

  // Realtime subscription — re-fetch on any row change after first load.
  useEffect(() => {
    if (!isSupabaseConfigured || !supabase || !loadedRef.current) return;

    const channel = supabase
      .channel('reservations-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'reservations' },
        () => load(),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [isSupabaseConfigured, supabase, load]);

  return {
    status,
    error,
    context,
    canManageReservations: identityHasAny(
      s.identity?.roleSlug ?? null,
      s.identity?.permissions ?? [],
      ['reservations.manage'],
    ),
    refetch: load,
  };
}
