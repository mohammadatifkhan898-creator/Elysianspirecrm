import { describe, expect, it } from 'vitest';
import { createCustomer, updateCustomer, customerMutationError, customerRowToView } from '../../src/services/customers';
import { MockSupabase } from './helpers/supabaseMock';

function makeCustomerRow() {
  return {
    id: '55555555-5555-5555-5555-555555555555',
    restaurant_id: '22222222-2222-2222-2222-222222222222',
    name: 'Arjun Mehta',
    phone: '+91 98450 11234',
    email: 'arjun@mail.com',
    visits: 24,
    orders: 38,
    spent: '84200',
    last_visit_at: '2026-09-06T10:00:00Z',
    favorite_item: 'Truffle Pasta',
    deleted_at: null,
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
  };
}

describe('createCustomer', () => {
  it('sets restaurant_id from the identity context, never from input', async () => {
    const mock = new MockSupabase([{ data: makeCustomerRow(), error: null }]);
    const res = await createCustomer(
      mock.client(),
      { name: '  Arjun Mehta  ', phone: '', email: '  arjun@mail.com  ' },
      { restaurantId: '22222222-2222-2222-2222-222222222222' },
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.name).toBe('Arjun Mehta');
    const insert = mock.calls.find((c) => c.startsWith('insert:'));
    expect(insert).toBeDefined();
    expect(insert).toContain('"restaurant_id":"22222222-2222-2222-2222-222222222222"');
    expect(insert).toContain('"phone":null');
    expect(insert).toContain('"email":"arjun@mail.com"');
  });

  it('rejects an empty name without touching the DB', async () => {
    const mock = new MockSupabase();
    const res = await createCustomer(mock.client(), { name: '   ' }, { restaurantId: 'r1' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('VALIDATION');
    expect(mock.calls).toHaveLength(0);
  });
});

describe('updateCustomer', () => {
  it('validates a subset update payload', async () => {
    const mock = new MockSupabase([{ data: makeCustomerRow(), error: null }]);
    const res = await updateCustomer(mock.client(), 'c1', { phone: '+91 90000 00000' });
    expect(res.ok).toBe(true);
    expect(mock.calls).toContain('update:{"phone":"+91 90000 00000"}');
    if (res.ok) expect(res.data.name).toBe('Arjun Mehta');
  });

  it('rejects an empty name', async () => {
    const mock = new MockSupabase();
    const res = await updateCustomer(mock.client(), 'c1', { name: ' ' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('VALIDATION');
  });

  it('returns NOT_FOUND when the row is gone', async () => {
    const mock = new MockSupabase([{ data: null, error: null }]);
    const res = await updateCustomer(mock.client(), 'c99', { name: 'New Name' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('NOT_FOUND');
  });
});

describe('customerMutationError', () => {
  const withRaw = (code: string) => ({ code: 'VALIDATION' as const, message: 'raw', raw: { code } });

  it('maps 23505 (duplicate phone/email) to a friendly message', () => {
    const e = customerMutationError(withRaw('23505'));
    expect(e.code).toBe('VALIDATION');
    expect(e.message).toContain('already exists');
  });

  it('maps 42501 to FORBIDDEN', () => {
    const e = customerMutationError(withRaw('42501'));
    expect(e.code).toBe('FORBIDDEN');
  });

  it('keeps NETWORK as NETWORK without exposing raw text', () => {
    const e = customerMutationError({ code: 'NETWORK', message: 'fetch failed' });
    expect(e.code).toBe('NETWORK');
    expect(e.message).not.toContain('fetch failed');
  });

  it('falls back to a generic message on unmapped failures', () => {
    const e = customerMutationError({ code: 'UNKNOWN', message: 'relation customers does not exist' });
    expect(e.code).toBe('VALIDATION');
    expect(e.message).not.toContain('does not exist');
  });
});

describe('customerRowToView', () => {
  it('maps a canonical row, converting numeric money strings', () => {
    const v = customerRowToView(makeCustomerRow() as never);
    expect(v.id).toBe('55555555-5555-5555-5555-555555555555');
    expect(v.name).toBe('Arjun Mehta');
    expect(v.phone).toBe('+91 98450 11234');
    expect(v.spent).toBe(84200);
    expect(v.fav).toBe('Truffle Pasta');
  });

  it('handles nulls cleanly', () => {
    const row = makeCustomerRow();
    row.phone = null;
    row.email = null;
    row.favorite_item = null;
    row.last_visit_at = null;
    const v = customerRowToView(row as never);
    expect(v.phone).toBe('');
    expect(v.email).toBe('');
    expect(v.fav).toBe('');
    expect(v.last).toBe('');
  });
});