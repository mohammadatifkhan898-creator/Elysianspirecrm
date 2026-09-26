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

/* ═══════════════════════════════════════════════════════════════
   Key validation.

   A publishable key is `pk_test_<base64(frontendApiHost$)>` (or `pk_live_`).
   The embedded host IS the Clerk Frontend API the browser will fetch
   clerk.browser.js from, so a bad host is the single most common cause of a
   production app that hangs on a splash screen: the key parses fine, the
   network request simply never lands.

   We therefore resolve the key into an explicit, reportable status instead of
   handing ClerkProvider a raw string. This NEVER weakens authentication —
   an unusable key is surfaced as a hard, blocking error screen.
   ═══════════════════════════════════════════════════════════════ */

export type ClerkConfigStatus = 'ok' | 'missing' | 'malformed';

export interface ClerkConfig {
  /** The raw publishable key (never logged, never rendered). */
  publishableKey: string;
  status: ClerkConfigStatus;
  /** Actionable, user-facing reason. Contains no key material. */
  problem: string | null;
  /** Decoded Clerk Frontend API host, when the key is well-formed. */
  frontendApiHost: string | null;
}

const ENV_VAR = 'VITE_CLERK_PUBLISHABLE_KEY';

/** Decode a publishable key's base64 payload. Returns null if not decodable. */
function decodeKeyPayload(key: string): string | null {
  // Strip the pk_test_ / pk_live_ prefix; the remainder is base64 of "<host>$".
  const m = /^pk_(?:test|live)_(.+)$/.exec(key);
  if (!m) return null;
  try {
    // atob is available in every browser and in Node >= 16 (vitest runs here).
    return atob(m[1]);
  } catch {
    return null;
  }
}

/** Resolve the publishable key into a validated configuration. */
export function readClerkConfig(key: string = clerkPublishableKey): ClerkConfig {
  const trimmed = key.trim();

  if (!trimmed) {
    return {
      publishableKey: trimmed,
      status: 'missing',
      problem: `Sign-in is not configured. The ${ENV_VAR} environment variable is missing or empty.`,
      frontendApiHost: null,
    };
  }

  const payload = decodeKeyPayload(trimmed);
  // Clerk's payload is "<frontend-api-host>$"; the trailing $ is the sentinel.
  const host = payload && payload.includes('$') ? payload.slice(0, payload.indexOf('$')) : '';

  if (!host || /\s/.test(host) || !host.includes('.')) {
    return {
      publishableKey: trimmed,
      status: 'malformed',
      problem: `The ${ENV_VAR} environment variable does not look like a Clerk publishable key. Expected a value beginning with "pk_test_" or "pk_live_".`,
      frontendApiHost: null,
    };
  }

  return { publishableKey: trimmed, status: 'ok', problem: null, frontendApiHost: host };
}

/** The resolved, validated Clerk configuration for this build. */
export const clerkConfig = readClerkConfig();

/** True only when a well-formed publishable key is present. */
export const isClerkConfigured = clerkConfig.status === 'ok';

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
