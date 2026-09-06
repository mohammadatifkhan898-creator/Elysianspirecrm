/* SessionGate — profile-aware gate for the authenticated app (Phase 2B).

   Rendered inside RequireAuth (signed in) and OUTSIDE AppShell. It resolves the
   calling user's provisioning state once and then:
     - ready        -> render the protected app (Outlet)
     - none         -> redirect to /onboarding
     - inactive     -> branded "account inactive" screen (never enters the app)
     - orphan       -> graceful error screen with retry
     - not configured -> fall through to the app (pre-existing in-memory demo
                          behavior when no Supabase is configured)

   Guards against infinite loops/flashing: while the lookup is in flight it
   renders a branded loader and does NOT redirect. On provisioned users the
   lookup runs once per mount, so a refresh re-checks rather than flashing. */

import { useCallback, useEffect, useState } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useUser } from '@clerk/react';
import { useSupabase } from '../../lib/useSupabase';
import { getProfileState, type ProfileState } from '../../services';
import { ROUTES } from '../../routing/routes';
import { BrandLogo } from '../ui/BrandLogo';

function ProvisionLoader() {
  return (
    <div className="auth" id="authRoot">
      <div className="auth-loading">
        <BrandLogo size={140} />
        <div className="auth-loading-spinner" role="status" aria-label="Preparing">
          <span />
        </div>
        <p className="auth-sub" style={{ marginTop: 16 }}>Preparing your workspace&hellip;</p>
      </div>
    </div>
  );
}

function StatusScreen({
  title,
  body,
  actionLabel,
  onAction,
}: {
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="auth" id="authRoot">
      <section className="auth-section" style={{ display: 'contents' }}>
        <div className="auth-panel">
          <div className="auth-card">
            <div className="auth-logo">
              <BrandLogo size={56} />
            </div>
            <h1 className="auth-h1">{title}</h1>
            <p className="auth-sub">{body}</p>
            {actionLabel && onAction ? (
              <button className="btn btn-primary" style={{ width: '100%', padding: 12 }} onClick={onAction}>
                <span className="btn-label">{actionLabel}</span>
              </button>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
}

export function SessionGate() {
  const { supabase, isSupabaseConfigured } = useSupabase();
  const { user } = useUser();
  const [state, setState] = useState<ProfileState>({ phase: 'loading' });

  const load = useCallback(() => {
    let cancelled = false;

    // No Supabase configured: preserve the pre-Phase-2B demo behavior and let
    // the user straight into the (in-memory) app.
    if (!isSupabaseConfigured || !supabase) {
      setState({ phase: 'ready', restaurantId: '' });
      return () => undefined;
    }

    const userId = user?.id ?? '';
    if (!userId) {
      setState({ phase: 'loading' });
      return () => undefined;
    }

    setState({ phase: 'loading' });
    getProfileState(supabase, userId)
      .then((next) => {
        if (!cancelled) setState(next);
      })
      .catch(() => {
        // Any unexpected lookup failure is surfaced as an error (retryable),
        // NEVER treated as "not provisioned" (which would bounce to onboarding).
        if (!cancelled) setState({ phase: 'error' });
      });

    return () => {
      cancelled = true;
    };
  }, [supabase, isSupabaseConfigured, user?.id]);

  useEffect(() => load(), [load]);

  switch (state.phase) {
    case 'loading':
      return <ProvisionLoader />;
    case 'none':
      return <Navigate to={ROUTES.onboarding} replace />;
    case 'error':
      return (
        <StatusScreen
          title="Something went wrong"
          body="We could not verify your workspace. Please check your connection and try again."
          actionLabel="Retry"
          onAction={load}
        />
      );
    case 'inactive':
      return (
        <StatusScreen
          title="Account inactive"
          body={`Your account is currently ${state.staffStatus === 'suspended' ? 'suspended' : 'inactive'}. Please contact your restaurant administrator to restore access.`}
        />
      );
    case 'orphan':
      return (
        <StatusScreen
          title="Workspace issue"
          body="Your profile references a missing restaurant. Please contact support. Try signing out and back in, or clear your browser data."
        />
      );
    case 'ready':
    default:
      return <Outlet />;
  }
}
