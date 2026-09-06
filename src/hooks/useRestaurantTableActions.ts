/* ═══════════════════════════════════════════════════════════════
   useRestaurantTableActions — Phase 4D Checkpoint C mutation hooks.

   Wraps the restaurantTables service so the Tables page never talks to
   Supabase directly. Mutations update `s.tables` (single source of truth)
   and call notify() + toast(), matching the established store pattern.

   Create resolves the tenant from authenticated identity (getCurrentIdentity)
   inside the service path — the UI never sends restaurant_id.

   Each mutation is gated server-side by RLS (settings.manage); the
   permission-aware page may hide the controls as a UX convenience, but RLS
   remains authoritative. A denied WRITE surfaces as a FORBIDDEN error.
   ═══════════════════════════════════════════════════════════════ */

import { useCallback, useRef, useState } from 'react';
import { useUser } from '@clerk/react';
import { useStore } from '../store/store';
import { useSupabase } from '../lib/useSupabase';
import { getCurrentIdentity } from '../services';
import {
  createRestaurantTable,
  updateRestaurantTable,
  softDeleteRestaurantTable,
  tableMutationError,
  type RestaurantTableCreateInput,
  type RestaurantTableUpdateInput,
} from '../services/restaurantTables';
import type { ServiceError, ServiceResult } from '../services/shared';
import type { DiningTable } from '../types';

/* ── CREATE ───────────────────────────────────────────────────── */

export function useCreateRestaurantTable() {
  const { s, notify, toast } = useStore();
  const { supabase, isSupabaseConfigured } = useSupabase();
  const { user } = useUser();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ServiceError | null>(null);

  const busyRef = useRef(false);

  const run = useCallback(
    async (input: RestaurantTableCreateInput): Promise<ServiceResult<DiningTable>> => {
      if (busyRef.current) {
        return { ok: false, error: { code: 'VALIDATION', message: 'This is still saving — please wait.' } };
      }
      if (!isSupabaseConfigured || !supabase) {
        return { ok: false, error: { code: 'NOT_CONFIGURED', message: 'Supabase is not configured.' } };
      }
      const userId = user?.id ?? '';
      if (!userId) {
        return { ok: false, error: { code: 'VALIDATION', message: 'Not signed in.' } };
      }
      setSubmitting(true);
      setError(null);
      try {
        const ident = await getCurrentIdentity(supabase, userId);
        if (!ident.ok || !ident.identity.restaurantId) {
          const err: ServiceError = {
            code: 'FORBIDDEN',
            message: 'Could not resolve restaurant for this account.',
          };
          setError(err);
          return { ok: false, error: err };
        }
        const res = await createRestaurantTable(supabase, input, {
          restaurantId: ident.identity.restaurantId,
        });
        if (res.ok) {
          s.tables = [...s.tables, res.data];
          notify();
          toast('Table added');
        } else {
          const friendly = tableMutationError(res.error);
          setError(friendly);
          return { ok: false, error: friendly };
        }
        return res;
      } finally {
        busyRef.current = false;
        setSubmitting(false);
      }
    },
    [supabase, isSupabaseConfigured, user?.id, s, notify, toast],
  );

  return { run, submitting, error };
}

/* ── UPDATE ───────────────────────────────────────────────────── */

export function useUpdateRestaurantTable() {
  const { s, notify, toast } = useStore();
  const { supabase, isSupabaseConfigured } = useSupabase();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ServiceError | null>(null);

  const busyRef = useRef(false);

  const run = useCallback(
    async (id: string, input: RestaurantTableUpdateInput): Promise<ServiceResult<DiningTable>> => {
      if (busyRef.current) {
        return { ok: false, error: { code: 'VALIDATION', message: 'This is still saving — please wait.' } };
      }
      if (!isSupabaseConfigured || !supabase) {
        return { ok: false, error: { code: 'NOT_CONFIGURED', message: 'Supabase is not configured.' } };
      }
      setSubmitting(true);
      setError(null);
      try {
        const res = await updateRestaurantTable(supabase, id, input);
        if (res.ok) {
          s.tables = s.tables.map((t) => (t.id === id ? res.data : t));
          notify();
          toast('Table updated');
        } else {
          const friendly = tableMutationError(res.error);
          setError(friendly);
          return { ok: false, error: friendly };
        }
        return res;
      } finally {
        busyRef.current = false;
        setSubmitting(false);
      }
    },
    [supabase, isSupabaseConfigured, s, notify, toast],
  );

  return { run, submitting, error };
}

/* ── STATUS (a normal UPDATE) ─────────────────────────────────── */

/** Change a table's status only — the manual status path (no auto-sync). */
export function useSetRestaurantTableStatus() {
  const { s, notify, toast } = useStore();
  const { supabase, isSupabaseConfigured } = useSupabase();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ServiceError | null>(null);

  const busyRef = useRef(false);

  const run = useCallback(
    async (id: string, status: RestaurantTableUpdateInput['status']): Promise<ServiceResult<DiningTable>> => {
      if (busyRef.current) {
        return { ok: false, error: { code: 'VALIDATION', message: 'This is still saving — please wait.' } };
      }
      if (!isSupabaseConfigured || !supabase) {
        return { ok: false, error: { code: 'NOT_CONFIGURED', message: 'Supabase is not configured.' } };
      }
      setSubmitting(true);
      setError(null);
      try {
        const res = await updateRestaurantTable(supabase, id, { status });
        if (res.ok) {
          s.tables = s.tables.map((t) => (t.id === id ? res.data : t));
          notify();
          toast('Table status updated');
        } else {
          const friendly = tableMutationError(res.error);
          setError(friendly);
          return { ok: false, error: friendly };
        }
        return res;
      } finally {
        busyRef.current = false;
        setSubmitting(false);
      }
    },
    [supabase, isSupabaseConfigured, s, notify, toast],
  );

  return { run, submitting, error };
}

/* ── DELETE (SOFT) ────────────────────────────────────────────── */

export function useDeleteRestaurantTable() {
  const { s, notify, toast } = useStore();
  const { supabase, isSupabaseConfigured } = useSupabase();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ServiceError | null>(null);

  const busyRef = useRef(false);

  const run = useCallback(
    async (id: string): Promise<ServiceResult<true>> => {
      if (busyRef.current) {
        return { ok: false, error: { code: 'VALIDATION', message: 'This is still saving — please wait.' } };
      }
      if (!isSupabaseConfigured || !supabase) {
        return { ok: false, error: { code: 'NOT_CONFIGURED', message: 'Supabase is not configured.' } };
      }
      setSubmitting(true);
      setError(null);
      try {
        const res = await softDeleteRestaurantTable(supabase, id);
        if (res.ok) {
          s.tables = s.tables.filter((t) => t.id !== id);
          notify();
          toast('Table removed');
        } else {
          const friendly = tableMutationError(res.error);
          setError(friendly);
          return { ok: false, error: friendly };
        }
        return res;
      } finally {
        busyRef.current = false;
        setSubmitting(false);
      }
    },
    [supabase, isSupabaseConfigured, s, notify, toast],
  );

  return { run, submitting, error };
}
