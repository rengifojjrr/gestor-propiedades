import { cn } from "@/components/ui";
import { formatWindowShort, windowDayLabels, type DateWindow } from "@/lib/pasarelas/dates";

/*
 * La fecha estimada de un cobro es una ventana: las pasarelas no prometen un día sino «de 3 a 5 días». Aquí se
 * pinta con los textos del motor (`windowDayLabels`, `formatWindowShort`), como `<time>` donde se lee una fecha.
 */

/** ¿Es una ventana de verdad, de más de un día? */
export const isWindow = (window: DateWindow): boolean => window.from !== window.to;

/**
 * «Llega entre el lun 16 y el mié 18 nov», o «Llega el mié 18 nov» si es un solo día: al registrar y en el detalle.
 * Con `past` (un cobro ya depositado o fallido, que ya no «llega») dice «Se estimaba entre el … y el …». Cada punta
 * es un `<time>` con su fecha.
 */
export function DepositWindowText({
  window,
  past = false,
  className,
}: {
  window: DateWindow;
  past?: boolean;
  className?: string;
}) {
  const verb = past ? "Se estimaba" : "Llega";
  const [first, last] = windowDayLabels(window);
  const time = (value: string, text: string) => (
    <time dateTime={value} className="cifra whitespace-nowrap">
      {text}
    </time>
  );
  return (
    <span className={className}>
      {last === undefined ? (
        <>
          {verb} el {time(window.to, first)}
        </>
      ) : (
        <>
          {verb} entre el {time(window.from, first)} y el {time(window.to, last)}
        </>
      )}
    </span>
  );
}

/** La ventana corta, para listas: «16–18 nov». */
export function DepositWindowShort({ window, className }: { window: DateWindow; className?: string }) {
  return <span className={cn("cifra whitespace-nowrap", className)}>{formatWindowShort(window)}</span>;
}
