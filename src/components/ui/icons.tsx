import type { ReactNode } from 'react';

/** KPI row icons (icon key -> path markup). */
export const KPI_ICON: Record<string, string> = {
  rev: '<path d="M12 2v20M17 6H9.5a3 3 0 0 0 0 6h5a3 3 0 0 1 0 6H7"/>',
  ord: '<path d="M6 3 4 9v11a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9l-2-6H6Z"/><path d="M4 9h16M9 13h6"/>',
  res: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18M9 15h6"/>',
  tbl: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2.4"/>',
  cust: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.4 3.4-5 6.5-5s5.7 1.6 6.5 5"/>',
  aov: '<path d="M4 12a8 8 0 1 1 16 0z"/><path d="M12 8v8M9 10h6"/>',
};

/** Menu item icons (from app.js MENU_ICONS). */
export const MENU_ICON_MARKUP: Record<string, ReactNode> = {
  salad: <path d="M6 13c0-4 2.5-7 6-7s6 3 6 7c0 .5-.5 1-1 1H7c-.5 0-1-.5-1-1Z" />,
  board: <path d="M12 3v14M7 8l5 5 5-5" />,
  pasta: <path d="M5 19c6 0 14-4 14-4-4-1-14-3-14 4Z" />,
  arancini: <circle cx="12" cy="12" r="8" />,
  bone: <path d="M8 4a2 2 0 1 1 4 2l.5.5 1-1a2.5 2.5 0 1 1 3 3l-1 1 .5.5a2 2 0 1 1-2 4l-.5-.5-3 3a2 2 0 1 1-3-3l1-1-.5-.5a2.5 2.5 0 1 1 3-3l-1-1A2 2 0 0 1 8 4Z" />,
  burger: <path d="M4 12h16l-1 5a3 3 0 0 1-3 2H8a3 3 0 0 1-3-2l-1-5Z" />,
  risotto: <path d="M4 12c0-4.5 3.5-8 8-8s8 3.5 8 8v8H6v-7" />,
  chicken: <path d="M13 2a5 5 0 0 1 5 5c0 .6-.1 1.2-.3 1.7L20 15l-3 4-2-2-2 5-2-5-1 1-2-3 2-3-1.5-2.5A5 5 0 0 1 13 2Z" />,
  steak: <path d="M12 3c3 0 8 2 8 7 0 4-3 8-6 8s-4-2-6-2-3 2-6 2c0-3 1-5 3-6.5M12 3c-2 5-1 11 4 15" />,
  wine: <path d="M8 2h8l-.5 8a3.5 3.5 0 0 1-7 0L8 2Z" />,
  tonic: <path d="M9 3h6l-1 7a2 2 0 0 1-4 0L9 3Z" />,
  martini: <path d="M5 3h14L12 13 5 3Z" />,
  mocktail: <path d="M8 3h8l-1 3h-6L8 3Z" />,
  tiramisu: <rect x="4" y="4" width="16" height="16" rx="2" />,
  sorbet: <path d="M12 3a7 7 0 0 1 7 7c0 2-1 4-2 5l-3 4a2 2 0 0 1-4 0l-3-4c-1-1-2-3-2-5a7 7 0 0 1 7-7Z" />,
  fondant: <path d="M12 3c1.5 3 5 3.5 5 6a5 5 0 0 1-10 0c0-2.5 3.5-3 5-6Z" />,
};

/**
 * Render a menu item's icon. Falls back to the salad icon when the key is
 * unknown. Uses `stroke-width=1.5` per the vanilla `.menu-img` markup.
 */
export function MenuIcon({ name, size = 26 }: { name?: string; size?: number }) {
  const key = name && MENU_ICON_MARKUP[name] ? name : 'salad';
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} style={{ width: size, height: size }}>
      {MENU_ICON_MARKUP[key]}
    </svg>
  );
}
