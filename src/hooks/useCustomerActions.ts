/* ═══════════════════════════════════════════════════════════════
   useCustomerActions — Phase 4C mutation + note hooks.

   Wraps the Phase 4B/4C service layer so pages never talk to Supabase
   directly. Mutations update `s.customers` (single source of truth)
   and call notify() for the UI, matching the established store pattern.

   Create resolves the tenant from authenticated identity (getCurrentIdentity)
   inside the service path — the UI never sends restaurant_id.
   ═══════════════════════════════════════════════════════════════ */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useUser } from '@clerk/react';
import { useStore } from '../store/store';
import { useSupabase } from '../lib/useSupabase';
import { getCurrentIdentity } from '../services';
import {
  createCustomer,
  updateCustomer,
  softDeleteCustomer,
  listCustomerNotes,
  createCustomerNote,
  customerMutationError,
  type CustomerCreateInput,
  type CustomerUpdateInput,
} from '../services/customers';
import type { ServiceError, ServiceResult } from '../services/shared';
import type { Customer } from '../types';

/* ── CREATE ───────────────────────────────────────────────────── */

export function useCreateCustomer() {
  const { s, notify, toast } = useStore();
  const { supabase, isSupabaseConfigured } = useSupabase();
  const { user } = useUser();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ServiceError | null>(null);
  const busyRef = useRef(false);

  const run = useCallback(
    async (input: CustomerCreateInput): Promise<ServiceResult<Customer>> => {
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
      busyRef.current = true;
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
        const res = await createCustomer(supabase, input, { restaurantId: ident.identity.restaurantId });
        if (res.ok) {
          s.customers = [...s.customers, res.data];
          notify();
          toast('Customer added');
        } else {
          const friendly = customerMutationError(res.error);
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

export function useUpdateCustomer() {
  const { s, notify, toast } = useStore();
  const { supabase, isSupabaseConfigured } = useSupabase();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ServiceError | null>(null);
  const busyRef = useRef(false);

  const run = useCallback(
    async (id: string, input: CustomerUpdateInput): Promise<ServiceResult<Customer>> => {
      if (busyRef.current) {
        return { ok: false, error: { code: 'VALIDATION', message: 'This is still saving — please wait.' } };
      }
      if (!isSupabaseConfigured || !supabase) {
        return { ok: false, error: { code: 'NOT_CONFIGURED', message: 'Supabase is not configured.' } };
      }
      busyRef.current = true;
      setSubmitting(true);
      setError(null);
      try {
        const res = await updateCustomer(supabase, id, input);
        if (res.ok) {
          s.customers = s.customers.map((c) => (c.id === id ? res.data : c));
          notify();
          toast('Customer updated');
        } else {
          const friendly = customerMutationError(res.error);
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

export function useDeleteCustomer() {
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
      busyRef.current = true;
      setSubmitting(true);
      setError(null);
      try {
        const res = await softDeleteCustomer(supabase, id);
        if (res.ok) {
          s.customers = s.customers.filter((c) => c.id !== id);
          notify();
          toast('Customer removed');
        } else {
          const friendly = customerMutationError(res.error);
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

/* ── NOTES (READ + CREATE; immutable) ─────────────────────────── */

export interface CustomerNoteItem {
  id: string;
  note: string;
  createdAt: string;
}

export type CustomerNotesStatus = 'loading' | 'loaded' | 'error';

export function useCustomerNotes(customerId: string | null) {
  const { toast } = useStore();
  const { supabase, isSupabaseConfigured } = useSupabase();
  const [notes, setNotes] = useState<CustomerNoteItem[]>([]);
  const [status, setStatus] = useState<CustomerNotesStatus>('loading');
  const [error, setError] = useState<ServiceError | null>(null);
  const [saving, setSaving] = useState(false);
  const busyRef = useRef(false);

  const load = useCallback(async () => {
    if (!customerId || !isSupabaseConfigured || !supabase) {
      setNotes([]);
      setStatus('loaded');
      return;
    }
    setStatus('loading');
    setError(null);
    const res = await listCustomerNotes(supabase, customerId);
    if (res.ok) {
      setNotes(res.data.map((n) => ({ id: n.id, note: n.note, createdAt: n.createdAt })));
      setStatus('loaded');
    } else {
      setStatus('error');
      setError(res.error);
    }
  }, [customerId, supabase, isSupabaseConfigured]);

  useEffect(() => {
    if (!customerId) return;
    let cancelled = false;
    (async () => {
      await load();
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
  }, [customerId, load]);

  const save = useCallback(
    async (text: string): Promise<ServiceResult<CustomerNoteItem>> => {
      if (busyRef.current) {
        return { ok: false, error: { code: 'VALIDATION', message: 'This is still saving — please wait.' } };
      }
      if (!customerId || !isSupabaseConfigured || !supabase) {
        return { ok: false, error: { code: 'NOT_CONFIGURED', message: 'Supabase is not configured.' } };
      }
      busyRef.current = true;
      setSaving(true);
      setError(null);
      try {
        const res = await createCustomerNote(supabase, customerId, text);
        if (res.ok) {
          setNotes((prev) => [{ id: res.data.id, note: res.data.note, createdAt: res.data.createdAt }, ...prev]);
          toast('Note added');
        } else {
          setError(res.error);
        }
        return res;
      } finally {
        busyRef.current = false;
        setSaving(false);
      }
    },
    [customerId, supabase, isSupabaseConfigured, toast],
  );

  return { notes, status, error, saving, save, retry: load };
}

