/* ═══════════════════════════════════════════════════════════════
   useStaff — real-data read adapter for the Staff & Roles page.

   WRITE (persistent):
     updateRole — persists a member's role (staff.manage-gated) and refetches
     so the store reflects committed DB state. Role changes no longer revert
     on refresh.
   Hydration contract:
     - No Supabase configured -> `ss.members` cleared to [] / status
       'empty' (never seeded).
     - Supabase configured, error -> status 'error'.
     - Real rows -> replace `ss.members` wholesale with real rows (role +
       activity resolved), notify(). Zero rows -> [] / status 'empty'.

   Invitations, permission edits and removal remain read-only config (they are
   not fabricated here); role changes are the one persisted write. The page
   keeps its static role / permission config (ROLE_TYPES, PERM_CATS, ...) as UI
   constants.
   ═══════════════════════════════════════════════════════════════ */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from '../store/store';
import { useSupabase } from '../lib/useSupabase';
import { listStaff, listRoles, listRolePermissions, updateStaffRole } from '../services/staff';
import { PERMISSION_KEYS } from '../data/seed';
import type { ServiceError } from '../services/shared';
import type { CustomRole } from '../types/staff';

export type StaffStatus = 'idle' | 'loading' | 'loaded' | 'empty' | 'error';

export type RoleListItem = { id: string; name: string; description: string | null; is_custom: boolean };

/** Reverse PERMISSION_KEYS (display → slug) with first-wins on collisions, so a
    DB slug like 'reports.view' renders as the canonical label 'View Reports'. */
const SLUG_TO_DISPLAY: Record<string, string> = {};
for (const [display, slug] of Object.entries(PERMISSION_KEYS)) {
  if (!(slug in SLUG_TO_DISPLAY)) SLUG_TO_DISPLAY[slug] = display;
}

function slugToDisplay(slugs: string[]): string[] {
  return slugs.map((s) => SLUG_TO_DISPLAY[s] ?? s);
}

export interface UseStaffResult {
  /** Current staff members from the store (real rows once hydrated, otherwise empty). */
  memberCount: number;
  status: StaffStatus;
  error: ServiceError | null;
  /** All roles from DB (id + name + description + is_custom) for role-change dropdowns. */
  roles: RoleListItem[];
  /** Persist a member's role (staff.manage-gated) then refetch. */
  updateRole: (staffId: string, roleId: string) => Promise<{ ok: boolean; error?: ServiceError }>;
  refetch: () => void;
}

export function useStaff(): UseStaffResult {
  const { ss, notify } = useStore();
  const { supabase, isSupabaseConfigured } = useSupabase();
  const [status, setStatus] = useState<StaffStatus>('idle');
  const [error, setError] = useState<ServiceError | null>(null);
  const [roles, setRoles] = useState<RoleListItem[]>([]);
  const ran = useRef(false);

  const load = useCallback(() => {
    if (!isSupabaseConfigured || !supabase) {
      // Never keep mock/seed data in the runtime path: clear + empty state.
      ss.members = [];
      ss.customRoles = [];
      setRoles([]);
      notify();
      setStatus('empty');
      setError(null);
      return;
    }

    let cancelled = false;
    setStatus('loading');
    setError(null);

    (async () => {
      const [staffRes, rolesRes] = await Promise.all([listStaff(supabase), listRoles(supabase)]);
      if (cancelled) return;

      if (!staffRes.ok) {
        setStatus('error');
        setError(staffRes.error);
        return;
      }
      if (rolesRes.ok) {
        setRoles(rolesRes.data);
        const customs = rolesRes.data.filter((r) => r.is_custom);
        if (customs.length) {
          // Hydrate the custom-role replica the roles matrix renders. The
          // UI works in display labels; the DB stores slugs.
          const permRows = await Promise.all(customs.map((c) => listRolePermissions(supabase, c.id)));
          if (cancelled) return;
          ss.customRoles = customs.map((c, i): CustomRole => ({
            name: c.name,
            desc: c.description ?? '',
            perms: permRows[i].ok ? slugToDisplay(permRows[i].data) : [],
          }));
        } else {
          ss.customRoles = [];
        }
        notify();
      }

      const withActivity = staffRes.data.map((m) => ({ ...m, activity: m.activity.map((a) => ({ ...a })) }));
      ss.members = withActivity;
      notify();
      setStatus(withActivity.length > 0 ? 'loaded' : 'empty');
    })();

    return () => {
      cancelled = true;
    };
  }, [supabase, isSupabaseConfigured, ss, notify]);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    load();
  }, [load]);

  const updateRole = useCallback<UseStaffResult['updateRole']>(
    async (staffId, roleId) => {
      if (!isSupabaseConfigured || !supabase) {
        return { ok: false, error: { code: 'NOT_CONFIGURED', message: 'Role changes are unavailable (not configured).' } };
      }
      const res = await updateStaffRole(supabase, staffId, roleId);
      if (!res.ok) return { ok: false, error: res.error };
      load();
      return { ok: true };
    },
    [supabase, isSupabaseConfigured, load],
  );

  return {
    memberCount: ss.members.length,
    status,
    error,
    roles,
    updateRole,
    refetch: load,
  };
}
