# Phase 7 — Full CRM QA, Workflow & Permission Audit Report

**Product:** Elysian Spire CRM (Vite + React + TypeScript, Supabase, Clerk)
**Date:** 06 Sep 2026
**Basis:** Full-module audit (9 pages), workflow tracing, permission-matrix audit, and a Phase 7 bug-fix pass. Every claim below is either directly executed (see §6) or traced through the actual source (see §7). Nothing is fabricated.

---

## 1. Module audit

| # | Module | Verdict | Notes |
|---|--------|---------|-------|
| 1 | Dashboard | **FIXED** | KPIs are derived from the hydrated store, never fabricated. Charts render honest empty states. Added a load-error banner with Retry (was silently showing "No orders yet" on failure). |
| 2 | Orders | **FIXED** | Full read/write flow is real-data (list, atomic `create_order` RPC, status advance, mark-paid, realtime re-fetch). The service previously claimed to enforce the status lifecycle but did not — **now enforced** (§4.1). Load-error branch already present. |
| 3 | Reservations | **FIXED** | Create/update/cancel hit the DB with server code via `next_reservation_code()` RPC; double-book 23505 mapped to a friendly message. `updateReservation` ignored the allowed-transition table and `cancelReservation` could cancel a Completed booking — **both now enforced** (§4.2). Added load-error banner + Retry (failed loads previously rendered as a blank/empty list). |
| 4 | Tables | **FIXED** | Soft-delete semantics preserved (migration 0009 partial-unique index on `restaurant_tables`), label reuse works. Load failures previously rendered a blank floor (no error branch) — **added error panel + banner + Retry**. |
| 5 | Customers | **FIXED** | Real CRUD + immutable notes; soft-delete never destroys history. Raw PostgREST text leaked on duplicate phone/email (23505) — **mapped to a friendly message** (§4.3). Drawer order history was name-matched only; **now matched by `customerId`** with a name fallback, plus a related-reservations section (§4.7). |
| 6 | Menu | **PASS** | Categories come from real DB rows, item list filters `menu_items.on`, writes are inventory-gated, realtime re-fetch subscribed. No issues found. |
| 7 | Staff & Roles | **FIXED** | Multiple issues, all addressed (§4.5–4.6): custom roles were persisted **with zero permissions** (display labels sent to an RPC that only accepts slugs); the permission matrix mutated in-memory seeds with no persistence; invitations toasts claimed email was sent (local-only). See details below. |
| 8 | Reports | **FIXED** | Period tabs ("Today/This Week/This Month/Custom") were cosmetic — **now actually filter orders** in the restaurant's calendar zone; Top-items follows the selected period. Added load-error banner + Retry. Historical charts still render honest empty states (analytics service not built — documented, not faked). |
| 9 | Settings | **PASS** | Page is browseable by any authenticated user; write actions are gated by `settings.manage` and RLS on the backend (no `settings.view` slug exists by design). |

---

## 2. Workflow results

Verification tiers: **executed** / **statically verified** (code-path trace) / **✓ checks passed as part of the automated run**.

| Workflow | Steps verified | Tier |
|----------|----------------|------|
| Orders | Create via `create_order` RPC — server resolves prices, computes subtotal/tax/total, generates `ORD-####`; status advance New→Preparing→Ready→Completed now blocked on any backward/illegal transition and out of terminal states; mark-paid persists `pay_status`; realtime refreshes the list on any change | Statically verified (service + hook trace); requires live DB to execute |
| Reservations | Create obtains a server code, 23505 double-booking mapped; edit enforces `ALLOWED_TRANSITIONS`; cancel refuses terminal (Completed/Cancelled) states; list canonicalizes DB statuses | Statically verified; requires live DB to execute |
| Tables | Create/update/status/soft-delete; label uniqueness via partial index (0009) allows delete→recreate; deleted tables keep reservation history | Statically verified; requires live DB to execute |
| Customers | Create/update/soft-delete + immutable notes; duplicate-contact 23505 → friendly message (was raw SQL text) | Statically verified; requires live DB to execute |
| Menu | Category list from DB (`Record<category, MenuItem[]>`), availability filter, realtime refetch | Statically verified; requires live DB to execute |
| Staff & Roles | Role change persists via `staff_members.role_id` and refetches identity; custom roles now persist real permission slugs (§4.5); system-role matrix read-only; invitations honestly labeled local-only | Statically verified; requires live DB to execute |

> **Overall status:** the combined tsc/build/e2e run is green (see §6). The six workflow *operations* above depend on a live Supabase + Clerk session, which this environment cannot produce — they are traced through code, not executed. See §7 for the exact live-test checklist.

---

## 3. Permission audit

Backend (RLS + role system) remains the **source of truth**: `getCurrentIdentity` → `role_permissions`, resolved through `effectivePermissions` / `identityHasAny` in `src/routing/routes.ts`.

### Verified facts
- **Owner/Admin** always receives the full catalog (`owner-admin` slug bypass) — the one deliberate exception in `effectivePermissions`.
- **Non-owner roles** are driven purely by their DB `role_permissions`. The in-memory `ROLE_PERMS` seed maps **display only** and was previously being mutated by the UI as if persistent — **that path is removed** (§4.5).
- System roles (`is_custom = false`) **cannot** be edited or deleted via the `update_custom_role` / `delete_custom_role` SECURITY DEFINER RPCs — the matrix is now read-only for them, matching the backend contract.
- Tables/Settings are browseable by all (no `tables.*` / `settings.view` slugs exist); *actions* are gated by `settings.manage` in both the UI and RLS.
- Custom-role permissions were **persisted as empty** because the UI sent display labels (`"View Orders"`) to an RPC that filters against slug codes (`"orders.view"`) — fixed at the service boundary (§4.5). Must be verified live.

### Audit findings / inconsistencies
1. **Display-vs-slug collapse.** Several distinct labels map to the same slug (`View Reports`+`Export Reports` → `reports.view`; `Invite Staff`+`Manage Roles` → `staff.manage`; `View/Create/Edit/Delete Customers` → `customers.view`/`customers.manage`). The matrix shows the fine-grained labels; the DB stores the collapsed slug. This is a known simplification, now consistent in both directions (create/edit and display).
2. **"Sidebar access by role" panel** (Roles tab) is a **static illustration** from seed `ROLE_NAV`, not enforced at runtime — the real Sidebar renders all nine sections for any authenticated user (documented intent in `routes.ts`). The panel cites roles ("Receive reservations", etc.) that do not exist as enrollment rules.
3. **No `Receptionist` role** exists in the seeds (Owner/Admin, Manager, Waiter, Chef, Cashier, Inventory Manager, Host/Hostess, Kitchen Staff). Host/Hostess covers the reception duties of the brief. Called out, not hidden.
4. **Zero-permission custom role** is legal: a member on such a role sees the pages (auth-gated) but every action gate fails. Honest consequence of the role system.
5. **RLS + UI double-gating:** every write is gated server-side; page-level controls are a convenience. A denied write surfaces as a mapped FORBIDDEN error (no raw text).

---

## 4. Bugs fixed

| # | Root cause | Files changed |
|---|------------|---------------|
| 4.1 | `updateOrderStatus` accepted any status write; docstring claimed lifecycle enforcement that didn't exist (terminal states could be "advanced"). | `src/services/orders.ts` — fetches current status, validates against `STATUS_NEXT`, blocks illegal/backward moves, treats same-status as idempotent no-op, returns NOT_FOUND + friendly VALIDATION messages. |
| 4.2 | `updateReservation` ignored `ALLOWED_TRANSITIONS`; `cancelReservation` could cancel a Completed booking. | `src/services/reservations.ts` — both now enforce the transition table; added `transitionMessage` helper. |
| 4.3 | `reservationMutationError` / `tableMutationError` returned **raw PostgREST/network text** for unmapped codes; `customers` had no 23505 mapping (duplicate phone/email leaked raw SQL). | `src/services/reservations.ts`, `src/services/restaurantTables.ts`, `src/services/customers.ts` (new `customerMutationError`) — generic friendly fallbacks + network handling; wired into `src/hooks/useCustomerActions.ts`. |
| 4.4 | All mutation hooks lacked in-flight guards; Overlay snapshots freeze the `submitting` prop, so double-click could duplicate creates. | `src/hooks/useReservationActions.ts` (3), `useRestaurantTableActions.ts` (4), `useCustomerActions.ts` (create/update/delete + note save) — `busyRef` re-entry guard + friendly "still saving" error. |
| 4.5 | Custom roles persisted with **empty permissions**: display labels sent to RPCs that filter against slug codes. | `src/services/staff.ts` — `toRoleSlugs` translates display → slug (with dedupe) at the service boundary. |
| 4.6 | Custom roles didn't reappear after refresh (`useStaff` never hydrated `ss.customRoles`); permission matrix edited in-memory `ROLE_PERMS` seeds with a success toast and no persistence; matrix editable for system roles that the backend refuses to modify. | `src/hooks/useStaff.ts` (hydrate `ss.customRoles` from DB with slug→display map, clear on not-configured); `src/pages/StaffRoles.tsx` (matrix read-only for system roles with an explanatory note; system-role seeds no longer mutated; custom-role toggles write through `update_custom_role` with optimistic apply + rollback on failure); `src/pages/staff/parts.tsx` (dedupe `allRoleNames` — DB roles + hydrated customs collided). |
| 4.7 | Profile-drawer role change opened without `onRoleChanged` → identity (and therefore permissions/nav) wasn't refreshed after changing your own or another member's role. | `src/pages/StaffRoles.tsx` + `src/pages/staff/modals.tsx` — `MemberProfileDrawer` accepts and forwards `onRoleChanged={refreshIdentity}` to `ChangeRoleModal`. |
| 4.8 | Customer drawer history matched orders by **name only**; related reservations never surfaced (orders view lacked `customerId`). | `src/types/index.ts` + `src/services/orders.ts` (view model carries `customerId` + `placed`); `src/pages/Customers.tsx` (history filtered by `customerId` with name fallback; new Reservations section). |
| 4.9 | Reports period tabs were cosmetic; Reports and Dashboard showed no load-error state; Reservations/Tables failed loads rendered as empty states. | `src/pages/Reports.tsx` (Kolkata-zone period filter, error banner/retry, period-aware Top Items); `src/pages/Dashboard.tsx` (error banner/retry); `src/pages/Reservations.tsx` + `src/pages/Tables.tsx` (error banner/retry + distinct error panels). |
| 4.10 | Invite/Resend toasts claimed invitations were "sent" though email delivery is not wired up. | `src/pages/staff/modals.tsx` + `src/pages/StaffRoles.tsx` — honest copy ("recorded locally — email delivery not wired up"). |

---

## 5. Remaining issues

1. **Service-layer unit tests (added post-report).** The repo originally had no runner other than Playwright, so the service/hook fixes could only be code-traced. A **vitest 3** runner (`npm test`, `tests/unit/`) was added after the fixes landed, converting the pure service logic (order lifecycle, reservation transitions, error mappers, `toRoleSlugs`, permission routing) into **77 executed unit tests** — see §6. Still **not** covered: anything requiring a live DB/Clerk session (§7), and the React page components themselves (jest-environment-jsdom / @testing-library would be needed for those).
2. **Tables drawer status staleness.** The drawer body snapshots the table at open time; `StatusControl` re-subscribes via `useStore` but still reads the prop snapshot, so an on-floor status change elsewhere won't repaint the open drawer until reopened. Low impact.
3. **Invitations are local-only** (no email provider, by design). UI copy is now honest about it.
4. **Reports historical charts** remain honest empty states pending an analytics/aggregation service.
5. **Permission labels collapse to shared slugs** (see §3.1) — a deliberate simplification; the matrix displays labels while the DB stores the collapsible slug.
6. **No "Receptionist" role** in seeds — Host/Hostess serves that function (call-out, not a fix).
7. **Order lifecycle has no cancellation path.** `Cancelled` is a valid display state (history), and the service now refuses to target it from a non-terminal state. If cancellation is wanted, it needs an explicit transition + UI.
8. **Custom-role toggles persist one RPC per click** — acceptable; could be batched if chatty.
9. **e2e rely on `reuseExistingServer`** — results reflect whatever app is served on the configured port; a stale dev server could mask changes (they were green in this run).
10. **Tab-label→slug duplication is now symmetric but unforgiving** — a typo'd permission label silently drops the permission (RPC-side filter). Acceptable today.

---

## 6. Automated verification (exact results)

| Check | Command | Result |
|-------|---------|--------|
| Unit tests (service layer) | `npm test` (`vitest run`, `tests/unit/`) | ✅ **77 passed** across 6 suites: orders (lifecycle enforcement, idempotent no-op, terminal guard, NOT_FOUND, RPC payload hygiene), reservations (transition table, cancel terminal guard, mapping/error mappers), customers (tenant-context insert, validation, 23505/42501/NETWORK mappers), tables (label normalize, validation, mappers), staff (`toRoleSlugs` display→slug incl. dedupe, custom-role RPC payloads), routing (`effectivePermissions`, `identityHasAny`, `sidebarKeyFromPath`). |
| Typecheck | `npx tsc -b` | ✅ **Clean** (no errors) — after final edits |
| Production build | `npm run build` | ✅ **Success** — Vite 5.4.21, 209 modules, built in **4.82s**. Outputs: `dist/index.html` 0.73 kB; `ElysianSpirelogo` 78.41 kB; CSS 51.66 kB (gzip 9.98 kB); JS 683.47 kB (gzip 184.43 kB). One non-fatal warning: JS chunk > 500 kB after minification (recommends code-splitting — pre-existing, not introduced here). |
| E2E | `npx playwright test` | ✅ **11 passed** (1 worker, **43.5s**) — `tests/e2e/auth.spec.ts`: unauth redirects, root redirect, login/signup rendering, Google/OR dividers, brand lockup, SSO callback, forgot form, guest-only routes, no-page-errors. |

The four checks ran **after** all Phase 7 fixes landed. Test infra additions: `vitest@^3.2.7` (pinned to the Vite 5 peer range), `vitest.config.ts` (unit-scoped include, node environment), a chainable Supabase mock at `tests/unit/helpers/supabaseMock.ts`, and `npm test` / `npm run test:unit` scripts. `toRoleSlugs` was exported from the staff service to make the permission-fix directly testable.

---

## 7. Live-testing limitations

This environment has no way to establish a real Clerk auth session against a provisioned Supabase instance, so authenticated UI/DB behavior cannot be *executed* here. The list below separates what was actually run from what is code-verified, and what a reviewer must click through on a live build.

**Actually executed (this environment):**
- `npm test` — 77 service-layer unit tests passed (details in §6).
- `tsc -b` clean, `npm run build` success, `playwright test` 11/11 — see §6.
- Static reads through every file referenced in §4 (services, hooks, pages, staff parts/modals, routing, store, migrations 0001–0010), including the exact root causes quoted above.

**Executed as isolated unit tests (pure service logic, mocked Supabase client):**
- Order lifecycle enforcement: legal forward transition writes `status:preparing`; backward moves, terminal-state moves and repeat-of-current all behave correctly (the last as an idempotent no-op that never touches the DB); NOT_FOUND for a missing row; unknown status rejected before any I/O.
- Reservation transitions: Pending→Confirmed allowed, Pending→Completed rejected with the allowed-list message, terminal Completed→anything rejected, repeat write is a no-op; cancel blocked on Completed/Cancelled; NOT_FOUND paths.
- Error mappers: order/unavailable → VALIDATION; order/permission → FORBIDDEN; reservation 23505/23514/42501/NETWORK/unmapped; customer and table 23505/42501/NETWORK/unmapped — all friendly, no raw PostgREST text leaks.
- Custom-role permission translation: display labels → canonical slugs (incl. shared-slug dedupe), bare-slug passthrough, unknown labels dropped — verified in both `create_custom_role` and `update_custom_role` RPC payloads.
- Permission routing: `effectivePermissions` owner-admin full-catalog bypass + fresh-array guarantee; `identityHasAny` OR semantics, empty-required pass, null-identity behavior.
- Tenant-context hygiene: customer/table creates put `restaurant_id` from the passed identity and never from input.
- The `identityHasAny` test surfaced and corrected a docstring mismatch (empty `required` passes even for a null identity).

**Statically verified (code-path trace, not executed):**
- Hook-level `busyRef` guards on all seven mutation hooks + note save.
- DB hydration of the roles matrix, system-role read-only matrix, identity refresh on drawer role change.
- Period filtering in Kolkata-zone bounds; customer history/reservation matching by `customerId`.
- RLS/role_system facts (§3) traced through migrations 0009/0010 and `getCurrentIdentity`.

**Requires manual authenticated live testing (local emulator or provisioned project):**
1. Two different staff members (Owner/Admin + Waiter) reach the pipeline; verify a Waiter's kitchen advance is denied by both UI gate and RLS (FORBIDDEN mapping).
2. Order lifecycle: New→Preparing→Ready→Completed; confirm Completed→Preparing is blocked with the friendly message, and Completed→Completed no-op.
3. Double-booking (same table+slot): confirm the friendly 23505 message, not raw SQL.
4. Cancel a Completed reservation — blocked with the transition message.
5. Customer with duplicate phone/email — friendly validation message.
6. Double-click the Create/Save buttons in Reservation, Customer, and Table modals — exactly one row created.
7. Custom role: create with permissions → refresh page → role persists with its permissions; toggle a permission → value persists; assign a member → their action gates reflect it.
8. System-role matrix: attempt edits — matrix is read-only with the explanatory note.
9. Change your own role from the Staff Profile drawer → sidebar/action gates update without a hard refresh.
10. Reports: place orders on different days via the app or DB, then Today/This Week/This Month → KPIs and Top Items change accordingly.
11. Table delete → re-add same label (partial-unique index allows it); old reservations keep their history.