import { useEffect, useId, useRef, type ReactNode } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Fenêtre modale accessible, partagée par tous les écrans.
 *
 * Correction P3 (accessibilité) : les trois modales de l'application étaient
 * réécrites à l'identique, sans role="dialog", sans fermeture au clavier, sans
 * piège de focus ni restauration du focus à la fermeture.
 */
export function Modal({ title, children, onClose, width = 560 }: {
  title: string; children: ReactNode; onClose: () => void; width?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    opener.current = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? ref.current)?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
      if (e.key !== 'Tab' || !ref.current) return;
      const items = Array.from(ref.current.querySelectorAll<HTMLElement>(FOCUSABLE))
        .filter(el => el.offsetParent !== null);
      if (items.length === 0) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }

    document.addEventListener('keydown', onKeyDown, true);
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.body.style.overflow = overflow;
      opener.current?.focus?.();
    };
  }, [onClose]);

  return (
    <div className="modal-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" ref={ref} style={{ width }} tabIndex={-1}
        role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="row">
          <h3 id={titleId} style={{ margin: 0 }}>{title}</h3>
          <button className="iconbtn" onClick={onClose} aria-label="Fermer la fenêtre">✕</button>
        </div>
        <div style={{ marginTop: 12 }}>{children}</div>
      </div>
    </div>
  );
}

/** Confirmation explicite avant une action destructrice. */
export function ConfirmDialog({ title, message, confirmLabel = 'Confirmer', danger, onConfirm, onClose }: {
  title: string; message: ReactNode; confirmLabel?: string; danger?: boolean;
  onConfirm: () => void; onClose: () => void;
}) {
  return (
    <Modal title={title} onClose={onClose} width={480}>
      <div style={{ marginBottom: 16 }}>{message}</div>
      <div className="row">
        <button className="btn ghost" onClick={onClose}>Annuler</button>
        <button className="btn" style={danger ? { background: 'var(--red)' } : undefined}
          onClick={() => { onConfirm(); onClose(); }}>{confirmLabel}</button>
      </div>
    </Modal>
  );
}
