import { useEffect, useEffectEvent, useId, useRef, type ReactNode } from 'react';

interface ModalProps {
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
}

export const Modal = ({ title, description, onClose, children, footer, size = 'md' }: ModalProps) => {
  const titleId = useId();
  const panelRef = useRef<HTMLElement>(null);
  const closeModal = useEffectEvent(() => onClose());

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const firstField = panelRef.current?.querySelector<HTMLElement>('input, select, textarea, button:not(.modal-close)');
    (firstField ?? panelRef.current)?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeModal();
    };
    document.addEventListener('keydown', onKeyDown);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = '';
      previousFocus?.focus();
    };
  }, []);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section ref={panelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId} className={`modal-panel modal-${size}`}>
        <header className="modal-header">
          <div>
            <h2 id={titleId}>{title}</h2>
            {description && <p>{description}</p>}
          </div>
          <button type="button" className="modal-close" aria-label="Fermer" onClick={onClose}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-footer">{footer}</footer>}
      </section>
    </div>
  );
};
