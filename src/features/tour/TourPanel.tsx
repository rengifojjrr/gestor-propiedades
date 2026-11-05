/**
 * Panel flotante del recorrido guiado: paso actual, explicación, «Hazlo por mí», «Siguiente» y salir.
 * Al cambiar de paso entra con la cuenta del paso (propietario, limpieza o técnico) y abre la pantalla.
 */
import { ChevronDown, ChevronUp, Loader2, Sparkles, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useSession } from '@/app/session';
import { useLive } from '@/data/live';
import { errorMessage } from '@/services';
import { Button, cn, useToast } from '@/ui';
import { captureProfitBefore, endTour, setTour, STEPS, tourProgress, useTour } from './tour';

export function TourPanel() {
  const tour = useTour();
  const { realUser, login, viewAs, viewingAs } = useSession();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const progress = useLive(() => tourProgress(tour), [tour.step, tour.bookingId, tour.active]);
  const entered = useRef<number | null>(null);
  const step = STEPS[tour.step - 1];

  // Al entrar a un paso: cambia a la cuenta del paso y abre su pantalla (una vez por paso).
  useEffect(() => {
    if (!tour.active || !step || !progress) return;
    if (entered.current === tour.step) return;
    // Primero la cuenta del paso; la navegación espera al siguiente render (para que las rutas vean el rol nuevo).
    if (viewingAs) return viewAs(null);
    if (realUser?.id !== step.userId) return login(step.userId);
    entered.current = tour.step;
    const route = step.route(tour, progress);
    if (route !== pathname) navigate(route);
  }, [tour, step, progress, realUser, login, navigate, pathname, viewAs, viewingAs]);

  // Antes del paso 7 se guarda la ganancia del mes (para mostrar cuánto baja en el 8).
  useEffect(() => {
    if (tour.active && tour.step >= 6 && tour.profitBefore == null) void captureProfitBefore();
  }, [tour.active, tour.step, tour.profitBefore]);

  useEffect(() => {
    document.body.classList.toggle('tour-active', tour.active);
    return () => document.body.classList.remove('tour-active');
  }, [tour.active]);

  if (!tour.active || !step) return null;
  const done = step.done ? !!progress && step.done(progress) : true;
  const last = tour.step === STEPS.length;

  const go = (n: number) => {
    entered.current = null;
    setTour({ step: n, minimized: false });
  };

  const doIt = async () => {
    if (!step.action || !progress) return;
    setBusy(true);
    try {
      await step.action(tour, progress);
      toast.success('¡Hecho!');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (tour.minimized)
    return (
      <button
        type="button"
        onClick={() => setTour({ minimized: false })}
        data-testid="tour-abrir"
        className="no-print fixed right-4 bottom-24 z-50 flex h-11 items-center gap-2 rounded-full bg-secondary-container px-4 text-label-md text-on-secondary-container shadow-pop lg:bottom-6"
      >
        <Sparkles size={18} aria-hidden /> Recorrido · {tour.step}/{STEPS.length}
        <ChevronUp size={18} aria-hidden />
      </button>
    );

  return (
    <section
      aria-label="Recorrido guiado"
      data-testid="tour-panel"
      className="no-print fixed inset-x-3 bottom-[5.5rem] z-50 mx-auto max-w-xl rounded-lg bg-primary-container p-4 text-on-primary-container shadow-pop lg:right-6 lg:bottom-6 lg:left-auto lg:w-[26rem]"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-label-sm uppercase text-on-primary-container-muted" data-testid="tour-paso">
            Recorrido · paso {tour.step} de {STEPS.length}
          </p>
          <h2 className="mt-0.5 text-headline-md">{step.title}</h2>
        </div>
        <div className="flex shrink-0">
          <button type="button" aria-label="Minimizar el recorrido" className="rounded-full p-2 hover:bg-primary/40" onClick={() => setTour({ minimized: true })}>
            <ChevronDown size={18} aria-hidden />
          </button>
          <button
            type="button"
            aria-label="Salir del recorrido"
            className="rounded-full p-2 hover:bg-primary/40"
            onClick={() => {
              endTour();
              toast.info('Recorrido terminado. Puedes volver a empezarlo desde la entrada.');
            }}
          >
            <X size={18} aria-hidden />
          </button>
        </div>
      </div>
      <div className="mt-2 flex gap-1" aria-hidden>
        {STEPS.map((s) => (
          <span key={s.n} className={cn('h-1 flex-1 rounded-full', s.n <= tour.step ? 'bg-secondary-container' : 'bg-on-primary-container/20')} />
        ))}
      </div>
      <p className="mt-3 text-body-sm text-on-primary-container" data-testid="tour-texto">
        {progress ? step.body(tour, progress) : <Loader2 size={16} className="animate-spin" aria-label="Cargando" />}
      </p>
      <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
        {tour.step > 1 && (
          <Button size="sm" variant="ghost" className="text-on-primary-container hover:bg-primary/40" onClick={() => go(tour.step - 1)}>
            Atrás
          </Button>
        )}
        {step.action && !done && (
          <Button size="sm" variant="mint" icon={Sparkles} loading={busy} onClick={doIt} data-testid="tour-hazlo">
            Hazlo por mí: {step.actionLabel}
          </Button>
        )}
        {last ? (
          <>
            <Button size="sm" variant="secondary" onClick={() => navigate('/finanzas')}>
              Ver en finanzas
            </Button>
            <Button
              size="sm"
              variant="mint"
              data-testid="tour-terminar"
              onClick={() => {
                endTour();
                toast.success('¡Listo! Ese fue el recorrido completo.');
              }}
            >
              Terminar
            </Button>
          </>
        ) : (
          <Button size="sm" variant={done ? 'mint' : 'secondary'} disabled={!done || busy} onClick={() => go(tour.step + 1)} data-testid="tour-siguiente">
            Siguiente
          </Button>
        )}
      </div>
    </section>
  );
}
