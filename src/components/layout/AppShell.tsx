import { useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@clerk/react';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { openDrawer, closeDrawer } from '../ui/Overlay';
import { ProfileDrawerBody } from './ProfileDrawer';
import { NotificationsDrawerBody } from './NotificationsDrawer';
import { useStore, toast } from '../../store/store';
import { sidebarKeyFromPath, ROUTES } from '../../routing/routes';
import { useNotifications } from '../../hooks/useNotifications';
import { useIdentity } from '../../hooks/useIdentity';

/* ═══════════════════════════════════════════════════════════════
   App shell — the authenticated layout (sidebar + topbar + routed
   content), plus mobile nav scrim. Real notifications hydrate the
   topbar badge via useNotifications (no fabricated realtime ticker).
   ═══════════════════════════════════════════════════════════════ */

export function AppShell() {
  const { s, notify } = useStore();
  const location = useLocation();
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  // Centralized identity: single source of truth for role/permissions.
  // The hook populates s.identity; Topbar/Sidebar/ProfileDrawer read it.
  useIdentity();

  // Real notification data for the always-present topbar unread badge.
  useNotifications();

  const openNotif = () => {
    openDrawer(<NotificationsDrawerBody />);
    const bell = document.getElementById('notifTopBtn');
    if (bell) {
      bell.classList.remove('bell-shake');
      void bell.offsetWidth;
      bell.classList.add('bell-shake');
    }
  };

  const openProfile = () => {
    openDrawer(
      <ProfileDrawerBody
        onEditAccount={() => {
          closeDrawer();
          navigate(ROUTES.settings);
        }}
        onLogout={() => {
          closeDrawer();
          doLogout();
        }}
      />
    );
  };

  const doLogout = async () => {
    // Clear the local UI mirror immediately, then let Clerk end the session.
    s.user = null;
    notify();
    toast('You have been signed out safely.', 'info', 'Signed out');
    await signOut();
    navigate(ROUTES.login, { replace: true });
  };

  const onNavigate = () => setMobileOpen(false);

  const activeKey = sidebarKeyFromPath(location.pathname);

  return (
    <div className="app" style={{ display: 'flex' }}>
      <Sidebar
        active={activeKey}
        onNavigate={onNavigate}
        sidebarOpen={mobileOpen}
        scrimOpen={mobileOpen}
        closeMobile={() => setMobileOpen(false)}
        onOpenProfile={openProfile}
        onLogout={doLogout}
      />
      <div className="main">
        <Topbar
          active={activeKey}
          menuBtn={() => setMobileOpen(true)}
          notifBtn={openNotif}
          userChip={openProfile}
        />
        <main className="content" id="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
