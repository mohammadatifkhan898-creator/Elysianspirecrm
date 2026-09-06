import { useState } from 'react';
import { useStore } from '../store/store';
import { useOrders } from '../hooks/useOrders';
import { useReservations } from '../hooks/useReservations';
import { inr } from '../lib/utils';
import { GOLD } from '../lib/charts';
import { ICON } from '../lib/svg';
import { Icon } from '../components/ui/Icon';
import { PageHead } from '../components/ui/primitives';
import { todayKolkataISO } from '../lib/dates';
import type { Order } from '../types';

/* ═══════════════════════════════════════════════════════════════
   Reports — real-data KPIs with honest empty states.

   KPIs are DERIVED from the hydrated store (s.orders / s.reservations):
   total revenue, order count, and upcoming reservations. Historical
   charts (trend lines) require an analytics aggregation service that
   doesn't exist yet, so they render an empty state rather than
   fabricated `REP` series. The period header is preserved for the
   intended future API, but it no longer drives fake data.
   ═══════════════════════════════════════════════════════════════ */

const PERIODS = ['Today', 'This Week', 'This Month', 'Custom'] as const;
type Period = (typeof PERIODS)[number];

const KPI_ICON: Record<'rev' | 'ord' | 'res', string> = {
  rev: '<path d="M12 2v20M17 6H9.5a3 3 0 0 0 0 6h5a3 3 0 0 1 0 6H7"/>',
  ord: '<path d="M6 3 4 9v11a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9l-2-6H6Z"/><path d="M4 9h16M9 13h6"/>',
  res: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18M9 15h6"/>',
};

export default function Reports() {
  const { s } = useStore();
  const ordersLoad = useOrders();
  const resLoad = useReservations();
  const [period, setPeriod] = useState<Period>('This Week');

  const today = todayKolkataISO();

  /** Period bounds are computed in the restaurant's own calendar zone. */
  const inPeriod = (o: Order): boolean => {
    if (!o.placed) return true; // legacy/mock rows without a timestamp stay visible
    const kd = todayKolkataISO(new Date(o.placed));
    switch (period) {
      case 'Today':
        return kd === today;
      case 'This Week':
        return kd >= todayKolkataISO(new Date(Date.now() - 6 * 86400000)) && kd <= today;
      case 'This Month':
        return kd.slice(0, 7) === today.slice(0, 7);
      default:
        return true; // Custom — all recorded orders for now
    }
  };

  const periodOrders = s.orders.filter(inPeriod);
  const revenue = periodOrders.reduce((a, o) => a + (o.pay === 'Refunded' ? 0 : o.amount), 0);
  const orderCount = periodOrders.length;
  const resCount = s.reservations.filter((r) => r.date === today && r.status !== 'Cancelled').length;

  const loadError = ordersLoad.error ?? resLoad.error;
  const retry = () => {
    ordersLoad.refetch();
    resLoad.refetch();
  };

  return (
    <>
      <PageHead
        title="Reports"
        sub={'Performance summary — ' + period}
        actions={
          <div className="tabs">
            {PERIODS.map((p) => (
              <button key={p} className={'tab ' + (period === p ? 'active' : '')} onClick={() => setPeriod(p)}>
                {p}
              </button>
            ))}
          </div>
        }
      />

      {loadError ? (
        <div className="inv-note" style={{ marginBottom: 16 }}>
          <Icon d={ICON.info} size={15} />
          <span>
            Could not load live data — figures may be partial.{' '}
            <a style={{ cursor: 'pointer', textDecoration: 'underline' }} onClick={retry}>
              Retry
            </a>
          </span>
        </div>
      ) : null}

      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <div className="kpi">
          <div className="k-label">
            <span className="k-icon">
              <Icon d={KPI_ICON.rev} />
            </span>
            Revenue
          </div>
          <div className="k-value num">{inr(revenue)}</div>
          <div className="k-delta mut">from {orderCount} order{orderCount === 1 ? '' : 's'}</div>
        </div>
        <div className="kpi">
          <div className="k-label">
            <span className="k-icon">
              <Icon d={KPI_ICON.ord} />
            </span>
            Orders
          </div>
          <div className="k-value num">{orderCount}</div>
          <div className="k-delta mut">on record</div>
        </div>
        <div className="kpi">
          <div className="k-label">
            <span className="k-icon">
              <Icon d={KPI_ICON.res} />
            </span>
            Reservations
          </div>
          <div className="k-value num">{resCount}</div>
          <div className="k-delta mut">upcoming today</div>
        </div>
      </div>

      <div className="analytics-grid">
        <div className="card card-pad" data-od-id="rep-revenue">
          <div className="card-title" style={{ marginBottom: 6 }}>
            Revenue
          </div>
          <div className="card-sub" style={{ marginBottom: 10 }}>
            Net revenue trend
          </div>
          <ChartEmpty text="Historical revenue trends become available once an analytics service is live." />
        </div>
        <div className="card card-pad" data-od-id="rep-orders">
          <div className="card-title" style={{ marginBottom: 6 }}>
            Orders
          </div>
          <div className="card-sub" style={{ marginBottom: 10 }}>
            Orders fulfilled
          </div>
          <ChartEmpty text="Historical order trends become available once an analytics service is live." />
        </div>
      </div>

      <div className="dash-grid2">
        <div className="card card-pad" data-od-id="rep-res">
          <div className="card-title" style={{ marginBottom: 6 }}>
            Reservations
          </div>
          <div className="card-sub" style={{ marginBottom: 10 }}>
            Booking trend
          </div>
          <ChartEmpty text="Historical booking trends become available once an analytics service is live." />
        </div>
        <div className="card card-pad" data-od-id="rep-top">
          <div className="card-title" style={{ marginBottom: 12 }}>
            Top Selling Items
          </div>
          <TopItems orders={periodOrders} />
        </div>
      </div>
    </>
  );
}

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

function TopItems({ orders }: { orders: Order[] }) {
  const counts = new Map<string, number>();
  orders.forEach((o) => o.items.forEach((it) => counts.set(it.n, (counts.get(it.n) || 0) + it.q)));
  const rows = [...counts.entries()]
    .map(([name, qty]) => ({ name, orders: qty }))
    .sort((a, b) => b.orders - a.orders)
    .slice(0, 5);
  const max = rows.length ? rows[0].orders : 0;

  if (!rows.length) {
    return <ChartEmpty text="No items sold yet." />;
  }
  return (
    <div className="bar-list">
      {rows.map((r, i) => {
        const shade = i === 0 ? GOLD : i < 3 ? 'var(--navy)' : 'var(--muted)';
        const pct = max ? Math.round((r.orders / max) * 100) : 0;
        return (
          <div className="bar-row" key={r.name}>
            <div className="bar-head">
              <span className="bl">{r.name}</span>
              <span className="bv">
                {r.orders} unit{r.orders === 1 ? '' : 's'}
              </span>
            </div>
            <span className="bar-track">
              <span className="bar-fill" data-pct={pct} data-base={pct} style={{ background: shade, width: pct + '%' }} />
            </span>
          </div>
        );
      })}
    </div>
  );
}
