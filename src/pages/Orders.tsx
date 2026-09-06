import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store/store';
import { useOrders } from '../hooks/useOrders';
import { useSupabase } from '../lib/useSupabase';
import { listMenu } from '../services/menu';
import { listRestaurantTables } from '../services/restaurantTables';
import { listCustomers } from '../services/customers';
import type { CreateOrderInput } from '../services/orders';
import type { ServiceError } from '../services/shared';
import type { AppSupabaseClient } from '../lib/supabase';
import { ReadOnlyNotice } from '../components/ui/ReadOnlyNotice';
import { inr } from '../lib/utils';
import { openModal, closeModal, ModalHead, openDrawer, closeDrawer, CloseButton } from '../components/ui/Overlay';
import { StatusBadge, PayBadge, PageHead } from '../components/ui/primitives';
import type { OrderStatus, Customer } from '../types';

/* ═══════════════════════════════════════════════════════════════
   Orders — order list + creation + status/payment actions.

   Order creation delegates to the atomic server RPC (public.
   create_order); status advance and mark-paid persist to `orders` via
   the orders.manage-gated RLS policy. Optimistic updates roll back on
   error. The view keeps the original layout/markup (gold/navy theme).
   ═══════════════════════════════════════════════════════════════ */

const SEQ: OrderStatus[] = ['New', 'Preparing', 'Ready', 'Completed'];

/** Human-friendly message for a status/pay ServiceError (never shows raw). */
function ordersErrMsg(err?: ServiceError): string {
  if (!err) return 'Something went wrong. Please try again.';
  switch (err.code) {
    case 'FORBIDDEN':
      return "You don't have permission to update orders. Please contact a manager or administrator.";
    case 'NOT_FOUND':
      return 'This order no longer exists or was removed.';
    case 'VALIDATION':
      return err.message || 'The change is not valid.';
    case 'NETWORK':
      return 'Network error — could not reach the server.';
    case 'NOT_CONFIGURED':
      return 'Orders are unavailable (not configured).';
    default:
      return 'Something went wrong. Please try again.';
  }
}

/* ── New Order modal ──────────────────────────────────────────── */

/* ── New Order modal (multi-step) ─────────────────────────────── */

type OrderType = 'Dine In' | 'Takeaway';

interface OrderableItem {
  id: string;
  name: string;
  price: number;
  cat: string;
}

function NewOrderModal({
  supabase,
  createOrder,
}: {
  supabase: AppSupabaseClient;
  createOrder: (input: CreateOrderInput) => Promise<{ ok: boolean; error?: ServiceError }>;
}) {
  const { toast } = useStore();
  const [step, setStep] = useState(1); // 1 order type · 2 menu · 3 summary
  const [orderType, setOrderType] = useState<OrderType>('Dine In');
  const [items, setItems] = useState<OrderableItem[]>([]);
  const [cats, setCats] = useState<string[]>(['All']);
  const [activeCat, setActiveCat] = useState('All');
  const [q, setQ] = useState('');
  const [tables, setTables] = useState<{ id: string; label: string }[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [custQ, setCustQ] = useState('');
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [tableId, setTableId] = useState('');
  const [qty, setQty] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);

  // Load menu, tables, customers once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [menuRes, tableRes, custRes] = await Promise.all([
        listMenu(supabase),
        listRestaurantTables(supabase),
        listCustomers(supabase),
      ]);
      if (cancelled) return;
      if (menuRes.ok) {
        const flat: OrderableItem[] = [];
        for (const [cat, row] of Object.entries(menuRes.data)) {
          for (const it of row) {
            if (it.on && it.id !== undefined) flat.push({ id: it.id as string, name: it.name, price: it.price, cat });
          }
        }
        flat.sort((a, b) => a.name.localeCompare(b.name));
        setItems(flat);
        setCats(['All', ...Object.keys(menuRes.data)]);
      }
      if (tableRes.ok) {
        setTables(
          tableRes.data
            .filter((t) => t.status === 'available')
            .map((t) => ({ id: t.id, label: t.label ?? t.id })),
        );
      }
      if (custRes.ok) setCustomers(custRes.data);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  const changeQty = (id: string, delta: number) => {
    setQty((prev) => {
      const cur = prev[id] ?? 0;
      const nextVal = Math.max(0, cur + delta);
      const next = { ...prev };
      if (nextVal > 0) next[id] = nextVal;
      else delete next[id];
      return next;
    });
  };

  const chosen = items.filter((it) => (qty[it.id] ?? 0) > 0);
  const subtotal = chosen.reduce((a, it) => a + it.price * (qty[it.id] ?? 0), 0);
  const tax = Math.round(subtotal * 0.05);
  const total = subtotal + tax;

  const filtered = useMemo(() => {
    const query = q.toLowerCase();
    return items
      .filter((it) => (activeCat === 'All' ? true : it.cat === activeCat))
      .filter((it) => it.name.toLowerCase().includes(query));
  }, [items, activeCat, q]);

  const custMatches = useMemo(() => {
    const query = custQ.trim().toLowerCase();
    if (!query) return [];
    return customers
      .filter((c) => (c.name + ' ' + c.phone + ' ' + c.email).toLowerCase().includes(query))
      .slice(0, 6);
  }, [customers, custQ]);

  const goReview = () => {
    if (chosen.length === 0) {
      toast('Add at least one item to the order.', 'error', 'No items');
      return;
    }
    if (orderType === 'Dine In' && tables.length > 0 && !tableId) {
      toast('Choose a table for this dine-in order.', 'error', 'Table required');
      return;
    }
    setStep(3);
  };

  const save = async () => {
    if (chosen.length === 0) {
      toast('Add at least one item to the order.', 'error', 'No items');
      return;
    }
    setSaving(true);
    setOrderError(null);
    const res = await createOrder({
      customerId: customer?.id ?? null,
      tableId: orderType === 'Dine In' ? tableId || null : null,
      items: chosen.map((it) => ({ menu_item_id: it.id, quantity: qty[it.id] })),
    });
    setSaving(false);
    if (!res.ok) {
      setOrderError(res.error?.message ?? 'Could not create the order.');
      toast(res.error?.message ?? 'Could not create the order.', 'error', 'Order failed');
      return;
    }
    toast('Order created and ready for the kitchen.', 'success', 'Order placed');
    closeModal();
  };

  const steps = [
    { k: 1, label: 'Details' },
    { k: 2, label: 'Menu' },
    { k: 3, label: 'Review' },
  ];

  return (
    <>
      <ModalHead title="New Order">
        <div className="no-stepper" aria-label="Order steps">
          {steps.map((s) => (
            <button
              key={s.k}
              type="button"
              className={'no-step' + (step === s.k ? ' active' : '') + (step > s.k ? ' done' : '')}
              onClick={() => {
                if (s.k < step) setStep(s.k);
              }}
            >
              <span className="no-step-dot">{step > s.k ? '✓' : s.k}</span>
              <span className="no-step-lbl">{s.label}</span>
            </button>
          ))}
        </div>
        <CloseButton onClick={closeModal} />
      </ModalHead>

      <form className="modal-body" onSubmit={(e) => e.preventDefault()}>
        {orderError ? (
          <div style={{ color: 'var(--error)', fontSize: 13 }}>{orderError}</div>
        ) : null}

        {/* ── Step 1 · details ─────────────────────────────────── */}
        {step === 1 ? (
          <div className="no-step-panel">
            <div className="field">
              <label>Order type</label>
              <div className="no-type-row">
                {(['Dine In', 'Takeaway'] as OrderType[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    className={'no-type' + (orderType === t ? ' active' : '')}
                    onClick={() => setOrderType(t)}
                  >
                    <span className="no-type-name">{t}</span>
                    <span className="no-type-sub">{t === 'Dine In' ? 'Seated at a table' : 'Pickup / delivery'}</span>
                  </button>
                ))}
              </div>
            </div>

            {orderType === 'Dine In' ? (
              tables.length > 0 ? (
                <div className="field">
                  <label>Table</label>
                  <div className="no-table-chips">
                    {tables.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        className={'no-chip' + (tableId === t.id ? ' active' : '')}
                        onClick={() => setTableId(tableId === t.id ? '' : t.id)}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="no-muted">No available tables — the order will be a walk-in.</div>
              )
            ) : null}

            <div className="field">
              <label>Customer</label>
              <input
                className="input"
                value={custQ}
                onChange={(e) => {
                  setCustQ(e.target.value);
                  if (customer) setCustomer(null);
                }}
                placeholder="Search name, phone or email…"
              />
              {custQ.trim() ? (
                <div className="no-cust-list">
                  {custMatches.length === 0 ? (
                    <div className="no-muted" style={{ padding: '10px 12px' }}>
                      No matching customers.
                    </div>
                  ) : (
                    custMatches.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        className="no-cust-opt"
                        onClick={() => {
                          setCustomer(c);
                          setCustQ(c.name);
                        }}
                      >
                        <span className="no-cust-name">{c.name}</span>
                        <span className="no-cust-phone">{c.phone}</span>
                      </button>
                    ))
                  )}
                </div>
              ) : null}
              <div className="row-between">
                <span style={{ color: 'var(--muted)', fontSize: 12.5 }}>
                  {customer ? customer.name : 'Walk-in customer (no profile)'}
                </span>
              </div>
            </div>
          </div>
        ) : null}

        {/* ── Step 2 · menu ─────────────────────────────────────── */}
        {step === 2 ? (
          <div className="no-step-panel">
            <div className="field">
              <input
                className="input"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search the menu…"
              />
            </div>
            <div className="no-cat-row">
              {cats.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={'no-cat' + (activeCat === c ? ' active' : '')}
                  onClick={() => setActiveCat(c)}
                >
                  {c}
                </button>
              ))}
            </div>

            {loading ? (
              <div className="no-muted" style={{ padding: 16, textAlign: 'center' }}>
                Loading menu…
              </div>
            ) : filtered.length === 0 ? (
              <div className="no-muted" style={{ padding: 16, textAlign: 'center' }}>
                No available items. Add items on the Menu page first.
              </div>
            ) : (
              <div className="no-item-list">
                {filtered.map((it) => {
                  const qn = qty[it.id] ?? 0;
                  return (
                    <div key={it.id} className="no-item">
                      <div className="no-item-info">
                        <div className="no-item-name">{it.name}</div>
                        <div className="no-item-meta">
                          <span>{inr(it.price)}</span>
                          <span className="no-item-cat">{it.cat}</span>
                        </div>
                      </div>
                      {qn === 0 ? (
                        <button type="button" className="btn btn-navy btn-sm" onClick={() => changeQty(it.id, 1)}>
                          Add +
                        </button>
                      ) : (
                        <div className="no-qty-pill">
                          <button type="button" className="no-qty-btn" onClick={() => changeQty(it.id, -1)} aria-label={'Decrease ' + it.name}>
                            &minus;
                          </button>
                          <span className="no-qty-val">{qn}</span>
                          <button type="button" className="no-qty-btn" onClick={() => changeQty(it.id, 1)} aria-label={'Increase ' + it.name}>
                            +
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {chosen.length > 0 ? (
              <div className="row-between" style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                <span style={{ color: 'var(--muted)', fontSize: 13.5 }}>
                  {chosen.length} item(s) · {inr(subtotal)}
                </span>
                <button type="button" className="btn btn-primary btn-sm" onClick={goReview}>
                  Review order →
                </button>
              </div>
            ) : null}
          </div>
        ) : null}

        {/* ── Step 3 · review ───────────────────────────────────── */}
        {step === 3 ? (
          <div className="no-step-panel">
            <div className="no-summary-meta">
              <span className="no-meta-tag">{orderType}</span>
              {orderType === 'Dine In' ? (
                <span className="no-meta-tag">
                  {tables.find((t) => t.id === tableId)?.label ?? 'Walk-in'}
                </span>
              ) : null}
              <span className="no-meta-tag">{customer ? customer.name : 'Walk-in customer'}</span>
            </div>

            <div className="no-summary-list">
              {chosen.map((it) => {
                const qn = qty[it.id] ?? 0;
                return (
                  <div key={it.id} className="no-sum-row">
                    <span className="no-sum-name">
                      {qn} × {it.name}
                    </span>
                    <span className="no-sum-price">{inr(it.price * qn)}</span>
                  </div>
                );
              })}
              {chosen.length === 0 ? (
                <div className="no-muted" style={{ padding: 12 }}>
                  No items yet.
                </div>
              ) : null}
            </div>

            <div className="no-total-block">
              <div className="no-total-row">
                <span>Subtotal</span>
                <span>{inr(subtotal)}</span>
              </div>
              <div className="no-total-row">
                <span>Service tax (5%)</span>
                <span>{inr(tax)}</span>
              </div>
              <div className="no-total-row no-total-grand">
                <span>Total</span>
                <span>{inr(total)}</span>
              </div>
            </div>
          </div>
        ) : null}
      </form>

      <div className="modal-foot">
        {step > 1 ? (
          <button className="btn btn-ghost" disabled={saving} onClick={() => setStep(step - 1)}>
            ← Back
          </button>
        ) : (
          <button className="btn btn-ghost" disabled={saving} onClick={closeModal}>
            Cancel
          </button>
        )}
        {step === 1 ? (
          <button className="btn btn-primary" disabled={loading} onClick={() => setStep(2)}>
            Choose items →
          </button>
        ) : null}
        {step === 2 ? (
          <button className="btn btn-primary" disabled={loading || chosen.length === 0} onClick={goReview}>
            Review order →
          </button>
        ) : null}
        {step === 3 ? (
          <button className="btn btn-primary" disabled={saving || chosen.length === 0} onClick={save}>
            {saving ? 'Placing order…' : 'Place Order'}
          </button>
        ) : null}
      </div>
    </>
  );
}

/* ── Page ─────────────────────────────────────────────────────── */

export default function Orders() {
  const { s, notify, toast } = useStore();
  const {
    status: loadStatus,
    createOrder: doCreateOrder,
    advanceStatus: doAdvanceStatus,
    markPaid: doMarkPaid,
    canCreateOrders,
    canManageOrders,
  } = useOrders();
  const { supabase, isSupabaseConfigured } = useSupabase();
  const busyRef = useRef(false);
  const [q, setQ] = useState('');

  const configured = isSupabaseConfigured && supabase !== null;

  const isLoading = loadStatus === 'loading' || loadStatus === 'idle';
  const hasError = loadStatus === 'error';

  const filtered = useMemo(() => {
    const query = q.toLowerCase();
    return s.orders.filter((o) => (o.id + o.cust + o.table).toLowerCase().includes(query));
  }, [s.orders, q]);

  const openNewOrder = () => {
    if (!configured || !supabase) {
      toast('Orders are unavailable (not configured).', 'error', 'Unavailable');
      return;
    }
    openModal(<NewOrderModal supabase={supabase} createOrder={doCreateOrder} />);
  };

  const openOrder = (id: string) => {
    const o = s.orders.find((x) => x.id === id);
    if (!o) return;
    const sub = o.items.reduce((a, i) => a + i.q * i.p, 0);
    const tax = Math.round(sub * 0.05);
    const total = sub + tax;
    const curIdx = SEQ.indexOf(o.status);

    const advance = async () => {
      if (busyRef.current) return;
      if (!o.orderId) {
        toast('This order is not tied to the database.', 'error', 'Unavailable');
        return;
      }
      const next = SEQ[curIdx + 1];
      if (!next) return;
      const prev = o.status;
      o.status = next;
      notify();
      busyRef.current = true;
      const res = await doAdvanceStatus(o.orderId, next);
      busyRef.current = false;
      if (!res.ok) {
        o.status = prev;
        notify();
        toast(ordersErrMsg(res.error), 'error', 'Update failed');
        return;
      }
      toast('Order ' + o.id + ' moved to ' + next + '.', 'success', 'Status updated');
      closeDrawer();
    };

    const markPaid = async () => {
      if (busyRef.current) return;
      if (!o.orderId) {
        toast('This order is not tied to the database.', 'error', 'Unavailable');
        return;
      }
      const prev = o.pay;
      o.pay = 'Paid';
      notify();
      busyRef.current = true;
      const res = await doMarkPaid(o.orderId, true);
      busyRef.current = false;
      if (!res.ok) {
        o.pay = prev;
        notify();
        toast(ordersErrMsg(res.error), 'error', 'Update failed');
        return;
      }
      toast('Payment recorded for ' + o.id + '.', 'success', 'Payment received');
      closeDrawer();
    };

    openDrawer(
      <>
        <div className="drawer-head">
          <div>
            <h3>Order {o.id}</h3>
            <span className="num">{o.cust}</span>
          </div>
          <CloseButton onClick={closeDrawer} />
        </div>
        <div className="drawer-body">
          <div className="detail-grid">
            <div className="detail-item">
              <div className="k">Customer</div>
              <div className="v">{o.cust}</div>
            </div>
            <div className="detail-item">
              <div className="k">Table</div>
              <div className="v num">{o.table}</div>
            </div>
            <div className="detail-item">
              <div className="k">Placed</div>
              <div className="v num">{o.time}</div>
            </div>
            <div className="detail-item">
              <div className="k">Payment</div>
              <div className="v">
                <PayBadge pay={o.pay} />
              </div>
            </div>
          </div>
          <div className="sec-title">Ordered Items</div>
          <table className="tbl" style={{ minWidth: 0, fontSize: 13.5 }}>
            <tbody>
              {o.items.map((it, idx) => (
                <tr key={idx}>
                  <td style={{ borderBottom: '1px solid var(--border)', padding: '8px 0' }}>{it.n}</td>
                  <td className="t-right num-col">x{it.q}</td>
                  <td className="num-col">{inr(it.p)}</td>
                  <td className="num-col" style={{ fontWeight: 600 }}>
                    {inr(it.q * it.p)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ borderTop: '1px solid var(--border)', marginTop: 8, paddingTop: 12 }}>
            <div className="row-between" style={{ fontSize: 13.5, color: 'var(--muted)' }}>
              <span>Subtotal</span>
              <span className="num">{inr(sub)}</span>
            </div>
            <div className="row-between" style={{ fontSize: 13.5, color: 'var(--muted)', marginTop: 6 }}>
              <span>Tax (5%)</span>
              <span className="num">{inr(tax)}</span>
            </div>
            <div className="row-between" style={{ fontSize: 16, fontWeight: 700, marginTop: 8, color: 'var(--navy)' }}>
              <span>Total</span>
              <span className="num">{inr(total)}</span>
            </div>
          </div>
          <div className="sec-title">Order Timeline</div>
          <div className="timeline">
            {SEQ.map((s, i) => (
              <div key={s} className={'tl-item' + (i < curIdx ? ' done' : '') + (i === curIdx ? ' now' : '')}>
                <div className="tl-dot">{i < curIdx ? '\u2713' : i === curIdx ? '\u2022' : ''}</div>
                <div className="tl-body">
                  <b>{s}</b>
                  <span>
                    {s === 'New' ? 'Order placed' : s === 'Preparing' ? 'Kitchen confirmed' : s === 'Ready' ? 'Ready for service' : 'Delivered & complete'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="drawer-foot" id="orderFoot">
          {!canManageOrders ? (
            <span style={{ color: 'var(--muted)', fontSize: 13 }}>
              You have view-only access to orders. Contact a manager to make changes.
            </span>
          ) : o.status === 'Cancelled' ? (
            <span style={{ color: 'var(--muted)', fontSize: 13 }}>This order was cancelled.</span>
          ) : curIdx >= SEQ.length - 1 ? (
            <>
              <span style={{ color: 'var(--success)', fontWeight: 600, fontSize: 13.5 }}>
                &check; Order completed
              </span>
              {o.pay === 'Paid' ? null : (
                <button className="btn btn-ghost" disabled={busyRef.current} onClick={markPaid}>
                  {busyRef.current ? 'Saving…' : 'Mark Paid'}
                </button>
              )}
            </>
          ) : (
            <>
              <button className="btn btn-primary" disabled={busyRef.current} onClick={advance}>
                {busyRef.current ? 'Saving…' : 'Mark as ' + SEQ[curIdx + 1]}
              </button>
              {o.pay === 'Paid' ? null : (
                <button className="btn btn-ghost" disabled={busyRef.current} onClick={markPaid}>
                  {busyRef.current ? 'Saving…' : 'Mark Paid'}
                </button>
              )}
            </>
          )}
        </div>
      </>
    );
  };

  return (
    <>
      <PageHead
        title="Orders"
        sub={isLoading ? 'Loading orders…' : s.orders.length + ' orders on record'}
        actions={
          <>
            <input
              className="input"
              id="orders-search"
              placeholder="Search order or customer…"
              style={{ width: 220 }}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            {canCreateOrders ? (
              <button className="btn btn-primary" onClick={openNewOrder} disabled={!configured}>
                + New Order
              </button>
            ) : null}
          </>
        }
      />
      {!canCreateOrders && !canManageOrders ? (
        <ReadOnlyNotice>You can browse and review orders, but you don&rsquo;t have permission to create or change them.</ReadOnlyNotice>
      ) : null}
      <div className="card">
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Order</th>
                <th>Customer</th>
                <th>Table</th>
                <th>Items</th>
                <th>Amount</th>
                <th>Payment</th>
                <th>Status</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody id="orders-body">
              {isLoading ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', color: 'var(--muted)', padding: 28 }}>
                    Loading orders…
                  </td>
                </tr>
              ) : hasError ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', color: 'var(--error)', padding: 28 }}>
                    Could not load orders.
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', color: 'var(--muted)', padding: 28 }}>
                    {q ? 'No orders match your search' : 'No orders yet'}
                  </td>
                </tr>
              ) : (
                filtered.map((o) => (
                  <tr className="ord-row" data-id={o.id} style={{ cursor: 'pointer' }} key={o.id} onClick={() => openOrder(o.id)}>
                    <td className="num" style={{ color: 'var(--gold-ink)', fontWeight: 600 }}>
                      {o.id}
                    </td>
                    <td>
                      <span style={{ fontWeight: 600 }}>{o.cust}</span>
                    </td>
                    <td className="num">{o.table}</td>
                    <td>{o.items.reduce((a, i) => a + i.q, 0)} items</td>
                    <td className="num-col">{inr(o.amount)}</td>
                    <td>
                      <PayBadge pay={o.pay} />
                    </td>
                    <td>
                      <StatusBadge status={o.status} />
                    </td>
                    <td>
                      <span className="num" style={{ color: 'var(--muted)' }}>
                        {o.time}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
