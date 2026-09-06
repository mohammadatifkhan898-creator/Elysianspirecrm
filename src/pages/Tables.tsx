import { useState } from 'react';
import { useStore } from '../store/store';
import { useRestaurantTables } from '../hooks/useRestaurantTables';
import {
  useCreateRestaurantTable,
  useUpdateRestaurantTable,
  useSetRestaurantTableStatus,
  useDeleteRestaurantTable,
} from '../hooks/useRestaurantTableActions';
import { openModal, closeModal, openDrawer, closeDrawer, ModalHead, CloseButton } from '../components/ui/Overlay';
import { Icon } from '../components/ui/Icon';
import { ICON } from '../lib/svg';
import { ReadOnlyNotice } from '../components/ui/ReadOnlyNotice';
import { TABLE_STATUSES, type RestaurantTableUpdateInput } from '../services/restaurantTables';
import type { DiningTable, TableStatus } from '../types';

const SEAT_ICONS = {
  seat: '<circle cx="12" cy="7" r="4"/><path d="M5 13h14l-1.5 8h-3L14 19h-4l-.5 2h-3L5 13Z"/>',
  table: '<rect x="3" y="9" width="18" height="7" rx="2"/><path d="M5 16v3M19 16v3M9 9V6h6v3"/>',
  large: '<rect x="2.5" y="10" width="19" height="6" rx="2"/><circle cx="7" cy="16" r="1.4"/><circle cx="12" cy="16" r="1.4"/><circle cx="17" cy="16" r="1.4"/>',
};

const STATUS_LABEL: Record<TableStatus, string> = {
  available: 'Available',
  occupied: 'Occupied',
  reserved: 'Reserved',
};

const STATUS_BADGE: Record<TableStatus, string> = {
  available: 'badge-success',
  occupied: 'badge-info',
  reserved: 'badge-warning',
};

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Display code for a table: real rows carry `.label`; seed rows carry it in `.id`. */
function codeOf(t: DiningTable): string {
  return t.label ?? t.id;
}

export default function Tables() {
  const { s } = useStore();
  const { tables, status, error: loadError, canManageTables, refetch: reload } = useRestaurantTables();

  const avail = tables.filter((t) => t.status === 'available').length;
  const occ = tables.filter((t) => t.status === 'occupied').length;
  const resv = tables.filter((t) => t.status === 'reserved').length;

  const seatIcon = (cap: number) => (cap <= 2 ? SEAT_ICONS.seat : cap <= 6 ? SEAT_ICONS.table : SEAT_ICONS.large);

  const tableMap = new Map(s.tables.map((tb) => [tb.id, tb.label ?? tb.id]));

  const openTable = (t: DiningTable) => {
    const reservations = s.reservations.filter((r) => {
      const dt = r.tableId ? (tableMap.get(r.tableId) ?? r.table) : r.table;
      return dt === codeOf(t) && r.status !== 'Cancelled';
    });
    openDrawer(
      <>
        <div className="drawer-head">
          <div>
            <h3>Table {codeOf(t)}</h3>
            <span className="num">{t.cap} seats</span>
          </div>
          <CloseButton onClick={closeDrawer} />
        </div>
        <div className="drawer-body">
          <div style={{ textAlign: 'center', marginBottom: 16 }}>
            <div style={{ width: 96, height: 96, margin: '0 auto 10px', borderRadius: 20, background: 'var(--sand)', display: 'grid', placeItems: 'center' }}>
              <span style={{ fontSize: 34, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--navy)' }}>
                {codeOf(t).replace('T-', '')}
              </span>
            </div>
            <div style={{ color: 'var(--muted)', fontSize: 13 }}>
              Seating capacity: <b className="num">{t.cap}</b> guests
            </div>
          </div>
          <div className="detail-grid">
            <div className="detail-item">
              <div className="k">Current status</div>
              <div className="v">{capitalize(t.status)}</div>
            </div>
            <div className="detail-item">
              <div className="k">Area</div>
              <div className="v">Dining Hall</div>
            </div>
          </div>
          {canManageTables ? <StatusControl table={t} /> : null}
          <div className="sec-title">Active reservations</div>
          {reservations.length ? (
            reservations.map((r) => (
              <div key={r.id} style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 4 }}>
                {r.cust} &middot; {r.time} &middot; {r.guests} guests
              </div>
            ))
          ) : (
            <div style={{ color: 'var(--muted)', fontSize: 13 }}>No active reservations</div>
          )}
        </div>
      </>
    );
  };

  const openCreate = () => {
    openModal(<CreateTableModal />);
  };

  const empty = tables.length === 0 && (status === 'empty' || status === 'loaded');

  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-title">Table Management</div>
          <div className="page-sub">Live seating plan</div>
        </div>
        <div className="page-actions" style={{ gap: 8 }}>
          <span className="badge badge-success">{avail} available</span>
          <span className="badge badge-info">{occ} occupied</span>
          <span className="badge badge-warning">{resv} reserved</span>
          {canManageTables ? (
            <button className="btn btn-primary" id="add-table" onClick={openCreate} style={{ marginLeft: 8 }}>
              + Add Table
            </button>
          ) : null}
        </div>
      </div>
      {!canManageTables ? (
        <ReadOnlyNotice>You can browse the seating plan, but you don&rsquo;t have permission to add, edit, or reseat tables.</ReadOnlyNotice>
      ) : null}
      {loadError ? (
        <div className="inv-note" style={{ marginBottom: 16 }}>
          <Icon d={ICON.info} size={15} />
          <span>
            Could not load the seating plan.{' '}
            <a style={{ cursor: 'pointer', textDecoration: 'underline' }} onClick={reload}>
              Retry
            </a>
          </span>
        </div>
      ) : null}
      <div className="card card-pad">
        <div className="legend" style={{ marginBottom: 16 }}>
          <span className="legend-item">
            <span className="dot" style={{ background: 'var(--success)' }}></span>Available
          </span>
          <span className="legend-item">
            <span className="dot" style={{ background: 'var(--info)' }}></span>Occupied
          </span>
          <span className="legend-item">
            <span className="dot" style={{ background: 'var(--warning)' }}></span>Reserved
          </span>
        </div>
        {status === 'error' ? (
          <div style={{ textAlign: 'center', padding: '48px 24px', color: 'var(--muted)' }}>
            <div style={{ fontSize: 15, marginBottom: 6 }}>Could not load the seating plan</div>
            <div style={{ fontSize: 13, marginBottom: 16 }}>Tables will appear here once the server is reachable.</div>
            <button className="btn btn-ghost" onClick={reload}>
              Retry
            </button>
          </div>
        ) : empty ? (
          <div style={{ textAlign: 'center', padding: '48px 24px', color: 'var(--muted)' }}>
            <div style={{ fontSize: 15, marginBottom: 6 }}>No tables yet</div>
            <div style={{ fontSize: 13, marginBottom: 16 }}>
              {canManageTables ? 'Add your first table to start building the seating plan.' : 'Tables will appear here once one is added.'}
            </div>
            {canManageTables ? (
              <button className="btn btn-primary" id="add-table-empty" onClick={openCreate}>
                + Add Table
              </button>
            ) : null}
          </div>
        ) : (
          <div className="floor">
            {tables.map((t) => (
              <div key={t.id} className={'tbl-card ' + t.status} data-id={t.id} onClick={() => openTable(t)}>
                <div className="tbl-seat">
                  <Icon d={seatIcon(t.cap)} size={34} strokeWidth={1.6} />
                  <span className="t-num">{codeOf(t).replace('T-', '')}</span>
                </div>
                <div style={{ fontWeight: 600, color: 'var(--navy)', fontFamily: 'var(--font-mono)' }}>{codeOf(t)}</div>
                <div className="t-cap">
                  <span className="num">{t.cap}</span> seats
                </div>
                <span className={'badge ' + STATUS_BADGE[t.status]}>{STATUS_LABEL[t.status]}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

/* ═══════════════════════════════════════════════════════════
   Status + edit/remove controls embedded in the table drawer
   (settings.manage gate; RLS remains authoritative).
   ═══════════════════════════════════════════════════════════ */

function StatusControl({ table }: { table: DiningTable }) {
  const { toast } = useStore();
  const { run, submitting, error } = useSetRestaurantTableStatus();

  const setStatus = async (status: TableStatus) => {
    if (!table.id) return;
    if (submitting) return;
    const res = await run(table.id, status);
    if (res.ok) {
      toast('Table is now ' + capitalize(status) + '.', 'success', 'Table updated');
    } else {
      toast(res.error?.message || 'Could not update status.', 'error', 'Status update failed');
    }
  };

  return (
    <>
      <div className="sec-title">Change Status</div>
      {error ? <div style={{ color: 'var(--error)', fontSize: 12.5, marginBottom: 8 }}>{error.message}</div> : null}
      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {TABLE_STATUSES.map((status) => (
          <button
            key={status}
            className={'btn ' + (table.status === status ? 'btn-navy' : 'btn-ghost')}
            disabled={submitting}
            onClick={() => setStatus(status)}
          >
            {capitalize(status)}
          </button>
        ))}
      </div>
      <div className="sec-title">Edit Table</div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => openModal(<EditTableModal table={table} />)}>
          Edit details
        </button>
      </div>
    </>
  );
}

/* ═══════════════════════════════════════════════════════════
   Create modal
   ═══════════════════════════════════════════════════════════ */

function CreateTableModal() {
  const { toast } = useStore();
  const { run, submitting, error } = useCreateRestaurantTable();
  const [label, setLabel] = useState('');
  const [capacity, setCapacity] = useState('');
  const [err, setErr] = useState('');

  const save = async () => {
    const cap = parseInt(capacity, 10);
    const res = await run({ label, capacity: Number.isFinite(cap) ? cap : NaN });
    if (res.ok) {
      toast('Table added');
      closeModal();
    } else {
      setErr(res.error?.message || 'Could not add table.');
    }
  };

  return (
    <>
      <ModalHead title="Add Table" onClose={closeModal} />
      <form className="modal-body" onSubmit={(e) => e.preventDefault()}>
        <div className="field">
          <label>Table label</label>
          <input className="input" id="table_add_label" placeholder="e.g. T-14" autoFocus value={label} onChange={(e) => setLabel(e.target.value)} />
          {err ? <span className="err" style={{ color: 'var(--error)', fontSize: 12.5 }}>{err}</span> : null}
        </div>
        <div className="field">
          <label>Capacity (guests)</label>
          <input className="input" id="table_add_capacity" type="number" min={1} placeholder="e.g. 4" value={capacity} onChange={(e) => setCapacity(e.target.value)} />
        </div>
      </form>
      <div className="modal-foot">
        <button className="btn btn-ghost" onClick={closeModal}>
          Cancel
        </button>
        <button className="btn btn-primary" id="table_add_save" disabled={submitting} onClick={save}>
          {submitting ? 'Adding…' : 'Add Table'}
        </button>
      </div>
      {error ? (
        <div style={{ padding: '0 22px 16px', color: 'var(--error)', fontSize: 12.5 }}>{error.message}</div>
      ) : null}
    </>
  );
}

/* ═══════════════════════════════════════════════════════════
   Edit modal (label + capacity + soft delete)
   ═══════════════════════════════════════════════════════════ */

function EditTableModal({ table }: { table: DiningTable }) {
  const { toast } = useStore();
  const { run, submitting, error } = useUpdateRestaurantTable();
  const del = useDeleteRestaurantTable();
  const [label, setLabel] = useState(codeOf(table));
  const [capacity, setCapacity] = useState(String(table.cap));
  const [err, setErr] = useState('');

  const save = async () => {
    if (!table.id) return;
    const cap = parseInt(capacity, 10);
    const patch: RestaurantTableUpdateInput = {
      label,
      capacity: Number.isFinite(cap) ? cap : NaN,
    };
    const res = await run(table.id, patch);
    if (res.ok) {
      toast('Table updated');
      closeModal();
    } else {
      setErr(res.error?.message || 'Could not update table.');
    }
  };

  const handleDelete = async () => {
    if (!table.id) return;
    if (del.submitting) return;
    if (!window.confirm('Remove ' + codeOf(table) + '? Reservations keep their history, and this can be re-enabled later.')) return;
    const res = await del.run(table.id);
    if (res.ok) {
      toast('Table removed');
      closeModal();
    } else {
      toast(res.error?.message || 'Could not remove table.', 'error', 'Remove failed');
    }
  };

  return (
    <>
      <ModalHead title={'Edit ' + codeOf(table)} onClose={closeModal} />
      <form className="modal-body" onSubmit={(e) => e.preventDefault()}>
        <div className="field">
          <label>Table label</label>
          <input className="input" id="table_edit_label" value={label} onChange={(e) => setLabel(e.target.value)} />
          {err ? <span className="err" style={{ color: 'var(--error)', fontSize: 12.5 }}>{err}</span> : null}
        </div>
        <div className="field">
          <label>Capacity (guests)</label>
          <input className="input" id="table_edit_capacity" type="number" min={1} value={capacity} onChange={(e) => setCapacity(e.target.value)} />
        </div>
      </form>
      <div className="modal-foot">
        <button className="btn btn-danger" style={{ marginRight: 'auto' }} id="table_delete" disabled={del.submitting} onClick={handleDelete}>
          {del.submitting ? 'Removing…' : 'Remove'}
        </button>
        <button className="btn btn-ghost" onClick={closeModal}>
          Cancel
        </button>
        <button className="btn btn-primary" id="table_edit_save" disabled={submitting} onClick={save}>
          {submitting ? 'Saving…' : 'Save Changes'}
        </button>
      </div>
      {error ? (
        <div style={{ padding: '0 22px 16px', color: 'var(--error)', fontSize: 12.5 }}>{error.message}</div>
      ) : null}
    </>
  );
}
