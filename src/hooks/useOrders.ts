/* ═══════════════════════════════════════════════════════════════
   useOrders — real-data adapter for the Orders page.

   Hydration contract:
     - No Supabase configured -> `s.orders` cleared to [] / status 'empty'
       (never seeded).
     - Supabase configured, error -> status 'error'.
     - Real rows -> replace `s.orders` wholesale with real rows (view
       models resolving customer/table labels + line items), notify().
       Zero rows -> [] / status 'empty'.

   Writes (persistent):
     - createOrder: calls the atomic public.create_order RPC (migration
       0008). Only menu_item_id + quantity (+ optional customer/table) are
       sent; the server resolves prices, computes all monetary totals and
       generates the order code. On success the list is refetched so the
       store reflects committed DB state. No restaurant_id is sent.
     - advanceStatus: persists a forward status transition (orders.manage
       gated by RLS). Optimistic updates are handled by the PAGE (which has
       access to the specific row); the hook performs the write + refetch.
     - markPaid: persists pay_status (orders.manage gated by RLS).

   Realtime: subscribes to postgres_changes on `orders` + `order_items`
   after the first successful load. Any INSERT/UPDATE/DELETE triggers a full
   re-fetch so derived KPIs and the order list stay current. Subscription
   is cleaned up on unmount.
   ═══════════════════════════════════════════════════════════════ */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from '../store/store';
import { useSupabase } from '../lib/useSupabase';
import {
  listOrders,
  createOrder,
  updateOrderStatus,
  setOrderPayStatus,
  type CreateOrderInput,
} from '../services/orders';
import type { ServiceError } from '../services/shared';
import type { Order, OrderStatus } from '../types';
import { identityHasAny } from '../routing/routes';

export type OrdersStatus = 'idle' | 'loading' | 'loaded' | 'empty' | 'error';

export interface UseOrdersResult {
  /** Current orders from the store (real rows once hydrated, otherwise empty). */
  orders: Order[];
  status: OrdersStatus;
  error: ServiceError | null;
  refetch: () => void;
  /** Atomic create via the create_order RPC. Server computes all money. */
  createOrder: (input: CreateOrderInput) => Promise<{ ok: boolean; error?: ServiceError }>;
  /** Persist a forward status transition (orders.manage gated by RLS). */
  advanceStatus: (orderId: string, next: OrderStatus) => Promise<{ ok: boolean; error?: ServiceError }>;
  /** Persist pay_status (paid=true => Paid, else Unpaid). orders.manage gated. */
  markPaid: (orderId: string, paid: boolean) => Promise<{ ok: boolean; error?: ServiceError }>;
  /** True when the resolved identity has orders.create — "+ New Order". */
  canCreateOrders: boolean;
  /** True when the resolved identity has orders.manage — status/pay actions. */
  canManageOrders: boolean;
}

export function useOrders(): UseOrdersResult {
  const { s, notify } = useStore();
  const { supabase, isSupabaseConfigured } = useSupabase();
  const [status, setStatus] = useState<OrdersStatus>('idle');
  const [error, setError] = useState<ServiceError | null>(null);
  const ran = useRef(false);
  const loadedRef = useRef(false);

  const load = useCallback(() => {
    if (!isSupabaseConfigured || !supabase) {
      s.orders = [];
      notify();
      setStatus('empty');
      setError(null);
      return;
    }

    let cancelled = false;
    setStatus('loading');
    setError(null);

    (async () => {
      const result = await listOrders(supabase);
      if (cancelled) return;

      if (!result.ok) {
        setStatus('error');
        setError(result.error);
        return;
      }

      s.orders = result.data;
      notify();
      setStatus(result.data.length > 0 ? 'loaded' : 'empty');
      loadedRef.current = true;
    })();

    return () => {
      cancelled = true;
    };
  }, [supabase, isSupabaseConfigured, s, notify]);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    load();
  }, [load]);

  // Realtime subscription — re-fetch on any orders/order_items change.
  useEffect(() => {
    if (!isSupabaseConfigured || !supabase || !loadedRef.current) return;

    const channel = supabase
      .channel('orders-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders' },
        () => load(),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'order_items' },
        () => load(),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [isSupabaseConfigured, supabase, load]);

  const doCreateOrder = useCallback<UseOrdersResult['createOrder']>(
    async (input) => {
      if (!isSupabaseConfigured || !supabase) {
        return { ok: false, error: { code: 'NOT_CONFIGURED', message: 'Orders are unavailable (not configured).' } };
      }
      const res = await createOrder(supabase, input);
      if (!res.ok) return { ok: false, error: res.error };
      load();
      return { ok: true };
    },
    [supabase, isSupabaseConfigured, load],
  );

  const doAdvanceStatus = useCallback<UseOrdersResult['advanceStatus']>(
    async (orderId, next) => {
      if (!isSupabaseConfigured || !supabase) {
        return { ok: false, error: { code: 'NOT_CONFIGURED', message: 'Orders are unavailable (not configured).' } };
      }
      const res = await updateOrderStatus(supabase, orderId, next);
      if (!res.ok) return { ok: false, error: res.error };
      load();
      return { ok: true };
    },
    [supabase, isSupabaseConfigured, load],
  );

  const doMarkPaid = useCallback<UseOrdersResult['markPaid']>(
    async (orderId, paid) => {
      if (!isSupabaseConfigured || !supabase) {
        return { ok: false, error: { code: 'NOT_CONFIGURED', message: 'Orders are unavailable (not configured).' } };
      }
      const res = await setOrderPayStatus(supabase, orderId, paid ? 'Paid' : 'Unpaid');
      if (!res.ok) return { ok: false, error: res.error };
      load();
      return { ok: true };
    },
    [supabase, isSupabaseConfigured, load],
  );

  return {
    orders: s.orders,
    status,
    error,
    refetch: load,
    createOrder: doCreateOrder,
    advanceStatus: doAdvanceStatus,
    markPaid: doMarkPaid,
    canCreateOrders: identityHasAny(
      s.identity?.roleSlug ?? null,
      s.identity?.permissions ?? [],
      ['orders.create'],
    ),
    canManageOrders: identityHasAny(
      s.identity?.roleSlug ?? null,
      s.identity?.permissions ?? [],
      ['orders.manage'],
    ),
  };
}
