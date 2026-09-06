/* ═══════════════════════════════════════════════════════════════
   Customers service (Phase 4C — full read + write + notes).

   Follows the Phase 4B conventions (ServiceResult<T> / ServiceError /
   toServiceError). Tenant scoping is derived by RLS from the caller.
   On INSERT the RLS WITH CHECK requires restaurant_id to equal the
   caller's derived tenant, so `restaurant_id` is resolved here from
   authenticated identity (passed in from the hook as `identity`) and is
   NEVER accepted from the UI. Update/delete are same-tenant constrained
   by RLS and never touch restaurant_id / id.

   Delete = SOFT DELETE (sets deleted_at). Hard DELETE is FK-safe
   (customer_notes CASCADE, orders/reservations SET NULL) but the schema
   uses `deleted_at` as the approved soft-delete convention for the
   `customers` reference entity, and the list already excludes soft-deleted
   rows — so removal never destroys business history.

   Notes are IMMUTABLE per the schema: SELECT + INSERT are RLS-granted,
   UPDATE and DELETE are denied (USING (false)). Only read/create here.
   ═══════════════════════════════════════════════════════════════ */

import type { AppSupabaseClient } from '../lib/supabase';
import type { CustomersRow, CustomerNotesRow } from '../types/database';
import type { Customer } from '../types';
import { toServiceError, type ServiceError, type ServiceResult } from './shared';

/* ── READ ─────────────────────────────────────────────────────── */

/**
 * List non-deleted customers visible to the caller (RLS-scoped to the
 * caller's restaurant).
 */
export async function listCustomers(
  supabase: AppSupabaseClient,
): Promise<ServiceResult<Customer[]>> {
  const { data, error } = await supabase
    .from('customers')
    .select('*')
    .is('deleted_at', null)
    .order('name', { ascending: true });

  if (error) return { ok: false, error: toServiceError(error) };

  return { ok: true, data: (data as CustomersRow[]).map(customerRowToView) };
}

/**
 * Fetch a single (non-deleted) customer by uuid.
 */
export async function getCustomer(
  supabase: AppSupabaseClient,
  id: string,
): Promise<ServiceResult<Customer | null>> {
  const { data, error } = await supabase
    .from('customers')
    .select('*')
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();

  if (error) return { ok: false, error: toServiceError(error) };
  if (!data) return { ok: true, data: null };
  return { ok: true, data: customerRowToView(data as CustomersRow) };
}

/* ── CREATE ───────────────────────────────────────────────────── */

/** Fields settable by the UI when creating a customer. No tenant/id here. */
export interface CustomerCreateInput {
  name: string;
  phone?: string | null;
  email?: string | null;
  favorite_item?: string | null;
}

/** Tenant derived from authenticated identity, passed by the hook. */
export interface TenantContext {
  restaurantId: string;
}

function normalizeCreateInput(input: CustomerCreateInput): {
  name: string;
  phone: string | null;
  email: string | null;
  favorite_item: string | null;
} {
  const name = input.name.trim();
  if (!name) throw new Error('Customer name is required.');
  return {
    name,
    phone: input.phone?.trim() ? input.phone.trim() : null,
    email: input.email?.trim() ? input.email.trim() : null,
    favorite_item: input.favorite_item?.trim() ? input.favorite_item.trim() : null,
  };
}

/**
 * Create a customer. `restaurant_id` is set from authenticated identity
 * (TenantContext), never from user input — RLS enforces this too.
 */
export async function createCustomer(
  supabase: AppSupabaseClient,
  input: CustomerCreateInput,
  identity: TenantContext,
): Promise<ServiceResult<Customer>> {
  let normalized: { name: string; phone: string | null; email: string | null; favorite_item: string | null };
  try {
    normalized = normalizeCreateInput(input);
  } catch (e) {
    return { ok: false, error: { code: 'VALIDATION', message: e instanceof Error ? e.message : 'Invalid customer.' } };
  }

  const row: Partial<CustomersRow> = {
    restaurant_id: identity.restaurantId,
    name: normalized.name,
    phone: normalized.phone,
    email: normalized.email,
    favorite_item: normalized.favorite_item,
    visits: 0,
    orders: 0,
    spent: '0',
  };

  const { data, error } = await supabase
    .from('customers')
    .insert(row as CustomersRow)
    .select('*')
    .single();

  if (error) return { ok: false, error: toServiceError(error) };

  return { ok: true, data: customerRowToView(data as CustomersRow) };
}

/* ── UPDATE ───────────────────────────────────────────────────── */

/** Only these fields may be updated. id / restaurant_id are immutable. */
export interface CustomerUpdateInput {
  name?: string;
  phone?: string | null;
  email?: string | null;
  favorite_item?: string | null;
}

/**
 * Update a customer by uuid. The RLS UPDATE policy's USING + WITH CHECK
 * both require the row to belong to the caller's restaurant, so a customer
 * can never be moved to another tenant. Allows subset updates.
 */
export async function updateCustomer(
  supabase: AppSupabaseClient,
  id: string,
  input: CustomerUpdateInput,
): Promise<ServiceResult<Customer>> {
  const patch: Partial<CustomersRow> = {};
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) return { ok: false, error: { code: 'VALIDATION', message: 'Customer name cannot be empty.' } };
    patch.name = name;
  }
  if (input.phone !== undefined) patch.phone = input.phone?.trim() ? input.phone.trim() : null;
  if (input.email !== undefined) patch.email = input.email?.trim() ? input.email.trim() : null;
  if (input.favorite_item !== undefined)
    patch.favorite_item = input.favorite_item?.trim() ? input.favorite_item.trim() : null;

  const { data, error } = await supabase
    .from('customers')
    .update(patch as Partial<CustomersRow>)
    .eq('id', id)
    .is('deleted_at', null)
    .select('*')
    .maybeSingle();

  if (error) return { ok: false, error: toServiceError(error) };
  if (!data) {
    return {
      ok: false,
      error: { code: 'NOT_FOUND', message: 'Customer was not found or was removed.' },
    };
  }
  return { ok: true, data: customerRowToView(data as CustomersRow) };
}

/* ── DELETE (SOFT) ────────────────────────────────────────────── */

/**
 * Soft-delete a customer by setting deleted_at = NOW(). The list read
 * already excludes soft-deleted rows. RLS constrains this to the caller's
 * restaurant and requires customers.manage. No dependent business records
 * (orders/reservations) are touched, and notes are preserved (customer_notes
 * cascade only on HARD delete, which we do not perform here).
 */
export async function softDeleteCustomer(
  supabase: AppSupabaseClient,
  id: string,
): Promise<ServiceResult<true>> {
  const { error } = await supabase
    .from('customers')
    .update({ deleted_at: new Date().toISOString() } as Partial<CustomersRow>)
    .eq('id', id);

  if (error) return { ok: false, error: toServiceError(error) };
  return { ok: true, data: true };
}

/* ── NOTES (READ + CREATE; immutable) ─────────────────────────── */

export interface CustomerNote {
  id: string;
  customerId: string;
  note: string;
  createdAt: string;
}

/**
 * List immutable notes for a customer (RLS: customers.view on the parent).
 */
export async function listCustomerNotes(
  supabase: AppSupabaseClient,
  customerId: string,
): Promise<ServiceResult<CustomerNote[]>> {
  const { data, error } = await supabase
    .from('customer_notes')
    .select('id, customer_id, note, created_at')
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false });

  if (error) return { ok: false, error: toServiceError(error) };

  const notes = (data as Pick<CustomerNotesRow, 'id' | 'customer_id' | 'note' | 'created_at'>[]).map(
    (n) => ({ id: n.id, customerId: n.customer_id, note: n.note, createdAt: n.created_at }),
  );
  return { ok: true, data: notes };
}

/**
 * Create an immutable note on a customer (RLS: customers.manage on the
 * parent). author_staff_id is optional (SET NULL allowed).
 */
export async function createCustomerNote(
  supabase: AppSupabaseClient,
  customerId: string,
  note: string,
  authorStaffId?: string | null,
): Promise<ServiceResult<CustomerNote>> {
  const text = note.trim();
  if (!text) return { ok: false, error: { code: 'VALIDATION', message: 'Note cannot be empty.' } };

  const { data, error } = await supabase
    .from('customer_notes')
    .insert({
      customer_id: customerId,
      author_staff_id: authorStaffId ?? null,
      note: text,
    } as CustomerNotesRow)
    .select('id, customer_id, note, created_at')
    .single();

  if (error) return { ok: false, error: toServiceError(error) };

  const n = data as Pick<CustomerNotesRow, 'id' | 'customer_id' | 'note' | 'created_at'>;
  return { ok: true, data: { id: n.id, customerId: n.customer_id, note: n.note, createdAt: n.created_at } };
}

/* ── MAPPER ───────────────────────────────────────────────────── */

/**
 * Resolve a human-authored, self-descriptive error for customer write
 * failures. 23505 is the unique index on (restaurant_id, phone/email).
 */
export function customerMutationError(error: ServiceError): ServiceError {
  const base = error as ServiceError & { raw?: { code?: string } };
  const code = base.raw && typeof base.raw === 'object' ? (base.raw as { code?: string }).code : undefined;
  if (code === '23505') {
    return { code: 'VALIDATION', message: 'A customer with this phone or email already exists.' };
  }
  if (code === '42501') {
    return { code: 'FORBIDDEN', message: 'You do not have permission to manage customers.' };
  }
  if (base.code === 'NETWORK') {
    return { code: 'NETWORK', message: 'Network error — could not reach the server. Please try again.', raw: base.raw };
  }
  return { code: 'VALIDATION', message: 'Could not save the customer. Please try again.', raw: base.raw };
}

/**
 * Map a canonical `customers` row to the frontend `Customer` view model.
 * Single boundary so page components never touch DB shapes.
 */
export function customerRowToView(row: CustomersRow): Customer {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone ?? '',
    email: row.email ?? '',
    visits: row.visits,
    orders: row.orders,
    spent: Number(row.spent),
    last: relativeVisit(row.last_visit_at),
    fav: row.favorite_item ?? '',
  };
}

/** Compact human label for a last-visit timestamp (seed-style display). */
function relativeVisit(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const now = Date.now();
  const diff = now - date.getTime();
  const day = 24 * 60 * 60 * 1000;
  if (diff < day && diff >= 0) return 'Today';
  if (diff < 2 * day) return 'Yesterday';
  if (diff < 7 * day) return `${Math.floor(diff / day)} days ago`;
  if (diff < 30 * day) return 'This week';
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
