import { describe, expect, it } from 'vitest';
import { toRoleSlugs, createCustomRole, updateCustomRole, staffRowToView } from '../../src/services/staff';
import { PERMISSION_KEYS, ALL_PERMISSION_SLUGS } from '../../src/data/seed';
import { MockSupabase } from './helpers/supabaseMock';

describe('toRoleSlugs', () => {
  it('translates display permission labels into canonical DB slugs', () => {
    expect(toRoleSlugs(['View Orders'])).toEqual(['orders.view']);
    expect(toRoleSlugs(['View Reservations', 'Create Reservations'])).toEqual([
      'reservations.view',
      'reservations.manage',
    ]);
    expect(toRoleSlugs(['Manage Settings'])).toEqual(['settings.manage']);
  });

  it('dedupes labels that share a slug', () => {
    // 'Edit Customers' and 'Delete Customers' both map to customers.manage.
    expect(toRoleSlugs(['Edit Customers', 'Delete Customers'])).toEqual(['customers.manage']);
    // 'View Reports' and 'Export Reports' both map to reports.view.
    expect(toRoleSlugs(['View Reports', 'Export Reports'])).toEqual(['reports.view']);
  });

  it('passes bare slugs through untouched', () => {
    expect(toRoleSlugs(['orders.view', 'orders.manage'])).toEqual(['orders.view', 'orders.manage']);
  });

  it('drops unknown labels but keeps the rest', () => {
    expect(toRoleSlugs(['View Orders', 'Totally Fake Perm'])).toEqual(['orders.view']);
  });

  it('every documented display label maps to a slug in the catalog', () => {
    for (const label of Object.keys(PERMISSION_KEYS)) {
      const slugs = toRoleSlugs([label]);
      expect(slugs.length).toBe(1);
      expect(ALL_PERMISSION_SLUGS).toContain(slugs[0]);
    }
  });
});

describe('createCustomRole / updateCustomRole', () => {
  it('sends slug codes (not display labels) to the create RPC', async () => {
    const mock = new MockSupabase([
      { data: { ok: true, role_id: 'role-1', name: 'Host Escort' }, error: null },
    ]);
    const res = await createCustomRole(mock.client(), 'Host Escort', 'Meets guests', [
      'View Orders',
      'View Reservations',
      'View Reports',
      'Export Reports',
    ]);
    expect(res.ok).toBe(true);
    const rpc = mock.calls.find((c) => c.startsWith('rpc:create_custom_role:'));
    expect(rpc).toBeDefined();
    expect(rpc).toContain('"p_permissions":["orders.view","reservations.view","reports.view"]');
    if (res.ok) expect(res.data).toEqual({ roleId: 'role-1', name: 'Host Escort' });
  });

  it('sends slug codes to the update RPC', async () => {
    const mock = new MockSupabase([{ data: { ok: true }, error: null }]);
    const res = await updateCustomRole(mock.client(), 'role-1', 'Host Escort', 'Meets guests', [
      'Create Customers',
      'Edit Customers',
      'Delete Customers',
    ]);
    expect(res.ok).toBe(true);
    const rpc = mock.calls.find((c) => c.startsWith('rpc:update_custom_role:'));
    expect(rpc).toBeDefined();
    expect(rpc).toContain('"p_permissions":["customers.manage"]');
  });

  it('surfaces the RPC ok:false error message', async () => {
    const mock = new MockSupabase([{ data: { ok: false, error: 'A role with that name already exists.' }, error: null }]);
    const res = await updateCustomRole(mock.client(), 'role-1', 'Duplicate', 'x', []);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe('VALIDATION');
      expect(res.error.message).toContain('already exists');
    }
  });
});

describe('staffRowToView', () => {
  function makeStaffRow() {
    return {
      id: '77777777-7777-7777-7777-777777777777',
      restaurant_id: '22222222-2222-2222-2222-222222222222',
      name: 'Priya Nair',
      email: 'priya@elysianspire.com',
      role_id: 'role-1',
      status: 'active' as const,
      inv_status: null,
      last_active_at: '2026-09-06T09:00:00Z',
      joined_at: '2026-08-01T00:00:00Z',
      deleted_at: null,
      created_at: '2026-08-01T00:00:00Z',
      updated_at: '2026-08-01T00:00:00Z',
      roles: { id: 'role-1', name: 'Waiter' },
      staff_activity: [],
    };
  }

  it('maps a join row with role name and status', () => {
    const v = staffRowToView(makeStaffRow() as never);
    expect(v.id).toBe('77777777-7777-7777-7777-777777777777');
    expect(v.name).toBe('Priya Nair');
    expect(v.role).toBe('Waiter');
    expect(v.roleId).toBe('role-1');
    expect(v.status).toBe('Active');
  });
});