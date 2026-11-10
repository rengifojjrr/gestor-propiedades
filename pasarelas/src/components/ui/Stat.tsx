import type { ReactNode } from "react";
import { cn } from "./cn";

export type StatProps = {
  /** Qué es la cifra: «Neto», «Por caer». */
  label: string;
  /** La cifra: normalmente un `<Money>`. */
  value: ReactNode;
  /** Una aclaración corta: «9,7 % del bruto». */
  hint?: ReactNode;
  /** Es un total: lleva la doble raya contable. Úsalo en una sola cifra por grupo. */
  total?: boolean;
  className?: string;
};

/** Una cifra con su nombre. La cifra manda: es lo más grande del bloque. */
export function Stat({ label, value, hint, total, className }: StatProps) {
  return (
    <div className={cn("flex min-w-0 flex-col items-start gap-1", className)}>
      <p className="text-sm text-ink-soft">{label}</p>
      <p className={cn("cifra text-2xl leading-tight font-semibold", total && "doble-raya")}>{value}</p>
      {hint ? <p className="text-sm text-ink-soft">{hint}</p> : null}
    </div>
  );
}
