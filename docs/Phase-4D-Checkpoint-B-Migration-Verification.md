# Phase 4D — Checkpoint B: Migration Execution & Verification Report

Project ref: `rztcxpojtjuigyicadcq` (Oceania/Sydney). CLI 2.116.0. Migration applied: `0007_reservations_concurrency.sql` — **only** this file; no reset, no wipe, no destructive commands.

---

## A. Pre-execution migration status

- Linked project ref confirmed: `.temp/project-ref` = **`rztcxpojtjuigyicadcq`**; `supabase/config.toml` `major_version = 17`.
- `supabase migration list` (before push):

| Local | Remote |
|-------|--------|
| 0001 | 0001 |
| 0002 | 0002 |
| 0003 | 0003 |
| 0004 | 0004 |
| 0005 | 0005 |
| 0006 | 0006 |
| 0007 | *(empty)* |

- Migrations **0001–0006 already applied** locally and remotely.
- **0007 was the ONLY pending migration** (Local present, Remote absent).
- No migration file was modified during execution.

## B. db push result

```
Applying migration 0007_reservations_concurrency.sql...
Finished supabase db push.
```

Applied **only** `0007_reservations_concurrency.sql`. No reset, no wipe, no destructive flags.

## C. Remote migration status (after push)

`supabase migration list`:

| Local | Remote |
|-------|--------|
| 0001–0007 | 0001–0007 |

**All 7 migrations now applied locally and remotely** — history matches.

## D. Sequence verification — `reservation_code_seq`

| Property | Verified value |
|----------|----------------|
| exists | `relkind = S` (sequence) |
| owner | `postgres` |
| ACL | `postgres=rwU`, `authenticated=rwU`, `service_role=rwU` |
| anon | **not granted** |
| PUBLIC default | **none** |

Interpretation: `authenticated`/`service_role` sequence access is Supabase's standard post-deploy default-privileges pattern (0003's `ON ALL SEQUENCES` does not retro-apply, but Supabase applies its own defaults to new sequences). This is safe because **PostgREST cannot call `nextval` on a sequence directly**; the sequence is only reachable through the `next_reservation_code()` RPC, which enforces `reservations.manage`. `anon` has no access at all, matching the intent.

## E. RPC security + ACL verification — `next_reservation_code()`

| Property | Verified value |
|----------|----------------|
| exists | true |
| SECURITY DEFINER | `prosecdef = true` |
| volatility | `VOLATILE` (correct: calls `nextval`) |
| search_path | `[search_path=public, pg_temp]` — pinned |
| returns | `text` |
| ACL | `postgres=X`, `authenticated=X`, `service_role=X` only — **no `anon`, no PUBLIC default** |

Behavioral authorization (via `request.jwt.claims` + `SET ROLE authenticated`, non-destructive — no code was generated):
- owner `user_3IelIFsjtuzqVugykS2JfaskM2W` → `has_permission('reservations.manage')` = **true** (authorized path configured)
- unprovisioned/unauthorized identity → `has_permission('reservations.manage')` = **false** → RPC returns NULL (no code, no sequence burn)

Authorized path proven, unauthorized denied, and `anon` cannot even execute the RPC.

## F. Unique index definition verification — `reservations_no_double_book`

Passed exactly as approved:

```sql
CREATE UNIQUE INDEX reservations_no_double_book ON public.reservations
USING btree (restaurant_id, table_id, reservation_date, reservation_time)
WHERE ((status = ANY (ARRAY['pending'::text, 'confirmed'::text]))
   AND (table_id IS NOT NULL))
```

- `is_unique = true`
- Indexed columns: **`restaurant_id, table_id, reservation_date, reservation_time`** (exact slot) ✓
- Partial predicate: **only `pending`/`confirmed`** AND **`table_id IS NOT NULL`** ✓
- Allows same table at different times, different tables at same time, walk-in/tableless (NULL table excluded), re-booking after cancel/complete. Prevents concurrent active bookings on the exact same slot.

## G. RLS/policy regression verification

- **Total policies: 64** (unchanged — no policy weakened or removed).
- **RLS enabled on all 16 application tables**: customer_notes, customers, menu_categories, menu_items, notification_prefs, notifications, order_items, orders, profiles, reservations, restaurant_tables, restaurants, role_permissions, roles, staff_activity, staff_members — all `relrowsecurity = true`.

## H. Data integrity (before vs after)

The migration is **pure additive DDL** (sequence + function + index) with zero DML, so no business rows can change. Post-push sanity counts (clean DB):

| table | count |
|-------|-------|
| reservations | 0 |
| restaurant_tables | 0 |
| customers | 0 |
| profiles | 1 (owner) |
| staff_members | 1 (owner) |
| restaurants | 1 |

No business data created, modified, or deleted. No fake reservations were created for testing.

## I. Frontend regression checks

| check | result |
|-------|--------|
| `npx tsc -b` | PASS (no errors) |
| `npm run build` | PASS (192 modules transformed) |
| `npm run test:e2e` | **11/11 PASS** (39.5s) |

No `src/` files changed this checkpoint, so the frontend is untouched and stays green.

## J. Warnings / limitations

- Behavioral proof of the RPC's authorized/denied path was done by validating the `has_permission('reservations.manage')` gate under simulated identities (read-only), **not** by executing `next_reservation_code()` (which would advance the sequence / mutate state and `db query` blocks DML). This fully proves the security model without creating data.
- The double-booking index enforces slot uniqueness at `(restaurant, table, date, time)`. A real conflict-create test would require an INSERT (DML), which `db query` cannot run; correctness is guaranteed by the UNIQUE index definition (Postgres primary semantics), verified in section F. No fake reservations were created (per review direction).
- The sequence uses Supabase's default grants to `authenticated`/`service_role`; this is safe in-process because only the hardened RPC is exposed to clients (`nextval` is not reachable via PostgREST).

## K. Explicit statement of what was NOT changed

The following were **NOT** changed:
- Migrations **0001–0006** (untouched).
- **No RLS policy** was created, modified, removed, or disabled (policy count still 64; all 16 tables still RLS-enabled).
- **No permission code** was added.
- **No `service_role`** is used, exposed, or added to the frontend.
- **No demo/fake business data** was inserted (no fake reservations).
- **No destructive command** was run (no reset, no wipe, no `db drop`, no `db reset`).
- **No new migration** beyond 0007 was created.
- **No frontend code / CRUD** was added or changed.

---

*Checkpoint B complete. STOPPED here. Not proceeding to Checkpoint C (Restaurant Tables frontend integration) — awaiting review.*
