import { X } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from './Button';
import { cn } from './cn';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'md' | 'lg';
}

/**
 * Diálogo accesible con <dialog>: hoja desde abajo en el teléfono y ventana centrada en la
 * computadora. Escape y el botón X lo cierran.
 */
export function Modal({ open, onClose, title, children, footer, size = 'md' }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className={cn(
        'm-0 mt-auto w-full max-w-none bg-transparent p-0 backdrop:bg-scrim md:m-auto',
        size === 'md' ? 'md:max-w-lg' : 'md:max-w-2xl',
      )}
    >
      {open && (
        <div className="flex max-h-[92dvh] flex-col rounded-t-xl bg-surface-lowest text-on-surface shadow-pop md:rounded-lg">
          <div className="flex items-center justify-between gap-3 border-b border-outline-variant/50 px-5 py-4">
            <h2 className="text-headline-md text-primary">{title}</h2>
            <button type="button" onClick={onClose} aria-label="Cerrar" className="rounded-full p-2 text-on-surface-variant hover:bg-surface-low">
              <X size={20} aria-hidden />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="pb-safe flex flex-wrap justify-end gap-2 border-t border-outline-variant/50 px-5 py-3">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

interface ConfirmOptions {
  title: string;
  body?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;
const ConfirmContext = createContext<ConfirmFn | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);
  const confirm = useCallback<ConfirmFn>((opts) => new Promise<boolean>((resolve) => setState({ ...opts, resolve })), []);
  const close = (v: boolean) => {
    state?.resolve(v);
    setState(null);
  };
  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Modal
        open={!!state}
        onClose={() => close(false)}
        title={state?.title ?? ''}
        footer={
          <>
            <Button variant="secondary" onClick={() => close(false)}>
              {state?.cancelLabel ?? 'Cancelar'}
            </Button>
            <Button variant={state?.danger ? 'danger' : 'primary'} onClick={() => close(true)} autoFocus>
              {state?.confirmLabel ?? 'Confirmar'}
            </Button>
          </>
        }
      >
        <div className="text-body-md text-on-surface-variant">{state?.body}</div>
      </Modal>
    </ConfirmContext.Provider>
  );
}

/** const confirm = useConfirm(); if (await confirm({ title: '¿Seguro?' })) … */
export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm fuera de ConfirmProvider');
  return ctx;
}
