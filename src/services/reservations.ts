/* ═══════════════════════════════════════════════════════════════
   Reservations service (Phase 4D — Checkpoint D).

   Follows the Phase 4B/4C/4C conventions (ServiceResult<T> /
   ServiceError / toServiceError). Tenant scoping is derived by RLS
   from the caller; services never send a client-supplied
   restaurant_id.

   WRITE GATE — reservations.manage (0006): INSERT/UPDATE/DELETE all
   require `restaurant_id = current_restaurant_id() AND
   has_permission('reservations.manage')`.  SELECT requires
   `reservations.view`.  Owner-admin and manager roles have manage.

   DELETE = STATUS CHANGE (cancelled). We never issue a physical DELETE.
   The partial unique index (0007) only enforces uniqueness for
   pending/confirmed reservations, so cancelling frees the slot.

   RESERVATION CODE — obtained from the next_reservation_code() RPC
   (0007) which self-gates on reservations.manage.  Codes are
   display-only (never PK).  Gaps in the sequence are acceptable.

   DOUBLE-BOOKING — caught via the reservations_no_double_book partial
   unique index (0007) on (restaurant_id, table_id, reservation_date,
   reservation_time) WHERE status IN ('pending','confirmed') AND
   table_id IS NOT NULL.  Unique violation (23505) is mapped to a
   clear user-facing message.
   ═══════════════════════════════════════════════════════════════ */

import type { AppSupabaseClient } from '../lib/supabase';
import type { ReservationsRow } from '../types/database';
import type { Reservation, ResStatus } from '../types';
import { toServiceError, type ServiceError, type ServiceResult } from './shared';

/* ── STATUS MAPPINGS ─────────────────────────────────────────── */

const DB_TO_VIEW: Record<string, ResStatus> = {
  pending: 'Pending',
  confirmed: 'Confirmed',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export const VIEW_TO_DB: Record<ResStatus, ReservationsRow['status']> = {
  Pending: 'pending',
  Confirmed: 'confirmed',
  Completed: 'completed',
  Cancelled: 'cancelled',
};

/** Statuses the UI may set on create. DB default is 'pending'. */
export const RES_STATUSES: ResStatus[] = ['Pending', 'Confirmed', 'Completed', 'Cancelled'];

/** Allowed forward transitions from a given status. */
export const ALLOWED_TRANSITIONS: Record<ResStatus, ResStatus[]> = {
  Pending: ['Confirmed', 'Cancelled'],
  Confirmed: ['Completed', 'Cancelled'],
  Completed: [],
  Cancelled: [],
};

function transitionMessage(role: string, allowed: ResStatus[]): ServiceError {
  return {
    code: 'VALIDATION',
    message:
      allowed.length > 0
        ? 'A ' + role + ' reservation can only move forward to: ' + allowed.join(', ') + '.'
        : 'A ' + role + ' reservation cannot change status anymore.',
  };
}

function mapStatus(db: string): ResStatus {
  return DB_TO_VIEW[db] ?? 'Pending';
}

/* ── READ ─────────────────────────────────────────────────────── */

/** List reservations visible to the caller (RLS-scoped). */
export async function listReservations(
  supabase: AppSupabaseClient,
): Promise<ServiceResult<ReservationsRow[]>> {
  const { data, error } = await supabase
    .from('reservations')
    .select('*')
    .order('reservation_date', { ascending: true })
    .order('reservation_time', { ascending: true });

  if (error) return { ok: false, error: toServiceError(error) };
  return { ok: true, data: data as ReservationsRow[] };
}

/** Fetch a single reservation by uuid. */
export async function getReservation(
  supabase: AppSupabaseClient,
  id: string,
): Promise<ServiceResult<ReservationsRow | null>> {
  const { data, error } = await supabase
    .from('reservations')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) return { ok: false, error: toServiceError(error) };
  return { ok: true, data: data as ReservationsRow | null };
}

/* ── CODE GENERATION (RPC) ───────────────────────────────────── */

/** Get the next reservation code from the server (next_reservation_code RPC). */
export async function getNextReservationCode(
  supabase: AppSupabaseClient,
): Promise<ServiceResult<string>> {
  const { data, error } = await supabase.rpc('next_reservation_code');
  if (error) return { ok: false, error: toServiceError(error) };
  if (!data) {
    return {
      ok: false,
      error: { code: 'FORBIDDEN', message: 'Unable to generate reservation code. You may not have permission.' },
    };
  }
  return { ok: true, data: data as string };
}

/* ── CREATE ───────────────────────────────────────────────────── */

export interface ReservationCreateInput {
  guestName: string;
  phone?: string | null;
  customerId?: string | null;
  tableId?: string | null;
  reservationDate: string;
  reservationTime: string;
  guests: number;
  notes?: string | null;
}

export interface TenantContext {
  restaurantId: string;
}

/**
 * Create a reservation.  `restaurant_id` is set from authenticated
 * identity (TenantContext), never from user input.  The display code
 * is obtained from next_reservation_code() RPC.  RLS enforces
 * restaurant_id + reservations.manage on INSERT.
 */
export async function createReservation(
  supabase: AppSupabaseClient,
  input: ReservationCreateInput,
  identity: TenantContext,
  code: string,
): Promise<ServiceResult<Reservation>> {
  const guestName = input.guestName.trim();
  if (!guestName) {
    return { ok: false, error: { code: 'VALIDATION', message: 'Guest name is required.' } };
  }
  if (!input.reservationDate) {
    return { ok: false, error: { code: 'VALIDATION', message: 'Reservation date is required.' } };
  }
  if (!input.reservationTime) {
    return { ok: false, error: { code: 'VALIDATION', message: 'Reservation time is required.' } };
  }
  if (!Number.isInteger(input.guests) || input.guests < 1) {
    return { ok: false, error: { code: 'VALIDATION', message: 'Guest count must be at least 1.' } };
  }

  const row: Partial<ReservationsRow> = {
    restaurant_id: identity.restaurantId,
    code,
    guest_name: guestName,
    phone: input.phone?.trim() || null,
    customer_id: input.customerId || null,
    table_id: input.tableId || null,
    reservation_date: input.reservationDate,
    reservation_time: input.reservationTime,
    guests: input.guests,
    notes: input.notes?.trim() || null,
  };

  const { data, error } = await supabase
    .from('reservations')
    .insert(row as ReservationsRow)
    .select('*')
    .single();

  if (error) return { ok: false, error: toServiceError(error) };

  return { ok: true, data: reservationRowToView(data as ReservationsRow) };
}

/* ── UPDATE ───────────────────────────────────────────────────── */

export interface ReservationUpdateInput {
  guestName?: string;
  phone?: string | null;
  customerId?: string | null;
  tableId?: string | null;
  reservationDate?: string;
  reservationTime?: string;
  guests?: number;
  /** View-model status (capitalized). Canonicalized to DB values before write. */
  status?: ResStatus;
  notes?: string | null;
}

/** Update a reservation by uuid.  Handles double-booking conflict. */
export async function updateReservation(
  supabase: AppSupabaseClient,
  id: string,
  input: ReservationUpdateInput,
): Promise<ServiceResult<Reservation>> {
  const patch: Partial<ReservationsRow> = {};

  if (input.guestName !== undefined) {
    const guestName = input.guestName.trim();
    if (!guestName) {
      return { ok: false, error: { code: 'VALIDATION', message: 'Guest name cannot be empty.' } };
    }
    patch.guest_name = guestName;
  }
  if (input.phone !== undefined) patch.phone = input.phone?.trim() || null;
  if (input.customerId !== undefined) patch.customer_id = input.customerId || null;
  if (input.tableId !== undefined) patch.table_id = input.tableId || null;
  if (input.reservationDate !== undefined) patch.reservation_date = input.reservationDate;
  if (input.reservationTime !== undefined) patch.reservation_time = input.reservationTime;
  if (input.guests !== undefined) {
    if (!Number.isInteger(input.guests) || input.guests < 1) {
      return { ok: false, error: { code: 'VALIDATION', message: 'Guest count must be at least 1.' } };
    }
    patch.guests = input.guests;
  }
  if (input.status !== undefined) {
    const dbStatus = VIEW_TO_DB[input.status];
    if (!dbStatus) {
      return { ok: false, error: { code: 'VALIDATION', message: 'Unknown reservation status.' } };
    }
    // Enforce the status lifecycle here (not just in the UI): only forward
    // transitions via ALLOWED_TRANSITIONS, never out of a terminal state.
    const { data: cur, error: curErr } = await supabase
      .from('reservations')
      .select('status')
      .eq('id', id)
      .maybeSingle();
    if (curErr) return { ok: false, error: toServiceError(curErr) };
    if (!cur) return { ok: false, error: { code: 'NOT_FOUND', message: 'Reservation not found.' } };

    const current = mapStatus(cur.status);
    if (input.status !== current && !ALLOWED_TRANSITIONS[current].includes(input.status)) {
      return { ok: false, error: transitionMessage(current, ALLOWED_TRANSITIONS[current]) };
    }
    patch.status = dbStatus;
  }
  if (input.notes !== undefined) patch.notes = input.notes?.trim() || null;

  if (Object.keys(patch).length === 0) {
    return { ok: false, error: { code: 'VALIDATION', message: 'Nothing to update.' } };
  }

  const { data, error } = await supabase
    .from('reservations')
    .update(patch as Partial<ReservationsRow>)
    .eq('id', id)
    .select('*')
    .maybeSingle();

  if (error) return { ok: false, error: toServiceError(error) };
  if (!data) {
    return { ok: false, error: { code: 'NOT_FOUND', message: 'Reservation not found.' } };
  }
  return { ok: true, data: reservationRowToView(data as ReservationsRow) };
}

/* ── CANCEL (status change only, no physical DELETE) ──────────── */

/** Cancel a reservation by setting status to 'cancelled'. Only allowed from a non-terminal state. */
export async function cancelReservation(
  supabase: AppSupabaseClient,
  id: string,
): Promise<ServiceResult<Reservation>> {
  const { data: cur, error: readErr } = await supabase
    .from('reservations')
    .select('status')
    .eq('id', id)
    .maybeSingle();

  if (readErr) return { ok: false, error: toServiceError(readErr) };
  if (!cur) return { ok: false, error: { code: 'NOT_FOUND', message: 'Reservation not found.' } };

  const current = mapStatus(cur.status);
  if (current === 'Cancelled' || current === 'Completed') {
    return { ok: false, error: transitionMessage(current, ALLOWED_TRANSITIONS[current]) };
  }

  const { data, error } = await supabase
    .from('reservations')
    .update({ status: 'cancelled' } as Partial<ReservationsRow>)
    .eq('id', id)
    .select('*')
    .maybeSingle();

  if (error) return { ok: false, error: toServiceError(error) };
  if (!data) {
    return { ok: false, error: { code: 'NOT_FOUND', message: 'Reservation not found.' } };
  }
  return { ok: true, data: reservationRowToView(data as ReservationsRow) };
}

/* ── MAPPER ───────────────────────────────────────────────────── */

/**
 * Map a canonical reservations row to the frontend Reservation view model.
 * `tableLabelMap` resolves table UUIDs to display codes.  The `table` display
 * field is resolved from the map; if absent, falls back to ''.
 */
export function reservationRowToView(
  row: ReservationsRow,
  tableLabelMap?: Map<string, string>,
): Reservation {
  const displayTable = row.table_id
    ? (tableLabelMap?.get(row.table_id) ?? '')
    : '';
  // Strip seconds from time if present: "19:00:00" → "19:00"
  const t24 = row.reservation_time.slice(0, 5);
  return {
    id: row.id,
    code: row.code,
    cust: row.guest_name,
    customerId: row.customer_id,
    phone: row.phone ?? '',
    date: row.reservation_date,
    time: t12(t24),
    guests: row.guests,
    table: displayTable,
    tableId: row.table_id,
    status: mapStatus(row.status),
    notes: row.notes ?? '',
  };
}

/** 24h ("19:00") to 12h ("7:00 PM"). Mirrors lib/utils to12. */
function t12(t: string): string {
  const parts = t.split(':');
  const h = Number(parts[0]);
  const m = Number(parts[1]);
  const ap = h >= 12 ? 'PM' : 'AM';
  const hh = ((h + 11) % 12) + 1;
  return hh + ':' + String(m).padStart(2, '0') + ' ' + ap;
}

/* ── ERROR MAPPING ────────────────────────────────────────────── */

/** Resolve a human-readable error for reservation write failures. */
export function reservationMutationError(error: ServiceError): ServiceError {
  const base = error as ServiceError & { raw?: { code?: string } };
  const code = base.raw && typeof base.raw === 'object'
    ? (base.raw as { code?: string }).code
    : undefined;
  if (code === '23505') {
    return {
      code: 'VALIDATION',
      message: 'This table already has an active reservation for the selected date and time.',
    };
  }
  if (code === '23514') {
    return {
      code: 'VALIDATION',
      message: 'Unable to update the reservation status. Please try again.',
    };
  }
  if (code === '42501') {
    return {
      code: 'FORBIDDEN',
      message: 'You do not have permission to manage reservations.',
    };
  }
  // Never surface raw PostgREST/network text for unmapped failures.
  if (base.code === 'NETWORK') {
    return { code: 'NETWORK', message: 'Network error — could not reach the server. Please try again.', raw: base.raw };
  }
  return {
    code: 'VALIDATION',
    message: 'Could not save the reservation. Please try again.',
    raw: base.raw,
  };
}
