import { test, expect, type Page } from '@playwright/test';

/* ═══════════════════════════════════════════════════════════════
   Auth E2E tests — Clerk edition.

   Clerk is now the single auth authority: there is no demo password and
   no localStorage session. Real sign-in / sign-up / password-reset
   require live Clerk credentials plus an inbox, so they are intentionally
   NOT automated here (never commit real passwords). Instead, these tests
   lock in every behaviour that does NOT need credentials:

     • unauthenticated users are bounced to Login from protected routes,
     • the root path redirects to Login when signed out,
     • the three custom auth pages render their forms,
     • the guest-only auth routes are reachable when signed out,
     • no browser page errors occur while loading the auth pages.

   The authenticated flows (sign in → dashboard, refresh persistence,
   logout, sign-up verification, reset password) are verified manually —
   see the MANUAL VERIFICATION section at the bottom of this file.
   ═══════════════════════════════════════════════════════════════ */

const PROTECTED = [
  '/staff',
  '/settings',
  '/orders',
  '/dashboard',
  '/reservations',
  '/customers',
  '/menu',
  '/reports',
];

/* Each protected route shows Login when signed out. */
test('unauthenticated users are redirected to Login from every protected route', async ({
  page,
}) => {
  for (const path of PROTECTED) {
    await page.goto('/#' + path);
    // Wait until the redirect fully resolves (login form visible) before
    // asserting — avoids timing out while Clerk's auth state is still loading
    // on the first navigation.
    await page.waitForSelector('#login_email', { state: 'visible' });
    await expect(page).toHaveURL(/#\/login$/);
  }
});

test('root path redirects to Login when signed out', async ({ page }) => {
  await page.goto('/#/');
  await expect(page).toHaveURL(/#\/login$/);
});

test('Login page renders the custom sign-in form', async ({ page }) => {
  await page.goto('/#/login');
  await expect(page.locator('#login_email')).toBeVisible();
  await expect(page.locator('#login_password')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign In', exact: true })).toBeVisible();
});

test('Login page shows the Google button and OR divider', async ({ page }) => {
  await page.goto('/#/login');
  await expect(page.getByRole('button', { name: /Continue with Google/i })).toBeVisible();
  await expect(page.locator('.auth-divider[role="separator"]')).toBeVisible();
  await expect(page.locator('.auth-divider-text')).toHaveText('or');
});

test('Signup page renders the custom create-account form', async ({ page }) => {
  await page.goto('/#/signup');
  await expect(page.locator('#su_name')).toBeVisible();
  await expect(page.locator('#su_email')).toBeVisible();
  await expect(page.locator('#su_password')).toBeVisible();
  await expect(page.locator('#su_confirm')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create Account' })).toBeVisible();
});

test('auth pages render the Elysian brand lockup (icon + wordmark + descriptor)', async ({ page }) => {
  for (const path of ['/login', '/signup', '/forgot']) {
    await page.goto('/#' + path);
    const lockup = page.locator('.auth-logo .brand-lockup');
    await expect(lockup).toBeVisible();
    await expect(lockup.locator('.brand-wordmark')).toHaveText(/ELYSIAN\s+SPIRE/i);
    await expect(lockup.locator('.brand-descriptor')).toHaveText('RESTAURANT CRM');
    const logo = lockup.locator('img.brand-logo');
    await expect(logo).toBeVisible();
    await expect(logo).toHaveAttribute('alt', 'Elysian Spire');
    await expect(logo).toHaveJSProperty('complete', true);
    await expect(logo).toHaveCSS('object-fit', 'contain');
  }
});

test('Signup page shows the Google button and OR divider', async ({ page }) => {
  await page.goto('/#/signup');
  await expect(page.getByRole('button', { name: /Continue with Google/i })).toBeVisible();
  await expect(page.locator('.auth-divider[role="separator"]')).toBeVisible();
  await expect(page.locator('.auth-divider-text')).toHaveText('or');
});

test('SSO callback route renders without a page error', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/#/sso-callback');
  await page.waitForSelector('.auth-loading', { state: 'visible' });
  expect(errors).toEqual([]);
});

test('Forgot page renders the custom reset form', async ({ page }) => {
  await page.goto('/#/forgot');
  await expect(page.locator('#fg_email')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send Reset Code' })).toBeVisible();
});

test('guest-only auth routes are reachable when signed out', async ({ page }) => {
  for (const [path, sel] of [
    ['/login', '#login_email'],
    ['/signup', '#su_name'],
    ['/forgot', '#fg_email'],
  ] as Array<[string, string]>) {
    await page.goto('/#' + path);
    await expect(page.locator(sel)).toBeVisible();
    await expect(page).toHaveURL(new RegExp('#/?' + path.replace('/', '') + '$'));
  }
});

/* Load every auth page and make sure none throws during Clerk bootstrap. */
test('no browser page errors while loading the auth pages', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  for (const path of ['/login', '/signup', '/forgot', '/login']) {
    await page.goto('/#' + path);
    await page.waitForSelector('.auth-card', { state: 'visible' });
  }

  expect(errors).toEqual([]);
});

/* ═══════════════════════════════════════════════════════════════
   MANUAL VERIFICATION — authenticated flows (run against a real Clerk
   instance with a reachable inbox; NEVER commit real credentials).

   1. Sign in
      - Open /#/login and enter the email + password of a user that exists
        in the linked Clerk instance.
      - Expect: a "Signed in" toast, then the Dashboard shell renders with
        the user's greeting/initials (s.user hydrated from Clerk).
      - Brand lockup: the dark sidebar header renders the vertical
        "ELYSIAN SPIRE / RESTAURANT CRM" lockup with the gold icon above,
        without clipping or distortion. On narrow screens (<920px) a subtle
        Elysian logo appears in the topbar once the sidebar retracts.
      - Expect: visiting /#/dashboard after a full page reload stays signed
        in (Clerk restores the session) and the Dashboard still renders.

   2. Wrong credentials
      - Enter an email that does not exist (or a wrong password).
      - Expect: an inline error and a "Sign in failed" toast; you remain on
        the Login page with the form enabled again.

   3. Sign up (email verification)
      - Open /#/signup, fill the form with a new email + strong password.
      - Expect: a verification step asking for the emailed code; entering
        the correct code activates the session and opens the Dashboard.

   4. Forgot / reset password
      - Open /#/forgot and enter an existing email.
      - Expect: emailed code → new-password step → success → signed back in.

   5. Sign out
      - Open the profile drawer (topbar user chip) → "Sign out".
      - Expect: a "Signed out" toast, redirect to /#/login, and protected
        routes redirect to Login again; a full reload stays logged out.
   ═══════════════════════════════════════════════════════════════ */
