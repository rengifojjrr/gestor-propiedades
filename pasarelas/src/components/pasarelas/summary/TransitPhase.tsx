import { CalendarClock, Clock, TriangleAlert, type LucideIcon } from "lucide-react";
import { cn } from "@/components/ui";
import { windowDayLabels, type DateWindow } from "@/lib/pasarelas/dates";
import type { TransitPhase } from "@/lib/pasarelas/transit";

/*
 * Las piezas de la fase de un cobro (o de un grupo) en «Dinero en camino»: el texto con su ícono, la ventana con
 * sus fechas y la barra de cuánto del camino ya pasó. Lo que dicen sale del motor (`moneyInTransit`): aquí solo se
 * pinta. El color acompaña; lo que dice la fase es el texto y el ícono.
 */

const ICON: Record<TransitPhase, LucideIcon> = { atrasado: TriangleAlert, hoy: Clock, proximo: CalendarClock };

/** «⚠ Debió llegar hace 4 días», «◷ Puede llegar hoy», «▦ Llega en 3–7 días». */
export function PhaseText({ phase, label, className }: { phase: TransitPhase; label: string; className?: string }) {
  const Icon = ICON[phase];
  return (
    <p
      className={cn(
        "flex items-center gap-1.5 font-semibold",
        phase === "atrasado" ? "text-warning" : phase === "hoy" ? "text-brand" : "text-ink",
        className,
      )}
    >
      <Icon aria-hidden className="size-4 shrink-0" />
      {label}
    </p>
  );
}

/** La ventana con sus fechas, para leer debajo de la fase: «lun 16 – mié 18 nov», o «jue 12 nov». */
export function WindowDays({ window, className }: { window: DateWindow; className?: string }) {
  const [first, last] = windowDayLabels(window);
  return (
    <span className={cn("cifra text-sm text-ink-soft", className)}>
      {last === undefined ? (
        <time dateTime={window.to}>{first}</time>
      ) : (
        <>
          <time dateTime={window.from}>{first}</time> – <time dateTime={window.to}>{last}</time>
        </>
      )}
    </span>
  );
}

/**
 * Cuánto del camino ya pasó, de la fecha del cobro a la más tardía de su ventana. Decorativa: la fase ya lo dice
 * en texto. Atrasado, llena y en ámbar.
 */
export function ProgressBar({ progress, overdue }: { progress: number; overdue: boolean }) {
  return (
    <div aria-hidden className="h-1.5 w-full overflow-hidden rounded-full bg-rule">
      <div
        className={cn("h-full rounded-full", overdue ? "bg-warning" : "bg-brand")}
        style={{ width: `${progress}%` }}
      />
    </div>
  );
}
