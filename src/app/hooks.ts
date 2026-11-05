import { useCallback, useState } from 'react';
import { errorMessage } from '@/services';
import { useToast } from '@/ui';

export interface ActionOptions {
  success?: string;
}

/**
 * Corre una acción de servicio y muestra el error en un aviso (toast) si falla.
 * const run = useAction(); await run(() => svc.bookings.checkOutBooking(actor, id), { success: 'Salida registrada' });
 * Devuelve el resultado, o undefined si falló.
 */
export function useAction() {
  const toast = useToast();
  return useCallback(
    async <T>(fn: () => Promise<T>, opts: ActionOptions = {}): Promise<T | undefined> => {
      try {
        const result = await fn();
        if (opts.success) toast.success(opts.success);
        return result;
      } catch (err) {
        toast.error(errorMessage(err));
        return undefined;
      }
    },
    [toast],
  );
}

/** Igual que useAction, con un indicador `busy` para deshabilitar botones. */
export function useBusyAction(): [<T>(fn: () => Promise<T>, opts?: ActionOptions) => Promise<T | undefined>, boolean] {
  const run = useAction();
  const [busy, setBusy] = useState(false);
  const wrapped = useCallback(
    async <T>(fn: () => Promise<T>, opts?: ActionOptions) => {
      setBusy(true);
      try {
        return await run(fn, opts);
      } finally {
        setBusy(false);
      }
    },
    [run],
  );
  return [wrapped, busy];
}

/** Descarga un texto o Blob como archivo. */
export function downloadFile(content: string | Blob, name: string, type = 'text/plain;charset=utf-8'): void {
  const blob = typeof content === 'string' ? new Blob([content], { type }) : content;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
