import type { ReactNode } from 'react';
import { Icon } from './Icon';
import { ICON } from '../../lib/svg';

/* View-only notice shown on pages where the user can browse and review
   content but has no permission to make changes. Quiet by design — a
   muted line under the page head, never an alert-style banner. */

export function ReadOnlyNotice({ children }: { children: ReactNode }) {
  return (
    <div className="ro-notice" role="status">
      <Icon d={ICON.eye} size={15} />
      <span>{children}</span>
    </div>
  );
}