import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store/store';
import { useOrders } from '../hooks/useOrders';
import { useReservations } from '../hooks/useReservations';
import { useRestaurantTables } from '../hooks/useRestaurantTables';
import { useCustomers } from '../hooks/useCustomers';
import { inr, greeting } from '../lib/utils';
import { ROUTES } from '../routing/routes';
import { GOLD, NAVY } from '../lib/charts';
import { ICON } from '../lib/svg';
import { Icon } from '../components/ui/Icon';
import { StatusBadge, PayBadge } from '../components/ui/primitives';
import { todayKolkataISO } from '../lib/dates';

/* ═══════════════════════════════════════════════════════════════
   Dashboard — real-data overview.

   KPIs are DERIVED from the hydrated store (s.orders / s.reservations /
   s.tables / s.customers) — never from hardcoded analytics seeds. The
   historical charts (revenue/weekly/top-items) require an aggregation
   service that doesn't exist yet, so they render an honest empty state
   until real aggregated data is available. The header date is "today"
   in Asia/Kolkata. Recent Orders lists real orders from the store.
   ═══════════════════════════════════════════════════════════════ */

type KpiIcon = 'rev' | 'ord' | 'res' | 'tbl' | 'cust' | 'aov';

const KPI_ICON: Record<KpiIcon, string> = {
  rev: '<path d="M12 2v20M17 6H9.5a3 3 0 0 0 0 6h5a3 3 0 0 1 0 6H7"/>',
  ord: '<path d="M6 3 4 9v11a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9l-2-6H6Z"/><path d="M4 9h16M9 13h6"/>',
  res: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18M9 15h6"/>',
  tbl: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2.4"/>',
  cust: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.4 3.4-5 6.5-5s5.7 1.6 6.5 5"/>',
  aov: '<path d="M4 12a8 8 0 1 1 16 0z"/><path d="M12 8v8M9 10h6"/>',
};

export default function Dashboard() {
  const { s } = useStore();
  const navigate = useNavigate();
  // Hydrate the store so the dashboard reflects real data.
  const orders = useOrders();
  const reservations = useReservations();
  const tables = useRestaurantTables();
  const customers = useCustomers();
  const countersRef = useRef<HTMLDivElement>(null);

  const loadError = orders.error ?? reservations.error ?? tables.error ?? customers.error;
  const retry = () => {
    orders.refetch();
    reservations.refetch();
    tables.refetch();
    customers.refetch();
  };

  const today = todayKolkataISO();
  const isLoading =
    orders.status === 'loading' ||
    orders.status === 'idle' ||
    reservations.status === 'loading' ||
    reservations.status === 'idle' ||
    tables.status === 'loading' ||
    tables.status === 'idle' ||
    customers.status === 'loading' ||
    customers.status === 'idle';

  // ── Derived KPIs from real store data (no fabricated aggregates). ──
  const revenue = s.orders.reduce((a, o) => a + (o.pay === 'Refunded' ? 0 : o.amount), 0);
  const orderCount = s.orders.length;
  const tonightRes = s.reservations.filter((r) => r.date === today && r.status !== 'Cancelled').length;
  const availableTables = s.tables.filter((t) => t.status === 'available').length;
  const totalTables = s.tables.length;
  const customerCount = s.customers.length;
  const aov = orderCount ? Math.round(revenue / orderCount) : 0;

  const kpis: { label: string; value: number; delta: string; icon: KpiIcon; fmt?: 'money' }[] = [
    { label: "Today's Revenue", value: revenue, delta: orderCount + ' order' + (orderCount === 1 ? '' : 's') + ' recorded', icon: 'rev', fmt: 'money' },
    { label: 'Total Orders', value: orderCount, delta: 'Live from service', icon: 'ord' },
    { label: 'Reservations', value: tonightRes, delta: tonightRes ? 'tonight' : 'none tonight', icon: 'res' },
    { label: 'Available Tables', value: availableTables, delta: (totalTables ? 'of ' + totalTables + ' tables' : ''), icon: 'tbl' },
    { label: 'Customers', value: customerCount, delta: 'in guest directory', icon: 'cust' },
    { label: 'Average Order Value', value: aov, delta: orderCount ? 'across ' + orderCount + ' orders' : 'no orders yet', icon: 'aov', fmt: 'money' },
  ];

  useEffect(() => {
    const c = countersRef.current;
    if (!c) return;
    const els = c.querySelectorAll<HTMLElement>('.counter');
    els.forEach((el) => {
      const target = +(el.dataset.target || '0');
      const fmt = el.dataset.fmt || '';
      const dur = 1100;
      const start = performance.now();
      function step(now: number) {
        const p = Math.min((now - start) / dur, 1);
        const eased = 1 - Math.pow(1 - p, 3);
        const val = Math.round(target * eased);
        el.textContent = fmt === 'money' ? inr(val) : val.toLocaleString('en-IN');
        if (p < 1) requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    });
  }, [isLoading, kpis]);

  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-title">
            {greeting()}, {s.user ? s.user.name.split(' ')[0] : 'Admin'}
          </div>
          <div className="page-sub">Here's what's happening at Elysian Spire today.</div>
        </div>
        <div className="page-actions">
          <input className="input" type="date" defaultValue={today} style={{ width: 150 }} />
          <button className="btn btn-secondary" onClick={() => navigate(ROUTES.reports)}>
            View full reports
          </button>
        </div>
      </div>

      {loadError ? (
        <div className="inv-note" style={{ marginBottom: 16 }}>
          <Icon d={ICON.info} size={15} />
          <span>
            Could not load live data — some figures below may be incomplete.{' '}
            <a style={{ cursor: 'pointer', textDecoration: 'underline' }} onClick={retry}>
              Retry
            </a>
          </span>
        </div>
      ) : null}

      <div className="kpi-grid" ref={countersRef}>
        {kpis.map((k, i) => (
          <div className="kpi" data-od-id={'kpi-' + i} key={k.label}>
            <div className="k-label">
              <span className="k-icon">
                <Icon d={KPI_ICON[k.icon]} />
              </span>
              {k.label}
            </div>
            <div className="k-value">
              <span className="num counter" data-target={k.value} data-fmt={k.fmt || 'num'}>
                0
              </span>
            </div>
            <div className="k-delta mut">
              <span>{k.delta}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="analytics-grid">
        <div className="card card-pad" data-od-id="revenue-chart">
          <div className="row-between" style={{ marginBottom: 6 }}>
            <div>
              <div className="card-title">Revenue Overview</div>
              <div className="card-sub">
                Total <b className="num" style={{ color: 'var(--gold-ink)' }}>{inr(revenue)}</b> from {orderCount} order{orderCount === 1 ? '' : 's'}
              </div>
            </div>
          </div>
          <div className="chart-box" id="revBox">
            {isLoading ? (
              <ChartEmpty text="Loading revenue…" />
            ) : orderCount ? (
              <ChartEmpty text="Historical revenue trends become available once an analytics service is live." />
            ) : (
              <ChartEmpty text="No orders yet." />
            )}
          </div>
        </div>
        <div className="card card-pad" data-od-id="weekly-chart">
          <div className="row-between" style={{ marginBottom: 10 }}>
            <div>
              <div className="card-title">Weekly Orders</div>
              <div className="card-sub">Last 7 days</div>
            </div>
          </div>
          <div className="chart-box" id="weekBox">
            {isLoading ? (
              <ChartEmpty text="Loading weekly data…" />
            ) : orderCount ? (
              <ChartEmpty text="Weekly aggregation becomes available once an analytics service is live." />
            ) : (
              <ChartEmpty text="No orders yet." />
            )}
          </div>
        </div>
      </div>

      <div className="dash-stack">
        <div className="card" data-od-id="recent-orders">
          <div className="card-head">
            <div>
              <div className="card-title">Recent Orders</div>
              <div className="card-sub">Latest service activity</div>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={() => navigate(ROUTES.orders)}>
              View all
            </button>
          </div>
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
              <tbody>
                {s.orders.length ? (
                  s.orders.slice(0, 6).map((o) => (
                    <tr className="ord-row" data-id={o.id} style={{ cursor: 'pointer' }} key={o.id} onClick={() => navigate(ROUTES.orders)}>
                      <td className="num" style={{ color: 'var(--gold-ink)', fontWeight: 600 }}>
                        {o.id}
                      </td>
                      <td>
                        <span style={{ fontWeight: 600 }}>{o.cust}</span>
                      </td>
                      <td className="num">{o.table}</td>
                      <td>{o.items.reduce((a, i) => a + i.q, 0)} items</td>
                      <td className="num-col">{inr(o.amount)}</td>
                      <td>{<PayBadge pay={o.pay} />}</td>
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
                ) : (
                  <tr>
                    <td colSpan={8} style={{ textAlign: 'center', color: 'var(--muted)', padding: 28 }}>
                      {isLoading ? 'Loading orders…' : 'No orders yet'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
        <div className="card card-pad" data-od-id="top-sellers">
          <div className="row-between" style={{ marginBottom: 12 }}>
            <div>
              <div className="card-title">Top Selling Items</div>
              <div className="card-sub">By order line quantities</div>
            </div>
          </div>
          {isLoading ? (
            <ChartEmpty text="Loading top items…" />
          ) : s.orders.length ? (
            <TopItems orders={s.orders} />
          ) : (
            <ChartEmpty text="No orders yet." />
          )}
        </div>
      </div>
    </>
  );
}

/* ── Reusable empty-state for chart surfaces (design-preserving). ── */

function ChartEmpty({ text }: { text: string }) {
  return (
    <div
      style={{
        display: 'grid',
        placeItems: 'center',
        minHeight: 210,
        color: 'var(--muted)',
        fontSize: 13.5,
        textAlign: 'center',
        padding: 16,
      }}
    >
      <span style={{ maxWidth: 280 }}>{text}</span>
    </div>
  );
}

/* ── Top items derived from real order line items (no fabricated data). ── */

function TopItems({ orders }: { orders: ReturnType<typeof useOrders>['orders'] }) {
  const counts = new Map<string, number>();
  orders.forEach((o) =>
    o.items.forEach((it) => counts.set(it.n, (counts.get(it.n) || 0) + it.q)),
  );
  const rows = [...counts.entries()]
    .map(([name, qty]) => ({ name, orders: qty }))
    .sort((a, b) => b.orders - a.orders)
    .slice(0, 5);
  const max = rows.length ? rows[0].orders : 0;

  return rows.length ? (
    <div className="bar-list">
      {rows.map((r, i) => {
        const shade = i === 0 ? GOLD : i < 3 ? NAVY : 'var(--muted)';
        const pct = max ? Math.round((r.orders / max) * 100) : 0;
        return (
          <div className="bar-row" key={r.name}>
            <div className="bar-head">
              <span className="bl">{r.name}</span>
              <span className="bv">{r.orders} unit{r.orders === 1 ? '' : 's'}</span>
            </div>
            <span className="bar-track">
              <span className="bar-fill" data-pct={pct} data-base={pct} style={{ background: shade, width: pct + '%' }} />
            </span>
          </div>
        );
      })}
    </div>
  ) : (
    <ChartEmpty text="No items sold yet." />
  );
}
