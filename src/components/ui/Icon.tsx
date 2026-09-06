import type { ReactNode } from 'react';

interface IconProps {
  /** Key into the ICON library (full SVG markup), or arbitrary markup. */
  d?: string;
  size?: number;
  strokeWidth?: number;
  className?: string;
  children?: ReactNode;
}

/**
 * Inline SVG icon. The vanilla app injects the whole markup string
 * (e.g. `<path .../><circle .../>`) as a full `<svg>` via innerHTML, so we
 * render the provided markup inside the svg element identically. This works
 * both for ICON-library markup and for arbitrary path children.
 */
export function Icon({ d, size = 18, strokeWidth = 1.7, className, children }: IconProps) {
  const inner = d
    ? { __html: d }
    : children != null
      ? { __html: children }
      : undefined;
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      style={{ width: size, height: size }}
      className={className}
      aria-hidden="true"
      dangerouslySetInnerHTML={inner}
    />
  );
}
