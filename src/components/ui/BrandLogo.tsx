import brandLogo from '../../assets/ElysianSpirelogo.png';

/* ═══════════════════════════════════════════════════════════════
   BrandLogo — the single Elysian Spire CRM brand mark, imported as a
   Vite asset and reused everywhere the brand appears. It is intentionally
   dumb: it hands back the exact image asset with `object-fit: contain`,
   centred, and sized per-context. No recolouring, redesign, or replacement
   of the asset — only clean placement.
   ═══════════════════════════════════════════════════════════════ */

interface BrandLogoProps {
  /** Bounding-box size in px (the mark is square, so width = height). */
  size?: number;
  className?: string;
  alt?: string;
}

export function BrandLogo({ size = 56, className = '', alt = 'Elysian Spire' }: BrandLogoProps) {
  return (
    <img
      src={brandLogo}
      alt={alt}
      width={size}
      height={size}
      className={'brand-logo' + (className ? ` ${className}` : '')}
      style={{ width: size, height: size, objectFit: 'contain', objectPosition: 'center' }}
      draggable={false}
    />
  );
}
