/* ═══════════════════════════════════════════════════════════════
   Notifications service — real data for the notification drawer.

   Follows the Phase 4B conventions (ServiceResult<T> / ServiceError /
   toServiceError). Tenant scoping is derived by RLS; the recipient is
   identified by the authenticated caller's staff_members.id (resolved
   via getCurrentIdentity in the hook) — never a client-supplied id.

   READ GATE — RLS grants SELECT/UPDATE on notifications to the recipient
   staff member (read_at NULL = unread). This is a read + mark-as-read /
   remove slice; pushing NEW notifications is event-driven server-side
   and out of scope here (no fake realtime injection in the client).

   The view model `Notification` carries the real uuid so mark-read /
   remove can target the DB row, not just an array index.
   ═══════════════════════════════════════════════════════════════ */

import type { AppSupabaseClient } from '../lib/supabase';
import type { NotificationsRow } from '../types/database';
import type { Notification } from '../types';
import { toServiceError, type ServiceResult } from './shared';

/* ── READ ─────────────────────────────────────────────────────── */

/**
 * List notifications addressed to the given staff member, newest first.
 * read_at NULL = unread.
 */
export async function listNotifications(
  supabase: AppSupabaseClient,
  staffId: string,
): Promise<ServiceResult<Notification[]>> {
  if (!staffId) return { ok: true, data: [] };

  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('recipient_staff_id', staffId)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) return { ok: false, error: toServiceError(error) };
  return { ok: true, data: (data as NotificationsRow[]).map(notificationRowToView) };
}

/* ── MARK READ ────────────────────────────────────────────────── */

/** Mark a single notification read (idempotent). */
export async function markNotificationRead(
  supabase: AppSupabaseClient,
  id: string,
): Promise<ServiceResult<true>> {
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() } as Partial<NotificationsRow>)
    .eq('id', id)
    .is('read_at', null);

  if (error) return { ok: false, error: toServiceError(error) };
  return { ok: true, data: true };
}

/** Mark every unread notification for the staff member read. */
export async function markAllNotificationsRead(
  supabase: AppSupabaseClient,
  staffId: string,
): Promise<ServiceResult<true>> {
  if (!staffId) return { ok: true, data: true };
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() } as Partial<NotificationsRow>)
    .eq('recipient_staff_id', staffId)
    .is('read_at', null);

  if (error) return { ok: false, error: toServiceError(error) };
  return { ok: true, data: true };
}

/* ── REMOVE ───────────────────────────────────────────────────── */

/** Remove a notification row (soft: DELETE is RLS-gated to the recipient). */
export async function removeNotification(
  supabase: AppSupabaseClient,
  id: string,
): Promise<ServiceResult<true>> {
  const { error } = await supabase
    .from('notifications')
    .delete()
    .eq('id', id);

  if (error) return { ok: false, error: toServiceError(error) };
  return { ok: true, data: true };
}

/* ── MAPPER ───────────────────────────────────────────────────── */

/** Map a notifications row to the frontend Notification view model. */
export function notificationRowToView(row: NotificationsRow): Notification {
  return {
    id: row.id,
    msg: row.message,
    time: relativeLabel(row.created_at),
    read: row.read_at !== null,
  };
}

function relativeLabel(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const diff = Date.now() - t;
  if (diff < 60 * 1000) return 'Just now';
  if (diff < 60 * 60 * 1000) return Math.floor(diff / 60000) + ' min ago';
  if (diff < 24 * 60 * 60 * 1000) return Math.floor(diff / 3600000) + ' hr ago';
  return Math.floor(diff / 86400000) + ' days ago';
}
