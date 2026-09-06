import type { AppState } from '../types';
import type {
  ActivityEntry,
  CustomRole,
  InvStatus,
  MemberStatus,
  PermissionCategory,
  StaffMember,
  StaffState,
} from '../types/staff';

/* ═══ Core app state (port of the vanilla `S` object) ═══ */
export const seedState: AppState = {
  user: null,
  identity: null,
  orders: [
    { id: 'ORD-1042', cust: 'Arjun Mehta', table: 'T-06', items: [{ n: 'Truffle Pasta', q: 2, p: 1250 }, { n: 'Signature Tiramisu', q: 2, p: 490 }], amount: 3480, pay: 'Paid', status: 'Completed', time: '12:42 PM' },
    { id: 'ORD-1043', cust: "Isabella D'Souza", table: 'T-02', items: [{ n: 'Elysian Burger', q: 1, p: 980 }, { n: 'Fruit Tonic', q: 1, p: 320 }], amount: 1300, pay: 'Paid', status: 'Ready', time: '1:05 PM' },
    { id: 'ORD-1044', cust: 'Rohan Kapoor', table: 'T-09', items: [{ n: 'Creamy Mushroom Risotto', q: 1, p: 1080 }, { n: 'Grilled Chicken', q: 1, p: 1150 }, { n: 'Truffle Pasta', q: 1, p: 1250 }], amount: 3480, pay: 'Unpaid', status: 'Preparing', time: '1:18 PM' },
    { id: 'ORD-1045', cust: 'Sofia Mendes', table: 'T-04', items: [{ n: 'Burrata & Heirloom', q: 1, p: 720 }, { n: 'Elysian Burger', q: 2, p: 980 }], amount: 2680, pay: 'Paid', status: 'New', time: '1:26 PM' },
    { id: 'ORD-1046', cust: 'Vikram Rathore', table: 'T-11', items: [{ n: 'Charcuterie Board', q: 1, p: 890 }], amount: 995, pay: 'Refunded', status: 'Cancelled', time: '1:31 PM' },
    { id: 'ORD-1047', cust: 'Meera Pillai', table: 'T-01', items: [{ n: 'Grilled Chicken', q: 2, p: 1150 }, { n: 'Seasonal Sorbet', q: 2, p: 360 }], amount: 3080, pay: 'Paid', status: 'New', time: '1:37 PM' },
    { id: 'ORD-1048', cust: 'Daniel Osei', table: 'T-07', items: [{ n: 'Creamy Mushroom Risotto', q: 1, p: 1080 }, { n: "Chef's Selection Wine", q: 2, p: 620 }], amount: 2320, pay: 'Unpaid', status: 'Preparing', time: '1:44 PM' },
    { id: 'ORD-1039', cust: 'Ananya Iyer', table: 'T-03', items: [{ n: 'Elysian Burger', q: 1, p: 980 }, { n: 'Truffle Pasta', q: 1, p: 1250 }], amount: 2520, pay: 'Paid', status: 'Completed', time: '11:58 AM' },
    { id: 'ORD-1040', cust: 'Nikhil Verma', table: 'T-10', items: [{ n: 'Charcuterie Board', q: 1, p: 890 }, { n: 'Signature Tiramisu', q: 1, p: 490 }], amount: 1380, pay: 'Paid', status: 'Completed', time: '12:12 PM' },
    { id: 'ORD-1041', cust: 'Lena Fischer', table: 'T-05', items: [{ n: 'Grilled Chicken', q: 1, p: 1150 }, { n: 'Fruit Tonic', q: 2, p: 320 }], amount: 1790, pay: 'Unpaid', status: 'Ready', time: '12:28 PM' },
  ],
  reservations: [
    { id: 'RSV-308', cust: 'Ananya Iyer', phone: '+91 98450 11223', date: '2026-08-27', time: '7:00 PM', guests: 4, table: 'T-06', status: 'Confirmed', notes: 'Window table, anniversary' },
    { id: 'RSV-309', cust: 'Rohan Kapoor', phone: '+91 99870 44556', date: '2026-08-27', time: '7:30 PM', guests: 2, table: 'T-02', status: 'Pending', notes: 'Aisle, quiet' },
    { id: 'RSV-310', cust: "Isabella D'Souza", phone: '+91 81234 90987', date: '2026-08-27', time: '8:00 PM', guests: 6, table: 'T-09', status: 'Pending', notes: 'Birthday celebration' },
    { id: 'RSV-311', cust: 'Meera Pillai', phone: '+91 70551 33221', date: '2026-08-27', time: '8:30 PM', guests: 2, table: 'T-01', status: 'Completed', notes: '' },
    { id: 'RSV-312', cust: 'Daniel Osei', phone: '+91 90080 77112', date: '2026-08-27', time: '9:00 PM', guests: 4, table: 'T-07', status: 'Pending', notes: 'Corporate dinner' },
    { id: 'RSV-313', cust: 'Sofia Mendes', phone: '+91 96660 55443', date: '2026-08-28', time: '7:15 PM', guests: 3, table: 'T-04', status: 'Pending', notes: '' },
    { id: 'RSV-314', cust: 'Vikram Rathore', phone: '+91 91234 88990', date: '2026-08-28', time: '8:00 PM', guests: 2, table: 'T-11', status: 'Pending', notes: '' },
  ],
  tables: [
    { id: 'T-01', cap: 2, status: 'available' },
    { id: 'T-02', cap: 2, status: 'available' },
    { id: 'T-03', cap: 4, status: 'occupied' },
    { id: 'T-04', cap: 2, status: 'available' },
    { id: 'T-05', cap: 4, status: 'occupied' },
    { id: 'T-06', cap: 4, status: 'reserved' },
    { id: 'T-07', cap: 4, status: 'occupied' },
    { id: 'T-08', cap: 6, status: 'available' },
    { id: 'T-09', cap: 6, status: 'occupied' },
    { id: 'T-10', cap: 2, status: 'available' },
    { id: 'T-11', cap: 2, status: 'reserved' },
    { id: 'T-12', cap: 4, status: 'available' },
    { id: 'T-13', cap: 8, status: 'available' },
  ],
  customers: [
    { name: 'Arjun Mehta', phone: '+91 98450 11234', email: 'arjun.mehta@mail.com', visits: 24, orders: 38, spent: 84200, last: 'Today', fav: 'Truffle Pasta' },
    { name: "Isabella D'Souza", phone: '+91 99870 44501', email: 'isabella.dsouza@mail.com', visits: 18, orders: 27, spent: 61400, last: 'Yesterday', fav: 'Elysian Burger' },
    { name: 'Rohan Kapoor', phone: '+91 81234 90911', email: 'rohan.kapoor@mail.com', visits: 31, orders: 45, spent: 102300, last: 'Today', fav: 'Creamy Mushroom Risotto' },
    { name: 'Sofia Mendes', phone: '+91 70551 33299', email: 'sofia.mendes@mail.com', visits: 9, orders: 13, spent: 28400, last: 'Today', fav: 'Burrata' },
    { name: 'Vikram Rathore', phone: '+91 91234 88911', email: 'vikram.rathore@mail.com', visits: 14, orders: 20, spent: 45200, last: 'Today', fav: 'Charcuterie' },
    { name: 'Meera Pillai', phone: '+91 96660 55422', email: 'meera.pillai@mail.com', visits: 22, orders: 31, spent: 73800, last: 'Today', fav: 'Grilled Chicken' },
    { name: 'Daniel Osei', phone: '+91 90080 77110', email: 'daniel.osei@mail.com', visits: 6, orders: 9, spent: 18900, last: 'Yesterday', fav: 'Risotto' },
    { name: 'Ananya Iyer', phone: '+91 98450 11200', email: 'ananya.iyer@mail.com', visits: 12, orders: 17, spent: 39600, last: '2 days ago', fav: 'Signature Tiramisu' },
    { name: 'Nikhil Verma', phone: '+91 99870 44502', email: 'nikhil.verma@mail.com', visits: 5, orders: 8, spent: 15400, last: 'This week', fav: 'Steak' },
    { name: 'Lena Fischer', phone: '+91 81234 90912', email: 'lena.fischer@mail.com', visits: 8, orders: 11, spent: 26300, last: 'This week', fav: 'Wine' },
  ],
  menu: {
    'Starters': [
      { name: 'Burrata & Heirloom Tomato', price: 720, on: true, icon: 'salad' },
      { name: 'Charcuterie Board', price: 890, on: true, icon: 'board' },
      { name: 'Truffle Arancini', price: 540, on: false, icon: 'arancini' },
      { name: 'Roasted Bone Marrow', price: 780, on: true, icon: 'bone' },
    ],
    'Main Course': [
      { name: 'Truffle Pasta', price: 1250, on: true, icon: 'pasta' },
      { name: 'Elysian Burger', price: 980, on: true, icon: 'burger' },
      { name: 'Creamy Mushroom Risotto', price: 1080, on: true, icon: 'risotto' },
      { name: 'Grilled Chicken', price: 1150, on: true, icon: 'chicken' },
      { name: 'Aged Tomahawk', price: 2400, on: false, icon: 'steak' },
    ],
    'Drinks': [
      { name: "Chef's Selection Wine", price: 620, on: true, icon: 'wine' },
      { name: 'Fruit Tonic', price: 320, on: true, icon: 'tonic' },
      { name: 'Espresso Martini', price: 480, on: true, icon: 'martini' },
      { name: 'Signature Mocktail', price: 350, on: false, icon: 'mocktail' },
    ],
    'Desserts': [
      { name: 'Signature Tiramisu', price: 490, on: true, icon: 'tiramisu' },
      { name: 'Seasonal Sorbet', price: 360, on: true, icon: 'sorbet' },
      { name: 'Dark Chocolate Fondant', price: 560, on: true, icon: 'fondant' },
    ],
  },
  staff: [
    { name: 'Alexandra Reed', role: 'Admin', phone: '+91 90000 00001', email: 'alexandra@elysianspire.com', status: 'Active', last: 'Now' },
    { name: "Rahul D'Souza", role: 'Manager', phone: '+91 90000 00002', email: 'rahul@elysianspire.com', status: 'Active', last: '12 min ago' },
    { name: 'Priya Nair', role: 'Waiter', phone: '+91 90000 00003', email: 'priya@elysianspire.com', status: 'Active', last: 'Now' },
    { name: 'Marco Bianchi', role: 'Waiter', phone: '+91 90000 00004', email: 'marco@elysianspire.com', status: 'On Break', last: '5 min ago' },
    { name: 'Sana Qureshi', role: 'Cashier', phone: '+91 90000 00005', email: 'sana@elysianspire.com', status: 'Active', last: '2 min ago' },
    { name: 'Dev Patel', role: 'Waiter', phone: '+91 90000 00006', email: 'dev@elysianspire.com', status: 'Active', last: 'Now' },
    { name: 'Elena Rossi', role: 'Waitress', phone: '+91 90000 00007', email: 'elena@elysianspire.com', status: 'Off', last: 'Yesterday' },
  ],
  settings: {
    name: 'Elysian Spire',
    contact: '+91 22 4888 9000',
    address: '12 Rosebush Lane, Marine Drive, Mumbai',
    open: '12:00 PM – 11:30 PM',
    tables: 13,
    config: '2, 4, 6, 8 seaters',
  },
  notifs: { reserve: true, order: true, system: false },
  notifications: [
    { msg: 'New reservation from Rohan Kapoor · 8 seats', time: '2 min ago', read: false },
    { msg: 'Table T-09 is now ready for guests', time: '18 min ago', read: false },
    { msg: 'ORD-1041 marked as Ready for pickup', time: '1 hr ago', read: false },
    { msg: 'Weekly report is ready to review', time: '3 hrs ago', read: true },
  ],
};

/* ═══ Dashboard / analytics mock data ═══ */
export const TODAY = '2026-08-27';

export const TOP_ITEMS = [
  { name: 'Truffle Pasta', orders: 142, pct: 100 },
  { name: 'Elysian Burger', orders: 118, pct: 83 },
  { name: 'Creamy Mushroom Risotto', orders: 96, pct: 68 },
  { name: 'Grilled Chicken', orders: 78, pct: 55 },
  { name: 'Signature Tiramisu', orders: 64, pct: 45 },
];

export const REV: Record<string, { labels: string[]; data: number[] }> = {
  '7': { labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], data: [52, 61, 58, 72, 84, 96, 84] },
  '30': { labels: ['W1', 'W2', 'W3', 'W4', 'W5'], data: [420, 480, 452, 540, 588] },
  '3m': { labels: ['Jun', 'Jul', 'Aug'], data: [1620, 1750, 1900] },
  'TODAY': { labels: ['10a', '12p', '2p', '4p', '6p', '8p', '10p'], data: [4, 6, 8, 10, 14, 18, 16] },
};

export const WEEK_ORDERS = [64, 78, 71, 90, 118, 132, 108];
export const WEEK_REV = [128, 156, 142, 180, 236, 264, 216];

export const REP: Record<string, { rev: number[]; ord: number[]; res: number[] }> = {
  'Today': { rev: [8, 6, 9, 12, 15, 14], ord: [6, 4, 7, 9, 11, 10], res: [2, 3, 2, 4, 3, 4] },
  'This Week': { rev: [52, 58, 49, 72, 84, 78], ord: [38, 41, 36, 52, 63, 57], res: [14, 16, 12, 19, 22, 20] },
  'This Month': { rev: [420, 455, 470, 520, 560, 540], ord: [300, 320, 335, 370, 398, 385], res: [120, 128, 122, 140, 152, 146] },
  'Custom': { rev: [44, 40, 52, 48, 60, 55], ord: [30, 28, 35, 33, 42, 38], res: [10, 9, 12, 11, 14, 13] },
};

/* ═══ Dashboard KPIs ═══ */
export interface KPI {
  label: string;
  value: number;
  delta: string;
  dir: 'up' | 'down' | 'mut';
  icon: 'rev' | 'ord' | 'res' | 'tbl' | 'cust' | 'aov';
  fmt?: 'money';
}
export const KPIS: KPI[] = [
  { label: "Today's Revenue", value: 84500, delta: '+12.5% vs yesterday', dir: 'up', icon: 'rev', fmt: 'money' },
  { label: 'Total Orders', value: 56, delta: '+8% vs yesterday', dir: 'up', icon: 'ord' },
  { label: 'Reservations', value: 18, delta: '4 upcoming tonight', dir: 'mut', icon: 'res' },
  { label: 'Available Tables', value: 7, delta: 'of 13 tables', dir: 'mut', icon: 'tbl' },
  { label: 'New Customers', value: 9, delta: '+3 today', dir: 'up', icon: 'cust' },
  { label: 'Average Order Value', value: 1890, delta: '+4.2% vs yesterday', dir: 'up', icon: 'aov', fmt: 'money' },
];

/* Real-time live-notification pool */
export const NOTIF_POOL = [
  'New reservation from Meera Pillai — 4 seats at T-03',
  'ORD-1048 marked as Ready for pickup',
  'Table T-07 is now available',
  'ORD-1049 received on Table T-08',
  'Guest feedback added for Table T-02',
  'Kitchen flagged Truffle Pasta — 4 min ETA',
  'New reservation from Ananya Rao — 2 seats at T-05',
  'Payroll report is ready to review',
];

/* ═══ Staff & Roles mock data (port of staff-data.js) ═══ */
const a = (t: string, d: string): ActivityEntry => ({ t, d });

const STAFF_MEMBERS: StaffMember[] = [
  { name: 'Sarah Khan', email: 'sarah.khan@elysianspire.com', role: 'Manager', status: 'Active', last: '2 min ago', joined: '12 Mar 2024', activity: [a('Opened the Reports page', 'Today · 1:42 PM'), a('Logged in', 'Today · 9:05 AM'), a('Role changed from Waiter to Manager', '5 Jan 2026 · 9:10 AM'), a('Account activated', '12 Mar 2024 · 8:15 AM')] },
  { name: 'Rahul Singh', email: 'rahul.singh@elysianspire.com', role: 'Waiter', status: 'Active', last: 'Now', joined: '18 Apr 2024', activity: [a('Created order ORD-1051', 'Today · 1:38 PM'), a('Logged in', 'Today · 8:40 AM'), a('Invitation accepted', '18 Apr 2024 · 10:22 AM'), a('Account activated', '18 Apr 2024 · 10:24 AM')] },
  { name: 'Ahmed Ali', email: 'ahmed.ali@elysianspire.com', role: 'Chef', status: 'Active', last: '5 min ago', joined: '02 Jan 2024', activity: [a('Marked ORD-1044 as Ready', 'Today · 1:03 PM'), a('Promoted to Chef', '5 Mar 2026 · 9:12 AM'), a('Role changed from Waiter to Chef', '5 Mar 2026 · 9:10 AM'), a('Invitation accepted', '2 Jan 2024 · 8:12 AM')] },
  { name: 'Priya Sharma', email: 'priya.sharma@elysianspire.com', role: 'Cashier', status: 'Active', last: '1 hr ago', joined: '25 Jun 2024', activity: [a('Reconciled the lunch till', 'Today · 12:02 PM'), a('Settled invoice for T-04', 'Today · 11:47 AM'), a('Account activated', '25 Jun 2024 · 8:30 AM')] },
  { name: 'Arjun Mehta', email: 'arjun.mehta@elysianspire.com', role: 'Inventory Staff', status: 'Suspended', last: '3 days ago', joined: '09 Sep 2024', activity: [a('Account suspended', '25 Aug 2026 · 6:10 PM'), a('Restocked Bar stock', '24 Aug 2026 · 9:32 AM'), a('Account activated', '9 Sep 2024 · 9:05 AM')] },
  { name: 'Nina Kapoor', email: 'nina.kapoor@elysianspire.com', role: 'Waiter', status: 'Pending', inv: 'Pending', last: 'Awaiting response', joined: '—', sent: '2 Mar 2026', activity: [a('Invitation sent', '2 Mar 2026 · 11:15 AM')] },
  { name: 'Ravi Desai', email: 'ravi.desai@elysianspire.com', role: 'Chef', status: 'Pending', inv: 'Expired', last: 'Awaiting response', joined: '—', sent: '12 Jan 2026', activity: [a('Invitation expired', '26 Jan 2026 · 11:15 AM'), a('Invitation sent', '12 Jan 2026 · 10:00 AM')] },
];

export const seedStaffState = (): StaffState => ({
  tab: 'team',
  members: STAFF_MEMBERS.map((m) => ({ ...m, activity: m.activity.map((x) => ({ ...x })) })),
  customRoles: [] as CustomRole[],
  selectedRole: 'Manager',
  openMenu: -1,
  perPage: 5,
  page: 1,
  search: '',
  fRole: '',
  fStatus: '',
  sort: 'name',
  creatingCustom: false,
});

/* ═══ Permission system (port of staff-permissions.js) ═══
   Role names must match the canonical DB seed (0001_initial_schema.sql).
   The database has: Owner/Admin, Manager, Waiter, Chef.
   Do NOT add static role lists here — use the DB roles from useStaff(). */

export const PERM_CATS: PermissionCategory[] = [
  { cat: 'Customers', perms: ['View Customers', 'Create Customers', 'Edit Customers', 'Delete Customers'] },
  { cat: 'Orders', perms: ['View Orders', 'Create Orders', 'Edit Orders', 'Cancel Orders'] },
  { cat: 'Reservations', perms: ['View Reservations', 'Create Reservations', 'Edit Reservations', 'Cancel Reservations'] },
  { cat: 'Inventory', perms: ['View Inventory', 'Manage Inventory'] },
  { cat: 'Reports', perms: ['View Reports', 'Export Reports'] },
  { cat: 'Staff', perms: ['View Staff', 'Invite Staff', 'Manage Roles'] },
  { cat: 'Settings', perms: ['Manage Settings'] },
];

export const ALL_PERMS: string[] = PERM_CATS.reduce<string[]>((acc, c) => acc.concat(c.perms), []);

export const ROLE_PERMS: Record<string, string[]> = {
  'Owner/Admin': ALL_PERMS.slice(),
  'Manager': ['View Customers', 'Create Customers', 'Edit Customers', 'View Orders', 'Create Orders', 'Edit Orders', 'Cancel Orders', 'View Reservations', 'Create Reservations', 'Edit Reservations', 'Cancel Reservations', 'View Inventory', 'Manage Inventory', 'View Reports', 'Export Reports', 'View Staff', 'Invite Staff'],
  'Waiter': ['View Orders', 'Create Orders', 'View Reservations', 'View Customers'],
  'Chef': ['View Orders'],
  'Cashier': ['View Orders', 'Create Orders', 'Edit Orders', 'View Reservations', 'View Customers', 'View Reports'],
  'Inventory Manager': ['View Inventory', 'Manage Inventory', 'View Reports'],
  'Host/Hostess': ['View Reservations', 'Create Reservations', 'Edit Reservations', 'View Customers', 'Create Customers', 'View Orders'],
  'Kitchen Staff': ['View Orders', 'Edit Orders'],
};

export const ROLE_DESC: Record<string, string> = {
  'Owner/Admin': 'Full access to restaurant operations, billing and settings.',
  'Manager': 'Manages restaurant operations and team activity.',
  'Waiter': 'Takes orders and assists guests in the dining room.',
  'Chef': 'Accesses the kitchen queue and order pipeline.',
  'Cashier': 'Handles billing, POS and payments at the counter.',
  'Inventory Manager': 'Manages menu inventory, stock levels and suppliers.',
  'Host/Hostess': 'Manages reservations, guest seating and table assignments.',
  'Kitchen Staff': 'Kitchen order visibility and preparation workflow.',
};

export const ROLE_NAV: Record<string, string[]> = {
  'Owner/Admin': ['Dashboard', 'Customers', 'Reservations', 'Orders', 'Inventory', 'Staff & Roles', 'Reports', 'Settings'],
  'Manager': ['Dashboard', 'Customers', 'Reservations', 'Orders', 'Inventory', 'Staff & Roles', 'Reports', 'Settings'],
  'Waiter': ['Dashboard', 'Customers', 'Reservations', 'Orders'],
  'Chef': ['Dashboard', 'Orders'],
  'Cashier': ['Dashboard', 'Orders', 'Customers', 'Reservations', 'Reports'],
  'Inventory Manager': ['Dashboard', 'Menu', 'Reports'],
  'Host/Hostess': ['Dashboard', 'Customers', 'Reservations', 'Orders'],
  'Kitchen Staff': ['Dashboard', 'Orders'],
};

export const ROLE_ALL_NAV = ['Dashboard', 'Customers', 'Reservations', 'Orders', 'Inventory', 'Menu', 'Staff & Roles', 'Reports', 'Settings'];

export const PREV: Record<string, [string, number][]> = {
  'Owner/Admin': [['View Orders', 1], ['Create Orders', 1], ['View Reservations', 1], ['View Customers', 1], ['Manage Staff', 1], ['Manage Inventory', 1], ['View Reports', 1]],
  'Manager': [['View Orders', 1], ['Create Orders', 1], ['View Reservations', 1], ['View Customers', 1], ['Manage Staff', 1], ['Manage Inventory', 1], ['View Reports', 1]],
  'Waiter': [['View Orders', 1], ['Create Orders', 1], ['View Reservations', 1], ['View Customers', 1], ['Manage Staff', 0], ['Manage Inventory', 0], ['View Reports', 0]],
  'Chef': [['View Orders', 1], ['View Reservations', 0], ['View Customers', 0], ['Manage Staff', 0], ['Manage Inventory', 0], ['View Reports', 0], ['Manage Settings', 0]],
  'Cashier': [['View Orders', 1], ['Create Orders', 1], ['View Reservations', 1], ['View Customers', 1], ['Manage Staff', 0], ['Manage Inventory', 0], ['View Reports', 1]],
  'Inventory Manager': [['View Orders', 0], ['View Inventory', 1], ['Manage Inventory', 1], ['View Customers', 0], ['Manage Staff', 0], ['View Reports', 1], ['Manage Settings', 0]],
  'Host/Hostess': [['View Orders', 1], ['View Reservations', 1], ['Create Reservations', 1], ['View Customers', 1], ['Manage Staff', 0], ['Manage Inventory', 0], ['View Reports', 0]],
  'Kitchen Staff': [['View Orders', 1], ['Edit Orders', 1], ['View Reservations', 0], ['View Customers', 0], ['Manage Staff', 0], ['Manage Inventory', 0], ['View Reports', 0]],
};

export const PERMISSION_KEYS: Record<string, string> = {
  'View Customers': 'customers.view',
  'Create Customers': 'customers.manage',
  'Edit Customers': 'customers.manage',
  'Delete Customers': 'customers.manage',
  'View Orders': 'orders.view',
  'Create Orders': 'orders.create',
  'Edit Orders': 'orders.manage',
  'Cancel Orders': 'orders.manage',
  'View Reservations': 'reservations.view',
  'Create Reservations': 'reservations.manage',
  'Edit Reservations': 'reservations.manage',
  'Cancel Reservations': 'reservations.manage',
  'View Inventory': 'inventory.view',
  'Manage Inventory': 'inventory.manage',
  'View Reports': 'reports.view',
  'Export Reports': 'reports.view',
  'View Staff': 'staff.view',
  'Invite Staff': 'staff.manage',
  'Manage Roles': 'staff.manage',
  'Manage Settings': 'settings.manage',
};

/** Canonical DB permission codes — derived from PERMISSION_KEYS (single
    source of truth), matching migration 0001's per-slug seed exactly. */
export const ALL_PERMISSION_SLUGS: string[] = [...new Set(Object.values(PERMISSION_KEYS))];

/* ═══ TITLES for topbar routing ═══ */
export const TITLES: Record<string, string> = {
  dashboard: 'Dashboard',
  orders: 'Orders',
  reservations: 'Reservations',
  tables: 'Table Management',
  customers: 'Customers',
  menu: 'Menu Management',
  staff: 'Staff & Roles',
  reports: 'Reports',
  settings: 'Settings',
};

export type { InvStatus, MemberStatus, StaffMember };

/** Count unique permissions from a permission code array. */
export function rolePermCount(permissions: string[]): number {
  return new Set(permissions).size;
}
