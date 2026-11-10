import { FeeText } from "./FeeText";
import type { Fee } from "./international";

/**
 * La cuenta completa de un pago internacional, mientras se escribe: «Un pago internacional paga 4,4 % + 0,30».
 * Sin cuenta todavía (falta algo por escribir o no se puede leer), dice qué falta. `context` va detrás, en la
 * misma frase («con la tarifa vigente hoy»).
 */
export function InternationalTotal({
  total,
  missing,
  context,
}: {
  total: Fee | null;
  missing: string;
  context?: string;
}) {
  return (
    <p className="rounded-control bg-sunken px-3 py-2">
      {total === null ? (
        <span className="text-ink-soft">{missing}</span>
      ) : (
        <>
          Un pago internacional paga{" "}
          <strong className="font-semibold">
            <FeeText pct={total.pct} fixed={total.fixed} />
          </strong>
          {context ? ` ${context}` : null}.
        </>
      )}
    </p>
  );
}
