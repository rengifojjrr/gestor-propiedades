import { useEffect, useState } from 'react';
import { RouterProvider } from 'react-router';
import { svc } from '@/services';
import { ConfirmProvider, ErrorState, Loading, ToastProvider } from '@/ui';
import { router } from './router';
import { SessionProvider } from './session';

/** Arranque: carga la semilla si el navegador está vacío y corre las tareas automáticas cada minuto. */
export function App() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        await svc.system.ensureSeeded();
        await svc.system.tick();
        if (alive) setReady(true);
      } catch (err) {
        if (alive) setError(err instanceof Error ? err : new Error(String(err)));
      }
    })();
    const timer = setInterval(() => void svc.system.tick(), 60_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  if (error)
    return (
      <div className="mx-auto max-w-lg p-6">
        <ErrorState error={`No se pudieron preparar los datos en este navegador: ${error.message}`} />
      </div>
    );
  return (
    <ToastProvider>
      <ConfirmProvider>
        <SessionProvider ready={ready}>{ready ? <RouterProvider router={router} /> : <Loading label="Preparando los datos de ejemplo…" className="min-h-dvh" />}</SessionProvider>
      </ConfirmProvider>
    </ToastProvider>
  );
}
