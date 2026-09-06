/* ═══════════════════════════════════════════════════════════════
   useNotifications — real-data adapter for the notification drawer.

   Reads notifications addressed to the authenticated staff member
   (getCurrentIdentity -> staffId; RLS enforces recipient scoping) and
   mirrors them into `s.notifications`. Provides mark-read / mark-all /
   remove mutations backed by the notifications service.

   No fake realtime injection: new notifications arrive via Supabase
   Realtime postgres_changes on the `notifications` table; any INSERT/
   UPDATE/DELETE triggers a full re-fetch scoped to the current staff
   member. The AppShell auto-ticker that fabricated notifications is
   removed.
   ═══════════════════════════════════════════════════════════════ */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useUser } from '@clerk/react';
import { useStore } from '../store/store';
import { useSupabase } from '../lib/useSupabase';
import { getCurrentIdentity } from '../services';
import {
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  removeNotification,
} from '../services/notifications';
import type { ServiceError } from '../services/shared';

export type NotificationsStatus = 'idle' | 'loading' | 'loaded' | 'empty' | 'error';

export interface UseNotificationsResult {
  status: NotificationsStatus;
  error: ServiceError | null;
  staffId: string | null;
  refetch: () => void;
  markRead: (id: string) => Promise<boolean>;
  markAll: () => Promise<boolean>;
  remove: (id: string) => Promise<boolean>;
}

export function useNotifications(): UseNotificationsResult {
  const { s, notify } = useStore();
  const { supabase, isSupabaseConfigured } = useSupabase();
  const { user } = useUser();
  const [status, setStatus] = useState<NotificationsStatus>('idle');
  const [error, setError] = useState<ServiceError | null>(null);
  const [staffId, setStaffId] = useState<string | null>(null);
  const ran = useRef(false);
  const loadedRef = useRef(false);

  const load = useCallback(() => {
    if (!isSupabaseConfigured || !supabase) {
      // Never keep mock/seed data in the runtime path: clear + empty state.
      s.notifications = [];
      notify();
      setStaffId(null);
      setStatus('empty');
      setError(null);
      return;
    }

    let cancelled = false;
    setStatus('loading');
    setError(null);

    (async () => {
      const userId = user?.id ?? '';
      let recipient = '';
      if (userId) {
        const ident = await getCurrentIdentity(supabase, userId);
        if (cancelled) return;
        if (ident.ok) recipient = ident.identity.staffId ?? '';
      }
      setStaffId(recipient);

      const result = await listNotifications(supabase, recipient);
      if (cancelled) return;

      if (!result.ok) {
        setStatus('error');
        setError(result.error);
        return;
      }

      s.notifications = result.data;
      notify();
      setStatus(result.data.length > 0 ? 'loaded' : 'empty');
      loadedRef.current = true;
    })();

    return () => {
      cancelled = true;
    };
  }, [supabase, isSupabaseConfigured, user?.id, s, notify]);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    load();
  }, [load]);

  // Realtime subscription — re-fetch on any row change after first load.
  useEffect(() => {
    if (!isSupabaseConfigured || !supabase || !loadedRef.current) return;

    const channel = supabase
      .channel('notifications-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'notifications' },
        () => load(),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [isSupabaseConfigured, supabase, load]);

  const markRead = useCallback(
    async (id: string): Promise<boolean> => {
      if (!isSupabaseConfigured || !supabase || !id) return false;
      const res = await markNotificationRead(supabase, id);
      if (res.ok) {
        const n = s.notifications.find((x) => x.id === id);
        if (n) n.read = true;
        notify();
        return true;
      }
      return false;
    },
    [supabase, isSupabaseConfigured, s, notify],
  );

  const markAll = useCallback(async (): Promise<boolean> => {
    if (!isSupabaseConfigured || !supabase) return false;
    const res = await markAllNotificationsRead(supabase, staffId ?? '');
    if (res.ok) {
      s.notifications.forEach((n) => (n.read = true));
      notify();
      return true;
    }
    return false;
  }, [supabase, isSupabaseConfigured, staffId, s, notify]);

  const remove = useCallback(
    async (id: string): Promise<boolean> => {
      if (!isSupabaseConfigured || !supabase || !id) return false;
      const res = await removeNotification(supabase, id);
      if (res.ok) {
        s.notifications = s.notifications.filter((x) => x.id !== id);
        notify();
        return true;
      }
      return false;
    },
    [supabase, isSupabaseConfigured, s, notify],
  );

  return {
    status,
    error,
    staffId,
    refetch: load,
    markRead,
    markAll,
    remove,
  };
}
