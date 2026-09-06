import { AuthenticateWithRedirectCallback } from '@clerk/react';
import { BrandLogo } from '../../components/ui/BrandLogo';

/* ═══════════════════════════════════════════════════════════════
   SsoCallback — silent route that completes a Google OAuth flow.

   Clerk redirects the browser back here (the `redirectUrl` we pass to
   `authenticateWithRedirect`) after the user picks a Google account.
   `AuthenticateWithRedirectCallback` finishes the handshake, establishes
   the Clerk session, then navigates to the `redirectUrlComplete` we set
   (the dashboard). A branded loader masks the moment while it works.
   ═══════════════════════════════════════════════════════════════ */

export function SsoCallback() {
  return (
    <div className="auth" id="authRoot">
      <div className="auth-loading">
        <BrandLogo size={140} />
        <div className="auth-loading-spinner" role="status" aria-label="Completing sign in">
          <span />
        </div>
      </div>
      <AuthenticateWithRedirectCallback />
    </div>
  );
}
