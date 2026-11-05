/** Ganchos de las pantallas de huéspedes y mensajes del equipo. */
import { useCallback, useSyncExternalStore } from 'react';
import { useNavigate } from 'react-router';
import { useBusyAction } from '@/app/hooks';
import { useActor } from '@/app/session';
import { useLive } from '@/data/live';
import { subjectFor, svc, type Subject } from '@/services';

/** ¿Coincide la consulta de medios? (p. ej. '(min-width: 1024px)' para la computadora). */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const m = window.matchMedia(query);
      m.addEventListener('change', onChange);
      return () => m.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** El sujeto de permisos del actor actual (para no mostrar acciones que el rol no puede hacer). */
export function useSubject(): Subject | undefined {
  const actor = useActor();
  return useLive(() => subjectFor(actor), [actor]);
}

/**
 * Abre la conversación de una reserva o contrato (la crea vacía si todavía no existe) y navega a ella.
 * Devuelve [abrir, ocupado].
 */
export function useOpenThread(): [(ref: { bookingId?: string; leaseId?: string }) => Promise<void>, boolean] {
  const actor = useActor();
  const navigate = useNavigate();
  const [run, busy] = useBusyAction();
  const open = useCallback(
    async (ref: { bookingId?: string; leaseId?: string }) => {
      const id = await run(() => svc.people.ensureThread(actor, ref));
      if (id) navigate(`/mensajes/${id}`);
    },
    [actor, navigate, run],
  );
  return [open, busy];
}
