import type { StaffState } from '../types/staff';

/** Format a number as Indian Rupees. Port of vanilla `inr()`. */
export function inr(n: number): string {
  return '₹' + n.toLocaleString('en-IN');
}

/** Two-letter initials. Port of vanilla `initials()`. */
export function initials(n: string): string {
  return (n || ' ')
    .split(' ')
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

/** Derive a display name from an email. Port of vanilla `nameFromEmail()`. */
export function nameFromEmail(e: string): string {
  const p = e.split('@')[0];
  const name = p
    .split(/[._-]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
  return name || 'Admin';
}

export const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Convert a 12h time string ("7:30 PM") to 24h ("19:30"). Port of `convertTime()`. */
export function convertTime(t: string): string {
  const m = t.match(/^(\d{1,2}):(\d{2}) (AM|PM)$/);
  if (!m) return '19:30';
  let h = +m[1];
  if (m[3] === 'PM' && h !== 12) h += 12;
  if (m[3] === 'AM' && h === 12) h = 0;
  return String(h).padStart(2, '0') + ':' + m[2];
}

/** Convert 24h ("19:30") to 12h ("7:30 PM"). Port of `to12()`. */
export function to12(t: string): string {
  const [h, m] = t.split(':').map(Number);
  const ap = h >= 12 ? 'PM' : 'AM';
  const hh = ((h + 11) % 12) + 1;
  return hh + ':' + String(m).padStart(2, '0') + ' ' + ap;
}

/** Greeting based on current hour. */
export function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

/** Tier of a customer based on order count. */
export function customerTier(orders: number): 'Platinum' | 'Gold' | 'Silver' | 'Regular' {
  return orders >= 40 ? 'Platinum' : orders >= 20 ? 'Gold' : orders >= 10 ? 'Silver' : 'Regular';
}

/** Port of app store helpers for the Staff module. */
export function memberByIdx(ss: StaffState, i: number) {
  return ss.members[i] || null;
}
