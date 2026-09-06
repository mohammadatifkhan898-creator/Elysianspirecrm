# Phase 4D — Checkpoint D: Reservations Frontend Integration

**Date:** 2026-09-02  
**Status:** COMPLETE — Build green, E2E green (11/11)

---

## A — What was delivered

Full frontend integration for the Reservations page, connecting it to the Supabase backend with real data, mutation hooks, and role-gated UI.

### Files created (new)
| File | Purpose |
|------|---------|
| `src/services/reservations.ts` | Service layer: list, get, create, update, cancel, code generation (RPC), mapper, error mapping, status transition rules |
| `src/hooks/useReservations.ts` | Hydration hook: loads reservations from DB, resolves table display labels, exposes `canManageReservations` |
| `src/hooks/useReservationActions.ts` | Mutation hooks: `useCreateReservation`, `useUpdateReservation`, `useCancelReservation` with store updates and toast |

### Files modified (existing)
| File | Change |
|------|--------|
| `src/types/index.ts` | Extended `Reservation` interface with optional `code`, `customerId`, `tableId` fields |
| `src/pages/Reservations.tsx` | **Full rewrite** (291 → ~310 lines): real data path, mutation hooks, guided status transitions, linked customer dropdown, table dropdown, permission gate, loading/empty states |
| `src/pages/Tables.tsx` | Added `tableMap` for resolving reservation table labels (from Checkpoint C work, already applied) |

### Files unchanged
- `src/services/reservations.ts` type cast fix: `input.status` (string) cast to DB literal union on `patch.status` to satisfy strict typing

---

## B — Architecture decisions

### Data flow
```
useReservations (read)
  → getCurrentIdentity (restaurant_id, roleSlug)
  → listReservations (SELECT * from reservations)
  → reservationRowToView (DB → view model, table labels from s.tables)
  → replaces s.reservations wholesale (or empties to genuine empty state)

useCreateReservation (write)
  → getCurrentIdentity → tenant.restaurantId
  → getNextReservationCode (RPC → 'RSV-1000')
  → createReservation (INSERT with restaurant_id + code)
  → 23505 handling (double-booking → friendly message)
  → adds to s.reservations + notify + toast

useUpdateReservation (write)
  → updateReservation (UPDATE by uuid, partial fields)
  → 23505 handling on table/time/date change
  → updates in s.reservations + notify + toast

useCancelReservation (write)
  → cancelReservation (UPDATE status='cancelled', never physical DELETE)
  → partial unique index frees slot for new bookings
```

### Mapper design
`reservationRowToView(row, tableLabelMap?)` is a **pure function** (no store dependency). Table labels are resolved externally:
- At load time via `buildTableMap(s.tables)`
- Re-resolved reactively when `s.tables` changes (via `useEffect` in `useReservations`)

This avoids stale label state when tables are added/renamed after initial load.

### Status lifecycle
```
DB lowercase → View title-case:
  pending → Pending
  confirmed → Confirmed
  completed → Completed
  cancelled → Cancelled

Allowed transitions (ALLOWED_TRANSITIONS map):
  Pending → [Confirmed, Cancelled]
  Confirmed → [Completed, Cancelled]
  Completed → [] (terminal)
  Cancelled → [] (terminal)
```

On create: always starts as `Pending` (DB default).  
On edit: guided transition buttons (not a free-form dropdown).  
Terminal statuses: read-only badge displayed, no status dropdown shown.

### Customer handling
- `customerId` is nullable (walk-in guests have no linked CRM record)
- Guest name (`guest_name`) is always required (NOT NULL in DB)
- Customer dropdown: "Walk-in" option + all `s.customers` entries
- Selecting a CRM customer auto-fills name + phone
- Walk-in option clears `customerId` (name/phone editable manually)
- **No automatic customer record creation** (explicit scope exclusion per Checkpoint D spec)

### Table handling
- `tableId` is nullable (unassigned reservations are valid)
- Table dropdown: "No table" option + all `s.tables` entries
- Table display label resolved from `s.tables` map (works for both seed and real data)
- `tableLabel(id, tables)` helper used in form and list rendering
- 23505 unique violation → "This table already has an active reservation for the selected date and time"

### Reservation code generation
- Obtained from `next_reservation_code()` RPC (migration 0007)
- RPC self-gates on `reservations.manage` permission
- Codes are display-only (never used as PK)
- Gaps in sequence are acceptable (rapid clicks may consume multiple codes)

### Error handling
- 23505 (unique violation) → double-booking message
- 42501 (insufficient privilege) → permission denied message
- Validation errors → inline in modal (below form fields)
- Mutation errors → `reservationMutationError()` maps raw DB errors to user-facing messages
- No silent failures — every error path displays feedback

---

## C — Concurrency analysis (D12)

### Case 1: Rapid double-click on "Create Reservation"
**Handled by:** in-flight guards in all three mutation hooks (`if (submitting) return`), combined with the native `disabled={submitting}` attribute on buttons. Even if two clicks pass before React re-renders, the second `run()` call sees `submitting=true` and returns early. At most one RPC + INSERT is issued per modal open.

### Case 2: Two users reserve the same table at the same date+time
**Handled by:** the partial unique index `reservations_no_double_book` (migration 0007). Both INSERTs cannot succeed — the second gets a 23505 error. `reservationMutationError()` maps this to: "This table already has an active reservation for the selected date and time." The first user's reservation is committed. No data corruption. Sequence value is consumed (gap in codes), which is acceptable.

### Case 3: Two users reserve the same table at different times
**Handled by:** no conflict — different `reservation_time` values don't violate the partial unique index. Both INSERTs succeed independently.

### Case 4: User A cancels, User B immediately reserves the same slot
**Handled by:** cancellation sets `status='cancelled'`. The partial unique index only enforces uniqueness for `status IN ('pending','confirmed')`. Once cancelled, the slot is immediately available for User B's new reservation. The physical row remains (audit trail), but the index constraint is satisfied.

### Case 5: Walk-in reservation without a table (`table_id = NULL`)
**Handled by:** the partial unique index only fires `WHERE table_id IS NOT NULL`. Walk-in reservations never trigger double-booking checks. Multiple walk-ins can share the same date+time without conflict.

### Case 6: Cross-tenant isolation
**Handled by:** RLS. The `restaurant_id` on every reservation row is set by the service from `getCurrentIdentity()`, never from user input. The RLS policies enforce:
- SELECT: `restaurant_id = current_restaurant_id() AND has_permission('reservations.view')`
- INSERT/UPDATE/DELETE: `restaurant_id = current_restaurant_id() AND has_permission('reservations.manage')`

User A from Restaurant X can never see or modify Restaurant Y's reservations, even if they guess a UUID.

---

## D — Permissions verification (D13)

### Permission matrix (from 0001 seed, CONFIRMED)

| Role | `reservations.view` | `reservations.manage` | Reservations page access |
|------|---------------------|-----------------------|--------------------------|
| owner-admin | ✅ | ✅ | Full: view, create, edit, cancel |
| manager | ✅ | ✅ | Full: view, create, edit, cancel |
| waiter | ✅ | ❌ | View only, no Add/Edit/Cancel buttons |
| chef | ❌ | ❌ | No access (page hidden from nav) |

### RLS policy enforcement (from 0006, CONFIRMED)

**SELECT (line 255-259):**
```sql
CREATE POLICY "reservations_select" ON reservations
FOR SELECT USING (
  restaurant_id = current_restaurant_id() AND has_permission('reservations.view')
);
```

**INSERT (line 262-266):**
```sql
CREATE POLICY "reservations_insert" ON reservations
FOR INSERT WITH CHECK (
  restaurant_id = current_restaurant_id() AND has_permission('reservations.manage')
);
```

**UPDATE (line 269-273):**
```sql
CREATE POLICY "reservations_update" ON reservations
FOR UPDATE USING (
  restaurant_id = current_restaurant_id() AND has_permission('reservations.manage')
);
```

**DELETE (line 276-280):**
```sql
CREATE POLICY "reservations_delete" ON reservations
FOR DELETE USING (
  restaurant_id = current_restaurant_id() AND has_permission('reservations.manage')
);
```

### Frontend permission gates
- `canManageReservations = roleSlug === 'owner-admin' || roleSlug === 'manager'` (in `useReservations`)
- "Add Reservation" button: `canManageReservations ? <button>...` (line ~279)
- Reservation row click → opens modal: `if (!canManageReservations && !editId) return;` (line ~225)
- The modal itself handles terminal status (no save button) and guided transitions

### No new permissions invented
Checklist from architecture plan:
- [x] No `reservations.manage` added to waiter or chef roles
- [x] No `tables.manage` permission created (tables still use `settings.manage`)
- [x] Owner-admin and manager retain identical permission sets for reservations
- [x] No permission escalation path exists

---

## E — RPC security analysis

### `next_reservation_code()` (0007)
```sql
CREATE OR REPLACE FUNCTION public.next_reservation_code()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  restaurant UUID;
  has_manage BOOLEAN;
BEGIN
  restaurant := public.current_restaurant_id();
  IF restaurant IS NULL THEN RETURN NULL; END IF;
  SELECT has_permission('reservations.manage') INTO has_manage;
  IF NOT has_manage THEN RETURN NULL; END IF;
  PERFORM nextval('reservation_code_seq');
  RETURN 'RSV-' || currval('reservation_code_seq')::text;
END;
$$;

REVOKE ALL ON FUNCTION public.next_reservation_code() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.next_reservation_code() FROM anon;
GRANT EXECUTE ON FUNCTION public.next_reservation_code() TO authenticated;
GRANT EXECUTE ON FUNCTION public.next_reservation_code() TO service_role;
```

**Security properties:**
- `SECURITY DEFINER` — executes as the function owner (superuser), not the caller
- `SET search_path = public, pg_temp` — prevents search path manipulation
- Self-gates on `has_permission('reservations.manage')` — returns `NULL` (not an error) for unauthorized callers
- `REVOKE FROM PUBLIC, anon` — anonymous access blocked at the function level
- Sequence owned by postgres, ACL grants `rwU` to `authenticated` and `service_role` — but the function controls all access
- JWT claims derived via `auth.jwt() ->> 'sub'` (TEXT, never `auth.uid()`)

**Consequence for non-managers (waiter, chef):** RPC returns `NULL` → `getNextReservationCode()` returns `FORBIDDEN` error → "Unable to generate reservation code. You may not have permission." → create form shows error, no row inserted.

---

## F — Build verification (D14)

```
$ npx tsc -b
(no output — clean)

$ npm run build
vite v5.4.21 building for production...
✓ 198 modules transformed.
✓ built in 6.97s
dist/index.html                   0.73 kB │ gzip:   0.40 kB
dist/assets/index-5imVnNST.css   46.61 kB │ gzip:   9.28 kB
dist/assets/index-BRTfEIiG.js   652.11 kB │ gzip: 178.14 kB

$ npm run test:e2e
Running 11 tests using 1 worker
  ✓ 11 passed (50.4s)
```

All three gates pass. Module count increased from 195 (Checkpoint C) to 198 (3 new modules: useReservations, useReservationActions, reservations service).

---

## G — What was NOT changed

Per Checkpoint D scope exclusions (CONFIRMED):
- [x] No migration changes (0007 untouched)
- [x] No RLS policy weakening
- [x] No new permissions added to seed
- [x] No table automation modification
- [x] No service_role exposure to frontend
- [x] No demo data inserted into DB
- [x] No automatic table status synchronization
- [x] No CRM page redesigns

---

## H — Seed data compatibility

The mock reservation seed (`seedState.reservations`) uses a flat shape without `code`, `customerId`, or `tableId`. The integration handles this gracefully:

- `r.code` is undefined on seed rows → search uses `r.cust + r.phone + r.table + r.notes` only (code not searched)
- `r.customerId` is undefined on seed rows → customer dropdown defaults to "Walk-in"
- `r.tableId` is undefined on seed rows → table dropdown defaults to "No table", list shows `r.table` (the display code)
- Calendar count works because `r.date` is in ISO format (`'2026-08-27'`) matching `fmtDate()` output
- `r.status` is already title-case (`'Confirmed'`, `'Pending'`) — same as view model

Seed data remains fully functional without any DB connection.

---

## I — Table display label resolution

Labels are resolved at three points to stay current:

1. **At load time** (`useReservations.load`): `buildTableMap(s.tables)` maps `tableId → label` for all rows
2. **On table change** (`useReservations.useEffect`): re-resolves all labels when `s.tables` mutates
3. **On mutation success** (`useReservationActions`): `resolveTable(res.data.tableId, s.tables)` for newly created/updated rows

Fallback: if a `tableId` has no matching entry in `s.tables`, `table` is set to `''` (empty string). The booking list renders `r.table || 'No table'`.

---

## J — Loading and empty states

| `loadStatus` | UI |
|--------------|-----|
| `'idle'` / `'loading'` | "Loading reservations..." centered text |
| `'loaded'` | Normal booking list (filtered by selected date + search) |
| `'empty'` (DB returns 0 rows) | "No reservations yet" (when no search term) or "No reservations this date" (when date has no matches) |
| `'error'` | `error.message` displayed (from `useReservations`) |

The genuine empty state (`'empty'`) confirms the DB is clean — no demo data injected, consistent with Checkpoint C behavior.

---

## K — Search behavior

Search filters by: `r.cust`, `r.phone`, `r.table`, `r.notes` (case-insensitive substring match). Reservation codes and UUIDs are **not** searched (display codes are opaque, not user-meaningful search targets).

When `q` is empty, all reservations for the selected date are shown. When `q` has content, the filter applies across all fields simultaneously.

---

## L — Calendar integration

The calendar `MonthGrid` counts reservations per date from `s.reservations`, excluding `Cancelled` status (cancelled reservations don't show count dots). This matches the business meaning: a cancelled reservation shouldn't appear as a "booking" on the calendar.

Seed data reservations and real DB reservations coexist in `s.reservations` — both use ISO date strings matching `fmtDate()` output, so counting works correctly in either mode.

---

## M — Guided status transitions (edit mode)

The edit modal uses `ALLOWED_TRANSITIONS` from the service to determine which status buttons to show:

```
Current status  →  Available transitions
Pending         →  [Confirmed, Cancelled]
Confirmed       →  [Completed, Cancelled]
Completed       →  (terminal — read-only badge, no buttons)
Cancelled       →  (terminal — read-only badge, no buttons)
```

Current status is always shown as a disabled "navy" button. Transition buttons use `btn-navy` (forward) or `btn-danger` (cancel). Selecting a transition updates local state; the API call uses the DB status literal (`VIEW_TO_DB[status]`).

If a user somehow submits with an invalid transition (impossible via UI, but defensively checked): the form validates `allowed.includes(status)` and shows an error.

---

## N — Next steps (Checkpoint E)

1. **Real sign-in verification** (manual): Sign in as owner-admin, manager, and waiter. Verify:
   - Owner/manager: full CRUD works, 23505 shows double-booking message, codes increment
   - Waiter: can view reservations, cannot see Add button, cannot edit
   - Cross-tenant: sign in as different user, confirm no data leakage
2. **Edge case testing** (manual): Create reservation → cancel → re-reserve same slot (confirms partial index frees on cancel)
3. **Checkpoints A–D are complete. Do not start Checkpoint E (full validation sweep) until explicitly instructed.**

---

**Checkpoint D — COMPLETE. STOP.**
