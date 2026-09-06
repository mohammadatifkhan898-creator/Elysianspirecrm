import { useState } from 'react';
import { useStore } from '../store/store';
import { useMenu } from '../hooks/useMenu';
import { inr } from '../lib/utils';
import { openModal, closeModal, ModalHead } from '../components/ui/Overlay';
import { PageHead, Switch, Tabs } from '../components/ui/primitives';
import { MenuIcon, MENU_ICON_MARKUP } from '../components/ui/icons';
import { UNCATEGORIZED } from '../services/menu';
import type { MenuItem } from '../types';
import type { ServiceError } from '../services/shared';
import { ReadOnlyNotice } from '../components/ui/ReadOnlyNotice';

const ICON_KEYS = Object.keys(MENU_ICON_MARKUP);

/** Human-friendly message for a mutation ServiceError (never shows raw). */
function errMsg(err?: ServiceError): string {
  if (!err) return 'Something went wrong. Please try again.';
  switch (err.code) {
    case 'FORBIDDEN':
      return "You don't have permission to manage the menu. Please contact a manager or administrator.";
    case 'NOT_FOUND':
      return err.message || 'The item no longer exists.';
    case 'VALIDATION':
      return err.message || 'The entered values are not valid.';
    case 'NETWORK':
      return 'Network error — could not reach the server.';
    case 'NOT_CONFIGURED':
      return 'Menu changes are unavailable (not configured).';
    default:
      return 'Something went wrong. Please try again.';
  }
}

function ItemModal({
  editId,
  categories,
  createItem,
  updateItem,
}: {
  editId: string | null;
  categories: { id: string; name: string }[];
  createItem: (input: { name: string; price: number; available: boolean; icon: string; categoryId: string | null }) => Promise<{ ok: boolean; error?: ServiceError }>;
  updateItem: (id: string, input: { name: string; price: number; available: boolean; icon: string; categoryId: string | null }) => Promise<{ ok: boolean; error?: ServiceError }>;
}) {
  const { s, toast } = useStore();
  const cats = Object.keys(s.menu);
  const dropdownCats = categories.map((c) => c.name).concat(categories.some((c) => c.name === UNCATEGORIZED) ? [] : [UNCATEGORIZED]);
  let found: { it: MenuItem; cat: string } | null = null;
  if (editId) {
    outer: for (const c of cats) {
      for (const x of s.menu[c] || []) {
        if (x.id === editId) {
          found = { it: x, cat: c };
          break outer;
        }
      }
    }
  }
  const [name, setName] = useState(found ? found.it.name : '');
  const [cat, setCat] = useState(found ? found.cat : dropdownCats[0] || '');
  const [price, setPrice] = useState(found ? String(found.it.price) : '');
  const [on, setOn] = useState(found ? found.it.on : true);
  const [icon, setIcon] = useState(found && MENU_ICON_MARKUP[found.it.icon] ? found.it.icon : 'salad');
  const [saving, setSaving] = useState(false);

  const catId = (): string | null => {
    if (!cat) return null;
    return categories.find((c) => c.name === cat)?.id ?? null;
  };

  const save = async () => {
    const n = name.trim();
    if (!n) {
      toast('Please enter an item name.', 'error', 'Missing name');
      return;
    }
    const p = +price;
    if (!p || p <= 0) {
      toast('Please enter a valid price.', 'error', 'Invalid price');
      return;
    }
    if (editId) {
      if (!found || !found.it.id) {
        toast('This item could not be found.', 'error', 'Item missing');
        return;
      }
      setSaving(true);
      const res = await updateItem(found.it.id, { name: n, price: p, available: on, icon, categoryId: catId() });
      if (res.ok) {
        toast('Menu item updated.', 'success', 'Item updated');
        closeModal();
      } else {
        toast(errMsg(res.error), 'error', 'Update failed');
        setSaving(false);
      }
    } else {
      setSaving(true);
      const res = await createItem({ name: n, price: p, available: on, icon, categoryId: catId() });
      if (res.ok) {
        toast('Added "' + n + '" to ' + (cat || 'Uncategorized') + '.', 'success', 'Item added');
        closeModal();
      } else {
        toast(errMsg(res.error), 'error', 'Add failed');
        setSaving(false);
      }
    }
  };

  return (
    <>
      <ModalHead title={editId ? 'Edit Item' : 'Add Menu Item'} onClose={closeModal} />
      <form className="modal-body" onSubmit={(e) => e.preventDefault()}>
        <div className="field">
          <label>Name</label>
          <input className="input" id="mi_name" placeholder="Dish name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div className="field">
            <label>Category</label>
            <div className="select-wrap">
              <select className="input" id="mi_cat" value={cat} onChange={(e) => setCat(e.target.value)}>
                {dropdownCats.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="field">
            <label>Price (?)</label>
            <input className="input" id="mi_price" type="number" min={0} placeholder="0" value={price} onChange={(e) => setPrice(e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label>Icon</label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 6, justifyItems: 'center' }}>
            {ICON_KEYS.map((k) => (
              <button
                key={k}
                type="button"
                className="icon-btn"
                aria-label={k}
                onClick={() => setIcon(k)}
                style={icon === k ? { borderColor: 'var(--gold)', color: 'var(--gold-ink)', background: 'var(--gold-soft)' } : undefined}
              >
                <MenuIcon name={k} size={18} />
              </button>
            ))}
          </div>
        </div>
        <label className="checkbox">
          <input type="checkbox" id="mi_on" checked={on} onChange={(e) => setOn(e.target.checked)} /> Available now
        </label>
      </form>
      <div className="modal-foot">
        <button className="btn btn-ghost" disabled={saving} onClick={closeModal}>
          Cancel
        </button>
        <button className="btn btn-primary" disabled={saving} onClick={save}>
          {saving ? 'Saving…' : editId ? 'Save Changes' : 'Add Item'}
        </button>
      </div>
    </>
  );
}

export default function Menu() {
  const { s, notify, toast } = useStore();
  const { status: loadStatus, toggleItem, categories, createItem, updateItem, canManageMenu } = useMenu();
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set());
  const cats = Object.keys(s.menu);
  const [cat, setCat] = useState('');
  const items = cat ? s.menu[cat] || [] : Object.values(s.menu).flat();
  const total = cats.reduce((a, c) => a + s.menu[c].length, 0);

  const isLoading = loadStatus === 'loading' || loadStatus === 'idle';
  const hasError = loadStatus === 'error';

  const toggle = (it: MenuItem, val: boolean) => {
    const id = it.id;
    if (!id || pendingIds.has(id)) return; // ignore while a write is in flight
    const prev = it.on;
    it.on = val;
    notify(); // optimistic
    setPendingIds((old) => new Set(old).add(id));
    toggleItem(id, val).then((res) => {
      if (!res.ok) {
        it.on = prev;
        notify();
        toast(errMsg(res.error), 'error', 'Update failed');
      } else {
        toast(val ? '"' + it.name + '" is now available.' : '"' + it.name + '" is now unavailable.', 'info', 'Menu updated');
      }
      setPendingIds((old) => {
        const next = new Set(old);
        next.delete(id);
        return next;
      });
    });
  };
  const openEdit = (it: MenuItem) => openModal(<ItemModal editId={it.id ?? null} categories={categories} createItem={createItem} updateItem={updateItem} />);
  const openAdd = () => openModal(<ItemModal editId={null} categories={categories} createItem={createItem} updateItem={updateItem} />);

  return (
    <>
      <PageHead
        title="Menu Management"
        sub={isLoading ? 'Loading menu…' : total + ' items across ' + cats.length + ' categories'}
        actions={
          <>
            <Tabs value={cat} options={[{ key: '', label: 'All' }, ...cats.map((c) => ({ key: c, label: c }))]} onChange={setCat} />
            {canManageMenu ? (
              <button className="btn btn-primary" onClick={openAdd}>
                + Add Item
              </button>
            ) : null}
          </>
        }
      />
      {!canManageMenu ? (
        <ReadOnlyNotice>You can browse the menu, but you don&rsquo;t have permission to add, edit, or hide items.</ReadOnlyNotice>
      ) : null}
      {isLoading ? (
        <div style={{ color: 'var(--muted)', display: 'grid', placeItems: 'center', padding: 60, fontSize: 14 }}>
          Loading menu…
        </div>
      ) : hasError ? (
        <div style={{ color: 'var(--error)', display: 'grid', placeItems: 'center', padding: 60, fontSize: 14 }}>
          Could not load the menu.
        </div>
      ) : items.length === 0 ? (
        <div style={{ color: 'var(--muted)', display: 'grid', placeItems: 'center', padding: 60, fontSize: 14 }}>
          {total === 0 ? 'No menu items yet' : 'No items in this category'}
        </div>
      ) : (
      <div className="menu-grid">
          {items.map((it) => (
            <div className={'menu-item' + (it.on ? '' : ' off')} data-od-id={'menu-item-' + it.name.toLowerCase().replace(/\s/g, '-')} key={it.id ?? it.name}>
              <div className="menu-img">
                <MenuIcon name={it.icon} />
              </div>
              <div className="menu-body">
                <div className="row-between">
                  <span className="m-name">{it.name}</span>
                  <span className="menu-price num">{inr(it.price)}</span>
                </div>
                <div className="m-cat">{it.cat}</div>
                <div className="menu-actions">
                {canManageMenu ? (
                  <>
                    <Switch checked={it.on} onChange={(e) => toggle(it, e.target.checked)} title="Toggle availability" />
                    <button className="btn btn-ghost btn-sm" onClick={() => openEdit(it)}>
                      Edit
                    </button>
                  </>
                ) : null}
              </div>
              </div>
            </div>
          ))}
      </div>
      )}
    </>
  );
}
