import { useState } from 'react';
import { useStore, toast } from '../store/store';
import { PageHead, Switch } from '../components/ui/primitives';
import { useIdentity } from '../hooks/useIdentity';
import { ReadOnlyNotice } from '../components/ui/ReadOnlyNotice';

export default function Settings() {
  const { s, notify } = useStore();
  const { hasPermission } = useIdentity();
  const canManage = hasPermission('settings.manage');
  const [name, setName] = useState(s.settings.name);
  const [contact, setContact] = useState(s.settings.contact);
  const [address, setAddress] = useState(s.settings.address);
  const [open, setOpen] = useState(s.settings.open);
  const [tables, setTables] = useState(String(s.settings.tables));
  const [config, setConfig] = useState(s.settings.config);

  const saveSettings = () => {
    if (!canManage) return;
    s.settings.name = name;
    s.settings.contact = contact;
    s.settings.address = address;
    s.settings.open = open;
    notify();
    toast('Settings saved.', 'success');
  };

  const saveTables = () => {
    if (!canManage) return;
    s.settings.tables = +tables || 13;
    s.settings.config = config;
    notify();
    toast('Table settings saved.', 'success');
  };

  const toggleNotif = (key: 'reserve' | 'order' | 'system') => {
    if (!canManage) return;
    s.notifs[key] = !s.notifs[key];
    notify();
  };

  const notifCtl = (key: 'reserve' | 'order' | 'system', checked: boolean) =>
    canManage ? (
      <Switch checked={checked} onChange={() => toggleNotif(key)} />
    ) : (
      <span style={{ color: 'var(--muted)', fontSize: 12.5, fontFamily: 'var(--font-mono)' }}>{checked ? 'On' : 'Off'}</span>
    );

  return (
    <>
      <PageHead title="Settings" sub="Configure your Elysian Spire workspace" />

      {!canManage ? (
        <ReadOnlyNotice>You can view workspace settings, but you don&rsquo;t have permission to change them.</ReadOnlyNotice>
      ) : null}

      <div className="grid">
        <div className="card card-pad" data-od-id="set-restaurant">
          <div className="card-title" style={{ marginBottom: 16 }}>Restaurant</div>
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div className="field">
              <label>Restaurant Name</label>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} disabled={!canManage} />
            </div>
            <div className="field">
              <label>Contact Number</label>
              <input className="input" value={contact} onChange={(e) => setContact(e.target.value)} disabled={!canManage} />
            </div>
            <div className="field" style={{ gridColumn: '1/-1' }}>
              <label>Address</label>
              <input className="input" value={address} onChange={(e) => setAddress(e.target.value)} disabled={!canManage} />
            </div>
            <div className="field">
              <label>Opening Hours</label>
              <input className="input" value={open} onChange={(e) => setOpen(e.target.value)} disabled={!canManage} />
            </div>
          </div>
          {canManage ? (
            <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={saveSettings}>
              Save Changes
            </button>
          ) : null}
        </div>

        <div className="card card-pad" data-od-id="set-tables">
          <div className="card-title" style={{ marginBottom: 16 }}>Tables &amp; Seating</div>
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div className="field">
              <label>Number of Tables</label>
              <input className="input" type="number" value={tables} onChange={(e) => setTables(e.target.value)} disabled={!canManage} />
            </div>
            <div className="field">
              <label>Seating Configuration</label>
              <input className="input" value={config} onChange={(e) => setConfig(e.target.value)} disabled={!canManage} />
            </div>
          </div>
          <p style={{ color: 'var(--muted)', fontSize: 12.5, marginTop: 10 }}>Apply table changes on the Table Management page.</p>
          {canManage ? (
            <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={saveTables}>
              Save Changes
            </button>
          ) : null}
        </div>

        <div className="card card-pad" data-od-id="set-account">
          <div className="card-title" style={{ marginBottom: 16 }}>Account</div>
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div className="field">
              <label>Full Name</label>
              <input className="input" defaultValue={s.user ? s.user.name : 'Admin'} disabled={!canManage} />
            </div>
            <div className="field">
              <label>Email</label>
              <input className="input" defaultValue={s.user ? s.user.email : 'admin@elysianspire.com'} disabled={!canManage} />
            </div>
            <div className="field" style={{ gridColumn: '1/-1' }}>
              <label>Change Password</label>
              <input className="input" type="password" placeholder="Set a new password&hellip;" disabled={!canManage} />
            </div>
          </div>
        </div>

        <div className="card card-pad" data-od-id="set-notif">
          <div className="card-title" style={{ marginBottom: 16 }}>Notifications</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="row-between">
              <div>
                <b style={{ fontSize: 14 }}>Reservation Notifications</b>
                <div style={{ color: 'var(--muted)', fontSize: 12.5 }}>Alerts for new &amp; changed bookings</div>
              </div>
              {notifCtl('reserve', s.notifs.reserve)}
            </div>
            <div className="row-between">
              <div>
                <b style={{ fontSize: 14 }}>Order Notifications</b>
                <div style={{ color: 'var(--muted)', fontSize: 12.5 }}>Kitchen &amp; status updates</div>
              </div>
              {notifCtl('order', s.notifs.order)}
            </div>
            <div className="row-between">
              <div>
                <b style={{ fontSize: 14 }}>System Notifications</b>
                <div style={{ color: 'var(--muted)', fontSize: 12.5 }}>Maintenance &amp; security</div>
              </div>
              {notifCtl('system', s.notifs.system)}
            </div>
          </div>
        </div>
      </div>

      {canManage ? (
        <div style={{ marginTop: 24, display: 'flex', gap: 12 }}>
          <button className="btn btn-ghost" onClick={() => toast('Your spoken preferences are noted.', 'info', 'Reset')}>
            Reset
          </button>
        </div>
      ) : null}
    </>
  );
}
