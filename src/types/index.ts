/** Order (kitchen/table) */
export interface OrderItem {
  n: string;
  q: number;
  p: number;
}

export type OrderStatus = 'New' | 'Preparing' | 'Ready' | 'Completed' | 'Cancelled';
export type PaymentStatus = 'Paid' | 'Unpaid' | 'Refunded';

export interface Order {
  /** Display code (orders.code, e.g. 'ORD-1000'). */
  id: string;
  /** Real DB orders.id (uuid) — write identity for status/pay mutations. */
  orderId?: string;
  cust: string;
  /** Real customer uuid when linked to a CRM customer; null for walk-ins. */
  customerId?: string | null;
  table: string;
  items: OrderItem[];
  amount: number;
  pay: PaymentStatus;
  status: OrderStatus;
  time: string;
  /** ISO timestamp the order was placed (reports period filtering). */
  placed?: string;
}

/** Reservation */
export type ResStatus = 'Pending' | 'Confirmed' | 'Completed' | 'Cancelled';

export interface Reservation {
  id: string;
  /** Server-generated RSV display code (from next_reservation_code RPC). Absent on seed rows. */
  code?: string;
  cust: string;
  /** Real customer UUID when linked to a CRM customer; null for walk-ins. */
  customerId?: string | null;
  phone: string;
  date: string;
  time: string;
  guests: number;
  table: string;
  /** Real table UUID when assigned; null for unassigned. Absent on seed rows. */
  tableId?: string | null;
  status: ResStatus;
  notes: string;
}

/** Restaurant table */
export type TableStatus = 'available' | 'occupied' | 'reserved';

export interface DiningTable {
  /** Real DB uuid when hydrated from Supabase; a display code (e.g. 'T-01') on seed rows. */
  id: string;
  /** Display code (restaurant_tables.label, e.g. 'T-01') when hydrated from Supabase; absent on seed rows. */
  label?: string;
  cap: number;
  status: TableStatus;
}

/** Customer */
export interface Customer {
  /** Real DB uuid when hydrated from Supabase; absent on (id-less) mock rows. */
  id?: string;
  name: string;
  phone: string;
  email: string;
  visits: number;
  orders: number;
  spent: number;
  last: string;
  fav: string;
  note?: string;
}

/** Menu */
export interface MenuItem {
  /** Real DB uuid when hydrated from Supabase (write identity); absent on (id-less) mock rows. */
  id?: string;
  /** Real DB category uuid when hydrated; null for uncategorized items. */
  categoryId?: string | null;
  name: string;
  price: number;
  on: boolean;
  icon: string;
  cat?: string;
}

export type MenuCategory = string;
export type Menu = Record<MenuCategory, MenuItem[]>;

/** Staff member (legacy dashboard staff list) */
export interface StaffBrief {
  name: string;
  role: string;
  phone: string;
  email: string;
  status: string;
  last: string;
}

/** Settings */
export interface Settings {
  name: string;
  contact: string;
  address: string;
  open: string;
  tables: number;
  config: string;
}

export interface NotifPrefs {
  reserve: boolean;
  order: boolean;
  system: boolean;
}

export interface Notification {
  /** Real DB uuid when hydrated from Supabase; absent on legacy/seed rows. */
  id?: string;
  msg: string;
  time: string;
  read: boolean;
}

export interface AppUser {
  name: string;
  email: string;
}

/** Canonical identity from DB (profiles → staff → roles → permissions). */
export interface AppIdentity {
  profileId: string;
  restaurantId: string;
  staffId: string | null;
  roleSlug: string | null;
  roleName: string | null;
  roleId: string | null;
  permissions: string[];
  email: string;
  fullName: string | null;
}

/** Global app state mirrors the vanilla S object. */
export interface AppState {
  user: AppUser | null;
  identity: AppIdentity | null;
  orders: Order[];
  reservations: Reservation[];
  tables: DiningTable[];
  customers: Customer[];
  menu: Menu;
  staff: StaffBrief[];
  settings: Settings;
  notifs: NotifPrefs;
  notifications: Notification[];
}
