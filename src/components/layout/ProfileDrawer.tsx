import { getS } from '../../store/store';
import { closeDrawer } from '../ui/Overlay';
import { Icon } from '../ui/Icon';
import { ICON } from '../../lib/svg';
import { rolePermCount } from '../../data/seed';

/* ═══════════════════════════════════════════════════════════════
   Profile drawer content — ported from `openProfile()` in app.js.
   Now uses centralized identity from s.identity for consistent
   role display across all views.
   ═══════════════════════════════════════════════════════════════ */

export function ProfileDrawerBody({ onEditAccount, onLogout }: { onEditAccount: () => void; onLogout: () => void }) {
  const s = getS();
  const identity = s.identity;
  const nm = identity?.fullName || s.user?.name || 'Admin';
  const em = identity?.email || s.user?.email || '';
  const init = (nm || 'A')
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  const tbls = s.tables ? s.tables.length : 0;
  const team = s.staff ? s.staff.length : 0;
  const permCount = identity ? rolePermCount(identity.permissions) : 0;
  const joinedDate = identity ? 'Active member' : '—';

  return (
    <>
      <div className="drawer-head">
        <div>
          <h3>Profile</h3>
          <span className="num">Account overview</span>
        </div>
        <button className="icon-btn" onClick={closeDrawer} aria-label="Close">
          <Icon d={ICON.close} strokeWidth={1.8} />
        </button>
      </div>
      <div className="drawer-body">
        <div className="prof-banner">
          <div className="pb-avatar">
            <span className="sdot"></span>
            {init}
          </div>
          <div className="pb-main">
            <div className="pb-title">{nm}</div>
            <div className="pb-pill">
              <i></i>{identity?.roleName ?? 'Staff'}
            </div>
            <div className="pb-meta">
              <Icon d={ICON.calendar} size={13} strokeWidth={1.8} />
              {joinedDate}
            </div>
          </div>
          <span className="pb-bearer">
            <i></i>Active
          </span>
        </div>

        <div className="prof-stats">
          <div className="pstat">
            <div className="pv num">{tbls}</div>
            <div className="pk">Tables managed</div>
          </div>
          <div className="pstat">
            <div className="pv num">{team}</div>
            <div className="pk">Team members</div>
          </div>
          <div className="pstat">
            <div className="pv num">{permCount}</div>
            <div className="pk">Permissions</div>
          </div>
        </div>

        <div className="sec-title">Account details</div>
        <div className="detail-grid">
          <div className="detail-item">
            <div className="k">Email</div>
            <div className="v">{em || '—'}</div>
          </div>
          <div className="detail-item">
            <div className="k">Role</div>
            <div className="v">{identity?.roleName ?? '—'}</div>
          </div>
          <div className="detail-item">
            <div className="k">Restaurant</div>
            <div className="v">Elysian Spire</div>
          </div>
          <div className="detail-item">
            <div className="k">Access level</div>
            <div className="v">{permCount} permission{permCount !== 1 ? 's' : ''}</div>
          </div>
        </div>

        <div className="prof-actions">
          <button className="btn btn-secondary" onClick={onEditAccount}>
            <Icon d={ICON.edit} strokeWidth={1.8} />
            Edit account
          </button>
          <button className="btn btn-ghost danger" onClick={onLogout}>
            <Icon d={ICON.logout} strokeWidth={1.8} />
            Sign out
          </button>
        </div>
      </div>
    </>
  );
}
