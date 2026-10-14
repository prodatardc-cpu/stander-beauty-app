import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { Modal } from './Modal';

type ToastTone = 'success' | 'error' | 'info';
type Toast = { id: number; message: string; tone: ToastTone };
type ConfirmOptions = { title: string; message: string; confirmLabel?: string; danger?: boolean };

interface FeedbackContextValue {
  notify: (message: string, tone?: ToastTone) => void;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
}

const FeedbackContext = createContext<FeedbackContextValue | null>(null);

export const FeedbackProvider = ({ children }: { children: ReactNode }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [pendingConfirm, setPendingConfirm] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((value: boolean) => void) | null>(null);
  const nextId = useRef(0);

  const notify = useCallback((message: string, tone: ToastTone = 'success') => {
    const id = ++nextId.current;
    setToasts((current) => [...current, { id, message, tone }]);
    window.setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), tone === 'error' ? 6000 : 3500);
  }, []);

  const confirm = useCallback((options: ConfirmOptions) => {
    setPendingConfirm(options);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const settle = useCallback((value: boolean) => {
    resolver.current?.(value);
    resolver.current = null;
    setPendingConfirm(null);
  }, []);
  const cancel = useCallback(() => settle(false), [settle]);

  const value = useMemo(() => ({ notify, confirm }), [notify, confirm]);

  return (
    <FeedbackContext.Provider value={value}>
      {children}
      <div className="toast-stack" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} role={toast.tone === 'error' ? 'alert' : 'status'} className={`toast toast-${toast.tone}`}>
            {toast.message}
          </div>
        ))}
      </div>
      {pendingConfirm && (
        <Modal
          size="sm"
          title={pendingConfirm.title}
          onClose={cancel}
          footer={<>
            <button type="button" className="btn btn-secondary" onClick={cancel}>Annuler</button>
            <button type="button" className={`btn ${pendingConfirm.danger ? 'btn-danger' : 'btn-primary'}`} onClick={() => settle(true)}>
              {pendingConfirm.confirmLabel ?? 'Confirmer'}
            </button>
          </>}
        >
          <p className="text-sm text-gray-700">{pendingConfirm.message}</p>
        </Modal>
      )}
    </FeedbackContext.Provider>
  );
};

// eslint-disable-next-line react-refresh/only-export-components
export const useFeedback = () => {
  const context = useContext(FeedbackContext);
  if (!context) throw new Error('useFeedback must be used inside FeedbackProvider');
  return context;
};
