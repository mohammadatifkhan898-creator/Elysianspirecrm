import { createContext, useContext, useEffect, useReducer } from 'react';
import type { AppState, Notification } from '../types';
import type { StaffState } from '../types/staff';

/* ═══════════════════════════════════════════════════════════════
   Central mutable app store.
   Mirrors the vanilla `S` object + `StaffState`: a plain mutable
   singleton mutated imperatively by action helpers, with a version
   counter that re-renders every subscribed React consumer. This
   preserves the exact vanilla behavior (including cross-view
   mutations such as table status affecting the dashboard).
   ═══════════════════════════════════════════════════════════════ */

export interface Toast {
  id: number;
  msg: string;
  type: 'success' | 'error' | 'info';
  title?: string;
}

export interface AppStoreShape {
  s: AppState;
  ss: StaffState;
  /** Bump to re-render consumers. */
  version: number;
}

/* ── Empty initial state ─────────────────────────────────────────
   The store starts with NO data. Real Supabase-backed hooks (the
   *vertical slices*) replace `s.*` / `ss.members` wholesale when real
   rows hydrate; pages render genuine loading/empty/error states until
   then. Mock/seed data is never loaded into the production runtime
   path — it lives only in test fixtures.
   ═══════════════════════════════════════════════════════════════ */

function emptyAppState(): AppState {
  return {
    user: null,
    identity: null,
    orders: [],
    reservations: [],
    tables: [],
    customers: [],
    menu: {},
    staff: [],
    settings: {
      name: '',
      contact: '',
      address: '',
      open: '',
      tables: 0,
      config: '',
    },
    notifs: { reserve: true, order: true, system: false },
    notifications: [],
  };
}

function emptyStaffState(): StaffState {
  return {
    tab: 'team',
    members: [],
    customRoles: [],
    selectedRole: 'Manager',
    openMenu: -1,
    perPage: 5,
    page: 1,
    search: '',
    fRole: '',
    fStatus: '',
    sort: 'name',
    creatingCustom: false,
  };
}

let store: AppStoreShape = {
  s: emptyAppState(),
  ss: emptyStaffState(),
  version: 0,
};

export function getStore(): AppStoreShape {
  return store;
}

export function getS(): AppState {
  return store.s;
}

export function getSS(): StaffState {
  return store.ss;
}

/* ── Toasts (non-persistent UI) ── */
let toastSeq = 0;
let toasts: Toast[] = [];
const toastListeners = new Set<() => void>();

export function toast(msg: string, type: Toast['type'] = 'success', title?: string) {
  const t: Toast = { id: ++toastSeq, msg, type, title };
  toasts = [...toasts, t];
  emitToast();
  setTimeout(() => {
    toasts = toasts.filter((x) => x.id !== t.id);
    emitToast();
  }, 3200);
}

function emitToast() {
  toastListeners.forEach((fn) => fn());
}

export function useToasts(): Toast[] {
  const [, force] = useReducer((c: number) => c + 1, 0);
  useEffect(() => {
    const fn = () => force();
    toastListeners.add(fn);
    return () => {
      toastListeners.delete(fn);
    };
  }, []);
  return toasts;
}

/* ── Store subscription (context) ── */
const listeners = new Set<() => void>();

export function notify() {
  store = { ...store, version: store.version + 1 };
  listeners.forEach((fn) => fn());
}

/** Replaces the whole state/state objects (used by services in future phases). */
export function replaceState(nextS: AppState, nextSS: StaffState) {
  store = { s: nextS, ss: nextSS, version: store.version + 1 };
  listeners.forEach((fn) => fn());
}

/** Global CLI-ish access to the app-level store so the (future) services
 *  and any imperative code can dispatch updates. Kept here for parity with
 *  the original debugging surface. */
export const App = {
  get state() {
    return store.s;
  },
  get staffState() {
    return store.ss;
  },
  notify,
  toast,
};

/* ── React context wiring ── */
interface StoreCtx {
  s: AppState;
  ss: StaffState;
  notify: () => void;
  toast: (msg: string, type?: Toast['type'], title?: string) => void;
}

const Ctx = createContext<StoreCtx>({
  s: store.s,
  ss: store.ss,
  notify,
  toast,
});

/** Hook returning the current store snapshot (re-renders on notify). */
export function useStore(): StoreCtx {
  const [, force] = useReducer((c: number) => c + 1, 0);
  useEffect(() => {
    const fn = () => force();
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);
  return {
    s: store.s,
    ss: store.ss,
    notify,
    toast,
  };
}

// eslint-disable-next-line react-refresh/only-export-components
export function AppProvider({ children }: { children: React.ReactNode }) {
  return <Ctx.Provider value={{ s: store.s, ss: store.ss, notify, toast }}>{children}</Ctx.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useApp(): StoreCtx {
  return useContext(Ctx);
}

export type { Notification };
