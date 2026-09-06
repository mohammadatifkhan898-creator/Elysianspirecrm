/* ═══════════════════════════════════════════════════════════════
   Orders service — real data for the Orders page.

   Follows the Phase 4B conventions (ServiceResult<T> / ServiceError /
   toServiceError). Tenant scoping is derived by RLS; reads/writes never
   send a client-supplied restaurant_id.

   CREATE — server-authoritative RPC: order creation goes ONLY through the
   atomic public.create_order(uuid, uuid, jsonb) SECURITY DEFINER function
   (migration 0008). The client sends only menu_item_id + quantity; names,
   prices, taxes, totals, the order code and the restaurant_id are resolved
   and computed entirely on the server. Money is never trusted from the
   client.

   STATUS / PAY — the existing drawer controls advance status and mark
   payment. These are persisted via PostgREST .update() on `orders`, gated
   by the 0006 RLS policy (which requires orders.manage + restaurant match).
   Lifecycle is enforced in the service: only forward transitions, and no
   transition out of the terminal completed/cancelled states.

   View model `Order` bundles the header (orders) + immutable line items
   (order_items), resolves customer/table labels, carries the display code
   (orders.code) as `id` AND the real DB uuid as `orderId` for writes.
   ═══════════════════════════════════════════════════════════════ */

import type { AppSupabaseClient } from '../lib/supabase';
import type { OrderItemsRow, OrdersRow, OrdersUpdate } from '../types/database';
import type { Order, OrderItem, OrderStatus, PaymentStatus } from '../types';
import { toServiceError, type ServiceError, type ServiceResult } from './shared';

const DB_TO_STATUS: Record<string, OrderStatus> = {
  new: 'New',
  preparing: 'Preparing',
  ready: 'Ready',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

const DB_TO_PAY: Record<string, PaymentStatus> = {
  paid: 'Paid',
  unpaid: 'Unpaid',
  refunded: 'Refunded',
};

export const ORDER_STATUSES: OrderStatus[] = ['New', 'Preparing', 'Ready', 'Completed', 'Cancelled'];

/* ── READ ─────────────────────────────────────────────────────── */

interface OrdersJoinRow extends OrdersRow {
  order_items?: OrderItemsRow[];
  customer?: { name: string } | null;
  table?: { label: string } | null;
  kitchen?: { label: string } | null;
}

/**
 * List orders for the caller's restaurant (RLS-scoped), newest first.
 * Resolves customer/table display labels and bundles line items.
 */
export async function listOrders(supabase: AppSupabaseClient): Promise<ServiceResult<Order[]>> {
  const { data, error } = await supabase
    .from('orders')
    .select('*, order_items(*), customer:customer_id(name), table:table_id(label)')
    .order('created_at', { ascending: false });

  if (error) return { ok: false, error: toServiceError(error) };

  return {
    ok: true,
    data: (data as unknown as OrdersJoinRow[]).map((row) => orderRowToView(row)),
  };
}

/* ── MAPPER ───────────────────────────────────────────────────── */

/** Map an orders join row (with embedded items + labels) to the frontend Order view model. */
export function orderRowToView(row: OrdersJoinRow): Order {
  const items: OrderItem[] = (row.order_items ?? []).map((it) => ({
    n: it.item_name,
    q: it.quantity,
    p: Number(it.unit_price),
  }));
  const total = Number(row.total_amount);
  const placed = new Date(row.placed_at);
  return {
    id: row.code,
    orderId: row.id,
    cust: row.customer?.name ?? 'Walk-in',
    customerId: row.customer_id ?? null,
    table: row.table?.label ?? '',
    items,
    amount: total > 0 ? total : items.reduce((a, i) => a + i.q * i.p, 0),
    pay: DB_TO_PAY[row.pay_status] ?? 'Unpaid',
    status: DB_TO_STATUS[row.status] ?? 'New',
    time: placedLabel(placed),
    placed: row.placed_at,
  };
}

/** Compact clock label for "Placed" column (e.g. "12:42 PM"). */
function placedLabel(d: Date): string {
  if (Number.isNaN(d.getTime())) return '';
  const h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  const ap = h >= 12 ? 'PM' : 'AM';
  const hh = ((h + 11) % 12) + 1;
  return hh + ':' + m + ' ' + ap;
}

/* ── CREATE — server-authoritative atomic RPC ─────────────────── */

/**
 * One selectable line to send to create_order. The server re-resolves the
 * menu item tenant-scoped; name/price/code/totals are NEVER sent by the client.
 */
export interface CreateOrderItem {
  menu_item_id: string;
  quantity: number;
}

export interface CreateOrderInput {
  /** Optional CRM customer uuid; null/omitted = walk-in. Server-validated in-tenant. */
  customerId?: string | null;
  /** Optional table uuid; null/omitted = no table. Server-validated in-tenant. */
  tableId?: string | null;
  items: CreateOrderItem[];
}

/** The JSON returned by the create_order RPC (server-computed). */
export interface CreatedOrder {
  order_id: string;
  code: string;
  status: OrdersRow['status'];
  pay_status: OrdersRow['pay_status'];
  subtotal: number;
  tax_amount: number;
  total_amount: number;
  placed_at: string;
}

/** Translate a create_order RPC failure into a stable, user-safe ServiceError. */
function orderCreateError(err: unknown): ServiceError {
  const e = err as { message?: string; code?: string; details?: string };
  const msg = (e?.message ?? '') + ' ' + (e?.details ?? '');
  if (e?.code === '42501' || /permission denied/i.test(msg)) {
    return { code: 'FORBIDDEN', message: 'You do not have permission to create orders (orders.create required).', raw: err };
  }
  if (/authentication required/i.test(msg)) {
    return { code: 'FORBIDDEN', message: 'You must be signed in to create an order.', raw: err };
  }
  if (/not available in this restaurant|currently unavailable/i.test(msg)) {
    return { code: 'VALIDATION', message: 'One of the selected items is unavailable. Refresh and try again.', raw: err };
  }
  if (/invalid customer|invalid table/i.test(msg)) {
    return { code: 'VALIDATION', message: 'Please choose a valid customer or table.', raw: err };
  }
  const base = toServiceError(err);
  return base.code === 'UNKNOWN'
    ? { code: 'VALIDATION', message: 'Could not create the order. Please review the items and try again.', raw: err }
    : base;
}

/**
 * Create an order atomically via the create_order SECURITY DEFINER RPC.
 * Sends only customer/table (optional) + items (menu_item_id + quantity);
 * every monetary value and the order code are produced server-side.
 */
export async function createOrder(
  supabase: AppSupabaseClient,
  input: CreateOrderInput,
): Promise<ServiceResult<CreatedOrder>> {
  if (!Array.isArray(input.items) || input.items.length === 0) {
    return { ok: false, error: { code: 'VALIDATION', message: 'Add at least one item to the order.' } };
  }
  const payload = input.items.map((it) => ({
    menu_item_id: it.menu_item_id,
    quantity: it.quantity,
  }));

  const { data, error } = await supabase.rpc('create_order', {
    p_customer_id: input.customerId ?? null,
    p_table_id: input.tableId ?? null,
    p_items: payload,
  });

  if (error) return { ok: false, error: orderCreateError(error) };
  return { ok: true, data: data as CreatedOrder };
}

/* ── STATUS / PAY — persisted updates for the existing drawer ── */

/** Forward transition map (New→Preparing→Ready→Completed). Cancelled is terminal. */
const STATUS_NEXT: Record<OrderStatus, OrderStatus | null> = {
  New: 'Preparing',
  Preparing: 'Ready',
  Ready: 'Completed',
  Completed: null,
  Cancelled: null,
};

const STATUS_TO_DB: Record<OrderStatus, OrdersRow['status']> = {
  New: 'new',
  Preparing: 'preparing',
  Ready: 'ready',
  Completed: 'completed',
  Cancelled: 'cancelled',
};

const PAY_TO_DB: Record<PaymentStatus, OrdersRow['pay_status']> = {
  Paid: 'paid',
  Unpaid: 'unpaid',
  Refunded: 'refunded',
};

/** The next allowed forward status, or null when the order is terminal. */
export function nextStatus(current: OrderStatus): OrderStatus | null {
  return STATUS_NEXT[current] ?? null;
}

/**
 * Persist a status advance. Enforces the approved lifecycle in the service
 * (not just the UI): only forward transitions and no move out of a terminal
 * Completed/Cancelled state. A request that repeats the current status is an
 * idempotent no-op. The RLS orders.update policy independently enforces
 * restaurant match + orders.manage, so a waiter without manage is rejected
 * server-side.
 */
export async function updateOrderStatus(
  supabase: AppSupabaseClient,
  orderId: string,
  next: OrderStatus,
): Promise<ServiceResult<true>> {
  if (!(next in STATUS_TO_DB)) {
    return { ok: false, error: { code: 'VALIDATION', message: 'Unknown order status.' } };
  }

  const { data: row, error: readErr } = await supabase
    .from('orders')
    .select('status')
    .eq('id', orderId)
    .maybeSingle();

  if (readErr) return { ok: false, error: toServiceError(readErr) };
  if (!row) return { ok: false, error: { code: 'NOT_FOUND', message: 'This order no longer exists or was removed.' } };

  const current = DB_TO_STATUS[row.status] ?? null;
  if (!current) {
    return { ok: false, error: { code: 'VALIDATION', message: 'This order is in an unknown state.' } };
  }
  if (STATUS_NEXT[current] !== next) {
    if (next === current) return { ok: true, data: true };
    return {
      ok: false,
      error: {
        code: 'VALIDATION',
        message: 'Orders can only move forward in the workflow (New → Preparing → Ready → Completed).',
      },
    };
  }

  const { error } = await supabase
    .from('orders')
    .update({ status: STATUS_TO_DB[next] } as OrdersUpdate)
    .eq('id', orderId);

  if (error) return { ok: false, error: toServiceError(error) };
  return { ok: true, data: true };
}

/**
 * Persist a payment-status change (mark paid / unpaid). RLS requires
 * orders.manage + restaurant match. 'Refunded' is not offered by the current
 * UI, but the service accepts it for parity with the schema.
 */
export async function setOrderPayStatus(
  supabase: AppSupabaseClient,
  orderId: string,
  pay: PaymentStatus,
): Promise<ServiceResult<true>> {
  if (!(pay in PAY_TO_DB)) {
    return { ok: false, error: { code: 'VALIDATION', message: 'Unknown payment status.' } };
  }
  const { error } = await supabase
    .from('orders')
    .update({ pay_status: PAY_TO_DB[pay] } as OrdersUpdate)
    .eq('id', orderId);

  if (error) return { ok: false, error: toServiceError(error) };
  return { ok: true, data: true };
}

