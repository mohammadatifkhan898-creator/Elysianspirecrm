/* ═══════════════════════════════════════════════════════════════
   Staff service — real-data read + role write for the Staff & Roles page.

   Follows the Phase 4B conventions (ServiceResult<T> / ServiceError /
   toServiceError). Tenant scoping is derived by RLS; reads never send a
   client-supplied restaurant_id.

   WRITE — updateStaffRole persists a member's role (staff_members.role_id);
   RLS enforces the tenant scope and requires `staff.manage`, so only an owner
   or manager can change roles. Invitations, permission edits and removal
   remain read-only config (not fabricated here).

   Reads are SELECT-scoped by RLS to the caller's restaurant. lists exclude
   soft-deleted members (deleted_at set) and return roles_(id, name) + the
   member's activity timeline.
   ═══════════════════════════════════════════════════════════════ */

import type { AppSupabaseClient } from '../lib/supabase';
import type { RolesRow, StaffActivityRow, StaffMembersRow } from '../types/database';
import type { InvStatus, MemberStatus, StaffMember } from '../types/staff';
import { PERMISSION_KEYS } from '../data/seed';
import { toServiceError, type ServiceResult } from './shared';

const DB_TO_STATUS: Record<string, MemberStatus> = {
  active: 'Active',
  pending: 'Pending',
  suspended: 'Suspended',
};

const DB_TO_INV: Record<string, InvStatus> = {
  pending: 'Pending',
  accepted: 'Accepted',
  expired: 'Expired',
  revoked: 'Revoked',
};

/* ── READ ─────────────────────────────────────────────────────── */

interface StaffJoinRow extends StaffMembersRow {
  roles?: { id: string | null; name: string | null } | null;
  staff_activity?: StaffActivityRow[];
}

/**
 * List non-deleted staff members for the caller's restaurant (RLS-scoped),
 * resolving their role name and activity timeline.
 */
export async function listStaff(supabase: AppSupabaseClient): Promise<ServiceResult<StaffMember[]>> {
  const { data, error } = await supabase
    .from('staff_members')
    .select('id, role_id, *, roles(id, name), staff_activity(id, title, detail, created_at)')
    .is('deleted_at', null)
    .order('name', { ascending: true });

  if (error) return { ok: false, error: toServiceError(error) };

  return {
    ok: true,
    data: (data as unknown as StaffJoinRow[]).map(staffRowToView),
  };
}

/**
 * List all roles for building role-change dropdowns plus custom-role CRUD.
 * The roles table is a global reference with a SELECT-allowed RLS policy, so
 * no tenant scoping is needed here. Custom roles carry their id + description
 * so they can be rendered and edited/deleted by id via RPC.
 */
export async function listRoles(
  supabase: AppSupabaseClient,
): Promise<ServiceResult<{ id: string; name: string; description: string | null; is_custom: boolean }[]>> {
  const { data, error } = await supabase.from('roles').select('id, name, description, is_custom').order('name', { ascending: true });

  if (error) return { ok: false, error: toServiceError(error) };

  return {
    ok: true,
    data: (data as RolesRow[]).map((r) => ({ id: r.id, name: r.name, description: r.description, is_custom: r.is_custom })),
  };
}

/**
 * Resolve the permission display names for a role. Returns the human-facing
 * permission labels (e.g. "View Orders") mapped from internal slugs via the
 * PERMISSION_KEYS map in seed.ts.
 */
export async function listRolePermissions(
  supabase: AppSupabaseClient,
  roleId: string,
): Promise<ServiceResult<string[]>> {
  const { data, error } = await supabase
    .from('role_permissions')
    .select('permission')
    .eq('role_id', roleId);

  if (error) return { ok: false, error: toServiceError(error) };

  return { ok: true, data: (data as { permission: string }[]).map((r) => r.permission) };
}

/**
 * Persist a staff member's role by setting staff_members.role_id. RLS enforces
 * the tenant scope and requires `staff.manage`, so a non-manager can never
 * self-promote or move a member across tenants.
 */
export async function updateStaffRole(
  supabase: AppSupabaseClient,
  staffId: string,
  roleId: string,
): Promise<ServiceResult<null>> {
  const { error } = await supabase.from('staff_members').update({ role_id: roleId }).eq('id', staffId);

  if (error) return { ok: false, error: toServiceError(error) };
  return { ok: true, data: null };
}

/* ── Custom role CRUD (via SECURITY DEFINER RPCs) ────────────── */

/**
 * The role RPCs persist canonical slug codes (e.g. 'orders.view') filtered
 * against ALL_PERMISSION_SLUGS, while the UI works in display labels
 * (e.g. 'View Orders'). Translate display names to slugs here so custom-role
 * permissions actually persist; bare strings that are already slugs pass
 * through untouched, and unknown values are dropped (the RPC would reject
 * them anyway).
 */
export function toRoleSlugs(perms: string[]): string[] {
  const out = new Set<string>();
  for (const p of perms) {
    const slug = PERMISSION_KEYS[p];
    if (slug) out.add(slug);
    else if (p.includes('.')) out.add(p);
  }
  return [...out];
}

export interface CustomRoleResult {
  roleId: string;
  name: string;
}

/**
 * Create a custom role via the create_custom_role RPC. Only Owner/Admin
 * can invoke this (gated by staff.manage permission in the RPC).
 */
export async function createCustomRole(
  supabase: AppSupabaseClient,
  name: string,
  description: string,
  permissions: string[],
): Promise<ServiceResult<CustomRoleResult>> {
  const { data, error } = await supabase.rpc('create_custom_role', {
    p_name: name,
    p_description: description,
    p_permissions: toRoleSlugs(permissions),
  });

  if (error) return { ok: false, error: toServiceError(error) };

  const result = data as { ok: boolean; error?: string; role_id?: string; name?: string };
  if (!result.ok) {
    return { ok: false, error: { code: 'VALIDATION', message: result.error || 'Could not create role.' } };
  }

  return { ok: true, data: { roleId: result.role_id!, name: result.name || name } };
}

/**
 * Update a custom role via the update_custom_role RPC.
 */
export async function updateCustomRole(
  supabase: AppSupabaseClient,
  roleId: string,
  name: string,
  description: string,
  permissions: string[],
): Promise<ServiceResult<null>> {
  const { data, error } = await supabase.rpc('update_custom_role', {
    p_role_id: roleId,
    p_name: name,
    p_description: description,
    p_permissions: toRoleSlugs(permissions),
  });

  if (error) return { ok: false, error: toServiceError(error) };

  const result = data as { ok: boolean; error?: string };
  if (!result.ok) {
    return { ok: false, error: { code: 'VALIDATION', message: result.error || 'Could not update role.' } };
  }

  return { ok: true, data: null };
}

/**
 * Delete a custom role via the delete_custom_role RPC. Fails if any
 * staff members still reference this role.
 */
export async function deleteCustomRole(
  supabase: AppSupabaseClient,
  roleId: string,
): Promise<ServiceResult<null>> {
  const { data, error } = await supabase.rpc('delete_custom_role', {
    p_role_id: roleId,
  });

  if (error) return { ok: false, error: toServiceError(error) };

  const result = data as { ok: boolean; error?: string };
  if (!result.ok) {
    return { ok: false, error: { code: 'VALIDATION', message: result.error || 'Could not delete role.' } };
  }

  return { ok: true, data: null };
}

/* ── MAPPER ───────────────────────────────────────────────────── */

/** Map a staff_members join row (role + activity) to the frontend StaffMember view model. */
export function staffRowToView(row: StaffJoinRow): StaffMember {
  const status = DB_TO_STATUS[row.status] ?? 'Active';
  const activity = (row.staff_activity ?? [])
    .map((a) => ({
      t: a.title,
      d: a.detail ?? activityLabel(a.created_at),
    }))
    .reverse(); // oldest → newest for the profile timeline

  return {
    id: row.id,
    roleId: row.roles?.id ?? '',
    name: row.name,
    email: row.email,
    role: row.roles?.name ?? 'Staff',
    status,
    inv: row.inv_status ? DB_TO_INV[row.inv_status] : undefined,
    last: pendingOrActive(status) ? relativeLabel(row.last_active_at) : 'Awaiting response',
    joined: dateLabel(row.joined_at),
    activity,
  };
}

function pendingOrActive(status: MemberStatus): boolean {
  return status === 'Active' || status === 'Suspended';
}

function relativeLabel(iso: string | null): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const diff = Date.now() - t;
  if (diff < 60 * 1000) return 'Now';
  if (diff < 60 * 60 * 1000) return Math.floor(diff / 60000) + ' min ago';
  if (diff < 24 * 60 * 60 * 1000) return Math.floor(diff / 3600000) + ' hr ago';
  if (diff < 7 * 24 * 60 * 60 * 1000) return Math.floor(diff / 86400000) + ' days ago';
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function dateLabel(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function activityLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) +
    ' · ' +
    d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}
