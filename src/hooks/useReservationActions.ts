/* ═══════════════════════════════════════════════════════════════
   useReservationActions — Phase 4D Checkpoint D mutation hooks.

   Wraps the reservations service so the Reservations page never
   talks to Supabase directly.  Mutations update s.reservations
   (single source of truth) and call notify() + toast(), matching
   the established store pattern.

   Create obtains the server-generated reservation code via
   next_reservation_code() RPC (0007).  If the insert fails with a
   unique violation (23505 — double-booking), the error is mapped
   to a clear message.  The consumed sequence value is not reclaimed
   (gaps are acceptable for display codes).

   Physical DELETE is never performed; cancellation sets
   status='cancelled'.
   ═══════════════════════════════════════════════════════════════ */

import { useCallback, useRef, useState } from 'react';
import { useUser } from '@clerk/react';
import { useStore } from '../store/store';
import { useSupabase } from '../lib/useSupabase';
import { getCurrentIdentity } from '../services';
import {
  createReservation,
  updateReservation,
  cancelReservation,
  getNextReservationCode,
  reservationMutationError,
  type ReservationCreateInput,
  type ReservationUpdateInput,
} from '../services/reservations';
import type { ServiceError, ServiceResult } from '../services/shared';
import type { Reservation } from '../types';
import { convertTime } from '../lib/utils';

/** Resolve the table display label from s.tables (already hydrated). */
function resolveTable(tableId: string | null | undefined, tables: { id: string; label?: string }[]): string {
  if (!tableId) return '';
  const t = tables.find((x) => x.id === tableId);
  return t ? (t.label ?? t.id) : '';
}

/** Order reservations like listReservations(): date asc, then time asc. */
function byDateTime(a: Reservation, b: Reservation): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  const ta = convertTime(a.time);
  const tb = convertTime(b.time);
  if (ta !== tb) return ta < tb ? -1 : 1;
  return 0;
}

/* ── CREATE ───────────────────────────────────────────────────── */

export function useCreateReservation() {
  const { s, notify, toast } = useStore();
  const { supabase, isSupabaseConfigured } = useSupabase();
  const { user } = useUser();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ServiceError | null>(null);

  const busyRef = useRef(false);

  const run = useCallback(
    async (input: ReservationCreateInput): Promise<ServiceResult<Reservation>> => {
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

        const codeRes = await getNextReservationCode(supabase);
        if (!codeRes.ok) {
          setError(codeRes.error);
          return codeRes;
        }

        const res = await createReservation(
          supabase,
          input,
          { restaurantId: ident.identity.restaurantId },
          codeRes.data,
        );
        if (res.ok) {
          const resolved: Reservation = {
            ...res.data,
            table: resolveTable(res.data.tableId, s.tables),
          };
          s.reservations = [...s.reservations, resolved].sort(byDateTime);
          notify();
          toast('Reservation created');
        } else {
          const friendly = reservationMutationError(res.error);
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

export function useUpdateReservation() {
  const { s, notify, toast } = useStore();
  const { supabase, isSupabaseConfigured } = useSupabase();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ServiceError | null>(null);

  const busyRef = useRef(false);

  const run = useCallback(
    async (id: string, input: ReservationUpdateInput): Promise<ServiceResult<Reservation>> => {
      if (busyRef.current) {
        return { ok: false, error: { code: 'VALIDATION', message: 'This is still saving — please wait.' } };
      }
      if (!isSupabaseConfigured || !supabase) {
        return { ok: false, error: { code: 'NOT_CONFIGURED', message: 'Supabase is not configured.' } };
      }
      setSubmitting(true);
      setError(null);
      try {
        const res = await updateReservation(supabase, id, input);
        if (res.ok) {
          const resolved: Reservation = {
            ...res.data,
            table: resolveTable(res.data.tableId, s.tables),
          };
          s.reservations = s.reservations.map((r) => (r.id === id ? resolved : r));
          notify();
          toast('Reservation updated');
        } else {
          const friendly = reservationMutationError(res.error);
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

/* ── CANCEL (status → cancelled, never physical DELETE) ────────── */

export function useCancelReservation() {
  const { s, notify, toast } = useStore();
  const { supabase, isSupabaseConfigured } = useSupabase();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ServiceError | null>(null);

  const busyRef = useRef(false);

  const run = useCallback(
    async (id: string): Promise<ServiceResult<Reservation>> => {
      if (busyRef.current) {
        return { ok: false, error: { code: 'VALIDATION', message: 'This is still saving — please wait.' } };
      }
      if (!isSupabaseConfigured || !supabase) {
        return { ok: false, error: { code: 'NOT_CONFIGURED', message: 'Supabase is not configured.' } };
      }
      setSubmitting(true);
      setError(null);
      try {
        const res = await cancelReservation(supabase, id);
        if (res.ok) {
          s.reservations = s.reservations.map((r) => (r.id === id ? res.data : r));
          notify();
          toast('Reservation cancelled');
        } else {
          const friendly = reservationMutationError(res.error);
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
