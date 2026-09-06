import { TITLES } from '../../data/seed';
import { useStore } from '../../store/store';
import { Icon } from '../ui/Icon';
import { ICON } from '../../lib/svg';
import { BrandLogo } from '../ui/BrandLogo';
import { todayKolkataISO, formatISODate } from '../../lib/dates';

/* ═══════════════════════════════════════════════════════════════
   Topbar — ported verbatim from the vanilla `#topbar`.
   The date label is the true "today" in Asia/Kolkata (see lib/dates),
   not a hardcoded string.
   ═══════════════════════════════════════════════════════════════ */

interface TopbarProps {
  active: string;
  menuBtn: () => void;
  notifBtn: () => void;
  userChip: () => void;
}

export function Topbar({ active, menuBtn, notifBtn, userChip }: TopbarProps) {
  const { s } = useStore();
  const unread = s.notifications.filter((n) => !n.read).length;
  const firstName = s.user ? s.user.name.split(' ')[0] : 'Admin';
  const initials = (s.user?.name || 'AR')
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  const roleLabel = s.identity?.roleName ?? 'Restaurant Staff';

  const dateLabel = formatISODate(todayKolkataISO());

  return (
    <header className="topbar">
      <button className="icon-btn menu-btn" onClick={menuBtn} aria-label="Open menu">
        <Icon d={ICON.hamburger} strokeWidth={1.8} />
      </button>
      <BrandLogo size={28} className="topbar-logo" />
      <div className="topbar-title">{TITLES[active] || 'Dashboard'}</div>
      <div className="topbar-right">
        <div className="date-picker">
          <Icon d={ICON.calendar} size={15} />
          <span id="dateLabel">{dateLabel}</span>
        </div>
        <button className="icon-btn ring" onClick={notifBtn} aria-label="Notifications">
          <span className={'badge-dot' + (unread ? ' pulse' : '')} style={unread ? { display: 'block' } : { display: 'none' }}></span>
          <Icon d={ICON.bell} />
        </button>
        <button className="user-chip" onClick={userChip}>
          <div className="avatar">
            <span className="sdot"></span>
            {initials}
          </div>
          <div className="who">
            <b id="userName">{firstName}</b>
            <span className="role">
              <i></i>{roleLabel}
            </span>
          </div>
          <Icon className="chev" d={ICON.chevronDown} size={15} strokeWidth={2} />
        </button>
      </div>
    </header>
  );
}
