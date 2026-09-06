import { describe, expect, it } from 'vitest';
import {
  createRestaurantTable,
  updateRestaurantTable,
  tableMutationError,
  restaurantTableRowToView,
  TABLE_STATUSES,
} from '../../src/services/restaurantTables';
import { MockSupabase } from './helpers/supabaseMock';

function makeTableRow() {
  return {
    id: '66666666-6666-6666-6666-666666666666',
    restaurant_id: '22222222-2222-2222-2222-222222222222',
    label: 'T-06',
    capacity: 4,
    status: 'available' as const,
    deleted_at: null,
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
  };
}

describe('createRestaurantTable', () => {
  it('normalizes the label to uppercase and sets the restaurant from identity', async () => {
    const mock = new MockSupabase([{ data: makeTableRow(), error: null }]);
    const res = await createRestaurantTable(
      mock.client(),
      { label: '  t-06  ', capacity: 4 },
      { restaurantId: '22222222-2222-2222-2222-222222222222' },
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.label).toBe('T-06');
    const insert = mock.calls.find((c) => c.startsWith('insert:'));
    expect(insert).toBeDefined();
    expect(insert).toContain('"label":"T-06"');
    expect(insert).toContain('"restaurant_id":"22222222-2222-2222-2222-222222222222"');
    expect(insert).toContain('"status":"available"');
  });

  it('rejects an empty label', async () => {
    const mock = new MockSupabase();
    const res = await createRestaurantTable(mock.client(), { label: ' ', capacity: 4 }, { restaurantId: 'r1' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('VALIDATION');
    expect(mock.calls).toHaveLength(0);
  });

  it('rejects invalid capacity', async () => {
    const mock = new MockSupabase();
    const res = await createRestaurantTable(mock.client(), { label: 'T-01', capacity: 0 }, { restaurantId: 'r1' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('VALIDATION');
    expect(mock.calls).toHaveLength(0);
  });
});

describe('updateRestaurantTable', () => {
  it('writes only the provided fields and uppercases label', async () => {
    const mock = new MockSupabase([{ data: makeTableRow(), error: null }]);
    const res = await updateRestaurantTable(mock.client(), 't1', { label: 't-12' });
    expect(res.ok).toBe(true);
    expect(mock.calls).toContain('update:{"label":"T-12"}');
    if (res.ok) expect(res.data.label).toBe('T-06');
  });

  it('rejects an empty label', async () => {
    const mock = new MockSupabase();
    const res = await updateRestaurantTable(mock.client(), 't1', { label: '   ' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('VALIDATION');
  });

  it('rejects an update with no fields', async () => {
    const mock = new MockSupabase();
    const res = await updateRestaurantTable(mock.client(), 't1', {});
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('VALIDATION');
    expect(mock.calls).toHaveLength(0);
  });

  it('returns NOT_FOUND when the row is gone', async () => {
    const mock = new MockSupabase([{ data: null, error: null }]);
    const res = await updateRestaurantTable(mock.client(), 't99', { capacity: 8 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('NOT_FOUND');
  });
});

describe('tableMutationError', () => {
  const withRaw = (code: string) => ({ code: 'VALIDATION' as const, message: 'raw', raw: { code } });

  it('maps 23505 (label reuse) to a friendly message', () => {
    const e = tableMutationError(withRaw('23505'));
    expect(e.code).toBe('VALIDATION');
    expect(e.message).toContain('already exists');
  });

  it('maps 42501 to FORBIDDEN', () => {
    const e = tableMutationError(withRaw('42501'));
    expect(e.code).toBe('FORBIDDEN');
  });

  it('keeps NETWORK as NETWORK without raw text', () => {
    const e = tableMutationError({ code: 'NETWORK', message: 'fetch failed' });
    expect(e.code).toBe('NETWORK');
    expect(e.message).not.toContain('fetch failed');
  });

  it('falls back to a generic message on unmapped failures', () => {
    const e = tableMutationError({ code: 'UNKNOWN', message: 'duplicate key value violates constraint x' });
    expect(e.code).toBe('VALIDATION');
    expect(e.message).not.toContain('duplicate');
  });
});

describe('restaurantTableRowToView', () => {
  it('maps a row, defaulting an unknown status to available', () => {
    const v = restaurantTableRowToView(makeTableRow() as never);
    expect(v.id).toBe('66666666-6666-6666-6666-666666666666');
    expect(v.label).toBe('T-06');
    expect(v.cap).toBe(4);
    expect(v.status).toBe('available');

    const bad = makeTableRow();
    (bad as unknown as { status: string }).status = 'closed';
    expect(restaurantTableRowToView(bad as never).status).toBe('available');
  });

  it('exposes exactly the DB-supported statuses', () => {
    expect(TABLE_STATUSES).toEqual(['available', 'occupied', 'reserved']);
  });
});