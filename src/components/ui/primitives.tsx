import type { ReactNode, ChangeEvent, CSSProperties } from 'react';
import { initials } from '../../lib/utils';

/* Small presentation primitives that keep the exact vanilla markup so the
   global stylesheet renders identically. */

/** Order status badge. Port of `statusBadge()` from app.js. */
const STATUS_MAP: Record<string, string> = {
  New: 'badge-info',
  Preparing: 'badge-warning',
  Ready: 'badge-info',
  Completed: 'badge-success',
  Cancelled: 'badge-error',
};
export function StatusBadge({ status }: { status: string }) {
  return <span className={'badge ' + (STATUS_MAP[status] || 'badge-neut')}>{status}</span>;
}

/** Payment badge. Port of `payBadge()`. */
export function PayBadge({ pay }: { pay: string }) {
  if (pay === 'Paid') return <span className="badge badge-success">Paid</span>;
  if (pay === 'Unpaid') return <span className="badge badge-warning">Unpaid</span>;
  return <span className="badge badge-neut">{pay}</span>;
}

/** Reservation status badge. Port of `statusBadgeRes()`. */
const RES_MAP: Record<string, string> = {
  Pending: 'badge-warning',
  Confirmed: 'badge-info',
  Completed: 'badge-success',
  Cancelled: 'badge-error',
};
export function ResStatusBadge({ status }: { status: string }) {
  return <span className={'badge ' + (RES_MAP[status] || 'badge-neut')}>{status}</span>;
}

export function Avatar({ name, lg, gold, style }: { name: string; lg?: boolean; gold?: boolean; style?: CSSProperties }) {
  const cls = 'avatar' + (lg ? ' lg' : '');
  return (
    <div className={cls} style={{ ...(gold ? { background: 'var(--gold)', color: 'var(--navy)' } : {}), ...style }}>
      {initials(name)}
    </div>
  );
}

export function PageHead({ title, sub, actions }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <div className="page-title">{title}</div>
        {sub ? <div className="page-sub">{sub}</div> : null}
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </div>
  );
}

export function Empty({ title, sub, kind = 'team' }: { title: string; sub: string; kind?: 'search' | 'inv' | 'team' }) {
  const icons: Record<string, ReactNode> = {
    search: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <circle cx="11" cy="11" r="7" />
        <path d="m21 21-4.3-4.3" />
      </svg>
    ),
    inv: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M8 3v4M16 3v4M3 10h18" />
      </svg>
    ),
    team: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <circle cx="12" cy="8" r="3.5" />
        <path d="M5 20c.6-3.3 3.4-5 7-5s6.4 1.7 7 5" />
      </svg>
    ),
  };
  return (
    <div className="empty">
      <div className="e-ic">{icons[kind] || icons.team}</div>
      <b>{title}</b>
      <p>{sub}</p>
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  title,
}: {
  checked: boolean;
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  title?: string;
}) {
  return (
    <label className="switch" title={title}>
      <input type="checkbox" checked={checked} onChange={onChange} />
      <span className="track"></span>
    </label>
  );
}

export function SelectWrap({ children }: { children: ReactNode }) {
  return <div className="select-wrap">{children}</div>;
}

/** Simple tabs (`.tabs`). */
export function Tabs({
  value,
  options,
  onChange,
}: {
  value: string;
  options: { key: string; label: ReactNode }[];
  onChange: (key: string) => void;
}) {
  return (
    <div className="tabs">
      {options.map((o) => (
        <button key={o.key} className={'tab ' + (value === o.key ? 'active' : '')} onClick={() => onChange(o.key)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
