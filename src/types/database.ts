/* ═══════════════════════════════════════════════════════════════
   Database type boundary (Phase 4B — Step 2: Type Foundation).

   Hand-written, schema-accurate types matching the REAL deployed
   schema in supabase/migrations/0001_initial_schema.sql. The
   signed-off environment has no CLI DB access token and no local
   Docker, so `supabase gen types` cannot run here; this manual
   boundary is the sanctioned fallback.

   Conventions (locked for Phase 4B):
     - PostgREST returns UUID / DATE / TIME / TIMESTAMPTZ as `string`.
     - PostgREST returns NUMERIC money columns (`spent`, `price`,
       `subtotal`, ...) as `string`. Convert to `number` only at view
       boundaries in mappers.
     - INTEGER columns come back as `number`.
     - DISTINCT type families:
         Row    -> canonical stored shape (what a SELECT returns)
         Insert -> required = NOT NULL with no server default
         Update -> every field optional (partial update)
     - Display codes (orders.code, reservations.code,
       restaurant_tables.label) are *columns*, never primary keys.
     - Primary keys are `uuid` (or `text` for profiles.id = Clerk sub).
   ═══════════════════════════════════════════════════════════════ */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

/* ── 1. restaurants ─ root tenant entity ─────────────────────────── */
export interface RestaurantsRow {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}
export interface RestaurantsInsert {
  id?: string;
  name: string;
  created_at?: string;
  updated_at?: string;
}
export type RestaurantsUpdate = Partial<RestaurantsInsert>;

/* ── 2. roles ─ fixed application roles (global, not tenant-scoped) ── */
export interface RolesRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  is_custom: boolean;
  created_at: string;
  updated_at: string;
}
export interface RolesInsert {
  id?: string;
  name: string;
  slug: string;
  description?: string | null;
  is_custom?: boolean;
  created_at?: string;
  updated_at?: string;
}
export type RolesUpdate = Partial<RolesInsert>;

/* ── 3. staff_members ─ canonical staff record ───────────────────── */
export interface StaffMembersRow {
  id: string;
  restaurant_id: string;
  name: string;
  email: string;
  role_id: string;
  status: 'active' | 'pending' | 'suspended';
  inv_status: 'pending' | 'accepted' | 'expired' | 'revoked' | null;
  last_active_at: string | null;
  joined_at: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}
export interface StaffMembersInsert {
  id?: string;
  restaurant_id: string;
  name: string;
  email: string;
  role_id: string;
  status?: 'active' | 'pending' | 'suspended';
  inv_status?: 'pending' | 'accepted' | 'expired' | 'revoked' | null;
  last_active_at?: string | null;
  joined_at?: string | null;
  deleted_at?: string | null;
  created_at?: string;
  updated_at?: string;
}
export type StaffMembersUpdate = Partial<StaffMembersInsert>;

/* ── 4. profiles ─ Clerk bridge; id = Clerk user.id (TEXT) ──────── */
export interface ProfilesRow {
  id: string;
  restaurant_id: string;
  staff_id: string | null;
  email: string;
  full_name: string | null;
  created_at: string;
  updated_at: string;
}
export interface ProfilesInsert {
  id: string;
  restaurant_id: string;
  staff_id?: string | null;
  email: string;
  full_name?: string | null;
  created_at?: string;
  updated_at?: string;
}
export type ProfilesUpdate = Partial<ProfilesInsert>;

/* ── 5. role_permissions ─ flat permission codes ────────────────── */
export interface RolePermissionsRow {
  id: string;
  role_id: string;
  permission: string;
  created_at: string;
}
export interface RolePermissionsInsert {
  id?: string;
  role_id: string;
  permission: string;
  created_at?: string;
}
export type RolePermissionsUpdate = Partial<RolePermissionsInsert>;

/* ── 6. customers ─ guest directory ─────────────────────────────── */
export interface CustomersRow {
  id: string;
  restaurant_id: string;
  name: string;
  phone: string | null;
  email: string | null;
  visits: number;
  orders: number;
  spent: string;
  last_visit_at: string | null;
  favorite_item: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}
export interface CustomersInsert {
  id?: string;
  restaurant_id: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  visits?: number;
  orders?: number;
  spent?: string | number;
  last_visit_at?: string | null;
  favorite_item?: string | null;
  deleted_at?: string | null;
  created_at?: string;
  updated_at?: string;
}
export type CustomersUpdate = Partial<CustomersInsert>;

/* ── 7. restaurant_tables ─ seating plan; label is display code ── */
export interface RestaurantTablesRow {
  id: string;
  restaurant_id: string;
  label: string;
  capacity: number;
  status: 'available' | 'occupied' | 'reserved';
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}
export interface RestaurantTablesInsert {
  id?: string;
  restaurant_id: string;
  label: string;
  capacity: number;
  status?: 'available' | 'occupied' | 'reserved';
  deleted_at?: string | null;
  created_at?: string;
  updated_at?: string;
}
export type RestaurantTablesUpdate = Partial<RestaurantTablesInsert>;

/* ── 8. menu_categories ─────────────────────────────────────────── */
export interface MenuCategoriesRow {
  id: string;
  restaurant_id: string;
  name: string;
  sort_order: number;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}
export interface MenuCategoriesInsert {
  id?: string;
  restaurant_id: string;
  name: string;
  sort_order?: number;
  deleted_at?: string | null;
  created_at?: string;
  updated_at?: string;
}
export type MenuCategoriesUpdate = Partial<MenuCategoriesInsert>;

/* ── 9. menu_items ──────────────────────────────────────────────── */
export interface MenuItemsRow {
  id: string;
  restaurant_id: string;
  category_id: string | null;
  name: string;
  price: string;
  available: boolean;
  icon: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}
export interface MenuItemsInsert {
  id?: string;
  restaurant_id: string;
  category_id?: string | null;
  name: string;
  price: string | number;
  available?: boolean;
  icon?: string | null;
  deleted_at?: string | null;
  created_at?: string;
  updated_at?: string;
}
export type MenuItemsUpdate = Partial<MenuItemsInsert>;

/* ── 10. reservations ─ code is display reference, never PK ────── */
export interface ReservationsRow {
  id: string;
  restaurant_id: string;
  code: string;
  customer_id: string | null;
  guest_name: string;
  phone: string | null;
  table_id: string | null;
  reservation_date: string;
  reservation_time: string;
  guests: number;
  status: 'pending' | 'confirmed' | 'completed' | 'cancelled';
  notes: string | null;
  created_at: string;
  updated_at: string;
}
export interface ReservationsInsert {
  id?: string;
  restaurant_id: string;
  code: string;
  customer_id?: string | null;
  guest_name: string;
  phone?: string | null;
  table_id?: string | null;
  reservation_date: string;
  reservation_time: string;
  guests: number;
  status?: 'pending' | 'confirmed' | 'completed' | 'cancelled';
  notes?: string | null;
  created_at?: string;
  updated_at?: string;
}
export type ReservationsUpdate = Partial<ReservationsInsert>;

/* ── 11. orders ─ POS/service header; totals computed at write ─── */
export interface OrdersRow {
  id: string;
  restaurant_id: string;
  code: string;
  customer_id: string | null;
  table_id: string | null;
  status: 'new' | 'preparing' | 'ready' | 'completed' | 'cancelled';
  pay_status: 'paid' | 'unpaid' | 'refunded';
  subtotal: string;
  tax_amount: string;
  total_amount: string;
  placed_at: string;
  created_at: string;
  updated_at: string;
}
export interface OrdersInsert {
  id?: string;
  restaurant_id: string;
  code: string;
  customer_id?: string | null;
  table_id?: string | null;
  status?: 'new' | 'preparing' | 'ready' | 'completed' | 'cancelled';
  pay_status?: 'paid' | 'unpaid' | 'refunded';
  subtotal?: string | number;
  tax_amount?: string | number;
  total_amount?: string | number;
  placed_at?: string;
  created_at?: string;
  updated_at?: string;
}
export type OrdersUpdate = Partial<OrdersInsert>;

/* ── 12. order_items ─ immutable historical snapshots ───────────── */
export interface OrderItemsRow {
  id: string;
  order_id: string;
  menu_item_id: string | null;
  item_name: string;
  unit_price: string;
  quantity: number;
  line_total: string;
  created_at: string;
}
export interface OrderItemsInsert {
  id?: string;
  order_id: string;
  menu_item_id?: string | null;
  item_name: string;
  unit_price: string | number;
  quantity: number;
  line_total: string | number;
  created_at?: string;
}
export type OrderItemsUpdate = Partial<OrderItemsInsert>;

/* ── 13. staff_activity ─ immutable staff audit timeline ────────── */
export interface StaffActivityRow {
  id: string;
  staff_member_id: string;
  title: string;
  detail: string | null;
  created_at: string;
}
export interface StaffActivityInsert {
  id?: string;
  staff_member_id: string;
  title: string;
  detail?: string | null;
  created_at?: string;
}
export type StaffActivityUpdate = Partial<StaffActivityInsert>;

/* ── 14. customer_notes ─ immutable guest notes ─────────────────── */
export interface CustomerNotesRow {
  id: string;
  customer_id: string;
  author_staff_id: string | null;
  note: string;
  created_at: string;
}
export interface CustomerNotesInsert {
  id?: string;
  customer_id: string;
  author_staff_id?: string | null;
  note: string;
  created_at?: string;
}
export type CustomerNotesUpdate = Partial<CustomerNotesInsert>;

/* ── 15. notifications ─ read_at NULL = unread ──────────────────── */
export interface NotificationsRow {
  id: string;
  restaurant_id: string;
  recipient_staff_id: string;
  message: string;
  type: 'reservation' | 'order' | 'system';
  read_at: string | null;
  created_at: string;
}
export interface NotificationsInsert {
  id?: string;
  restaurant_id: string;
  recipient_staff_id: string;
  message: string;
  type?: 'reservation' | 'order' | 'system';
  read_at?: string | null;
  created_at?: string;
}
export type NotificationsUpdate = Partial<NotificationsInsert>;

/* ── 16. notification_prefs ─ per-staff toggles ─────────────────── */
export interface NotificationPrefsRow {
  id: string;
  staff_member_id: string;
  reserve: boolean;
  order_pref: boolean;
  system_pref: boolean;
  created_at: string;
  updated_at: string;
}
export interface NotificationPrefsInsert {
  id?: string;
  staff_member_id: string;
  reserve?: boolean;
  order_pref?: boolean;
  system_pref?: boolean;
  created_at?: string;
  updated_at?: string;
}
export type NotificationPrefsUpdate = Partial<NotificationPrefsInsert>;

/* ═══ Supabase schema-shape database type threaded into the client
   so `supabase.from('customers')` etc. are statically typed. ═══ */
export interface Database {
  public: {
    Tables: {
      restaurants: {
        Row: RestaurantsRow;
        Insert: RestaurantsInsert;
        Update: RestaurantsUpdate;
        Relationships: [];
      };
      roles: {
        Row: RolesRow;
        Insert: RolesInsert;
        Update: RolesUpdate;
        Relationships: [];
      };
      staff_members: {
        Row: StaffMembersRow;
        Insert: StaffMembersInsert;
        Update: StaffMembersUpdate;
        Relationships: [];
      };
      profiles: {
        Row: ProfilesRow;
        Insert: ProfilesInsert;
        Update: ProfilesUpdate;
        Relationships: [];
      };
      role_permissions: {
        Row: RolePermissionsRow;
        Insert: RolePermissionsInsert;
        Update: RolePermissionsUpdate;
        Relationships: [];
      };
      customers: {
        Row: CustomersRow;
        Insert: CustomersInsert;
        Update: CustomersUpdate;
        Relationships: [];
      };
      restaurant_tables: {
        Row: RestaurantTablesRow;
        Insert: RestaurantTablesInsert;
        Update: RestaurantTablesUpdate;
        Relationships: [];
      };
      menu_categories: {
        Row: MenuCategoriesRow;
        Insert: MenuCategoriesInsert;
        Update: MenuCategoriesUpdate;
        Relationships: [];
      };
      menu_items: {
        Row: MenuItemsRow;
        Insert: MenuItemsInsert;
        Update: MenuItemsUpdate;
        Relationships: [];
      };
      reservations: {
        Row: ReservationsRow;
        Insert: ReservationsInsert;
        Update: ReservationsUpdate;
        Relationships: [];
      };
      orders: {
        Row: OrdersRow;
        Insert: OrdersInsert;
        Update: OrdersUpdate;
        Relationships: [];
      };
      order_items: {
        Row: OrderItemsRow;
        Insert: OrderItemsInsert;
        Update: OrderItemsUpdate;
        Relationships: [];
      };
      staff_activity: {
        Row: StaffActivityRow;
        Insert: StaffActivityInsert;
        Update: StaffActivityUpdate;
        Relationships: [];
      };
      customer_notes: {
        Row: CustomerNotesRow;
        Insert: CustomerNotesInsert;
        Update: CustomerNotesUpdate;
        Relationships: [];
      };
      notifications: {
        Row: NotificationsRow;
        Insert: NotificationsInsert;
        Update: NotificationsUpdate;
        Relationships: [];
      };
      notification_prefs: {
        Row: NotificationPrefsRow;
        Insert: NotificationPrefsInsert;
        Update: NotificationPrefsUpdate;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}

/** Convenience: access a typed Row for a given table name. */
export type TableRow<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Row'];
