/* ═══════════════════════════════════════════════════════════════
   Menu service — real-data CRUD for the Menu page.

   Follows the Phase 4B conventions (ServiceResult<T> / ServiceError /
   toServiceError). Tenant scoping is derived by RLS from the caller;
   reads never send a client-supplied restaurant_id.

   WRITE GATE — RLS grants SELECT to any tenant staff, and INSERT / UPDATE
   / DELETE to staff with `inventory.manage`. Writes are persisted to the
   DB:

     - createMenuItem:  INSERT menu_items (restaurant_id from authenticated
       identity, never UI). Icon/price/available/category_id.
     - updateMenuItem:  UPDATE a menu_item by uuid (RLS + WITH CHECK keep it
       in-tenant and require inventory.manage).
     - toggleMenuItem:  UPDATE menu_items.available (availability switch).
     - softDeleteMenuItem:  SOFT delete (set deleted_at = NOW()), matching
       the schema's approved soft-delete convention for menu_items. Exposed
       as a service capability; the current Menu UI has no delete control.

   The view model `Menu` = Record<categoryName, MenuItem[]> groups items by
   category name (matching the frontend's category-tab layout). Items without
   a category are grouped under the stable 'Uncategorized' display name;
   categories sort by sort_order, items by name. Each hydrated MenuItem
   carries its DB `id` + `categoryId` so the page can mutate the correct row.
   ═══════════════════════════════════════════════════════════════ */

import type { AppSupabaseClient } from '../lib/supabase';
import type { MenuCategoriesRow, MenuItemsRow, MenuItemsUpdate } from '../types/database';
import type { Menu, MenuItem } from '../types';
import { toServiceError, type ServiceResult } from './shared';

export const UNCATEGORIZED = 'Uncategorized';

/* ── Shared write type ────────────────────────────────────────── */

/** Tenant derived from authenticated identity, passed by the hook. */
export interface MenuTenantContext {
  restaurantId: string;
}

/* ── READ ─────────────────────────────────────────────────────── */

/**
 * List the full menu as a Record<categoryName, MenuItem[]> for the caller's
 * restaurant. Soft-deleted rows (deleted_at set) are excluded.
 */
export async function listMenu(supabase: AppSupabaseClient): Promise<ServiceResult<Menu>> {
  const [catsRes, itemsRes] = await Promise.all([
    supabase
      .from('menu_categories')
      .select('id, name, sort_order')
      .is('deleted_at', null)
      .order('sort_order', { ascending: true }),
    supabase
      .from('menu_items')
      .select('*')
      .is('deleted_at', null)
      .order('name', { ascending: true }),
  ]);

  if (catsRes.error) return { ok: false, error: toServiceError(catsRes.error) };
  if (itemsRes.error) return { ok: false, error: toServiceError(itemsRes.error) };

  const categories = (catsRes.data as MenuCategoriesRow[]).map((c) => ({
    id: c.id,
    name: c.name,
    sortOrder: c.sort_order,
  }));
  const catName = new Map<string, string>(categories.map((c) => [c.id, c.name]));
  const catOrder = new Map(categories.map((c, i) => [c.id, i]));

  const grouped = new Map<string, MenuItem[]>();
  const add = (group: string, item: MenuItem) => {
    const arr = grouped.get(group) ?? [];
    arr.push(item);
    grouped.set(group, arr);
  };

  for (const item of itemsRes.data as MenuItemsRow[]) {
    const cat = item.category_id ? (catName.get(item.category_id) ?? UNCATEGORIZED) : UNCATEGORIZED;
    add(cat, menuItemRowToView(item, cat));
  }

  // Deterministic ordering: category sort_order first, then name; fallback
  // to alphabetical for uncategorized / missing sort_order.
  const catOrderOf = (name: string) => {
    const id = categories.find((c) => c.name === name)?.id;
    return id !== undefined && catOrder.has(id) ? (catOrder.get(id) as number) : Number.MAX_SAFE_INTEGER;
  };
  const keys = [...grouped.keys()].sort((a, b) => {
    const ca = catOrderOf(a);
    const cb = catOrderOf(b);
    if (ca !== cb) return ca - cb;
    return a.localeCompare(b);
  });

  const menu: Menu = {};
  for (const k of keys) {
    grouped.get(k)?.sort((a, b) => a.name.localeCompare(b.name));
    menu[k] = grouped.get(k) as MenuItem[];
  }

  return { ok: true, data: menu };
}

/**
 * List active menu categories (id + name) for the caller's restaurant.
 * Used to resolve a selected category name to its uuid for writes.
 */
export async function listMenuCategories(
  supabase: AppSupabaseClient,
): Promise<ServiceResult<{ id: string; name: string }[]>> {
  const { data, error } = await supabase
    .from('menu_categories')
    .select('id, name')
    .is('deleted_at', null)
    .order('sort_order', { ascending: true });

  if (error) return { ok: false, error: toServiceError(error) };

  const cats = (data as MenuCategoriesRow[]).map((c) => ({ id: c.id, name: c.name }));
  return { ok: true, data: cats };
}

/* ── CREATE ───────────────────────────────────────────────────── */

/** Fields settable by the UI when creating a menu item. No tenant/id here. */
export interface CreateMenuItemInput {
  name: string;
  price: number;
  available: boolean;
  icon: string;
  /** Resolved category uuid; null places the item under 'Uncategorized'. */
  categoryId: string | null;
}

function normalizeCreateInput(input: CreateMenuItemInput): {
  name: string;
  price: number;
  available: boolean;
  icon: string;
  categoryId: string | null;
} {
  const name = input.name.trim();
  if (!name) throw new Error('Menu item name is required.');
  if (typeof input.price !== 'number' || !Number.isFinite(input.price) || input.price < 0)
    throw new Error('A valid, non-negative price is required.');
  return {
    name,
    price: Math.round(input.price * 100) / 100,
    available: input.available,
    icon: input.icon.trim(),
    categoryId: input.categoryId || null,
  };
}

/**
 * Create a menu item. `restaurant_id` is set from authenticated identity
 * (MenuTenantContext), never from user input — RLS + WITH CHECK enforce the
 * same tenant boundary.
 */
export async function createMenuItem(
  supabase: AppSupabaseClient,
  input: CreateMenuItemInput,
  tenant: MenuTenantContext,
): Promise<ServiceResult<MenuItem>> {
  let normalized: { name: string; price: number; available: boolean; icon: string; categoryId: string | null };
  try {
    normalized = normalizeCreateInput(input);
  } catch (e) {
    return { ok: false, error: { code: 'VALIDATION', message: e instanceof Error ? e.message : 'Invalid menu item.' } };
  }

  const row: Partial<MenuItemsRow> = {
    restaurant_id: tenant.restaurantId,
    category_id: normalized.categoryId,
    name: normalized.name,
    price: String(normalized.price),
    available: normalized.available,
    icon: normalized.icon,
  };

  const { data, error } = await supabase
    .from('menu_items')
    .insert(row as MenuItemsRow)
    .select('*')
    .single();

  if (error) return { ok: false, error: toServiceError(error) };

  const catName = normalized.categoryId ? undefined : UNCATEGORIZED;
  return { ok: true, data: menuItemRowToView(data as MenuItemsRow, catName) };
}

/* ── UPDATE ───────────────────────────────────────────────────── */

/** Only these fields may be updated. id / restaurant_id are immutable. */
export interface UpdateMenuItemInput {
  name?: string;
  price?: number;
  available?: boolean;
  icon?: string;
  categoryId?: string | null;
}

/**
 * Update a menu item by uuid. The RLS UPDATE policy's USING + WITH CHECK
 * both require the row to belong to the caller's restaurant (and
 * inventory.manage), so an item can never be moved to another tenant.
 * Idempotent for field subsets.
 */
export async function updateMenuItem(
  supabase: AppSupabaseClient,
  id: string,
  input: UpdateMenuItemInput,
): Promise<ServiceResult<MenuItem>> {
  const patch: Partial<MenuItemsRow> = {};
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) return { ok: false, error: { code: 'VALIDATION', message: 'Menu item name cannot be empty.' } };
    patch.name = name;
  }
  if (input.price !== undefined) {
    if (typeof input.price !== 'number' || !Number.isFinite(input.price) || input.price < 0)
      return { ok: false, error: { code: 'VALIDATION', message: 'A valid, non-negative price is required.' } };
    patch.price = String(Math.round(input.price * 100) / 100);
  }
  if (input.available !== undefined) patch.available = input.available;
  if (input.icon !== undefined) patch.icon = input.icon.trim();
  if (input.categoryId !== undefined) patch.category_id = input.categoryId || null;

  const { data, error } = await supabase
    .from('menu_items')
    .update(patch as MenuItemsUpdate)
    .eq('id', id)
    .is('deleted_at', null)
    .select('*')
    .maybeSingle();

  if (error) return { ok: false, error: toServiceError(error) };
  if (!data) {
    return { ok: false, error: { code: 'NOT_FOUND', message: 'Menu item was not found or was removed.' } };
  }
  return { ok: true, data: menuItemRowToView(data as MenuItemsRow) };
}

/* ── TOGGLE (availability) ────────────────────────────────────── */

/**
 * Set a menu item's availability (the on/off switch). Thin wrapper over
 * updateMenuItem for a single boolean column.
 */
export async function toggleMenuItem(
  supabase: AppSupabaseClient,
  id: string,
  available: boolean,
): Promise<ServiceResult<MenuItem>> {
  return updateMenuItem(supabase, id, { available });
}

/* ── DELETE (SOFT) ────────────────────────────────────────────── */

/**
 * Soft-delete a menu item by setting deleted_at = NOW(). The list read
 * already excludes soft-deleted rows, so it disappears from every view.
 * RLS constrains this to the caller's restaurant and requires inventory.
 * manage. (Hard DELETE would be blocked by the category FK for any
 * category still holding items, so soft delete is the correct, safe path.)
 */
export async function softDeleteMenuItem(
  supabase: AppSupabaseClient,
  id: string,
): Promise<ServiceResult<true>> {
  const { error } = await supabase
    .from('menu_items')
    .update({ deleted_at: new Date().toISOString() } as MenuItemsUpdate)
    .eq('id', id)
    .is('deleted_at', null);

  if (error) return { ok: false, error: toServiceError(error) };
  return { ok: true, data: true };
}

/* ── MAPPER ───────────────────────────────────────────────────── */

/**
 * Map a menu_items row to the frontend MenuItem view model, carrying the DB
 * `id` + `categoryId` so writes target the correct row. Category display
 * name is injected by the caller (falls back to 'Uncategorized').
 */
export function menuItemRowToView(row: MenuItemsRow, cat?: string): MenuItem {
  return {
    id: row.id,
    categoryId: row.category_id,
    name: row.name,
    price: Number(row.price),
    on: row.available,
    icon: row.icon ?? '',
    cat: cat ?? UNCATEGORIZED,
  };
}
