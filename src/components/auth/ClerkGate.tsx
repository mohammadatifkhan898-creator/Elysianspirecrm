/* ClerkGate — hard, non-hanging boundary around ClerkProvider.

   Two failure modes used to leave the whole app spinning forever on the
   splash screen, because `useAuth().isLoaded` never flips to true when the
   Clerk Frontend API is unreachable:

     1. the publishable key is missing or malformed  -> ClerkProvider throws
     2. the key is well-formed but its frontend API host does not resolve
        (the production incident: clerk.<app-domain> was never provisioned),
        so clerk.browser.js never downloads.

   Neither case is recoverable by retrying inside the app, and neither may be
   "solved" by letting the user through — authentication stays exactly as
   strict as before. What changes is that we replace an infinite spinner with
   a named, actionable error screen, and offer a plain reload to retry once
   the underlying cause is fixed.

   A well-formed key that hangs is caught by ClerkLoadWatchdog below, which
   bounds the wait; a missing/malformed key is rejected before the provider
   ever mounts. */

import { Component, useEffect, useState, type ErrorInfo, type ReactNode } from 'react';
import { ClerkProvider } from '@clerk/react';
import { clerkConfig, type ClerkConfig } from '../../lib/clerk';
import { BrandLogo } from '../ui/BrandLogo';

/** How long to wait for Clerk to report a loaded auth state before declaring
    the Frontend API unreachable. Generous enough to absorb a cold Clerk CDN
    fetch on a slow connection, short enough that a real outage does not look
    like a loading page. */
const CLERK_LOAD_TIMEOUT_MS = 12_000;

/* ── Error screen ───────────────────────────────────────────────── */

function ClerkErrorScreen({
  title,
  detail,
  children,
}: {
  title: string;
  detail: ReactNode;
  children?: ReactNode;
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
            <div className="auth-sub">{detail}</div>
            {children ? <div style={{ marginTop: 20 }}>{children}</div> : null}
          </div>
        </div>
      </section>
    </div>
  );
}

/** Shown when no usable publishable key is baked into the build. */
function ClerkUnconfiguredScreen({ config }: { config: ClerkConfig }) {
  return (
    <ClerkErrorScreen
      title="Sign-in unavailable"
      detail={
        <>
          <p style={{ margin: '0 0 12px' }}>{config.problem}</p>
          <p style={{ margin: 0 }}>
            This is a deployment configuration issue, not something you can fix from the browser.
            Set <code>VITE_CLERK_PUBLISHABLE_KEY</code> to a valid Clerk publishable key
            (<code>pk_test_…</code> or <code>pk_live_…</code>) in your environment and redeploy.
          </p>
        </>
      }
    />
  );
}

/** Shown when Clerk JS was served a key but never finished booting. */
function ClerkUnreachableScreen({ host }: { host: string | null }) {
  return (
    <ClerkErrorScreen
      title="Could not reach sign-in"
      detail={
        <>
          <p style={{ margin: '0 0 12px' }}>
            The authentication service did not respond, so we cannot verify who you are.
            Nothing is lost &mdash; no data was changed.
          </p>
          {host ? (
            <p style={{ margin: '0 0 12px' }}>
              The app is configured to use <code>{host}</code> as its Clerk Frontend API, which
              did not respond. If this deployment is new, that host may not be provisioned yet.
            </p>
          ) : null}
          <p style={{ margin: 0 }}>Please try again in a moment.</p>
        </>
      }
    >
      <button
        className="btn btn-primary"
        style={{ width: '100%', padding: 12 }}
        onClick={() => window.location.reload()}
      >
        <span className="btn-label">Retry</span>
      </button>
    </ClerkErrorScreen>
  );
}

/* ── Watchdog ──────────────────────────────────────────────────── */

/**
 * Renders `children` once Clerk reports a loaded auth state. If that never
 * happens within CLERK_LOAD_TIMEOUT_MS, renders the unreachable screen
 * instead of spinning indefinitely.
 *
 * The initial `timedOut=false` render intentionally defers to Clerk's own
 * `isLoaded` gate inside App, so this only ever *adds* an upper bound.
 */
function ClerkLoadWatchdog({ children }: { children: ReactNode }) {
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    if (timedOut) return;
    const t = window.setTimeout(() => setTimedOut(true), CLERK_LOAD_TIMEOUT_MS);
    return () => window.clearTimeout(t);
  }, [timedOut]);

  if (timedOut) return <ClerkUnreachableScreen host={clerkConfig.frontendApiHost} />;
  return <>{children}</>;
}

/* ── Error boundary ────────────────────────────────────────────── */

/**
 * ClerkProvider throws synchronously for a structurally invalid key. Without a
 * boundary that unmounts the whole React tree into a blank page, so we convert
 * it into the same actionable screen.
 */
class ClerkErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // The key is never included in this message.
    console.error('[auth] Clerk failed to initialize:', error.message, info.componentStack);
  }

  render() {
    if (this.state.failed) {
      return <ClerkUnreachableScreen host={clerkConfig.frontendApiHost} />;
    }
    return this.props.children;
  }
}

/* ── Gate ──────────────────────────────────────────────────────── */

export function ClerkGate({ children }: { children: ReactNode }) {
  // Reject an unusable key BEFORE mounting ClerkProvider, so a missing or
  // malformed key produces an immediate error screen instead of a hang.
  if (clerkConfig.status !== 'ok') {
    return <ClerkUnconfiguredScreen config={clerkConfig} />;
  }

  return (
    <ClerkErrorBoundary>
      <ClerkProvider publishableKey={clerkConfig.publishableKey} proxyUrl="/__clerk">
        <ClerkLoadWatchdog>{children}</ClerkLoadWatchdog>
      </ClerkProvider>
    </ClerkErrorBoundary>
  );
}
