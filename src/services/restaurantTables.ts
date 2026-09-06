/* ═══════════════════════════════════════════════════════════════
   Restaurant Tables service (Phase 4D — Checkpoint C).

   Follows the Phase 4B/4C conventions (ServiceResult<T> / ServiceError /
   toServiceError). Tenant scoping is derived by RLS from the caller; the
   read path never sends a client-supplied restaurant_id.

   WRITE GATE — settings.manage (0006): INSERT/UPDATE/DELETE all require
   `restaurant_id = current_restaurant_id() AND has_permission('settings.manage')`.
   Reads (SELECT) are broadly visible to tenant staff with no permission
   code. This service does NOT invent a `tables.manage` permission — RLS's
   settings.manage is the sole authorization boundary for writes.

   DELETE = SOFT DELETE (sets deleted_at). We NEVER issue a physical DELETE:
   reservations.table_id / orders.table_id reference this table with
   ON DELETE SET NULL, so a hard delete would be non-destructive to history,
   but the schema uses `deleted_at` as the approved soft-delete convention;
   normal list reads exclude soft-deleted rows. Soft deletion therefore
   preserves historical FK references and lets a table be re-listed later.

   STATUS: only the DB-supported values 'available' | 'occupied' | 'reserved'
   (0001 CHECK constraint) are ever written.
   ═══════════════════════════════════════════════════════════════ */

import type { AppSupabaseClient } from '../lib/supabase';
import type { RestaurantTablesRow } from '../types/database';
import type { DiningTable, TableStatus } from '../types';
import { toServiceError, type ServiceError, type ServiceResult } from './shared';

/** UI settable statuses — exactly the DB CHECK values, no invention. */
export const TABLE_STATUSES: TableStatus[] = ['available', 'occupied', 'reserved'];

/* ── READ ─────────────────────────────────────────────────────── */

/**
 * List non-deleted tables visible to the caller (RLS-scoped to the caller's
 * restaurant). Ordering by the display code keeps the floor plan stable.
 */
export async function listRestaurantTables(
  supabase: AppSupabaseClient,
): Promise<ServiceResult<DiningTable[]>> {
  const { data, error } = await supabase
    .from('restaurant_tables')
    .select('*')
    .is('deleted_at', null)
    .order('label', { ascending: true });

  if (error) return { ok: false, error: toServiceError(error) };

  return { ok: true, data: (data as RestaurantTablesRow[]).map(restaurantTableRowToView) };
}

/**
 * Fetch a single (non-deleted) table by uuid.
 */
export async function getRestaurantTable(
  supabase: AppSupabaseClient,
  id: string,
): Promise<ServiceResult<DiningTable | null>> {
  const { data, error } = await supabase
    .from('restaurant_tables')
    .select('*')
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();

  if (error) return { ok: false, error: toServiceError(error) };
  if (!data) return { ok: true, data: null };
  return { ok: true, data: restaurantTableRowToView(data as RestaurantTablesRow) };
}

/* ── CREATE ───────────────────────────────────────────────────── */

/** Fields settable by the UI when creating a table. No tenant/id here. */
export interface RestaurantTableCreateInput {
  label: string;
  capacity: number;
  status?: TableStatus;
}

/** Tenant derived from authenticated identity, passed by the hook. */
export interface RestaurantTableTenantContext {
  restaurantId: string;
}

function normalizeLabel(label: string): string {
  const trimmed = label.trim();
  if (!trimmed) throw new Error('A table label is required.');
  return trimmed.toUpperCase();
}

/**
 * Create a table. `restaurant_id` is set from authenticated identity
 * (TenantContext), never from user input — RLS enforces this too
 * (WITH CHECK requires the restaurant + settings.manage).
 */
export async function createRestaurantTable(
  supabase: AppSupabaseClient,
  input: RestaurantTableCreateInput,
  identity: RestaurantTableTenantContext,
): Promise<ServiceResult<DiningTable>> {
  let label: string;
  try {
    label = normalizeLabel(input.label);
  } catch (e) {
    return {
      ok: false,
      error: { code: 'VALIDATION', message: e instanceof Error ? e.message : 'Invalid table.' },
    };
  }

  if (!Number.isInteger(input.capacity) || input.capacity < 1) {
    return { ok: false, error: { code: 'VALIDATION', message: 'Capacity must be at least 1 guest.' } };
  }

  const row: Partial<RestaurantTablesRow> = {
    restaurant_id: identity.restaurantId,
    label,
    capacity: input.capacity,
    status: input.status ?? 'available',
  };

  const { data, error } = await supabase
    .from('restaurant_tables')
    .insert(row as RestaurantTablesRow)
    .select('*')
    .single();

  if (error) return { ok: false, error: toServiceError(error) };

  return { ok: true, data: restaurantTableRowToView(data as RestaurantTablesRow) };
}

/* ── UPDATE ───────────────────────────────────────────────────── */

/** Only these fields may be updated. id / restaurant_id are immutable. */
export interface RestaurantTableUpdateInput {
  label?: string;
  capacity?: number;
  status?: TableStatus;
}

/**
 * Update a table by uuid. The RLS UPDATE policy's USING + WITH CHECK both
 * require the row to belong to the caller's restaurant AND settings.manage,
 * so a table can never be moved to another tenant. Allows subset updates.
 */
export async function updateRestaurantTable(
  supabase: AppSupabaseClient,
  id: string,
  input: RestaurantTableUpdateInput,
): Promise<ServiceResult<DiningTable>> {
  const patch: Partial<RestaurantTablesRow> = {};

  if (input.label !== undefined) {
    let label: string;
    try {
      label = normalizeLabel(input.label);
    } catch (e) {
      return {
        ok: false,
        error: { code: 'VALIDATION', message: e instanceof Error ? e.message : 'Invalid table.' },
      };
    }
    patch.label = label;
  }
  if (input.capacity !== undefined) {
    if (!Number.isInteger(input.capacity) || input.capacity < 1) {
      return { ok: false, error: { code: 'VALIDATION', message: 'Capacity must be at least 1 guest.' } };
    }
    patch.capacity = input.capacity;
  }
  if (input.status !== undefined) patch.status = input.status;

  if (Object.keys(patch).length === 0) {
    return { ok: false, error: { code: 'VALIDATION', message: 'Nothing to update.' } };
  }

  const { data, error } = await supabase
    .from('restaurant_tables')
    .update(patch as Partial<RestaurantTablesRow>)
    .eq('id', id)
    .is('deleted_at', null)
    .select('*')
    .maybeSingle();

  if (error) return { ok: false, error: toServiceError(error) };
  if (!data) {
    return {
      ok: false,
      error: { code: 'NOT_FOUND', message: 'Table was not found or was removed.' },
    };
  }
  return { ok: true, data: restaurantTableRowToView(data as RestaurantTablesRow) };
}

/* ── DELETE (SOFT) ────────────────────────────────────────────── */

/**
 * Soft-delete a table by setting deleted_at = NOW(). The list read already
 * excludes soft-deleted rows. RLS constrains this to the caller's restaurant
 * and requires settings.manage. We do NOT physically DELETE the row, so any
 * reservations/orders referencing this table keep their (SET NULL-cleared)
 * historical snapshot intact.
 */
export async function softDeleteRestaurantTable(
  supabase: AppSupabaseClient,
  id: string,
): Promise<ServiceResult<true>> {
  const { error } = await supabase
    .from('restaurant_tables')
    .update({ deleted_at: new Date().toISOString() } as Partial<RestaurantTablesRow>)
    .eq('id', id);

  if (error) return { ok: false, error: toServiceError(error) };
  return { ok: true, data: true };
}

/* ── MAPPER ───────────────────────────────────────────────────── */

/**
 * Map a canonical `restaurant_tables` row to the frontend `DiningTable` view
 * model. `id` carries the real DB uuid; `label` is the display code. Capacity
 * and status map 1:1 (the DB enum matches the frontend union exactly).
 */
export function restaurantTableRowToView(row: RestaurantTablesRow): DiningTable {
  const status: TableStatus =
    row.status === 'available' || row.status === 'occupied' || row.status === 'reserved'
      ? row.status
      : 'available';
  return {
    id: row.id,
    label: row.label,
    cap: row.capacity,
    status,
  };
}

/** Resolve a human-authored, self-descriptive error for table write failures. */
export function tableMutationError(error: ServiceError): ServiceError {
  const base = error as ServiceError & { raw?: { code?: string } };
  const code = base.raw && typeof base.raw === 'object' ? (base.raw as { code?: string }).code : undefined;
  if (code === '23505') {
    return { code: 'VALIDATION', message: 'A table with that label already exists in this restaurant.' };
  }
  if (code === '42501') {
    return { code: 'FORBIDDEN', message: 'You do not have permission to manage tables.' };
  }
  // Never surface raw PostgREST/network text for unmapped failures.
  if (base.code === 'NETWORK') {
    return { code: 'NETWORK', message: 'Network error — could not reach the server. Please try again.', raw: base.raw };
  }
  return {
    code: 'VALIDATION',
    message: 'Could not update the table. Please try again.',
    raw: base.raw,
  };
}
