import { getS, getSS, notify } from '../store/store';
import type { AppSupabaseClient } from '../lib/supabase';

/* ────────────────────────────────────────────────────────────────
   Provisioning / onboarding service (Phase 2B).
   Clerk is the sole auth authority; these functions run on the
   token-aware Supabase client (see lib/useSupabase.ts), so every
   request carries the Clerk session token. No service_role key is
   ever used here. RLS is not enabled this phase.
   ──────────────────────────────────────────────────────────────── */

export type ProfileState =
  | { phase: 'loading' }
  | { phase: 'none' }
  | { phase: 'error' }
  | { phase: 'inactive'; staffStatus: string }
  | { phase: 'orphan' }
  | { phase: 'ready'; restaurantId: string };

/**
 * Resolve the calling user's provisioning state by querying their profile.
 * `userId` is the Clerk user id (== auth.jwt() ->> 'sub' == profiles.id).
 * With RLS disabled this is readable by the authenticated client.
 */
export async function getProfileState(
  supabase: AppSupabaseClient,
  userId: string,
): Promise<ProfileState> {
  if (!userId) return { phase: 'none' };

  const { data, error } = await supabase
    .from('profiles')
    .select('id, restaurant_id, staff_members(status)')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    // A failed lookup must NOT be treated as "not provisioned". If we mapped it
    // to `none`, SessionGate would bounce an already-provisioned user back to
    // onboarding on any transient failure (creating the dead-end loop). Surface
    // it as `error` so the gate can offer a retry instead.
    console.error('[provision] profile lookup failed', error.message);
    return { phase: 'error' };
  }

  if (!data) return { phase: 'none' };

  if (!data.restaurant_id) return { phase: 'orphan' };

  const staffStatus = (data.staff_members as { status?: string } | null)?.status ?? null;
  if (staffStatus && staffStatus !== 'active') {
    return { phase: 'inactive', staffStatus };
  }

  return { phase: 'ready', restaurantId: data.restaurant_id as string };
}

export type ProvisionResult = {
  status: 'created' | 'already' | 'claimed';
  restaurant_id: string | null;
  staff_id?: string | null;
  profile_id: string | null;
};

export interface ProvisionPayload {
  restaurantName: string;
  restaurantEmail?: string;
  restaurantPhone?: string;
  userName?: string;
  userEmail?: string;
}

/**
 * Invoke the atomic provision_owner RPC (migration 0002). Identity is derived
 * server-side from the Clerk session (auth.jwt()->>'sub'), so the args are
 * display/auxiliary data only. Never returns/uses a service_role key.
 */
export async function provisionRestaurant(
  supabase: AppSupabaseClient,
  payload: ProvisionPayload,
): Promise<ProvisionResult> {
  const { data, error } = await supabase.rpc('provision_owner', {
    p_restaurant_name: payload.restaurantName,
    p_restaurant_email: payload.restaurantEmail ?? null,
    p_restaurant_phone: payload.restaurantPhone ?? null,
    p_user_name: payload.userName ?? null,
    p_user_email: payload.userEmail ?? null,
  });

  if (error) {
    throw new Error(error.message);
  }

  return data as ProvisionResult;
}

export async function persistSnapshot(): Promise<void> {
  throw new Error('persistSnapshot service not wired yet (planned next phase).');
}

/** Invitation placeholder — adds a Pending member locally for now. */
export function inviteMember(email: string, role: string) {
  const ss = getSS();
  ss.members.unshift({
    name: email.split('@')[0].replace(/[._-]/g, ' '),
    email,
    role,
    status: 'Pending',
    inv: 'Pending',
    last: 'Awaiting response',
    joined: '—',
    activity: [],
  });
  notify();
}

/** Realtime tick placeholder — bumps a subscription counter. */
export function onRealtimeEvent(_handler: () => void): () => void {
  return () => undefined;
}

/* ────────────────────────────────────────────────────────────────
   Identity foundation (Phase 4B — Step 4).

   Canonical resolver for the authenticated caller's application
   identity. Clerk remains the auth authority; this reads the caller's
   profiles row (self-read, RLS-permitted) and follows the chain
   profiles.id -> profiles.staff_id -> staff_members -> roles to expose
   the resolved restaurant/staff/role. Tenant scoping is enforced
   server-side by RLS; this only surfaces the already-authorized
   identity for UI context and future write gating. It must NOT be
   treated as a source of truth for tenant values the caller submits.
   ──────────────────────────────────────────────────────────────── */

export interface CurrentIdentity {
  /** Clerk user id == profiles.id (TEXT). */
  profileId: string;
  /** profiles.restaurant_id (uuid). */
  restaurantId: string;
  /** staff_members.id (uuid) when the profile is linked, else null. */
  staffId: string | null;
  /** resolved roles.slug (e.g. 'owner-admin', 'waiter'), else null. */
  roleSlug: string | null;
  /** resolved roles.name (display), else null. */
  roleName: string | null;
  /** resolved role_id uuid, else null. */
  roleId: string | null;
  /** Permission codes for the user's role (e.g. ['orders.view', 'orders.create']). */
  permissions: string[];
  /** profiles.email (from Clerk). */
  email: string;
  /** profiles.full_name (from Clerk), else null. */
  fullName: string | null;
}

export type IdentityResult =
  | { ok: true; identity: CurrentIdentity }
  | { ok: false; error: 'no-user' | 'not-found' | 'unexpected' };

/**
 * Resolve the calling user's identity profile. `userId` is the Clerk user id
 * (== auth.jwt() ->> 'sub' == profiles.id). RLS permits the caller to read
 * their own profile row and the linked staff/role (all restaurant-scoped).
 */
export async function getCurrentIdentity(
  supabase: AppSupabaseClient,
  userId: string,
): Promise<IdentityResult> {
  if (!userId) return { ok: false, error: 'no-user' };

  try {
    const { data, error } = await supabase
      .from('profiles')
      .select(
        `id, restaurant_id, email, full_name, staff_members ( id, role_id, roles ( slug, name, id ) )`,
      )
      .eq('id', userId)
      .maybeSingle();

    if (error) return { ok: false, error: 'unexpected' };
    if (!data) return { ok: false, error: 'not-found' };

    const staff = data.staff_members as unknown as
      | { id: string; role_id: string | null; roles: { slug: string | null; name: string | null; id: string | null } | null }
      | null;

    const roleId = staff?.roles?.id ?? null;

    // Fetch permissions for the user's role
    let permissions: string[] = [];
    if (roleId) {
      const { data: perms } = await supabase
        .from('role_permissions')
        .select('permission')
        .eq('role_id', roleId);
      if (perms) {
        permissions = (perms as { permission: string }[]).map((p) => p.permission);
      }
    }

    return {
      ok: true,
      identity: {
        profileId: data.id,
        restaurantId: data.restaurant_id,
        staffId: staff?.id ?? null,
        roleSlug: staff?.roles?.slug ?? null,
        roleName: staff?.roles?.name ?? null,
        roleId,
        permissions,
        email: data.email,
        fullName: data.full_name ?? null,
      },
    };
  } catch {
    return { ok: false, error: 'unexpected' };
  }
}

export { getS };
