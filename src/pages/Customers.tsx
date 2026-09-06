import { useEffect, useState } from 'react';
import { useStore } from '../store/store';
import { useCustomers } from '../hooks/useCustomers';
import { useCreateCustomer, useUpdateCustomer, useDeleteCustomer, useCustomerNotes } from '../hooks/useCustomerActions';
import { openModal, closeModal, openDrawer, closeDrawer, ModalHead, CloseButton } from '../components/ui/Overlay';
import { Avatar, PageHead } from '../components/ui/primitives';
import { inr, customerTier } from '../lib/utils';
import { formatISODate } from '../lib/dates';
import type { Customer } from '../types';
import type { CustomerNoteItem } from '../hooks/useCustomerActions';
import { ReadOnlyNotice } from '../components/ui/ReadOnlyNotice';

const BADGE: Record<'Platinum' | 'Gold' | 'Silver' | 'Regular', string> = {
  Platinum: 'badge-gold',
  Gold: 'badge-warning',
  Silver: 'badge-info',
  Regular: 'badge-neut',
};

export default function Customers() {
  const { s } = useStore();
  const { canManageCustomers } = useCustomers();
  const [q, setQ] = useState('');
  const [tier, setTier] = useState('');

  const tierOf = (c: Customer): 'Platinum' | 'Gold' | 'Silver' | 'Regular' => customerTier(c.orders);

  const list = s.customers.filter((c) => {
    const matchQ = (c.name + c.phone + c.email + c.visits).toLowerCase().includes(q.toLowerCase());
    const t = tierOf(c);
    const matchT = !tier ? true : tier === 'regular' ? t === 'Regular' : t === tier;
    return matchQ && matchT;
  });

  const openCustomer = (c: Customer) => {
    openDrawer(<CustomerDetailDrawer customer={c} canManage={canManageCustomers} />);
  };

  const openCreate = () => {
    openModal(<CustomerCreateModal />);
  };

  return (
    <>
      <PageHead
        title="Customers"
        sub={s.customers.length + ' valued guests'}
        actions={
          <>
            <input className="input" id="cust-search" placeholder="Search name, phone, email…" style={{ width: 240 }} value={q} onChange={(e) => setQ(e.target.value)} />
            <div className="select-wrap">
              <select className="input" id="cust-tier" style={{ width: 150 }} value={tier} onChange={(e) => setTier(e.target.value)}>
                <option value="">All tiers</option>
                <option>Gold</option>
                <option>Platinum</option>
                <option>Silver</option>
                <option value="regular">Regular</option>
              </select>
            </div>
            {canManageCustomers ? (
              <button className="btn btn-primary" id="add-customer" onClick={openCreate}>
                + Add Customer
              </button>
            ) : null}
          </>
        }
      />
      {!canManageCustomers ? (
        <ReadOnlyNotice>You can browse and review customers, but you don&rsquo;t have permission to add or change customer records.</ReadOnlyNotice>
      ) : null}
      <div className="card">
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Name</th>
                <th>Phone</th>
                <th>Email</th>
                <th>Visits</th>
                <th>Orders</th>
                <th>Total Spent</th>
                <th className="t-right">Last Visit</th>
              </tr>
            </thead>
            <tbody id="cust-body">
              {list.length ? (
                list.map((c) => {
                  const t = tierOf(c);
                  return (
                    <tr className="cust-row" key={c.id ?? c.name + c.phone} style={{ cursor: 'pointer' }} onClick={() => openCustomer(c)}>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <Avatar name={c.name} />
                          <span style={{ fontWeight: 600 }}>{c.name}</span>
                        </div>
                      </td>
                      <td className="num">{c.phone}</td>
                      <td style={{ color: 'var(--muted)' }}>{c.email}</td>
                      <td className="num-col">{c.visits}</td>
                      <td className="num-col">{c.orders}</td>
                      <td className="num-col" style={{ fontWeight: 600 }}>{inr(c.spent)}</td>
                      <td className="t-right">
                        <span style={{ color: 'var(--muted)' }}>{c.last}</span>{' '}
                        <span className={'badge ' + BADGE[t]}>{t}</span>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', color: 'var(--muted)', padding: 28 }}>
                    No customers match
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

/* ═══════════════════════════════════════════════════
   Create modal
   ═══════════════════════════════════════════════════ */

function CustomerCreateModal() {
  const { toast } = useStore();
  const { run, submitting, error } = useCreateCustomer();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [fav, setFav] = useState('');
  const [err, setErr] = useState('');

  const save = async () => {
    if (!name.trim()) {
      setErr('Name is required.');
      return;
    }
    setErr('');
    const res = await run({ name, phone, email, favorite_item: fav });
    if (res.ok) {
      toast('Customer added');
      closeModal();
    } else {
      setErr(res.error?.message || 'Could not add customer.');
    }
  };

  return (
    <>
      <ModalHead title="Add Customer" onClose={closeModal} />
      <form className="modal-body" onSubmit={(e) => e.preventDefault()}>
        <div className="field">
          <label>Name</label>
          <input className="input" id="cust_add_name" placeholder="Guest name" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
          {err ? <span className="err" style={{ color: 'var(--error)', fontSize: 12.5 }}>{err}</span> : null}
        </div>
        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div className="field">
            <label>Phone</label>
            <input className="input" id="cust_add_phone" placeholder="+91…" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div className="field">
            <label>Email</label>
            <input className="input" id="cust_add_email" placeholder="guest@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label>Favourite dish</label>
          <input className="input" id="cust_add_fav" placeholder="Optional" value={fav} onChange={(e) => setFav(e.target.value)} />
        </div>
      </form>
      <div className="modal-foot">
        <button className="btn btn-ghost" onClick={closeModal}>
          Cancel
        </button>
        <button className="btn btn-primary" id="cust_add_save" disabled={submitting} onClick={save}>
          {submitting ? 'Adding…' : 'Add Customer'}
        </button>
      </div>
      {error ? (
        <div style={{ padding: '0 22px 16px', color: 'var(--error)', fontSize: 12.5 }}>{error.message}</div>
      ) : null}
    </>
  );
}

/* ═══════════════════════════════════════════════════
   Detail drawer (view + edit + notes + soft delete)
   ═══════════════════════════════════════════════════ */

function CustomerDetailDrawer({ customer, canManage }: { customer: Customer; canManage: boolean }) {
  const { s, toast } = useStore();
  // Real rows carry a DB uuid; look up the freshest copy from the store so
  // edits/deletes reflect immediately. Seed rows (no id) use the snapshot.
  const live = customer.id ? s.customers.find((x) => x.id === customer.id) : undefined;
  const c = live ?? customer;
  const isReal = Boolean(c.id);

  const [editing, setEditing] = useState(false);

  const notes = useCustomerNotes(c.id ?? null);
  const del = useDeleteCustomer();

  const handleRemove = async () => {
    if (!c.id) return;
    if (del.submitting) return;
    if (!window.confirm('Remove ' + c.name + '? Their order history is kept, and this can be re-enabled later.')) return;
    const res = await del.run(c.id);
    if (res.ok) {
      closeDrawer();
    } else {
      toast(res.error?.message || 'Could not remove customer.', 'error', 'Remove failed');
    }
  };

  useEffect(() => {
    if (isReal && !live) closeDrawer();
  }, [isReal, live]);

  const hist = s.orders.filter((o) =>
    c.id ? o.customerId === c.id : o.cust.toLowerCase() === c.name.toLowerCase(),
  );
  const resv = c.id ? s.reservations.filter((r) => r.customerId === c.id) : [];

  return (
    <>
      <div className="drawer-head">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Avatar name={c.name} lg gold />
            <div>
              <h3 style={{ fontFamily: 'var(--font-body)', fontSize: 19 }}>{c.name}</h3>
              <span className="num">{c.email}</span>
            </div>
          </div>
        </div>
        <CloseButton onClick={closeDrawer} />
      </div>
      <div className="drawer-body">
        <div className="kpi-grid" style={{ gridTemplateColumns: '1fr 1fr 1fr', marginBottom: 16 }}>
          <div className="kpi" style={{ padding: 14 }}>
            <div className="k-label">Visits</div>
            <div className="k-value num" style={{ fontSize: 20 }}>{c.visits}</div>
          </div>
          <div className="kpi" style={{ padding: 14 }}>
            <div className="k-label">Orders</div>
            <div className="k-value num" style={{ fontSize: 20 }}>{c.orders}</div>
          </div>
          <div className="kpi" style={{ padding: 14 }}>
            <div className="k-label">Spent</div>
            <div className="k-value num" style={{ fontSize: 20 }}>{inr(c.spent)}</div>
          </div>
        </div>

        {editing ? (
          <EditCustomerForm customer={c} onDone={() => setEditing(false)} />
        ) : (
          <>
            <div className="detail-grid">
              <div className="detail-item">
                <div className="k">Phone</div>
                <div className="v num">{c.phone}</div>
              </div>
              <div className="detail-item">
                <div className="k">Last visit</div>
                <div className="v">{c.last}</div>
              </div>
              <div className="detail-item">
                <div className="k">Favourite</div>
                <div className="v">{c.fav || '—'}</div>
              </div>
              <div className="detail-item">
                <div className="k">Tag</div>
                <div className="v">{customerTier(c.orders)}</div>
              </div>
            </div>
            <div className="sec-title">Order History</div>
            {hist.length ? (
              hist.slice(0, 4).map((o) => (
                <div key={o.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border)', fontSize: 13.5 }}>
                  <span className="num" style={{ color: 'var(--gold-ink)', fontWeight: 600 }}>{o.id}</span>
                  <span>{o.items.reduce((a, i) => a + i.q, 0)} items</span>
                  <span className="num" style={{ fontWeight: 600 }}>{inr(o.amount)}</span>
                  <span>{o.time}</span>
                </div>
              ))
            ) : (
              <div style={{ color: 'var(--muted)', fontSize: 13 }}>No recent orders on record</div>
            )}
            <div className="sec-title">Reservations</div>
            {resv.length ? (
              resv.slice(0, 4).map((r) => (
                <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border)', fontSize: 13.5 }}>
                  <span className="num" style={{ color: 'var(--gold-ink)', fontWeight: 600 }}>{r.code ?? r.id}</span>
                  <span>{formatISODate(r.date)} · {r.time} · {r.guests} guests</span>
                  <span>{r.status}</span>
                </div>
              ))
            ) : (
              <div style={{ color: 'var(--muted)', fontSize: 13 }}>No reservations on record</div>
            )}
            <NotesSection notes={notes} canManage={canManage} />
          </>
        )}
      </div>
      <div className="drawer-foot">
        {isReal && !editing && canManage ? (
          <button className="btn btn-danger" style={{ marginRight: 'auto' }} disabled={del.submitting} onClick={handleRemove}>
            {del.submitting ? 'Removing…' : 'Remove'}
          </button>
        ) : null}
        {editing ? (
          <button className="btn btn-ghost" onClick={() => setEditing(false)}>
            Cancel
          </button>
        ) : null}
        {canManage ? (
          <button
            className="btn btn-primary"
            onClick={() => {
              if (editing) return;
              if (isReal) setEditing(true);
              else toast('Editing is available once this guest is saved from a live database.', 'info');
            }}
          >
            {editing ? '…' : 'Edit'}
          </button>
        ) : (
          <span style={{ color: 'var(--muted)', fontSize: 13 }}>
            You have view-only access to guests. Contact a manager to make changes.
          </span>
        )}
      </div>
    </>
  );
}

/* ── Edit form (embedded in the drawer) ───────────────────────── */

function EditCustomerForm({ customer, onDone }: { customer: Customer; onDone: () => void }) {
  const { toast } = useStore();
  const { run, submitting, error } = useUpdateCustomer();
  const [name, setName] = useState(customer.name);
  const [phone, setPhone] = useState(customer.phone);
  const [email, setEmail] = useState(customer.email);
  const [fav, setFav] = useState(customer.fav);
  const [err, setErr] = useState('');

  const save = async () => {
    if (!customer.id) return;
    if (!name.trim()) {
      setErr('Name is required.');
      return;
    }
    setErr('');
    const res = await run(customer.id, { name, phone, email, favorite_item: fav });
    if (res.ok) {
      toast('Customer updated');
      onDone();
    } else {
      setErr(res.error?.message || 'Could not update customer.');
    }
  };

  return (
    <>
      <div className="sec-title">Edit Guest</div>
      <div className="field">
        <label>Name</label>
        <input className="input" id="cust_edit_name" value={name} onChange={(e) => setName(e.target.value)} />
        {err ? <span className="err" style={{ color: 'var(--error)', fontSize: 12.5 }}>{err}</span> : null}
      </div>
      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div className="field">
          <label>Phone</label>
          <input className="input" id="cust_edit_phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <div className="field">
          <label>Email</label>
          <input className="input" id="cust_edit_email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label>Favourite dish</label>
        <input className="input" id="cust_edit_fav" value={fav} onChange={(e) => setFav(e.target.value)} />
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
        <button className="btn btn-primary" id="cust_edit_save" disabled={submitting} onClick={save}>
          {submitting ? 'Saving…' : 'Save Changes'}
        </button>
      </div>
      {error ? <div style={{ color: 'var(--error)', fontSize: 12.5 }}>{error.message}</div> : null}
    </>
  );
}

/* ── Notes (read list + add; immutable) ───────────────────────── */

function NotesSection({
  notes,
  canManage,
}: {
  notes: { status: string; saving: boolean; notes: CustomerNoteItem[]; error: { message: string } | null; save: (t: string) => Promise<unknown> };
  canManage: boolean;
}) {
  const { toast } = useStore();
  const [draft, setDraft] = useState('');
  const [localErr, setLocalErr] = useState('');

  const submit = async () => {
    if (!draft.trim()) {
      setLocalErr('Note cannot be empty.');
      return;
    }
    setLocalErr('');
    const res = (await notes.save(draft)) as { ok: boolean; error?: { message?: string } };
    if (res.ok) {
      setDraft('');
      toast('Note added');
    } else {
      setLocalErr(res?.error?.message || 'Could not add note.');
    }
  };

  return (
    <>
      <div className="sec-title">Notes</div>
      {notes.status === 'error' ? (
        <div style={{ color: 'var(--error)', fontSize: 13 }}>{notes.error?.message || 'Could not load notes.'}</div>
      ) : notes.notes.length ? (
        notes.notes.map((n) => (
          <div key={n.id} style={{ padding: '9px 0', borderBottom: '1px solid var(--border)' }}>
            <div style={{ fontSize: 13.5, color: 'var(--charcoal)' }}>{n.note}</div>
            <div className="num" style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3 }}>{n.createdAt}</div>
          </div>
        ))
      ) : (
        <div style={{ color: 'var(--muted)', fontSize: 13 }}>No notes yet</div>
      )}
      {canManage ? (
        <>
          <textarea className="input" rows={2} placeholder="Add a note about this guest…" style={{ fontSize: 13.5, marginTop: 10 }} value={draft} onChange={(e) => setDraft(e.target.value)} />
          {localErr ? <div style={{ color: 'var(--error)', fontSize: 12.5 }}>{localErr}</div> : null}
          <div style={{ display: 'flex', gap: 10, marginTop: 6, justifyContent: 'flex-end' }}>
            <button className="btn btn-primary" id="cust_note_save" disabled={notes.saving} onClick={submit}>
              {notes.saving ? 'Saving…' : 'Add Note'}
            </button>
          </div>
        </>
      ) : null}
    </>
  );
}
