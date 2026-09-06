/* ═══════════════════════════════════════════════════════════════
   useMenu — real-data CRUD adapter for the Menu page.

   Hydration contract:
     - No Supabase configured -> `s.menu` cleared to {} and status 'empty'
       (never seeded).
     - Supabase configured, error -> status 'error'.
     - Real rows -> replace `s.menu` wholesale with real rows (view models
       carrying DB uuid + categoryId), notify(). Zero rows -> {} / 'empty'.

   Writes (persistent):
     createItem / updateItem / toggleItem / deleteItem — each proxies to the
     menu service and, on success, refetches so the store always reflects
     committed DB state (no drift). Create resolves `restaurant_id` from the
     authenticated identity; RLS enforces the tenant + inventory.manage.

   Realtime: subscribes to postgres_changes on `menu_items` + `menu_categories`
   after the first successful load so edits from other clients appear.
   ═══════════════════════════════════════════════════════════════ */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useUser } from '@clerk/react';
import { useStore } from '../store/store';
import { useSupabase } from '../lib/useSupabase';
import {
  listMenu,
  listMenuCategories,
  createMenuItem,
  updateMenuItem,
  toggleMenuItem,
  softDeleteMenuItem,
  type CreateMenuItemInput,
  type UpdateMenuItemInput,
} from '../services/menu';
import { getCurrentIdentity } from '../services';
import { identityHasAny } from '../routing/routes';
import type { ServiceError } from '../services/shared';
import type { Menu, MenuItem } from '../types';

export type MenuStatus = 'idle' | 'loading' | 'loaded' | 'empty' | 'error';

export interface UseMenuResult {
  menu: Menu;
  /** Active categories (id + name) for the caller's restaurant. */
  categories: { id: string; name: string }[];
  status: MenuStatus;
  error: ServiceError | null;
  refetch: () => void;
  createItem: (input: CreateMenuItemInput) => Promise<{ ok: boolean; error?: ServiceError }>;
  updateItem: (id: string, input: UpdateMenuItemInput) => Promise<{ ok: boolean; error?: ServiceError }>;
  /** Set availability: true => available, false => unavailable. */
  toggleItem: (id: string, available: boolean) => Promise<{ ok: boolean; error?: ServiceError }>;
  /** Soft-delete an item. No delete control exists in the current UI. */
  deleteItem: (id: string) => Promise<{ ok: boolean; error?: ServiceError }>;
  /** True when the resolved identity has inventory.manage — menu write actions. */
  canManageMenu: boolean;
}

export function useMenu(): UseMenuResult {
  const { s, notify } = useStore();
  const { supabase, isSupabaseConfigured } = useSupabase();
  const { user } = useUser();
  const [status, setStatus] = useState<MenuStatus>('idle');
  const [error, setError] = useState<ServiceError | null>(null);
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [restaurantId, setRestaurantId] = useState<string | null>(null);
  const ran = useRef(false);
  const loadedRef = useRef(false);

  const load = useCallback(() => {
    if (!isSupabaseConfigured || !supabase) {
      s.menu = {};
      notify();
      setStatus('empty');
      setError(null);
      setCategories([]);
      return;
    }

    let cancelled = false;
    setStatus('loading');
    setError(null);

    (async () => {
      const userId = user?.id ?? '';
      if (userId) {
        const ident = await getCurrentIdentity(supabase, userId);
        if (cancelled) return;
        if (ident.ok) setRestaurantId(ident.identity.restaurantId);
      }

      const [menuRes, catsRes] = await Promise.all([listMenu(supabase), listMenuCategories(supabase)]);
      if (cancelled) return;

      if (!menuRes.ok) {
        setStatus('error');
        setError(menuRes.error);
        return;
      }
      if (catsRes.ok) setCategories(catsRes.data);

      s.menu = menuRes.data;
      notify();
      setStatus(Object.keys(menuRes.data).length > 0 ? 'loaded' : 'empty');
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

  // Realtime — refetch the menu when rows change elsewhere.
  useEffect(() => {
    if (!isSupabaseConfigured || !supabase || !loadedRef.current) return;

    const channel = supabase
      .channel('menu-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'menu_items' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'menu_categories' }, () => load())
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [isSupabaseConfigured, supabase, load]);

  const createItem = useCallback<UseMenuResult['createItem']>(
    async (input) => {
      if (!isSupabaseConfigured || !supabase) {
        return { ok: false, error: { code: 'NOT_CONFIGURED', message: 'Supabase is not configured.' } };
      }
      if (!restaurantId) {
        return { ok: false, error: { code: 'FORBIDDEN', message: 'Could not resolve restaurant identity for this session.' } };
      }
      const res = await createMenuItem(supabase, input, { restaurantId });
      if (!res.ok) return { ok: false, error: res.error };
      load();
      return { ok: true };
    },
    [supabase, isSupabaseConfigured, restaurantId, load],
  );

  const updateItem = useCallback<UseMenuResult['updateItem']>(
    async (id, input) => {
      if (!isSupabaseConfigured || !supabase) {
        return { ok: false, error: { code: 'NOT_CONFIGURED', message: 'Supabase is not configured.' } };
      }
      const res = await updateMenuItem(supabase, id, input);
      if (!res.ok) return { ok: false, error: res.error };
      load();
      return { ok: true };
    },
    [supabase, isSupabaseConfigured, load],
  );

  const toggleItem = useCallback<UseMenuResult['toggleItem']>(
    async (id, available) => {
      if (!isSupabaseConfigured || !supabase) {
        return { ok: false, error: { code: 'NOT_CONFIGURED', message: 'Supabase is not configured.' } };
      }
      const res = await toggleMenuItem(supabase, id, available);
      if (!res.ok) return { ok: false, error: res.error };
      load();
      return { ok: true };
    },
    [supabase, isSupabaseConfigured, load],
  );

  const deleteItem = useCallback<UseMenuResult['deleteItem']>(
    async (id) => {
      if (!isSupabaseConfigured || !supabase) {
        return { ok: false, error: { code: 'NOT_CONFIGURED', message: 'Supabase is not configured.' } };
      }
      const res = await softDeleteMenuItem(supabase, id);
      if (!res.ok) return { ok: false, error: res.error };
      load();
      return { ok: true };
    },
    [supabase, isSupabaseConfigured, load],
  );

  return {
    menu: s.menu,
    categories,
    status,
    error,
    refetch: load,
    createItem,
    updateItem,
    toggleItem,
    deleteItem,
    canManageMenu: identityHasAny(
      s.identity?.roleSlug ?? null,
      s.identity?.permissions ?? [],
      ['inventory.manage'],
    ),
  };
}

export type { MenuItem };
