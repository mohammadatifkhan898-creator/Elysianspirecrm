import type { StaffMember, StaffState } from '../../types/staff';
import {
  PERM_CATS,
  ALL_PERMS,
  ROLE_PERMS,
  ROLE_DESC,
  ROLE_NAV,
  ROLE_ALL_NAV,
} from '../../data/seed';
import { ICON } from '../../lib/svg';
import { initials } from '../../lib/utils';
import { Icon } from '../../components/ui/Icon';

export function rolePerms(ss: StaffState, role: string): string[] {
  if (ROLE_PERMS[role]) return ROLE_PERMS[role];
  const c = ss.customRoles.find((r) => r.name === role);
  return c ? c.perms : ALL_PERMS.slice();
}

/** Canonical DB role name → CSS class key. */
const ROLE_KEY_MAP: Record<string, string> = {
  'Owner/Admin': 'admin',
  'Manager': 'manager',
  'Waiter': 'waiter',
  'Chef': 'chef',
  'Cashier': 'cashier',
  'Inventory Manager': 'inventory-manager',
  'Host/Hostess': 'host-hostess',
  'Kitchen Staff': 'kitchen-staff',
};

export function allRoleNames(ss: StaffState, dbRoles: { id: string; name: string }[]): string[] {
  const names = dbRoles.map((r) => r.name);
  for (const r of ss.customRoles) {
    if (!names.includes(r.name)) names.push(r.name);
  }
  return names;
}

export function roleDesc(ss: StaffState, r: string): string {
  const cr = ss.customRoles.find((c) => c.name === r);
  return ROLE_DESC[r] || (cr ? cr.desc : 'Custom role with a tailored permission set.');
}

export function membersOf(ss: StaffState, role: string): number {
  return ss.members.filter((m) => m.role === role).length;
}

export function findRole(ss: StaffState, name: string) {
  return ss.customRoles.find((r) => r.name === name);
}

function roleKey(role: string): string {
  return ROLE_KEY_MAP[role] || 'custom';
}

export function permChips(perms: string[]) {
  return (
    <>
      {perms.slice(0, 8).map((p) => (
        <span key={p} className="role-badge role-waiter" style={{ background: 'var(--gold-soft)', color: 'var(--gold-ink)' }}>
          <i style={{ background: 'var(--gold)' }}></i>
          {p}
        </span>
      ))}
      {perms.length > 8 ? <span className="role-badge role-custom">+{perms.length - 8} more</span> : null}
    </>
  );
}

export function RoleBadge({ role }: { role: string }) {
  return (
    <span className={'role-badge role-' + roleKey(role)}>
      <i></i>
      {role}
    </span>
  );
}

function InvBadge({ st }: { st: string }) {
  const c = st === 'Pending' ? 'inv-pending' : st === 'Accepted' ? 'inv-accepted' : st === 'Expired' ? 'inv-expired' : 'inv-revoked';
  return (
    <span className={'inv-state ' + c}>
      <i></i>
      {st}
    </span>
  );
}

function StatusPill({ m }: { m: StaffMember }) {
  if (m.status === 'Pending') {
    return (
      <span className="inv-state inv-pending">
        <i></i>Pending
      </span>
    );
  }
  if (m.status === 'Active') {
    return (
      <span className="status-pill" style={{ color: 'var(--success)', background: 'var(--success-bg)' }}>
        <i></i>Active
      </span>
    );
  }
  return (
    <span className="status-pill" style={{ color: 'var(--error)', background: 'var(--error-bg)' }}>
      <i></i>Suspended
    </span>
  );
}

export function EmptyState({ title, sub, kind }: { title: string; sub: string; kind: 'search' | 'inv' | 'team' }) {
  const icons: Record<string, string> = { search: ICON.search, inv: ICON.calendar, team: ICON.user };
  return (
    <div className="empty" data-od-id={'staff-empty-' + kind}>
      <div className="e-ic">
        <Icon d={icons[kind] || icons.team} size={26} strokeWidth={1.6} />
      </div>
      <b>{title}</b>
      <p>{sub}</p>
    </div>
  );
}

export function Pager({
  pages,
  page,
  perPage,
  total,
  onPage,
}: {
  pages: number;
  page: number;
  perPage: number;
  total: number;
  onPage: (n: number) => void;
}) {
  return (
    <div className="paging">
      <span className="pinfo">
        Showing <b>{(page - 1) * perPage + 1}</b>–<b>{Math.min(page * perPage, total)}</b> of <b>{total}</b>
      </span>
      <div className="pages">
        {Array.from({ length: pages }, (_, i) => i + 1).map((n) => (
          <button key={n} className={'page-btn' + (n === page ? ' active' : '')} onClick={() => onPage(n)}>
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}

export function PermMatrix({
  perms,
  editable,
  onPerm,
  onCat,
}: {
  perms: string[];
  editable?: boolean;
  onPerm?: (p: string) => void;
  onCat?: (cat: string) => void;
}) {
  const has = (p: string) => perms.indexOf(p) !== -1;
  return (
    <>
      {PERM_CATS.map((c) => {
        const cnt = c.perms.filter(has).length;
        return (
          <div className="perm-cat" key={c.cat}>
            <div className="pc-head">
              <div className="pc-title">{c.cat}</div>
              <div className="pc-actions">
                {editable && onCat ? (
                  <span className="pc-select" onClick={() => onCat(c.cat)}>
                    {cnt === c.perms.length ? 'Clear all' : 'Select all'}
                  </span>
                ) : null}
                <span className="pc-count">
                  {cnt}/{c.perms.length}
                </span>
              </div>
            </div>
            <div className="pc-body">
              {c.perms.map((p) => (
                <span
                  key={p}
                  className={'perm-check' + (has(p) ? ' checked' : '')}
                  onClick={editable && onPerm ? () => onPerm(p) : undefined}
                >
                  <span className="cb">
                    <svg viewBox="0 0 24 24" fill="currentColor">
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                  </span>
                  <span>{p}</span>
                </span>
              ))}
            </div>
          </div>
        );
      })}
    </>
  );
}

export function NavAccess({ role }: { role: string }) {
  const navs = ROLE_NAV[role] || ROLE_NAV['Waiter'];
  return (
    <div className="na-modules">
      {ROLE_ALL_NAV.map((x) => (
        <span key={x} className={'na-mod' + (navs.indexOf(x) === -1 ? ' hidden' : '')}>
          {x}
        </span>
      ))}
    </div>
  );
}

export interface MemberActions {
  view: (i: number) => void;
  role: (i: number) => void;
  perms: (i: number) => void;
  suspend: (i: number) => void;
  remove: (i: number) => void;
  resend: (i: number) => void;
  revoke: (i: number) => void;
}

function MemberMenu({
  m: member,
  i,
  actions,
  canManage,
}: {
  m: StaffMember;
  i: number;
  actions: MemberActions;
  canManage: boolean;
}) {
  const pending = member.status === 'Pending';
  const item = (label: string, icon: string, action: () => void, cls?: string) => (
    <button
      key={label}
      className={'m-item' + (cls ? ' ' + cls : '')}
      onClick={(e) => {
        e.stopPropagation();
        action();
      }}
    >
      <Icon d={icon} size={16} />
      {label}
    </button>
  );
  if (!canManage) {
    return (
      <div className="menu-pop">{item('View Profile', ICON.user, () => actions.view(i))}</div>
    );
  }
  return (
    <div className="menu-pop">
      {pending ? (
        <>
          {item('Resend Invitation', ICON.refresh, () => actions.resend(i))}
          {item('Revoke Invitation', ICON.slash, () => actions.revoke(i), 'danger')}
        </>
      ) : (
        <>
          {item('View Profile', ICON.user, () => actions.view(i))}
          {item('Change Role', ICON.layers, () => actions.role(i))}
          {item('Edit Permissions', ICON.shield, () => actions.perms(i))}
          <div className="m-sep" />
          {item(
            member.status === 'Suspended' ? 'Suspended' : 'Suspend',
            ICON.pause,
            () => actions.suspend(i),
            member.status === 'Suspended' ? 'disabled' : undefined
          )}
          {item('Remove', ICON.trash, () => actions.remove(i), 'danger')}
        </>
      )}
    </div>
  );
}

export function MemberRow({
  m: member,
  i,
  menuOpen,
  actions,
  canManage,
  onRow,
  onKebab,
}: {
  m: StaffMember;
  i: number;
  menuOpen: boolean;
  actions: MemberActions;
  canManage: boolean;
  onRow: () => void;
  onKebab: () => void;
}) {
  const inv = member.inv ? (
    <div style={{ marginTop: 4 }}>
      <InvBadge st={member.inv} />
    </div>
  ) : null;
  const roleColor =
    i % 2
      ? { background: 'var(--gold)', color: 'var(--navy)' }
      : { background: 'var(--navy)', color: 'var(--gold)' };
  const pending = member.status === 'Pending';
  return (
    <tr className="row-click" onClick={onRow}>
      <td>
        <div className="staff-cell">
          <div className="av" style={roleColor}>
            {initials(member.name)}
          </div>
          <div>
            <div className="s-name">{member.name}</div>
            <div className="s-sub">Member ID · #{1000 + i}</div>
          </div>
        </div>
      </td>
      <td data-label="Email" style={{ color: 'var(--muted)' }}>
        {member.email}
        {inv}
      </td>
      <td data-label="Role">
        <RoleBadge role={member.role} />
      </td>
      <td data-label="Status">
        <StatusPill m={member} />
      </td>
      <td data-label="Last Active">
        {pending ? (
          <span className="num" style={{ color: 'var(--muted)' }}>
            Awaiting response
          </span>
        ) : (
          <span className="num" style={{ color: 'var(--muted)' }}>
            {member.last}
          </span>
        )}
      </td>
      <td data-label="Joined">
        <span className="num" style={{ color: 'var(--muted)' }}>
          {member.joined}
        </span>
      </td>
      <td data-hide="" data-label="Actions" className="t-right">
        <div className="kebab-wrap">
          <button
            className="kebab"
            aria-label="Actions"
            onClick={(e) => {
              e.stopPropagation();
              onKebab();
            }}
          >
            <svg viewBox="0 0 24 24" fill="currentColor">
              <circle cx="12" cy="5" r="1.6" />
              <circle cx="12" cy="12" r="1.6" />
              <circle cx="12" cy="19" r="1.6" />
            </svg>
          </button>
          {menuOpen ? <MemberMenu m={member} i={i} actions={actions} canManage={canManage} /> : null}
        </div>
      </td>
    </tr>
  );
}