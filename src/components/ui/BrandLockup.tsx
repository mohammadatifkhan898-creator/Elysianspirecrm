import { BrandLogo } from './BrandLogo';

/* ═══════════════════════════════════════════════════════════════
   BrandLockup — the full Elysian Spire brand identity: the official
   logo icon (reused via <BrandLogo/> so the asset is imported in one
   place) next to / above the "ELYSIAN SPIRE" wordmark and the small
   "RESTAURANT CRM" descriptor.

   Two layouts:
     • horizontal — icon left, wordmark + descriptor stacked right
       (auth / Login / Signup / Forgot pages).
     • vertical   — icon centred with the wordmark and descriptor below
       (compact sidebar header).

   Tone picks the text colour to match the surface:
     • light (ivory cards)  → navy wordmark, gold descriptor
     • dark  (navy sidebar) → white wordmark, gold descriptor

   The logo image itself is never recoloured, redrawn, or distorted —
   it is placed with `object-fit: contain`, aspect preserved.
   ═══════════════════════════════════════════════════════════════ */

interface BrandLockupProps {
  /** Icon bounding-box size in px (the mark is square). */
  iconSize?: number;
  /** horizontal (icon beside text) or vertical (icon above text). */
  variant?: 'horizontal' | 'vertical';
  /** light = ivory surface, dark = navy surface. */
  tone?: 'light' | 'dark';
  /** Show the secondary descriptor line. */
  showDescriptor?: boolean;
  /** Custom descriptor text (defaults to "RESTAURANT CRM"). */
  descriptor?: string;
  className?: string;
}

export function BrandLockup({
  iconSize = 40,
  variant = 'horizontal',
  tone = 'light',
  showDescriptor = true,
  descriptor = 'RESTAURANT CRM',
  className = '',
}: BrandLockupProps) {
  const classes = ['brand-lockup', 'br-' + variant, 'tone-' + tone];
  if (!showDescriptor) classes.push('no-desc');
  if (className) classes.push(className);

  return (
    <div className={classes.join(' ').trim()}>
      <BrandLogo size={iconSize} className="brand-lockup-mark" />
      <div className="brand-lockup-text">
        <span className="brand-wordmark">ELYSIAN&nbsp;SPIRE</span>
        {showDescriptor && <span className="brand-descriptor">{descriptor}</span>}
      </div>
    </div>
  );
}
