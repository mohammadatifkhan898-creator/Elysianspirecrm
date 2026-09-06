import { useState } from 'react';
import { useStore } from '../store/store';
import { useReservations } from '../hooks/useReservations';
import {
  useCreateReservation,
  useUpdateReservation,
  useCancelReservation,
} from '../hooks/useReservationActions';
import { ALLOWED_TRANSITIONS } from '../services/reservations';
import type { ReservationCreateInput, ReservationUpdateInput } from '../services/reservations';
import { ReadOnlyNotice } from '../components/ui/ReadOnlyNotice';
import type { ResStatus } from '../types';
import { todayKolkata, todayKolkataISO, fmtYMDParts } from '../lib/dates';
import { ICON } from '../lib/svg';
import { convertTime, to12 } from '../lib/utils';
import { Icon } from '../components/ui/Icon';
import { Avatar, ResStatusBadge } from '../components/ui/primitives';
import { ModalHead, closeModal, openModal } from '../components/ui/Overlay';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// Single source of truth for "today" in the restaurant zone (Asia/Kolkata).
const TODAY = todayKolkataISO();

function fmtDate(y: number, m: number, d: number): string {
  return fmtYMDParts(y, m, d);
}

function tableLabel(id: string, tables: { id: string; label?: string }[]): string {
  const t = tables.find((x) => x.id === id);
  return t ? (t.label ?? t.id) : '';
}

/* ═══════════════════════════════════════════════════════════════
   MonthGrid — calendar with reservation count dots.
   ═══════════════════════════════════════════════════════════════ */

function MonthGrid({ y, m, selDate, onPick }: { y: number; m: number; selDate: string; onPick: (d: string) => void }) {
  const { s } = useStore();
  const first = new Date(y, m, 1).getDay();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const prevDays = new Date(y, m, 0).getDate();
  const counts: Record<string, number> = {};
  s.reservations.forEach((r) => {
    if (r.status !== 'Cancelled') counts[r.date] = (counts[r.date] || 0) + 1;
  });
  const cells: { key: string; cls: string; date: string; text: string; count: number }[] = [];
  for (let i = 0; i < first; i++) {
    const pd = prevDays - first + i + 1;
    const pm = m === 0 ? 11 : m - 1;
    const py = m === 0 ? y - 1 : y;
    cells.push({ key: 'p' + i, cls: 'cal-day other', date: fmtDate(py, pm, pd), text: String(pd), count: 0 });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const ds = fmtDate(y, m, d);
    const cls = ['cal-day'];
    if (ds === TODAY) cls.push('today');
    if (counts[ds]) cls.push('has-res');
    if (ds === selDate) cls.push('selected');
    cells.push({ key: ds, cls: cls.join(' '), date: ds, text: String(d), count: counts[ds] || 0 });
  }
  let rem = 7 - ((first + daysInMonth) % 7);
  if (rem === 7) rem = 0;
  for (let i = 1; i <= rem; i++) {
    cells.push({ key: 'n' + i, cls: 'cal-day other', date: 'x', text: ' ', count: 0 });
  }
  const rows: { key: string; cls: string; date: string; text: string; count: number }[][] = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
  return (
    <table className="calendar">
      <thead>
        <tr>
          {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((x) => (
            <th key={x}>{x}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, ri) => (
          <tr key={ri}>
            {row.map((c) => (
              <td key={c.key}>
                <button className={c.cls} onClick={() => { if (c.date !== 'x') onPick(c.date); }}>
                  {c.text}
                  {c.count ? <span className="badge badge-gold" style={{ fontSize: 10 }}>{c.count}</span> : null}
                </button>
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ═══════════════════════════════════════════════════════════════
   ResFormModal — reservation details in two explicit modes:
   - create / edit ("readOnly" falsy): editable form, linked customer
     selection, guided status transitions, cancel + save.
   - read-only ("readOnly" true, view permission without manage): pure
     inspector. No inputs, no status transitions, no cancel/save, and
     NO mutation handler is reachable from this branch.
   Terminal status (Completed/Cancelled) is always shown as a badge.
   RLS remains the authoritative authorization boundary; this mode
   gating is a UX-only convenience.
   ═══════════════════════════════════════════════════════════════ */

function ResFormModal({
  editId,
  createRun,
  updateRun,
  cancelRun,
  submitting,
  readOnly,
}: {
  editId?: string;
  createRun?: (input: ReservationCreateInput) => Promise<{ ok: boolean; error?: { message?: string } }>;
  updateRun?: (id: string, input: ReservationUpdateInput) => Promise<{ ok: boolean; error?: { message?: string } }>;
  cancelRun?: (id: string) => Promise<{ ok: boolean; error?: { message?: string } }>;
  submitting?: boolean;
  readOnly?: boolean;
}) {
  const { s } = useStore();
  const r = editId ? s.reservations.find((x) => x.id === editId) : null;
  const isEdit = !!r;
  const isTerminal = isEdit && (r.status === 'Completed' || r.status === 'Cancelled');
  const allowed = isEdit ? ALLOWED_TRANSITIONS[r.status] : [];

  const [customerId, setCustomerId] = useState(r ? (r.customerId ?? '') : '');
  const [cust, setCust] = useState(r ? r.cust : '');
  const [phone, setPhone] = useState(r ? r.phone : '');
  const [date, setDate] = useState(r ? r.date : TODAY);
  const [time, setTime] = useState(r ? convertTime(r.time) : '19:30');
  const [guests, setGuests] = useState(r ? r.guests : 2);
  const [tableId, setTableId] = useState(r ? (r.tableId ?? '') : '');
  const [status, setStatus] = useState<ResStatus>(r ? r.status : 'Pending');
  const [notes, setNotes] = useState(r ? r.notes : '');
  const [err, setErr] = useState('');

  const onSelectCustomer = (val: string) => {
    if (!val) {
      setCustomerId('');
      return;
    }
    setCustomerId(val);
    const c = s.customers.find((x) => x.id === val);
    if (c) {
      setCust(c.name);
      if (c.phone) setPhone(c.phone);
    }
  };

  const save = async () => {
    if (readOnly) return;
    const name = cust.trim();
    if (!name) {
      setErr('Please enter a guest name.');
      return;
    }
    if (!date) {
      setErr('Please select a date.');
      return;
    }
    if (!time) {
      setErr('Please select a time.');
      return;
    }
    if (guests < 1) {
      setErr('Guest count must be at least 1.');
      return;
    }
    const time24 = time;
    if (isEdit && r) {
      if (isTerminal) {
        closeModal();
        return;
      }
      if (allowed.length > 0 && !allowed.includes(status)) {
        setErr('Invalid status transition.');
        return;
      }
      const patch: ReservationUpdateInput = {};
      patch.guestName = name;
      patch.phone = phone || null;
      patch.customerId = customerId || null;
      patch.tableId = tableId || null;
      patch.reservationDate = date;
      patch.reservationTime = time24;
      patch.guests = guests;
      if (r.status !== status) patch.status = status;
      patch.notes = notes || null;
      if (!updateRun) return;
      const res = await updateRun(r.id, patch);
      if (res.ok) closeModal();
      else setErr(res.error?.message || 'Update failed.');
    } else {
      const input: ReservationCreateInput = {
        guestName: name,
        phone: phone || null,
        customerId: customerId || null,
        tableId: tableId || null,
        reservationDate: date,
        reservationTime: time24,
        guests,
        notes: notes || null,
      };
      if (!createRun) return;
      const res = await createRun(input);
      if (res.ok) closeModal();
      else setErr(res.error?.message || 'Creation failed.');
    }
  };

  const handleCancel = async () => {
    if (!r || submitting || readOnly) return;
    if (!window.confirm('Cancel reservation for ' + r.cust + '?')) return;
    if (!cancelRun) return;
    const res = await cancelRun(r.id);
    if (res.ok) closeModal();
    else setErr(res.error?.message || 'Cancellation failed.');
  };

  return (
    <>
      <ModalHead title={isEdit ? (readOnly ? 'Reservation Details' : 'Edit Reservation') : 'Add Reservation'} onClose={closeModal} />
      {readOnly ? (
        <div className="modal-body" style={{ padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 15 }}>
          <div className="field">
            <label>Customer</label>
            <div style={{ fontSize: 14.5, color: 'var(--charcoal)' }}>{customerId ? cust : 'Walk-in'}</div>
          </div>
          <div className="field">
            <label>Guest Name</label>
            <div style={{ fontSize: 14.5, color: 'var(--charcoal)' }}>{cust || '—'}</div>
          </div>
          <div className="field">
            <label>Phone</label>
            <div style={{ fontSize: 14.5, color: 'var(--charcoal)' }}>{phone || '—'}</div>
          </div>
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="field">
              <label>Date</label>
              <div style={{ fontSize: 14.5, color: 'var(--charcoal)' }}>{date}</div>
            </div>
            <div className="field">
              <label>Time</label>
              <div style={{ fontSize: 14.5, color: 'var(--charcoal)' }}>{time ? to12(time) : '—'}</div>
            </div>
          </div>
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="field">
              <label>Guests</label>
              <div style={{ fontSize: 14.5, color: 'var(--charcoal)' }}>{guests}</div>
            </div>
            <div className="field">
              <label>Table</label>
              <div style={{ fontSize: 14.5, color: 'var(--charcoal)' }}>{tableId ? tableLabel(tableId, s.tables) : 'No table'}</div>
            </div>
          </div>
          <div className="field">
            <label>Status</label>
            <ResStatusBadge status={status} />
          </div>
          <div className="field">
            <label>Notes</label>
            <div style={{ fontSize: 14.5, color: 'var(--charcoal)', whiteSpace: 'pre-wrap' }}>{notes || '—'}</div>
          </div>
        </div>
      ) : (
      <form className="modal-body" style={{ padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 15 }} onSubmit={(e) => e.preventDefault()}>
        <div className="field">
          <label>Customer</label>
          <div className="select-wrap">
            <select className="input" value={customerId} onChange={(e) => onSelectCustomer(e.target.value)}>
              <option value="">Walk-in</option>
              {s.customers.map((c) => (
                <option key={c.id ?? c.name} value={c.id ?? ''}>
                  {c.name}{c.phone ? ' (' + c.phone + ')' : ''}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="field">
          <label>Guest Name</label>
          <input className="input" value={cust} onChange={(e) => setCust(e.target.value)} placeholder="Full name" required />
        </div>
        <div className="field">
          <label>Phone</label>
          <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 00000 00000" />
        </div>
        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div className="field">
            <label>Date</label>
            <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="field">
            <label>Time</label>
            <input className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </div>
        </div>
        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div className="field">
            <label>Guests</label>
            <input className="input" type="number" min={1} max={20} value={guests} onChange={(e) => setGuests(+e.target.value)} />
          </div>
          <div className="field">
            <label>Table</label>
            <div className="select-wrap">
              <select className="input" value={tableId} onChange={(e) => setTableId(e.target.value)}>
                <option value="">No table</option>
                {s.tables.map((t) => (
                  <option key={t.id} value={t.id}>
                    {tableLabel(t.id, s.tables)} (cap {t.cap})
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
        {isTerminal ? (
          <div className="field">
            <label>Status</label>
            <ResStatusBadge status={r.status} />
          </div>
        ) : isEdit && allowed.length > 0 ? (
          <div className="field">
            <label>Status</label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button
                className={'btn ' + (status === r.status ? 'btn-navy' : 'btn-ghost')}
                type="button"
                disabled
              >
                {r.status}
              </button>
              {allowed.map((s) => (
                <button
                  key={s}
                  className={'btn ' + (status === s ? (s === 'Cancelled' ? 'btn-danger' : 'btn-navy') : 'btn-ghost')}
                  type="button"
                  onClick={() => setStatus(s)}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="field">
            <label>Status</label>
            <div className="select-wrap">
              <select className="input" value={status} onChange={(e) => setStatus(e.target.value as ResStatus)}>
                <option>Pending</option>
              </select>
            </div>
          </div>
        )}
        <div className="field">
          <label>Notes</label>
          <textarea className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Special requests..." />
        </div>
        {err ? <div style={{ color: 'var(--error)', fontSize: 12.5 }}>{err}</div> : null}
      </form>
      )}
      <div className="modal-foot">
        {readOnly ? (
          <button className="btn btn-primary" onClick={closeModal}>
            Close
          </button>
        ) : (
          <>
            {isEdit && !isTerminal ? (
              <button className="btn btn-danger" style={{ marginRight: 'auto' }} disabled={submitting} onClick={handleCancel}>
                Cancel Reservation
              </button>
            ) : null}
            <button className="btn btn-ghost" onClick={closeModal}>
              {isTerminal ? 'Close' : 'Cancel'}
            </button>
            {!isTerminal ? (
              <button className="btn btn-primary" disabled={submitting} onClick={save}>
                {submitting ? 'Saving...' : isEdit ? 'Save Changes' : 'Create Reservation'}
              </button>
            ) : null}
          </>
        )}
      </div>
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Reservations — main page.
   ═══════════════════════════════════════════════════════════════ */

export default function Reservations() {
  const { s } = useStore();
  const { status: loadStatus, error: loadError, canManageReservations, refetch: reloadRes } = useReservations();
  const createMut = useCreateReservation();
  const updateMut = useUpdateReservation();
  const cancelMut = useCancelReservation();
  const [cur, setCur] = useState(() => {
    const t = todayKolkata();
    return { y: t.y, m: t.m };
  });
  const [selDate, setSelDate] = useState(TODAY);
  const [q, setQ] = useState('');

  const dayCount = s.reservations.filter((r) => r.date === selDate).length;
  const rows = s.reservations
    .filter((r) => r.date === selDate)
    .filter((r) => {
      if (!q) return true;
      const needle = q.toLowerCase();
      return (
        r.cust.toLowerCase().includes(needle) ||
        r.phone.toLowerCase().includes(needle) ||
        r.table.toLowerCase().includes(needle) ||
        (r.notes && r.notes.toLowerCase().includes(needle))
      );
    });

  const openForm = (editId?: string) => {
    const editing = editId ? s.reservations.find((x) => x.id === editId) ?? null : null;
    if (editing && !canManageReservations) {
      openModal(
        <ResFormModal
          editId={editId}
          readOnly
        />,
      );
      return;
    }
    if (!canManageReservations) return;
    openModal(
      <ResFormModal
        editId={editId}
        createRun={createMut.run}
        updateRun={updateMut.run}
        cancelRun={cancelMut.run}
        submitting={createMut.submitting || updateMut.submitting || cancelMut.submitting}
      />,
    );
  };

  const prevMonth = () =>
    setCur((c) => {
      const m = c.m - 1;
      return m < 0 ? { y: c.y - 1, m: 11 } : { ...c, m };
    });

  const nextMonth = () =>
    setCur((c) => {
      const m = c.m + 1;
      return m > 11 ? { y: c.y + 1, m: 0 } : { ...c, m };
    });

  const isLoading = loadStatus === 'loading' || loadStatus === 'idle';
  const isEmpty = loadStatus === 'empty';

  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-title">Reservations</div>
          <div className="page-sub">Manage guest bookings and table holds</div>
        </div>
        <div className="page-actions">
          <input className="input" placeholder="Search name, phone, table..." style={{ width: 230 }} value={q} onChange={(e) => setQ(e.target.value)} />
          {canManageReservations ? (
            <button className="btn btn-primary" onClick={() => openForm()}>+ Add Reservation</button>
          ) : null}
        </div>
      </div>
      {!canManageReservations ? (
        <ReadOnlyNotice>You can browse and review reservations, but you don&rsquo;t have permission to create or change bookings.</ReadOnlyNotice>
      ) : null}
      {loadError ? (
        <div className="inv-note" style={{ marginBottom: 16 }}>
          <Icon d={ICON.info} size={15} />
          <span>
            Could not load reservations.{' '}
            <a style={{ cursor: 'pointer', textDecoration: 'underline' }} onClick={reloadRes}>
              Retry
            </a>
          </span>
        </div>
      ) : null}
      <div className="res-layout">
        <div className="card card-pad" data-od-id="res-calendar">
          <div className="cal-head">
            <button className="icon-btn" aria-label="Previous month" onClick={prevMonth}>
              <Icon d={ICON.chevronLeft} strokeWidth={2} />
            </button>
            <div style={{ textAlign: 'center' }}>
              <div className="card-title">
                {MONTHS[cur.m]} {cur.y}
              </div>
              <div className="card-sub">Select a date to filter</div>
            </div>
            <button className="icon-btn" aria-label="Next month" onClick={nextMonth}>
              <Icon d={ICON.chevronRight} strokeWidth={2} />
            </button>
          </div>
          <MonthGrid y={cur.y} m={cur.m} selDate={selDate} onPick={setSelDate} />
        </div>
        <div className="card">
          <div className="card-head">
            <div className="card-title">Today's Bookings</div>
            <div className="card-sub">
              {dayCount} for {selDate}
            </div>
          </div>
          <div style={{ padding: '4px 18px' }}>
            {isLoading ? (
              <div style={{ color: 'var(--muted)', fontSize: 14, padding: '24px 0', textAlign: 'center' }}>Loading reservations...</div>
            ) : rows.length ? (
              rows.map((r) => (
                <div
                  key={r.id}
                  className="res-row"
                  data-id={r.id}
                  style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
                  onClick={() => openForm(r.id)}
                >
                  <Avatar name={r.cust} gold />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, color: 'var(--charcoal)' }}>
                      {r.cust}
                      {r.date === TODAY ? (
                        <span className="badge badge-gold" style={{ marginLeft: 4 }}>
                          Tonight
                        </span>
                      ) : null}
                    </div>
                    <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>
                      {r.time} &middot; {r.guests} guests &middot; {r.table || 'No table'}
                    </div>
                  </div>
                  <ResStatusBadge status={r.status} />
                </div>
              ))
            ) : (
              <div style={{ color: 'var(--muted)', fontSize: 14, padding: '24px 0', textAlign: 'center' }}>
                {loadStatus === 'error'
                  ? 'Could not load reservations'
                  : q
                    ? 'No reservations found'
                    : isEmpty
                      ? 'No reservations yet'
                      : 'No reservations this date'}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
