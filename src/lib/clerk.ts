/* Clerk integration seam — frontend only.
   Clerk is the single auth authority. The publishable key is exposed to the
   browser by design (it is public and safe to ship); the SECRET key must never
   appear in frontend code or be read at runtime. Auth state is driven through
   the @clerk/react hooks (useAuth / useUser / legacy useSignIn / useSignUp),
   never through a backend client. */

import { ROUTES } from '../routing/routes';

/** The Clerk publishable key, or empty when unconfigured. */
export const clerkPublishableKey =
  (import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined) ?? '';

export const isClerkConfigured = Boolean(clerkPublishableKey);

/**
 * Google OAuth URLs.
 *
 * The app uses a hash router, so Clerk's OAuth `redirectUrl` (the route that
 * completes the flow) and `redirectUrlComplete` (where the user lands after a
 * success) must be absolute URLs that carry the `#/path` fragment. Clerk's JS
 * appends the OAuth handshake params to the fragment's query string and the
 * `<AuthenticateWithRedirectCallback/>` route reads them back. These helpers
 * centralise that URL construction so the Login/Signup pages never duplicate
 * OAuth wiring.
 */

const OAUTH_BASE = () => `${window.location.origin}/#`;

/** Absolute URL of the route that completes a Google OAuth flow. */
export function oauthCallbackUrl(path = ROUTES.oauth): string {
  return `${OAUTH_BASE()}${path}`;
}

/** Absolute URL Clerk navigates to after a successful Google OAuth flow. */
export function oauthCompleteUrl(path: string): string {
  const normalized = path.replace(/^#/, '');
  return `${OAUTH_BASE()}${normalized.startsWith('/') ? normalized : `/${normalized}`}`;
}

/** Absolute Google OAuth callback + completion URLs (typed pair). */
export function oauthUrls(completePath: string): { redirectUrl: string; redirectUrlComplete: string } {
  return {
    redirectUrl: oauthCallbackUrl(),
    redirectUrlComplete: oauthCompleteUrl(completePath),
  };
}
