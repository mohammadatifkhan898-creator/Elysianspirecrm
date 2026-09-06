import { useEffect } from 'react';
import type { ReactNode } from 'react';
import type { StaffMember, CustomRole } from '../types/staff';
import { PERM_CATS, ALL_PERMS, ROLE_NAV, ROLE_ALL_NAV } from '../data/seed';
import { ICON } from '../lib/svg';
import { memberByIdx } from '../lib/utils';
import { useStore } from '../store/store';
import { useStaff } from '../hooks/useStaff';
import { useIdentity } from '../hooks/useIdentity';
import { useSupabase } from '../lib/useSupabase';
import { updateCustomRole } from '../services/staff';
import { openModal, openDrawer, closeModal } from '../components/ui/Overlay';
import { Icon } from '../components/ui/Icon';
import { ReadOnlyNotice } from '../components/ui/ReadOnlyNotice';
import {
  allRoleNames,
  rolePerms,
  roleDesc,
  membersOf,
  RoleBadge,
  PermMatrix,
  EmptyState,
  Pager,
  MemberRow,
  type MemberActions,
} from './staff/parts';
import {
  ConfirmModal,
  InviteModal,
  ChangeRoleModal,
  PermissionsModal,
  CustomRoleModal,
  MemberProfileDrawer,
} from './staff/modals';

export default function StaffRoles() {
  const { ss, notify, toast } = useStore();
  const { status: loadStatus, roles: staffRoles, updateRole } = useStaff();
  const { hasAnyPermission, refresh: refreshIdentity } = useIdentity();
  const { supabase, isSupabaseConfigured } = useSupabase();
  const canManageStaff = hasAnyPermission('staff.manage');

  const isLoading = loadStatus === 'loading' || loadStatus === 'idle';
  const hasError = loadStatus === 'error';

  const ac = ss.members.filter((m) => m.status === 'Active').length;
  const pend = ss.members.filter((m) => m.status === 'Pending').length;
  const roles = new Set([...ss.members.map((m) => m.role), ...ss.customRoles.map((r) => r.name)]).size;

  const setFilter = (k: 'fRole' | 'fStatus' | 'sort', v: string) => {
    (ss as Record<'fRole' | 'fStatus' | 'sort', string>)[k] = v;
    ss.page = 1;
    ss.openMenu = -1;
    notify();
  };
  const setSearch = (v: string) => {
    ss.search = v;
    ss.page = 1;
    ss.openMenu = -1;
    notify();
  };
  const setPage = (p: number) => {
    ss.page = p;
    notify();
  };
  const toggleMenu = (i: number) => {
    ss.openMenu = ss.openMenu === i ? -1 : i;
    notify();
  };
  const showTab = (t: 'team' | 'roles') => {
    ss.tab = t;
    ss.selectedRole = 'Manager';
    notify();
  };
  const selectRole = (r: string) => {
    ss.selectedRole = r;
    ss.openMenu = -1;
    notify();
  };

  const selectedInfo = staffRoles.find((x) => x.name === ss.selectedRole);
  const selectedIsCustom = !!selectedInfo?.is_custom;

  /**
   * Persist a custom-role permission change. Optimistically updates the local
   * `ss.customRoles` replica (which the matrix renders), then writes through
   * update_custom_role; on failure the change is rolled back. System roles
   * are never mutated here — they are fixed by the database seed.
   */
  const persistPerms = async (apply: (r: CustomRole) => void) => {
    const info = staffRoles.find((x) => x.name === ss.selectedRole);
    const local = ss.customRoles.find((x) => x.name === ss.selectedRole);
    if (!info || !local) return;
    const before = local.perms.slice();
    apply(local);
    notify();
    if (!isSupabaseConfigured || !supabase) {
      toast('Saved locally (offline).', 'info', 'Permissions updated');
      return;
    }
    const res = await updateCustomRole(supabase, info.id, info.name, info.description ?? '', local.perms);
    if (!res.ok) {
      local.perms = before;
      notify();
      toast(res.error?.message ?? 'Could not save role.', 'error', 'Could not save role');
    } else {
      toast('Permission saved to the database.', 'success', 'Permissions updated');
    }
  };

  const togglePerm = async (p: string) => {
    const info = staffRoles.find((x) => x.name === ss.selectedRole);
    if (ss.selectedRole === 'Owner/Admin' || !info?.is_custom) return;
    await persistPerms((r) => {
      const i = r.perms.indexOf(p);
      if (i === -1) r.perms.push(p);
      else r.perms.splice(i, 1);
    });
  };

  const toggleCatAll = async (cat: string) => {
    const info = staffRoles.find((x) => x.name === ss.selectedRole);
    if (ss.selectedRole === 'Owner/Admin' || !info?.is_custom) return;
    const c = PERM_CATS.find((x) => x.cat === cat);
    if (!c) return;
    await persistPerms((r) => {
      const allIn = c.perms.every((p) => r.perms.indexOf(p) !== -1);
      r.perms = allIn
        ? r.perms.filter((p) => c.perms.indexOf(p) === -1)
        : r.perms.concat(c.perms.filter((p) => r.perms.indexOf(p) === -1));
    });
  };

  const openProfile = (i: number) =>
    openDrawer(
      <MemberProfileDrawer idx={i} roles={staffRoles} onChangeRole={updateRole} canManage={canManageStaff} onRoleChanged={refreshIdentity} />
    );
  const openChangeRole = (i: number) => openModal(<ChangeRoleModal idx={i} roles={staffRoles} onChangeRole={updateRole} onRoleChanged={refreshIdentity} />);
  const openPermissions = (i: number) => openModal(<PermissionsModal idx={i} />);
  const resend = (i: number) => {
    const m = memberByIdx(ss, i);
    if (!m) return;
    m.sent = 'Just now';
    m.inv = 'Pending';
    m.status = 'Pending';
    ss.openMenu = -1;
    toast('Re-sent to ' + m.email + ' (recorded locally — email delivery is not wired up in this build).', 'info', 'Invitation updated');
    notify();
  };
  const doSuspend = (i: number) => {
    const m = memberByIdx(ss, i);
    if (!m) return;
    m.status = 'Suspended';
    m.activity.unshift({ t: 'Account suspended', d: 'Just now' });
    closeModal();
    toast(m.name + ' has been suspended.', 'info', 'Staff suspended');
    notify();
  };
  const confirmSuspend = (i: number) => {
    const m = memberByIdx(ss, i);
    if (!m || m.status === 'Suspended') return;
    openModal(
      <ConfirmModal
        title={'Suspend ' + m.name + '?'}
        confirmLabel="Suspend Staff"
        onConfirm={() => doSuspend(i)}
        body={
          <p style={{ color: 'var(--charcoal)', fontSize: 14 }}>
            Suspending this team member will immediately pause their CRM access. They can be re-activated at any time.
          </p>
        }
      />
    );
  };
  const doRemove = (i: number) => {
    const m = memberByIdx(ss, i);
    if (!m) return;
    ss.members.splice(i, 1);
    closeModal();
    toast(m.name + ' was removed from the team.', 'info', 'Member removed');
    notify();
  };
  const confirmRemove = (i: number) => {
    const m = memberByIdx(ss, i);
    if (!m) return;
    openModal(
      <ConfirmModal
        title={'Remove ' + m.name + '?'}
        confirmLabel="Remove Staff"
        onConfirm={() => doRemove(i)}
        body={
          <div className="inv-note">
            <Icon d={ICON.info} size={15} />
            <span>
              Removing this team member will revoke their access to <b style={{ color: 'var(--navy)' }}>Elysian Spire
              CRM</b>. This cannot be undone.
            </span>
          </div>
        }
      />
    );
  };
  const doRevoke = (i: number) => {
    const m = memberByIdx(ss, i);
    if (!m) return;
    m.inv = 'Revoked';
    m.activity.unshift({ t: 'Invitation revoked', d: 'Just now' });
    closeModal();
    toast('Invitation to ' + m.email + ' was revoked.', 'info', 'Invitation revoked');
    notify();
  };
  const confirmRevoke = (i: number) => {
    const m = memberByIdx(ss, i);
    if (!m) return;
    openModal(
      <ConfirmModal
        title={'Revoke invitation for ' + m.name + '?'}
        confirmLabel="Revoke Invitation"
        onConfirm={() => doRevoke(i)}
        body={
          <p style={{ color: 'var(--charcoal)', fontSize: 14 }}>
            This will cancel the pending invitation and revoke the sign-in link sent to <b>{m.email}</b>.
          </p>
        }
      />
    );
  };

  useEffect(() => {
    const onDocClick = () => {
      if (ss.openMenu !== -1) {
        ss.openMenu = -1;
        notify();
      }
    };
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const actions: MemberActions = {
    view: openProfile,
    role: openChangeRole,
    perms: openPermissions,
    suspend: confirmSuspend,
    remove: confirmRemove,
    resend,
    revoke: confirmRevoke,
  };

  const filtered = ss.members.filter((m) => {
    const hit = !ss.search || (m.name + ' ' + m.email + ' ' + m.role).toLowerCase().indexOf(ss.search.toLowerCase()) !== -1;
    return hit && (!ss.fRole || m.role === ss.fRole) && (!ss.fStatus || m.status === ss.fStatus);
  });
  const keyOf =
    ss.sort === 'role'
      ? (m: StaffMember) => m.role
      : ss.sort === 'joined'
        ? (m: StaffMember) => (m.joined === '—' ? 0 : m.joined)
        : (m: StaffMember) => m.name;
  filtered.sort((a, b) => String(keyOf(a)).localeCompare(String(keyOf(b))));

  const pages = Math.max(1, Math.ceil(filtered.length / ss.perPage));
  const page = Math.min(ss.page, pages);
  const start = (page - 1) * ss.perPage;
  const rows = filtered.slice(start, start + ss.perPage);
  const noPend = ss.fStatus === 'Pending' && filtered.length === 0;

  let emptyState: ReactNode = null;
  if (noPend) {
    emptyState = (
      <EmptyState
        title="No pending invitations"
        sub="There are no pending invitations matching this filter. Invite a new team member to get started."
        kind="inv"
      />
    );
  } else if (!rows.length) {
    emptyState =
      ss.search || ss.fRole || ss.fStatus ? (
        <EmptyState
          title="No staff match"
          sub="No team members match your search or filters. Try adjusting them."
          kind="search"
        />
      ) : (
        <EmptyState title="No staff members" sub="Invite your first team member to start building your team." kind="team" />
      );
  }

  const teamView = (
    <>
      <div className="toolbar">
        <div className="search">
          <Icon d={ICON.search} size={16} strokeWidth={1.8} />
          <input
            className="input"
            id="st-search"
            value={ss.search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, email or role…"
          />
        </div>
        <div className="ctl">
          <span className="lb">Role</span>
          <div className="select-wrap">
            <select className="input" id="st-role" value={ss.fRole} onChange={(e) => setFilter('fRole', e.target.value)}>
              <option value="">All roles</option>
              {allRoleNames(ss, staffRoles).map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="ctl">
          <span className="lb">Status</span>
          <div className="select-wrap">
            <select className="input" id="st-status" value={ss.fStatus} onChange={(e) => setFilter('fStatus', e.target.value)}>
              <option value="">All statuses</option>
              {['Active', 'Pending', 'Suspended'].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="ctl">
          <span className="lb">Sort</span>
          <div className="select-wrap">
            <select className="input" id="st-sort" value={ss.sort} onChange={(e) => setFilter('sort', e.target.value)}>
              <option value="name">Name</option>
              <option value="role">Role</option>
              <option value="joined">Joined</option>
            </select>
          </div>
        </div>
        <div style={{ flex: 1 }}></div>
        <span className="lb num" style={{ whiteSpace: 'nowrap' }}>
          {ss.members.length} members
        </span>
      </div>
      {emptyState}
      <div className="card" style={{ display: noPend || !rows.length ? 'none' : undefined }}>
        <div className="tbl-wrap members-wrap">
          <table className="tbl members-tbl">
            <thead>
              <tr>
                <th style={{ width: '34%' }}>Staff Member</th>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
                <th>Last Active</th>
                <th>Joined</th>
                <th className="t-right">Actions</th>
              </tr>
            </thead>
            <tbody id="members-body">
              {rows.map((m) => {
                const i = ss.members.indexOf(m);
                return (
                  <MemberRow
                    key={i}
                    m={m}
                    i={i}
                    menuOpen={ss.openMenu === i}
                    actions={actions}
                    canManage={canManageStaff}
                    onRow={() => openProfile(i)}
                    onKebab={() => toggleMenu(i)}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
        {pages > 1 ? <Pager pages={pages} page={page} perPage={ss.perPage} total={filtered.length} onPage={setPage} /> : null}
      </div>
    </>
  );

  const rolesView = (
    <>
      <div className="sec-title" style={{ marginTop: 0 }}>
        Role overview
      </div>
      <div className="role-grid">
        {allRoleNames(ss, staffRoles).map((r) => {
          const sel = r === ss.selectedRole;
          const count = r === 'Owner/Admin' ? 1 : membersOf(ss, r);
          return (
            <div
              key={r}
              data-od-id={'role-' + r.toLowerCase().replace(' ', '-')}
              className={'role-card' + (sel ? ' selected' : '')}
              onClick={() => selectRole(r)}
            >
              <div className="rc-head">
                <RoleBadge role={r} />
              </div>
              <div className="rc-name">{r}</div>
              <div className="rc-desc">{roleDesc(ss, r)}</div>
              <div className="rc-meta">
                <div className="rc-stat">
                  <b className="num">{rolePerms(ss, r).length}</b>
                  <span>Permissions</span>
                </div>
                <div className="rc-stat">
                  <b className="num">{count}</b>
                  <span>{count === 1 ? 'Member' : 'Members'}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="card card-pad" style={{ marginTop: 24 }}>
        <div className="open-role" style={{ marginBottom: 16 }}>
          <span className="lb">Editing permissions for</span>
          <RoleBadge role={ss.selectedRole} />
          <div style={{ flex: 1 }}></div>
          {canManageStaff ? (
            <button className="btn btn-ghost btn-sm" onClick={() => openModal(<CustomRoleModal onCreated={notify} />)}>
              + Create Custom Role
            </button>
          ) : null}
          <span className="pc-count">
            {rolePerms(ss, ss.selectedRole).length} of {ALL_PERMS.length} permissions
          </span>
        </div>
        {canManageStaff && !selectedIsCustom ? (
          <div className="inv-note" style={{ marginBottom: 14 }}>
            <Icon d={ICON.info} size={15} />
            <span>
              System roles are fixed by the database seed, so this matrix is read-only. Create a custom role to tailor a
              permission set.
            </span>
          </div>
        ) : null}
        <PermMatrix
          perms={rolePerms(ss, ss.selectedRole)}
          editable={canManageStaff && selectedIsCustom}
          onPerm={togglePerm}
          onCat={toggleCatAll}
        />
      </div>

      <div className="card card-pad" style={{ marginTop: 20 }}>
        <div className="card-title" style={{ marginBottom: 4 }}>
          Sidebar access by role
        </div>
        <div className="card-sub" style={{ marginBottom: 14 }}>
          When a staff member signs in, the CRM navigation updates automatically to match their role. Dashed items are
          hidden.
        </div>
        <div className="access-panel">
          {Object.keys(ROLE_NAV).map((k) => (
            <div className="na-row" key={k}>
              <div className="na-role">
                <b style={{ fontSize: 13, color: 'var(--navy)' }}>{k}</b>
                <span className="num" style={{ fontSize: 11, color: 'var(--gold-ink)' }}>
                  {ROLE_NAV[k].length} modules
                </span>
              </div>
              <div className="na-modules">
                {ROLE_ALL_NAV.map((x) => (
                  <span key={x} className={'na-mod' + (ROLE_NAV[k].indexOf(x) === -1 ? ' hidden' : '')}>
                    {x}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div style={{ height: 8 }}></div>
    </>
  );

  if (isLoading) {
    return (
      <>
        <div className="page-head">
          <div>
            <div className="page-title">Staff &amp; Roles</div>
            <div className="page-sub">Loading team members…</div>
          </div>
        </div>
        <div style={{ color: 'var(--muted)', display: 'grid', placeItems: 'center', padding: 60, fontSize: 14 }}>
          Loading staff…
        </div>
      </>
    );
  }

  if (hasError) {
    return (
      <>
        <div className="page-head">
          <div>
            <div className="page-title">Staff &amp; Roles</div>
            <div className="page-sub">Could not load the team.</div>
          </div>
        </div>
        <div style={{ color: 'var(--error)', display: 'grid', placeItems: 'center', padding: 60, fontSize: 14 }}>
          Could not load the staff list.
        </div>
      </>
    );
  }

  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-title">Staff &amp; Roles</div>
          <div className="page-sub">Manage your team members, roles, and access permissions.</div>
        </div>
        <div className="page-actions">
          {canManageStaff ? (
            <button className="btn btn-primary" onClick={() => openModal(<InviteModal dbRoles={staffRoles} />)}>
              <Icon d={ICON.plus} size={16} strokeWidth={2} />
              Invite Staff
            </button>
          ) : null}
        </div>
      </div>
      {!canManageStaff ? (
        <ReadOnlyNotice>You can view staff and roles, but you don&rsquo;t have permission to invite, edit, or remove team members.</ReadOnlyNotice>
      ) : null}
      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(4,1fr)' }} data-od-id="staff-summary">
        <div className="kpi">
          <div className="k-label">
            <span className="k-icon">
              <Icon d={ICON.user} size={15} />
            </span>
            Total Staff
          </div>
          <div className="k-value num">{ss.members.length}</div>
          <div className="k-delta mut">Across {roles} roles</div>
        </div>
        <div className="kpi">
          <div className="k-label">
            <span className="k-icon">
              <Icon d={ICON.user} size={15} />
            </span>
            Active Staff
          </div>
          <div className="k-value num">{ac}</div>
          <div className="k-delta up">On the floor now</div>
        </div>
        <div className="kpi">
          <div className="k-label">
            <span className="k-icon">
              <Icon d={ICON.calendar} size={15} />
            </span>
            Pending Invitations
          </div>
          <div className="k-value num">{pend}</div>
          <div className={'k-delta' + (pend ? '' : ' mut')}>{pend ? 'Awaiting acceptance' : 'None outstanding'}</div>
        </div>
        <div className="kpi">
          <div className="k-label">
            <span className="k-icon">
              <Icon d="<circle cx='12' cy='12' r='3'/><path d='M12 3v3M12 18v3M3 12h3M18 12h3'/>" size={15} />
            </span>
            Roles
          </div>
          <div className="k-value num">{roles}</div>
          <div className="k-delta mut">{staffRoles.length + ss.customRoles.length} defined</div>
        </div>
      </div>
      <div className="sub-tabs" data-od-id="staff-subtabs">
        <button className={'sub-tab' + (ss.tab === 'team' ? ' active' : '')} onClick={() => showTab('team')}>
          Team Members<span className="cnt">{ss.members.length}</span>
        </button>
        <button className={'sub-tab' + (ss.tab === 'roles' ? ' active' : '')} onClick={() => showTab('roles')}>
          Roles &amp; Permissions<span className="cnt">{staffRoles.length + ss.customRoles.length}</span>
        </button>
      </div>
      <div id="staff-tab-body">{ss.tab === 'roles' ? rolesView : teamView}</div>
    </>
  );
}