import { useState } from 'react';
import type { ReactNode } from 'react';
import { PERM_CATS, PREV } from '../../data/seed';
import { ICON } from '../../lib/svg';
import { emailRe, initials, memberByIdx } from '../../lib/utils';
import { useStore } from '../../store/store';
import { useSupabase } from '../../lib/useSupabase';
import { createCustomRole } from '../../services/staff';
import {
  openModal,
  closeModal,
  closeDrawer,
  ModalHead,
  CloseButton,
} from '../../components/ui/Overlay';
import { Icon } from '../../components/ui/Icon';
import { allRoleNames, permChips, rolePerms, PermMatrix, NavAccess } from './parts';
import type { ServiceError } from '../../services/shared';

function errMsg2(err?: ServiceError): string {
  if (!err) return 'Something went wrong. Please try again.';
  switch (err.code) {
    case 'FORBIDDEN':
      return "You don't have permission to change roles. Please contact an administrator.";
    case 'NOT_FOUND':
      return err.message || "This staff member no longer exists.";
    case 'NETWORK':
      return 'Network error — could not reach the server.';
    case 'NOT_CONFIGURED':
      return 'Role changes are unavailable (not configured).';
    default:
      return 'Something went wrong. Please try again.';
  }
}

export function ConfirmModal({
  title,
  body,
  confirmLabel,
  onConfirm,
}: {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
}) {
  return (
    <>
      <ModalHead title={title} onClose={closeModal} />
      <div className="modal-body">{body}</div>
      <div className="modal-foot">
        <button className="btn btn-ghost" onClick={closeModal}>
          Cancel
        </button>
        <button className="btn btn-danger" onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </>
  );
}

export function InviteModal({ dbRoles }: { dbRoles: { id: string; name: string }[] }) {
  const { ss, notify, toast } = useStore();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('Waiter');
  const preview = PREV[role] || PREV['Waiter'];
  const roles = allRoleNames(ss, dbRoles).concat(['Custom Role']);
  const send = () => {
    const n = name.trim();
    const e = email.trim();
    if (!n) {
      toast("Please enter the staff member's full name.", 'error', 'Missing name');
      return;
    }
    if (!emailRe.test(e)) {
      toast('Please enter a valid email address.', 'error', 'Invalid email');
      return;
    }
    ss.members.push({
      name: n,
      email: e,
      role: role === 'Custom Role' ? 'Custom Role' : role,
      status: 'Pending',
      inv: 'Pending',
      last: 'Awaiting response',
      joined: '—',
      sent: 'Just now',
      activity: [{ t: 'Invitation sent', d: 'Just now' }],
    });
    closeModal();
    ss.openMenu = -1;
    ss.page = Math.ceil(ss.members.length / ss.perPage);
    toast(e + ' added to the team (recorded locally — email delivery is not wired up in this build).', 'info', 'Invitation recorded');
    notify();
  };
  return (
    <>
      <ModalHead title="Invite Staff" onClose={closeModal} />
      <div className="modal-body">
        <div className="field">
          <label>Full Name</label>
          <input
            className="input"
            id="iv_name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Meera Krishnan"
          />
        </div>
        <div className="field">
          <label>Email Address</label>
          <input
            className="input"
            id="iv_email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@elysianspire.com"
          />
        </div>
        <div className="field">
          <label>Role</label>
          <div className="select-wrap">
            <select className="input" id="iv_role" value={role} onChange={(e) => setRole(e.target.value)}>
              {roles.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="perm-preview" id="iv-preview">
          <div className="fc">
            <b style={{ fontSize: 13, color: 'var(--navy)' }}>Role: {role}</b>
            <span style={{ color: 'var(--muted)' }}>Access preview</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1, marginTop: 8 }}>
            {preview.map((l) => (
              <div key={l[0]} className={'perm-row ' + (l[1] ? 'on' : 'off')}>
                <span className="mark">{l[1] ? '✓' : '•'}</span>
                {l[0]}
              </div>
            ))}
          </div>
        </div>
        <div className="inv-note">
          <Icon d={ICON.info} size={15} />
          <span>
            In this build the invitation is recorded locally only — no email is sent. Email delivery will be wired to a
            provider in a later phase; the member appears under Pending until then.
          </span>
        </div>
      </div>
      <div className="modal-foot">
        <button className="btn btn-ghost" onClick={closeModal}>
          Cancel
        </button>
        <button className="btn btn-primary" onClick={send}>
          Send Invitation
        </button>
      </div>
    </>
  );
}

export function ChangeRoleModal({
  idx,
  roles,
  onChangeRole,
  onRoleChanged,
}: {
  idx: number;
  roles: { id: string; name: string }[];
  onChangeRole: (staffId: string, roleId: string) => Promise<{ ok: boolean; error?: ServiceError }>;
  onRoleChanged?: () => void;
}) {
  const { ss, notify, toast } = useStore();
  const m = memberByIdx(ss, idx);
  const options = m ? roles.filter((r) => r.id !== m.roleId) : [];
  const [sel, setSel] = useState<string>(options[0]?.name ?? '');
  const [saving, setSaving] = useState(false);
  if (!m || !options.length) return null;
  const apply = async () => {
    if (saving) return;
    const target = options.find((r) => r.name === sel) ?? options[0];
    if (!m.id || !target) {
      toast("This staff member couldn't be updated.", 'error', 'Update failed');
      return;
    }
    setSaving(true);
    const res = await onChangeRole(m.id, target.id);
    if (!res.ok) {
      setSaving(false);
      toast(errMsg2(res.error), 'error', 'Update failed');
      return;
    }
    m.role = target.name;
    m.roleId = target.id;
    m.activity.unshift({ t: 'Role changed to ' + target.name, d: 'Just now' });
    closeModal();
    toast(m.name + ' is now assigned the ' + target.name + ' role.', 'success', 'Role updated');
    notify();
    // Refresh centralized identity (handles self-role-change case).
    onRoleChanged?.();
  };
  return (
    <>
      <ModalHead title="Change Role" onClose={closeModal} />
      <div className="modal-body">
        <div className="detail-grid" style={{ marginBottom: 4 }}>
          <div className="detail-item">
            <div className="k">Staff Member</div>
            <div className="v">{m.name}</div>
          </div>
          <div className="detail-item">
            <div className="k">Current Role</div>
            <div className="v">{m.role}</div>
          </div>
        </div>
        <div className="field">
          <label>New Role</label>
          <div className="select-wrap">
            <select className="input" id="cr_role" value={sel} onChange={(e) => setSel(e.target.value)}>
              {options.map((r) => (
                <option key={r.id}>{r.name}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="sec-title">Permissions included with this role</div>
        <div className="perm-sum" id="cr-perms">
          {permChips(rolePerms(ss, sel))}
        </div>
        <div className="inv-note">
          <Icon d={ICON.info} size={15} />
          <span>
            Changing this role will update this staff member's CRM access and persist it. Only an admin or manager with
            staff.manage can change roles.
          </span>
        </div>
      </div>
      <div className="modal-foot">
        <button className="btn btn-ghost" disabled={saving} onClick={closeModal}>
          Cancel
        </button>
        <button className="btn btn-primary" disabled={saving} onClick={apply}>
          {saving ? 'Saving…' : 'Save Changes'}
        </button>
      </div>
    </>
  );
}

export function PermissionsModal({ idx }: { idx: number }) {
  const { ss, notify } = useStore();
  const m = memberByIdx(ss, idx);
  if (!m) return null;
  const openRoles = () => {
    closeModal();
    ss.tab = 'roles';
    ss.selectedRole = 'Manager';
    notify();
  };
  return (
    <>
      <ModalHead title={'Permissions — ' + m.name} onClose={closeModal} />
      <div className="modal-body">
        <div className="inv-note">
          <Icon d={ICON.info} size={15} />
          <span>
            Permissions are inherited from the <b style={{ color: 'var(--gold-ink)' }}>{m.role}</b> role. Manage them
            from Roles &amp; Permissions.
          </span>
        </div>
        <PermMatrix perms={rolePerms(ss, m.role)} />
      </div>
      <div className="modal-foot">
        <button className="btn btn-ghost" onClick={closeModal}>
          Close
        </button>
        <button className="btn btn-secondary" onClick={openRoles}>
          Open Roles &amp; Permissions
        </button>
      </div>
    </>
  );
}

export function CustomRoleModal({ onCreated }: { onCreated?: () => void } = {}) {
  const { ss, notify, toast } = useStore();
  const { supabase, isSupabaseConfigured } = useSupabase();
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const toggle = (p: string) =>
    setSel((s) => {
      const n = { ...s };
      if (n[p]) delete n[p];
      else n[p] = true;
      return n;
    });
  const toggleCat = (cat: string) => {
    const c = PERM_CATS.find((x) => x.cat === cat);
    if (!c) return;
    setSel((s) => {
      const n = { ...s };
      const allIn = c.perms.every((p) => s[p]);
      c.perms.forEach((p) => {
        if (allIn) delete n[p];
        else n[p] = true;
      });
      return n;
    });
  };
  const create = async () => {
    const n = name.trim();
    if (!n) {
      toast('Please enter a role name.', 'error', 'Missing name');
      return;
    }
    const perms = Object.keys(sel);
    if (!perms.length) {
      toast('Please select at least one permission.', 'error', 'Missing permissions');
      return;
    }
    // Persist to DB via RPC if Supabase is available.
    if (isSupabaseConfigured && supabase) {
      setSaving(true);
      const res = await createCustomRole(supabase, n, desc.trim() || 'Custom role with a tailored permission set.', perms);
      setSaving(false);
      if (!res.ok) {
        toast(errMsg2(res.error), 'error', 'Could not create role');
        return;
      }
      // Also add to local store for immediate UI feedback.
      ss.customRoles.push({ name: n, desc: desc.trim() || 'Custom role with a tailored permission set.', perms });
      closeModal();
      toast('Custom role "' + n + '" created with ' + perms.length + ' permissions.', 'success', 'Role created');
      notify();
      onCreated?.();
      return;
    }
    // Offline fallback — in-memory only.
    ss.customRoles.push({ name: n, desc: desc.trim() || 'Custom role with a tailored permission set.', perms });
    closeModal();
    toast('Custom role "' + n + '" created with ' + perms.length + ' permissions.', 'success', 'Role created');
    notify();
    onCreated?.();
  };
  return (
    <>
      <ModalHead title="Create Custom Role" onClose={closeModal} />
      <div className="modal-body">
        <div className="field">
          <label>Role Name</label>
          <input className="input" id="cr_name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sommelier" />
        </div>
        <div className="field">
          <label>Role Description</label>
          <input className="input" id="cr_desc" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Short description of this role" />
        </div>
        <div className="sec-title" style={{ margin: '2px 0 10px' }}>
          Permissions
        </div>
        <div id="cr-cats">
          <PermMatrix perms={Object.keys(sel)} editable onPerm={toggle} onCat={toggleCat} />
        </div>
      </div>
      <div className="modal-foot">
        <button className="btn btn-ghost" disabled={saving} onClick={closeModal}>
          Cancel
        </button>
        <button className="btn btn-primary" disabled={saving} onClick={create}>
          {saving ? 'Creating…' : 'Create Role'}
        </button>
      </div>
    </>
  );
}

export function MemberProfileDrawer({
  idx,
  roles,
  onChangeRole,
  canManage = true,
  onRoleChanged,
}: {
  idx: number;
  roles: { id: string; name: string }[];
  onChangeRole: (staffId: string, roleId: string) => Promise<{ ok: boolean; error?: ServiceError }>;
  canManage?: boolean;
  /** Refresh centralized identity after a role change (handles self-change). */
  onRoleChanged?: () => void;
}) {
  const { ss, notify, toast } = useStore();
  const [tab, setTab] = useState<'overview' | 'permissions' | 'access'>('overview');
  const m = memberByIdx(ss, idx);
  if (!m) return null;
  const pending = m.status === 'Pending';
  const banner = pending ? (
    <span className="pb-bearer">
      <i></i>
      {m.inv || 'Pending'}
    </span>
  ) : (
    <span className="pb-bearer" style={{ color: m.status === 'Active' ? '#9FD4AE' : '#F0A9A9' }}>
      <i></i>
      {m.status}
    </span>
  );
  const tl = (m.activity || []).map((a, k) => (
    <div key={k} className={'tl-item ' + (k === 0 ? 'now' : 'done')}>
      <div className="tl-dot">{k === 0 ? '\u25CF' : ''}</div>
      <div className="tl-body">
        <b>{a.t}</b>
        <span>{a.d}</span>
      </div>
    </div>
  ));
  const dots = m.status === 'Active' ? '#4E9A66' : m.status === 'Suspended' ? '#B95C5C' : '#D4AF6A';
  const resend = () => {
    m.sent = 'Just now';
    m.inv = 'Pending';
    m.status = 'Pending';
    ss.openMenu = -1;
    toast('Re-sent to ' + m.email + ' (recorded locally — email delivery is not wired up in this build).', 'info', 'Invitation updated');
    notify();
  };
  const body =
    tab === 'overview' ? (
      <>
        <div className="detail-grid">
          <div className="detail-item">
            <div className="k">Role</div>
            <div className="v">{m.role}</div>
          </div>
          <div className="detail-item">
            <div className="k">Status</div>
            <div className="v">{m.status}</div>
          </div>
          <div className="detail-item">
            <div className="k">Joined</div>
            <div className="v">{m.joined}</div>
          </div>
          <div className="detail-item">
            <div className="k">Last Active</div>
            <div className="v">{m.last}</div>
          </div>
        </div>
        <div className="sec-title">Activity</div>
        <div className="timeline">{tl.length ? tl : <div className="empty"><p>No recent activity</p></div>}</div>
      </>
    ) : tab === 'permissions' ? (
      <>
        <div className="inv-note" style={{ marginBottom: 14 }}>
          <Icon d={ICON.info} size={15} />
          <span>
            {m.name} inherits <b style={{ color: 'var(--gold-ink)' }}>{rolePerms(ss, m.role).length}</b> permissions
            from the {m.role} role.
          </span>
        </div>
        <PermMatrix perms={rolePerms(ss, m.role)} />
      </>
    ) : (
      <>
        <div className="inv-note" style={{ marginBottom: 14 }}>
          <Icon d={ICON.info} size={15} />
          <span>Role {m.role} can access these CRM modules in the sidebar.</span>
        </div>
        <NavAccess role={m.role} />
      </>
    );
  return (
    <>
      <div className="drawer-head">
        <div>
          <h3>Staff Profile</h3>
          <span className="num">{m.email}</span>
        </div>
        <CloseButton onClick={closeDrawer} />
      </div>
      <div className="drawer-body">
        <div className="prof-banner">
          <div className="pb-avatar" style={{ background: 'var(--gold)', color: 'var(--navy)' }}>
            <span className="sdot" style={{ background: dots }}></span>
            {initials(m.name)}
          </div>
          <div className="pb-main">
            <div className="pb-title">{m.name}</div>
            <div className="pb-pill">
              <i></i>
              {m.role}
            </div>
            <div className="pb-meta">
              <Icon d={ICON.calendar} size={13} strokeWidth={1.8} />
              Joined {m.joined === '—' ? 'Awaiting acceptance' : m.joined}
            </div>
          </div>
          {banner}
        </div>
        <div className="prof-tabs">
          <button className={'prof-tab' + (tab === 'overview' ? ' active' : '')} onClick={() => setTab('overview')}>
            Overview
          </button>
          <button className={'prof-tab' + (tab === 'permissions' ? ' active' : '')} onClick={() => setTab('permissions')}>
            Permissions
          </button>
          <button className={'prof-tab' + (tab === 'access' ? ' active' : '')} onClick={() => setTab('access')}>
            Access
          </button>
        </div>
        {body}
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          {!canManage ? (
            <div style={{ color: 'var(--muted)', fontSize: 12.5 }}>
              You have view-only access to team details. Contact an administrator to make changes.
            </div>
          ) : pending ? (
            <button
              className="btn btn-primary"
              style={{ width: '100%' }}
              onClick={() => {
                closeDrawer();
                resend();
              }}
            >
              Resend Invitation
            </button>
          ) : (
            <>
              <button
                className="btn btn-secondary"
                style={{ flex: 1 }}
                onClick={() => {
                  closeDrawer();
                  openModal(<PermissionsModal idx={idx} />);
                }}
              >
                Edit Permissions
              </button>
              <button
                className="btn btn-ghost"
                style={{ flex: '0 0 auto' }}
                onClick={() => {
                  closeDrawer();
                  openModal(<ChangeRoleModal idx={idx} roles={roles} onChangeRole={onChangeRole} onRoleChanged={onRoleChanged} />);
                }}
              >
                Change Role
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
}