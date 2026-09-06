import { describe, expect, it } from 'vitest';
import {
  ALLOWED_TRANSITIONS,
  VIEW_TO_DB,
  updateReservation,
  cancelReservation,
  reservationMutationError,
  reservationRowToView,
  RES_STATUSES,
} from '../../src/services/reservations';
import { MockSupabase } from './helpers/supabaseMock';

function makeReservationRow() {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    restaurant_id: '22222222-2222-2222-2222-222222222222',
    code: 'RSV-900',
    customer_id: null,
    guest_name: 'Arjun Mehta',
    phone: '+91 98450 11223',
    table_id: '44444444-4444-4444-4444-444444444444',
    reservation_date: '2026-09-20',
    reservation_time: '19:00:00',
    guests: 4,
    status: 'pending' as const,
    notes: 'Window table',
    created_at: '2026-09-06T09:00:00Z',
    updated_at: '2026-09-06T09:00:00Z',
  };
}

describe('ALLOWED_TRANSITIONS', () => {
  it('allows forward movement and blocks terminal states', () => {
    expect(ALLOWED_TRANSITIONS.Pending).toEqual(['Confirmed', 'Cancelled']);
    expect(ALLOWED_TRANSITIONS.Confirmed).toEqual(['Completed', 'Cancelled']);
    expect(ALLOWED_TRANSITIONS.Completed).toEqual([]);
    expect(ALLOWED_TRANSITIONS.Cancelled).toEqual([]);
  });

  it('canonicalizes view statuses to DB values', () => {
    expect(VIEW_TO_DB.Pending).toBe('pending');
    expect(VIEW_TO_DB.Confirmed).toBe('confirmed');
    expect(VIEW_TO_DB.Completed).toBe('completed');
    expect(VIEW_TO_DB.Cancelled).toBe('cancelled');
  });

  it('exposes exactly the DB enum statuses', () => {
    expect(RES_STATUSES).toEqual(['Pending', 'Confirmed', 'Completed', 'Cancelled']);
  });
});

describe('updateReservation — transition enforcement', () => {
  it('allows a legal forward transition', async () => {
    const mock = new MockSupabase([
      { data: { status: 'pending' }, error: null },
      { data: makeReservationRow(), error: null },
    ]);
    const res = await updateReservation(mock.client(), 'r1', { status: 'Confirmed' });
    expect(res.ok).toBe(true);
    expect(mock.calls).toContain('update:{"status":"confirmed"}');
    if (res.ok) expect(res.data.status).toBe('Pending'); // untouched fields preserved by row mapper
  });

  it('blocks a non-allowed forward jump (Pending → Completed)', async () => {
    const mock = new MockSupabase([{ data: { status: 'pending' }, error: null }]);
    const res = await updateReservation(mock.client(), 'r1', { status: 'Completed' });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe('VALIDATION');
      expect(res.error.message).toContain('Confirmed');
      expect(res.error.message).toContain('Cancelled');
    }
    expect(mock.calls.some((c) => c.startsWith('update:'))).toBe(false);
  });

  it('blocks all changes out of a terminal state (Completed)', async () => {
    const mock = new MockSupabase([{ data: { status: 'completed' }, error: null }]);
    const res = await updateReservation(mock.client(), 'r1', { status: 'Confirmed' });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe('VALIDATION');
      expect(res.error.message).toContain('cannot change status anymore');
    }
    expect(mock.calls.some((c) => c.startsWith('update:'))).toBe(false);
  });

  it('treats a repeat status as a no-op write (no transition message)', async () => {
    const mock = new MockSupabase([
      { data: { status: 'confirmed' }, error: null },
      { data: makeReservationRow(), error: null },
    ]);
    const res = await updateReservation(mock.client(), 'r1', { status: 'Confirmed' });
    expect(res.ok).toBe(true);
    expect(mock.calls).toContain('update:{"status":"confirmed"}');
  });

  it('returns NOT_FOUND when the reservation row is gone', async () => {
    const mock = new MockSupabase([{ data: null, error: null }]);
    const res = await updateReservation(mock.client(), 'r99', { status: 'Confirmed' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('NOT_FOUND');
  });

  it('validates empty guest name', async () => {
    const mock = new MockSupabase();
    const res = await updateReservation(mock.client(), 'r1', { guestName: '   ' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('VALIDATION');
    expect(mock.calls).toHaveLength(0);
  });
});

describe('cancelReservation — terminal guard', () => {
  it('cancels a pending reservation', async () => {
    const mock = new MockSupabase([
      { data: { status: 'pending' }, error: null },
      { data: makeReservationRow(), error: null },
    ]);
    const res = await cancelReservation(mock.client(), 'r1');
    expect(res.ok).toBe(true);
    expect(mock.calls).toContain('update:{"status":"cancelled"}');
  });

  it('refuses to cancel a completed reservation', async () => {
    const mock = new MockSupabase([{ data: { status: 'completed' }, error: null }]);
    const res = await cancelReservation(mock.client(), 'r1');
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe('VALIDATION');
      expect(res.error.message).toContain('cannot change status anymore');
    }
    expect(mock.calls.some((c) => c.startsWith('update:'))).toBe(false);
  });

  it('returns NOT_FOUND for a missing reservation', async () => {
    const mock = new MockSupabase([{ data: null, error: null }]);
    const res = await cancelReservation(mock.client(), 'r99');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('NOT_FOUND');
  });
});

describe('reservationMutationError', () => {
  const withRaw = (code: string) => ({ code: 'VALIDATION' as const, message: 'raw', raw: { code } });

  it('maps a 23505 double-book collision to a friendly message', () => {
    const e = reservationMutationError(withRaw('23505'));
    expect(e.code).toBe('VALIDATION');
    expect(e.message).toContain('already has an active reservation');
  });

  it('maps a check violation to a stable validation message', () => {
    const e = reservationMutationError(withRaw('23514'));
    expect(e.code).toBe('VALIDATION');
  });

  it('maps permission-denied to FORBIDDEN with a friendly message', () => {
    const e = reservationMutationError(withRaw('42501'));
    expect(e.code).toBe('FORBIDDEN');
  });

  it('keeps NETWORK errors as NETWORK with a friendly message', () => {
    const e = reservationMutationError({ code: 'NETWORK', message: 'fetch failed' });
    expect(e.code).toBe('NETWORK');
    expect(e.message).not.toContain('fetch failed');
  });

  it('never surfaces raw PostgREST text on unmapped failures', () => {
    const e = reservationMutationError({ code: 'UNKNOWN', message: 'column X does not exist', raw: {} });
    expect(e.code).toBe('VALIDATION');
    expect(e.message).not.toContain('column X');
    expect(e.message).not.toContain('does not exist');
  });
});

describe('reservationRowToView', () => {
  it('maps a canonical row, stripping seconds and resolving table labels', () => {
    const row = makeReservationRow();
    const labels = new Map([[row.table_id!, 'T-06']]);
    const v = reservationRowToView(row as never, labels);
    expect(v.code).toBe('RSV-900');
    expect(v.cust).toBe('Arjun Mehta');
    expect(v.phone).toBe('+91 98450 11223');
    expect(v.time).toBe('7:00 PM');
    expect(v.guests).toBe(4);
    expect(v.table).toBe('T-06');
    expect(v.tableId).toBe(row.table_id);
    expect(v.status).toBe('Pending');
    expect(v.notes).toBe('Window table');
  });

  it('handles a null table and null phone', () => {
    const row = makeReservationRow();
    row.table_id = null;
    row.phone = null;
    const v = reservationRowToView(row as never);
    expect(v.table).toBe('');
    expect(v.phone).toBe('');
  });
});