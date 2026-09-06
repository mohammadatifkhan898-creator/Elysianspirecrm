import { ALL_PERMISSION_SLUGS } from '../data/seed';

export const ROUTES = {
  login: '/login',
  signup: '/signup',
  forgot: '/forgot',
  oauth: '/sso-callback',
  onboarding: '/onboarding',
  dashboard: '/dashboard',
  orders: '/orders',
  reservations: '/reservations',
  tables: '/tables',
  customers: '/customers',
  menu: '/menu',
  staff: '/staff',
  reports: '/reports',
  settings: '/settings',
} as const;

export type RouteKey = keyof typeof ROUTES;

/** Map a pathname (without leading slash and trailing slash) to its sidebar key. */
export function sidebarKeyFromPath(path: string): string {
  const p = path.replace(/^\/+|\/+$/g, '').split('/')[0];
  const known = ['dashboard', 'orders', 'reservations', 'tables', 'customers', 'menu', 'staff', 'reports', 'settings'];
  return known.includes(p) ? p : 'dashboard';
}

/* ═══════════════════════════════════════════════════════════════
   Navigation access model.

   Every sidebar section and every panel page is reachable by any
   AUTHENTICATED, provisioned user — visibility is authentication-gated,
   not permission-gated. RequireAuth (signed in) + SessionGate (provisioned)
   enforce that; the Sidebar renders all nine sections unconditionally for
   an authenticated identity. Permissions gate only ACTIONS inside a page
   (create/edit/manage), resolved via effectivePermissions / identityHasAny
   below. The catalog has no `tables.*` or `settings.view` slugs, so Tables
   and Settings are browseable by everyone; their write actions are gated
   by settings.manage.
   ═══════════════════════════════════════════════════════════════ */

/** DB slug of the built-in full-access owner/admin role (0001/0010 seed).
    The one, deliberate exception to "permissions are the source of truth". */
export const OWNER_ADMIN_SLUG = 'owner-admin';

/**
 * Resolve the effective permission set for a role.
 *
 * Permissions are the source of truth EXCEPT for one, deliberate exception:
 * the owner-admin role always receives the full permission catalog so the
 * account that owns the restaurant can never lose a module to a partial DB
 * resolve. Any custom or seeded non-owner role is driven purely by its DB
 * permissions. Always returns a fresh array so callers never mutate shared
 * catalog state.
 */
export function effectivePermissions(roleSlug: string | null | undefined, dbPermissions: string[]): string[] {
  if (roleSlug === OWNER_ADMIN_SLUG) {
    return [...ALL_PERMISSION_SLUGS];
  }
  return [...dbPermissions];
}

/**
 * Does the resolved identity have any of the requested slugs?
 * The owner-admin role always passes every gate. Empty `required` always
 * passes (a page gate with no slugs is not a permission check at all).
 * A null identity passes only when `required` is empty.
 */
export function identityHasAny(
  roleSlug: string | null | undefined,
  dbPermissions: string[] | null | undefined,
  required: string[],
): boolean {
  if (!required || required.length === 0) return true;
  if (roleSlug === OWNER_ADMIN_SLUG) return true;
  const perms = dbPermissions ?? [];
  return required.some((p) => perms.includes(p));
}
