import { describe, expect, it } from 'vitest';
import {
  nextStatus,
  updateOrderStatus,
  createOrder,
  orderRowToView,
  ORDER_STATUSES,
} from '../../src/services/orders';
import { MockSupabase } from './helpers/supabaseMock';

describe('nextStatus', () => {
  it('advances along New → Preparing → Ready → Completed', () => {
    expect(nextStatus('New')).toBe('Preparing');
    expect(nextStatus('Preparing')).toBe('Ready');
    expect(nextStatus('Ready')).toBe('Completed');
  });

  it('is terminal at Completed and Cancelled', () => {
    expect(nextStatus('Completed')).toBeNull();
    expect(nextStatus('Cancelled')).toBeNull();
  });
});

describe('updateOrderStatus — lifecycle enforcement', () => {
  it('rejects an unknown status before touching the DB', async () => {
    const mock = new MockSupabase();
    const res = await updateOrderStatus(mock.client(), 'order-1', 'Nope' as never);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('VALIDATION');
    expect(mock.calls).toHaveLength(0);
  });

  it('allows a legal forward transition and writes the DB status', async () => {
    const mock = new MockSupabase([
      { data: { status: 'new' }, error: null },
      { data: null, error: null },
    ]);
    const res = await updateOrderStatus(mock.client(), 'order-1', 'Preparing');
    expect(res).toEqual({ ok: true, data: true });
    expect(mock.calls).toContain('eq:id="order-1"');
    expect(mock.calls.some((c) => c === 'update:{"status":"preparing"}')).toBe(true);
  });

  it('blocks a backward transition', async () => {
    const mock = new MockSupabase([{ data: { status: 'ready' }, error: null }]);
    const res = await updateOrderStatus(mock.client(), 'order-1', 'New');
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe('VALIDATION');
      expect(res.error.message).toContain('only move forward');
    }
    expect(mock.calls.some((c) => c.startsWith('update:'))).toBe(false);
  });

  it('treats a repeat of the current status as an idempotent no-op', async () => {
    const mock = new MockSupabase([{ data: { status: 'new' }, error: null }]);
    const res = await updateOrderStatus(mock.client(), 'order-1', 'New');
    expect(res).toEqual({ ok: true, data: true });
    expect(mock.calls.some((c) => c.startsWith('update:'))).toBe(false);
  });

  it('refuses to move out of a terminal state', async () => {
    const mock = new MockSupabase([{ data: { status: 'completed' }, error: null }]);
    const res = await updateOrderStatus(mock.client(), 'order-1', 'Preparing');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('VALIDATION');
    expect(mock.calls.some((c) => c.startsWith('update:'))).toBe(false);
  });

  it('returns NOT_FOUND when the order row is gone', async () => {
    const mock = new MockSupabase([{ data: null, error: null }]);
    const res = await updateOrderStatus(mock.client(), 'order-9', 'Preparing');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('NOT_FOUND');
  });
});

function makeOrdersRow() {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    restaurant_id: '22222222-2222-2222-2222-222222222222',
    code: 'ORD-5001',
    customer_id: '33333333-3333-3333-3333-333333333333',
    table_id: '44444444-4444-4444-4444-444444444444',
    status: 'preparing' as const,
    pay_status: 'unpaid' as const,
    subtotal: '100',
    tax_amount: '20',
    total_amount: '120',
    placed_at: '2026-09-06T12:42:00.000Z',
    created_at: '2026-09-06T12:42:00.000Z',
    updated_at: '2026-09-06T12:42:00.000Z',
    order_items: [
      { id: 'i1', order_id: 'o1', menu_item_id: 'm1', item_name: 'Truffle Pasta', unit_price: '1250', quantity: 2, line_total: '2500', created_at: '2026-09-06T12:42:00.000Z' },
      { id: 'i2', order_id: 'o1', menu_item_id: 'm2', item_name: 'Signature Tiramisu', unit_price: '490', quantity: 2, line_total: '980', created_at: '2026-09-06T12:42:00.000Z' },
    ],
    table: { label: 'T-06' },
    customer: { name: 'Arjun Mehta' },
  };
}

describe('orderRowToView', () => {
  it('maps a join row to the Order view model', () => {
    const v = orderRowToView(makeOrdersRow() as never);
    expect(v.id).toBe('ORD-5001');
    expect(v.orderId).toBe('11111111-1111-1111-1111-111111111111');
    expect(v.cust).toBe('Arjun Mehta');
    expect(v.customerId).toBe('33333333-3333-3333-3333-333333333333');
    expect(v.table).toBe('T-06');
    expect(v.amount).toBe(120);
    expect(v.pay).toBe('Unpaid');
    expect(v.status).toBe('Preparing');
    expect(v.placed).toBe('2026-09-06T12:42:00.000Z');
    expect(v.items).toHaveLength(2);
  });

  it('defaults a walk-in and computes amount from items when total is 0', () => {
    const row = makeOrdersRow();
    row.total_amount = '0';
    row.customer = null;
    let v = orderRowToView(row as never);
    expect(v.cust).toBe('Walk-in');
    expect(v.customerId).toBe('33333333-3333-3333-3333-333333333333');
    expect(v.amount).toBe(2 * 1250 + 2 * 490);

    const noItems = makeOrdersRow();
    noItems.total_amount = '0';
    noItems.order_items = [];
    v = orderRowToView(noItems as never);
    expect(v.amount).toBe(0);
  });
});

describe('createOrder', () => {
  it('rejects an empty item list before calling the RPC', async () => {
    const mock = new MockSupabase();
    const res = await createOrder(mock.client(), { items: [] });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('VALIDATION');
    expect(mock.calls).toHaveLength(0);
  });

  it('sends only menu_item_id + quantity to the RPC (never names/prices)', async () => {
    const mock = new MockSupabase([
      {
        data: { order_id: 'o1', code: 'ORD-777', status: 'new', pay_status: 'unpaid', subtotal: 90, tax_amount: 10, total_amount: 100, placed_at: '2026-09-06T10:00:00Z' },
        error: null,
      },
    ]);
    const res = await createOrder(mock.client(), {
      customerId: 'c1',
      tableId: 't1',
      items: [
        { menu_item_id: 'm1', quantity: 2 },
        { menu_item_id: 'm2', quantity: 1 },
      ],
    });
    expect(res.ok).toBe(true);
    const rpc = mock.calls.find((c) => c.startsWith('rpc:create_order:'));
    expect(rpc).toBeDefined();
    expect(rpc).toContain('"p_customer_id":"c1"');
    expect(rpc).toContain('"p_table_id":"t1"');
    expect(rpc).toContain('{"menu_item_id":"m1","quantity":2}');
    expect(rpc).toContain('{"menu_item_id":"m2","quantity":1}');
    expect(rpc).not.toContain('unit_price');
    expect(rpc).not.toContain('item_name');
    if (res.ok) {
      expect(res.data).toMatchObject({ order_id: 'o1', code: 'ORD-777', total_amount: 100 });
    }
  });

  it('maps an unavailable-item RPC error to VALIDATION', async () => {
    const mock = new MockSupabase([
      { data: null, error: { code: 'PGRST324', message: 'Truffle Arancini is not available in this restaurant', details: '' } },
    ]);
    const res = await createOrder(mock.client(), { items: [{ menu_item_id: 'm1', quantity: 1 }] });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe('VALIDATION');
      expect(res.error.message).toContain('unavailable');
    }
  });

  it('maps a permission error to FORBIDDEN', async () => {
    const mock = new MockSupabase([
      { data: null, error: { code: '42501', message: 'permission denied for function create_order', details: '' } },
    ]);
    const res = await createOrder(mock.client(), { items: [{ menu_item_id: 'm1', quantity: 1 }] });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('FORBIDDEN');
  });

  it('exposes the stable order status catalog', () => {
    expect(ORDER_STATUSES).toEqual(['New', 'Preparing', 'Ready', 'Completed', 'Cancelled']);
  });
});