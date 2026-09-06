import { useNavigate } from 'react-router-dom';
import { Icon } from '../ui/Icon';
import { ICON } from '../../lib/svg';
import { BrandLockup } from '../ui/BrandLockup';
import { useStore } from '../../store/store';

/* ═══════════════════════════════════════════════════════════════
   Sidebar — navigation for every authenticated staff role. All nine
   sections are always visible: visibility follows authentication, not
   permissions. Fine-grained permissions gate actions inside the pages
   (via the page hooks), never the nav itself.
   ═══════════════════════════════════════════════════════════════ */

interface SidebarProps {
  active: string;
  onNavigate: () => void;
  sidebarOpen: boolean;
  scrimOpen: boolean;
  closeMobile: () => void;
  onOpenProfile: () => void;
  onLogout: () => void;
}

export function Sidebar({ active, onNavigate, sidebarOpen, scrimOpen, closeMobile, onOpenProfile, onLogout }: SidebarProps) {
  const { s } = useStore();
  const navigate = useNavigate();

  const pendingRes = s.reservations.filter((r) => r.status === 'Pending').length;

  const go = (path: string) => {
    navigate(path);
    onNavigate();
    closeMobile();
  };

  const sections: { section: string; items: { key: string; label: string; icon: string; path: string; badge?: number }[] }[] = [
    {
      section: 'Operations',
      items: [
        { key: 'dashboard', label: 'Dashboard', icon: ICON.home, path: '/dashboard' },
        { key: 'orders', label: 'Orders', icon: ICON.bag, path: '/orders', badge: s.orders.length },
        { key: 'reservations', label: 'Reservations', icon: ICON.resv, path: '/reservations', badge: pendingRes },
        { key: 'tables', label: 'Tables', icon: ICON.table, path: '/tables' },
        { key: 'customers', label: 'Customers', icon: ICON.users, path: '/customers' },
        { key: 'menu', label: 'Menu', icon: ICON.menu, path: '/menu' },
        { key: 'staff', label: 'Staff & Roles', icon: ICON.user, path: '/staff' },
      ],
    },
    {
      section: 'Insights',
      items: [{ key: 'reports', label: 'Reports', icon: ICON.report, path: '/reports' }],
    },
    {
      section: 'System',
      items: [{ key: 'settings', label: 'Settings', icon: ICON.settings, path: '/settings' }],
    },
  ];

  return (
    <>
      <aside className={'sidebar' + (sidebarOpen ? ' open' : '')} id="sidebar">
        <div className="sidebar-brand">
          <BrandLockup variant="vertical" tone="dark" iconSize={48} />
        </div>
        <nav className="side-nav">
          {sections.map((grp) => (
            <div key={grp.section}>
              <div className="nav-section">{grp.section}</div>
              {grp.items.map((it) => (
                <a
                  key={it.key}
                  className={'nav-item' + (active === it.key ? ' active' : '')}
                  href={'#' + it.path}
                  onClick={(e) => {
                    e.preventDefault();
                    go(it.path);
                  }}
                >
                  <Icon d={it.icon} />
                  {it.label}
                  {it.badge != null && it.badge > 0 ? <span className="nav-badge">{it.badge}</span> : null}
                </a>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-foot">
          <a
            className="nav-item"
            href="#profile"
            onClick={(e) => {
              e.preventDefault();
              onOpenProfile();
            }}
          >
            <Icon d={ICON.user} />
            User Profile
          </a>
          <a
            className="nav-item logout"
            href="#logout"
            onClick={(e) => {
              e.preventDefault();
              onLogout();
            }}
          >
            <Icon d={ICON.logout} />
            Log out
          </a>
        </div>
      </aside>
      <div className={'scrim' + (scrimOpen ? ' open' : '')} onClick={closeMobile}></div>
    </>
  );
}
