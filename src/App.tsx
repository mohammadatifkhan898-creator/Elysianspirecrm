import { useEffect } from 'react';
import { HashRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { useAuth, useUser } from '@clerk/react';
import { BrandLogo } from './components/ui/BrandLogo';
import { AppProvider, useStore } from './store/store';
import { OverlayHost } from './components/ui/Overlay';
import { AppShell } from './components/layout/AppShell';
import { ROUTES } from './routing/routes';
import { Login } from './pages/auth/Login';
import { Signup } from './pages/auth/Signup';
import { Forgot } from './pages/auth/Forgot';
import { SsoCallback } from './pages/auth/SsoCallback';
import { Onboarding } from './pages/auth/Onboarding';
import { SessionGate } from './components/auth/SessionGate';
import { DevSupabaseCheck } from './components/dev/DevSupabaseCheck';
import Dashboard from './pages/Dashboard';
import Orders from './pages/Orders';
import Reservations from './pages/Reservations';
import Tables from './pages/Tables';
import Customers from './pages/Customers';
import Menu from './pages/Menu';
import StaffRoles from './pages/StaffRoles';
import Reports from './pages/Reports';
import Settings from './pages/Settings';

/* ═══════════════════════════════════════════════════════════════
   App — router + auth gate. The root URL opens the CRM directly.

   Clerk is the single auth authority. Route guards read Clerk auth state
   (useAuth) and wait for `isLoaded` before deciding, so a refresh never
   flashes the app or bounces the user early. `s.user` is a derived UI
   mirror hydrated from the Clerk user — never a persistence mechanism.
   ═══════════════════════════════════════════════════════════════ */

/** Branded loader rendered while Clerk auth state is still loading, so
    neither the authenticated shell nor a premature redirect ever flashes. */
function AuthLoading() {
  return (
    <div className="auth" id="authRoot">
      <div className="auth-loading">
        <BrandLogo size={140} />
        <div className="auth-loading-spinner" role="status" aria-label="Loading">
          <span />
        </div>
      </div>
    </div>
  );
}

/** Only render children when a user is signed in. */
function RequireAuth() {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return <AuthLoading />;
  if (!isSignedIn) return <Navigate to={ROUTES.login} replace />;
  return <Outlet />;
}

/** Only render children when signed OUT (auth/guest routes). */
function GuestOnly() {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return <AuthLoading />;
  if (isSignedIn) return <Navigate to={ROUTES.dashboard} replace />;
  return <Outlet />;
}

/** The panel routes themselves are auth-gated, not permission-gated: every
    authenticated, provisioned user can open every module. Permissions
    gate actions inside the pages, never route access. SessionGate (above)
    redirects to onboarding only for users who are not yet provisioned. */

function RootRedirect() {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return <AuthLoading />;
  return <Navigate to={isSignedIn ? ROUTES.dashboard : ROUTES.login} replace />;
}

/**
 * Keeps the store's `s.user` in sync with the Clerk user. Purely cosmetic —
 * drives the greeting, initials, and settings fields. Cleared on sign-out.
 * Must sit inside both ClerkProvider and AppProvider.
 */
function ClerkHydrator() {
  const { s, notify } = useStore();
  const { isLoaded, isSignedIn, user } = useUser();

  useEffect(() => {
    if (!isLoaded) return;

    if (isSignedIn && user) {
      const name =
        user.fullName?.trim() ||
        [user.firstName, user.lastName].filter(Boolean).join(' ').trim() ||
        'Admin';
      const email = user.primaryEmailAddress?.emailAddress ?? '';
      if (s.user?.name !== name || s.user?.email !== email) {
        s.user = { name, email };
        notify();
      }
    } else if (s.user) {
      s.user = null;
      notify();
    }
  }, [isLoaded, isSignedIn, user, s, notify]);

  return null;
}

export default function App() {
  return (
    <AppProvider>
      <HashRouter>
        <ClerkHydrator />
        {import.meta.env.DEV && <DevSupabaseCheck />}
        <Routes>
          {/* Redirect root: signed in → dashboard, else → login */}
          <Route path="/" element={<RootRedirect />} />

          {/* Authenticated app shell (sidebar + topbar + routed pages) */}
          <Route element={<RequireAuth />}>
            {/* Profile-aware gate: provisioned users get the app, unprovisioned
                users are redirected to /onboarding. Lives INSIDE RequireAuth
                but OUTSIDE AppShell. */}
            <Route element={<SessionGate />}>
              <Route element={<AppShell />}>
                <Route path={ROUTES.dashboard} element={<Dashboard />} />
                <Route path={ROUTES.orders} element={<Orders />} />
                <Route path={ROUTES.reservations} element={<Reservations />} />
                <Route path={ROUTES.tables} element={<Tables />} />
                <Route path={ROUTES.customers} element={<Customers />} />
                <Route path={ROUTES.menu} element={<Menu />} />
                <Route path={ROUTES.staff} element={<StaffRoles />} />
                <Route path={ROUTES.reports} element={<Reports />} />
                <Route path={ROUTES.settings} element={<Settings />} />
              </Route>
            </Route>
            {/* First-run setup, reachable only for signed-in users who are not
                yet provisioned. A ready user hitting this route is redirected
                to the dashboard via the Onboarding page's own check. */}
            <Route path={ROUTES.onboarding} element={<Onboarding />} />
          </Route>

          {/* Guest-only auth routes */}
          <Route element={<GuestOnly />}>
            <Route path={ROUTES.login} element={<Login />} />
            <Route path={ROUTES.signup} element={<Signup />} />
            <Route path={ROUTES.forgot} element={<Forgot />} />
          </Route>

          {/* Google OAuth completion — must be reachable for signed-out users
              and during the redirect window, so it lives outside the guards
              and ABOVE the catch-all below. */}
          <Route path={ROUTES.oauth} element={<SsoCallback />} />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        <OverlayHost />
      </HashRouter>
    </AppProvider>
  );
}
