import { describe, expect, it } from 'vitest';
import { effectivePermissions, identityHasAny, sidebarKeyFromPath } from '../../src/routing/routes';
import { ALL_PERMISSION_SLUGS } from '../../src/data/seed';

describe('effectivePermissions', () => {
  it('gives owner-admin the full catalog regardless of DB permissions', () => {
    const full = effectivePermissions('owner-admin', ['orders.view']);
    expect(full).toEqual(ALL_PERMISSION_SLUGS);
  });

  it('gives owner-admin the full catalog even when the DB resolve is empty', () => {
    expect(effectivePermissions('owner-admin', [])).toEqual(ALL_PERMISSION_SLUGS);
  });

  it('returns exactly the DB permissions for any non-owner role', () => {
    const perms = effectivePermissions('manager', ['orders.view', 'orders.manage', 'reservations.manage']);
    expect(perms).toEqual(['orders.view', 'orders.manage', 'reservations.manage']);
  });

  it('returns a fresh array so callers cannot mutate shared catalog state', () => {
    const a = effectivePermissions('owner-admin', []);
    const b = effectivePermissions('owner-admin', []);
    expect(a).not.toBe(b);
  });
});

describe('identityHasAny', () => {
  it('always passes for owner-admin', () => {
    expect(identityHasAny('owner-admin', [], ['orders.manage'])).toBe(true);
    expect(identityHasAny('owner-admin', null, ['settings.manage'])).toBe(true);
  });

  it('passes when no permissions are required', () => {
    expect(identityHasAny('waiter', [], [])).toBe(true);
    expect(identityHasAny('waiter', null, [])).toBe(true);
  });

  it('fails for a null identity when permissions are required', () => {
    expect(identityHasAny(null, [], ['orders.view'])).toBe(false);
    expect(identityHasAny(null, null, ['orders.view'])).toBe(false);
  });

  it('empty required always passes (even for a null identity)', () => {
    expect(identityHasAny(null, null, [])).toBe(true);
  });

  it('matches when any required slug is present (OR semantics)', () => {
    expect(identityHasAny('manager', ['orders.view', 'orders.manage'], ['orders.manage', 'settings.manage'])).toBe(true);
    expect(identityHasAny('waiter', ['orders.view'], ['orders.manage', 'orders.create'])).toBe(false);
  });
});

describe('sidebarKeyFromPath', () => {
  it('maps known paths to their sidebar keys and falls back to dashboard', () => {
    expect(sidebarKeyFromPath('/orders')).toBe('orders');
    expect(sidebarKeyFromPath('/staff')).toBe('staff');
    expect(sidebarKeyFromPath('/reports/')).toBe('reports');
    expect(sidebarKeyFromPath('/nonsense')).toBe('dashboard');
    expect(sidebarKeyFromPath('/orders/42/edit')).toBe('orders');
  });
});