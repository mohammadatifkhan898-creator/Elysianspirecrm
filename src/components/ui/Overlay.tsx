import { useEffect, useReducer } from 'react';
import type { ReactNode } from 'react';
import { Icon } from './Icon';
import { BrandLockup } from './BrandLockup';
import { useToasts } from '../../store/store';
import { ICON } from '../../lib/svg';

/* ═══════════════════════════════════════════════════════════════
   Overlay system — modal + drawer + overlay + toasts.
   Single-instance store mirroring the vanilla `#modal` / `#drawer` /
   `#overlay` / `#toasts` region. Exposes React hooks so any component
   can open/close, and an <OverlayHost/> renders the live content.
   ═══════════════════════════════════════════════════════════════ */

let modalNode: ReactNode | null = null;
let drawerNode: ReactNode | null = null;
const overlayListeners = new Set<() => void>();

function emitOverlay() {
  overlayListeners.forEach((fn) => fn());
}

export function openModal(node: ReactNode) {
  modalNode = node;
  emitOverlay();
}
export function openDrawer(node: ReactNode) {
  drawerNode = node;
  emitOverlay();
}
export function closeModal() {
  modalNode = null;
  emitOverlay();
}
export function closeDrawer() {
  drawerNode = null;
  emitOverlay();
}
export function closeAll() {
  modalNode = null;
  drawerNode = null;
  emitOverlay();
}

function useOverlaySnapshot() {
  const [, force] = useReducer((c: number) => c + 1, 0);
  useEffect(() => {
    const fn = () => force();
    overlayListeners.add(fn);
    return () => {
      overlayListeners.delete(fn);
    };
  }, []);
  return { modal: modalNode, drawer: drawerNode };
}

/** Render the overlay/modal/drawer/toast region. Mount once in App. */
export function OverlayHost() {
  const { modal, drawer } = useOverlaySnapshot();
  const toasts = useToasts();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeModal();
        closeDrawer();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      <div className={'overlay' + (modal || drawer ? ' open' : '')} onClick={closeAll}></div>
      <div className={'modal' + (modal ? ' open' : '')}>{modal}</div>
      <div className={'drawer' + (drawer ? ' open' : '')}>{drawer}</div>
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={'toast ' + t.type + ' show'}>
            {t.type === 'success' ? (
              <Icon d={ICON.check} />
            ) : t.type === 'error' ? (
              <Icon d="<circle cx='12' cy='12' r='9'/><path d='M12 8v5M12 16.5v.5'/>" />
            ) : (
              <Icon d="<circle cx='12' cy='12' r='9'/><path d='M12 11v5M12 8v.5'/>" />
            )}
            {t.title ? <b>{t.title}</b> : null}
            <span>{t.msg}</span>
          </div>
        ))}
      </div>
    </>
  );
}

/* Convenience structural helpers (match vanilla markup). */
export function CloseButton({ onClick }: { onClick?: () => void }) {
  return (
    <button className="icon-btn" onClick={onClick} aria-label="Close">
      <Icon d={ICON.close} strokeWidth={1.8} />
    </button>
  );
}

export function ModalHead({ title, onClose, children }: { title: ReactNode; onClose?: () => void; children?: ReactNode }) {
  return (
    <div className="modal-head">
      <h3>{title}</h3>
      {children || <CloseButton onClick={onClose} />}
    </div>
  );
}

export function DrawerFoot({ children }: { children: ReactNode }) {
  return <div className="drawer-foot">{children}</div>;
}

export function AuthVisual({ quote, cite, meta }: { quote: string; cite: string; meta: string }) {
  return (
    <div className="auth-visual">
      <div className="authtexture"></div>
      <div className="auth-visual-inner">
        <div className="auth-brand">
          <BrandLockup variant="horizontal" tone="dark" iconSize={56} descriptor="Restaurant Management CRM" className="auth-visual-lockup" />
        </div>
        <div className="auth-quote">
          <p>{quote}</p>
          <div className="cite">&mdash; {cite}</div>
        </div>
        <div className="auth-meta">{meta}</div>
      </div>
    </div>
  );
}
