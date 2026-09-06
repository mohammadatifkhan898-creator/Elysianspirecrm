import { useState } from 'react';
import { useSignIn, useSignUp } from '@clerk/react/legacy';
import { toast } from '../../store/store';
import { oauthUrls } from '../../lib/clerk';
import { GoogleGIcon } from './GoogleGIcon';

/* ═══════════════════════════════════════════════════════════════
   GoogleAuthButton — the single, reusable "Continue with Google"
   control shared by the Login and Signup pages.

   It drives the REAL Clerk Google OAuth flow via the official
   `signIn.authenticateWithRedirect` / `signUp.authenticateWithRedirect`
   methods (strategy `oauth_google`). Clerk redirects the browser to
   Google; on success the user returns to the `<AuthenticateWithRedirect
   Callback/>` route, the Clerk session is established, and the app lands
   on `redirectUrl`. No fake/simulated Google logic here.

   Handles its own loading, duplicate-click protection, and a friendly
   error toast. No raw Clerk errors are surfaced.
   ═══════════════════════════════════════════════════════════════ */

type GoogleAuthMode = 'signin' | 'signup';

interface GoogleAuthButtonProps {
  /** Which Clerk resource drives the flow: sign-in or sign-up. */
  mode: GoogleAuthMode;
  /** Hash path landed on after a successful flow. Defaults to the dashboard. */
  redirectUrl?: string;
  className?: string;
}

export function GoogleAuthButton({ mode, redirectUrl = '/dashboard', className }: GoogleAuthButtonProps) {
  const { isLoaded: signInLoaded, signIn } = useSignIn();
  const { isLoaded: signUpLoaded, signUp } = useSignUp();
  const [busy, setBusy] = useState(false);

  const isReady = mode === 'signin' ? signInLoaded : signUpLoaded;

  const onFail = () => {
    setBusy(false);
    toast(
      mode === 'signin'
        ? 'Unable to sign in with Google. Please try again.'
        : 'Unable to create your account with Google. Please try again.',
      'error',
      mode === 'signin' ? 'Google sign-in failed' : 'Google sign-up failed'
    );
  };

  const handleClick = async () => {
    if (busy) return;

    const { redirectUrl: callbackUrl, redirectUrlComplete } = oauthUrls(redirectUrl);
    const opts = {
      strategy: 'oauth_google' as const,
      redirectUrl: callbackUrl,
      redirectUrlComplete,
    };

    if (mode === 'signin') {
      if (!signIn) return;
      setBusy(true);
      try {
        await signIn.authenticateWithRedirect(opts);
      } catch {
        onFail();
      }
      return;
    }

    if (!signUp) return;
    setBusy(true);
    try {
      await signUp.authenticateWithRedirect(opts);
    } catch {
      onFail();
    }
  };

  return (
    <button
      type="button"
      className={'google-btn' + (className ? ` ${className}` : '')}
      onClick={handleClick}
      disabled={busy || !isReady}
      aria-label={mode === 'signin' ? 'Continue with Google to sign in' : 'Continue with Google to create your account'}
    >
      <span className="google-btn-glyph">
        {busy ? <span className="spinner" aria-hidden="true" /> : <GoogleGIcon size={20} />}
      </span>
      <span className="google-btn-label">{busy ? 'Connecting to Google…' : 'Continue with Google'}</span>
    </button>
  );
}
