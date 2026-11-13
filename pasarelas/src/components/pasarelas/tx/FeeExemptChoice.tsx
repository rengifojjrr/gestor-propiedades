"use client";

import { useId } from "react";
import { Alert, Checkbox, Percent } from "@/components/ui";
import { NO_FEE_PAYER_TEXT } from "@/lib/pasarelas/schemes";
import { someonePays, type ExemptQuestion } from "./feeExempt";

/**
 * «¿Alguien no paga comisión?», al registrar o editar un cobro cuya comisión pagamos nosotros con un esquema sobre el
 * neto: una casilla por cada línea del esquema (el «Resto» no se marca), marcada como dice el esquema (o como quedó
 * el cobro). Lo que se cambie vale solo para ese cobro. Si no queda nadie que pague la comisión, lo dice aquí mismo:
 * como aviso mientras se marca y, si se intentó guardar así (`error`), como el error de la pregunta.
 * Cada casilla es una fila de 44 px; va en formularios con `onSubmit`, y la del kit sobrevive igual a un reinicio.
 */
export function FeeExemptChoice({
  question,
  value,
  onChange,
  startsFrom = "esquema",
  error,
}: {
  question: ExemptQuestion;
  /** Los beneficiarios marcados. */
  value: readonly string[];
  onChange: (ids: string[]) => void;
  /** De dónde salen las marcas: del esquema (al registrar) o de cómo quedó el cobro (al editar). */
  startsFrom?: "esquema" | "cobro";
  /**
   * El error de la pregunta al intentar guardar (que nadie paga la comisión). Mientras siga sin haber quién pague,
   * el aviso pasa a ser ese error y describe la pregunta; en cuanto alguien paga, ya no se ve.
   */
  error?: string | null;
}) {
  const hintId = useId();
  const errorId = useId();
  const nobodyPays = !someonePays(question, value);
  const failed = nobodyPays && Boolean(error);

  function toggle(id: string, on: boolean) {
    // Siempre en el orden de las líneas del esquema.
    onChange(
      question.lines
        .map((line) => line.beneficiaryId)
        .filter((lineId) => (lineId === id ? on : value.includes(lineId))),
    );
  }

  return (
    <fieldset className="flex min-w-0 flex-col gap-1" aria-describedby={failed ? `${hintId} ${errorId}` : hintId}>
      <legend className="mb-1 text-sm font-semibold">¿Alguien no paga comisión?</legend>
      <p id={hintId} className="text-sm text-ink-soft">
        Su parte sale del bruto y la comisión la pagan los demás.{" "}
        {startsFrom === "esquema" ? "Viene como dice el esquema" : "Viene como quedó este cobro"}; lo que cambies vale
        solo para este cobro.
      </p>
      {question.lines.map((line) => (
        <Checkbox
          key={line.beneficiaryId}
          label={line.name}
          hint={
            <>
              <Percent value={line.pct} /> del reparto
            </>
          }
          checked={value.includes(line.beneficiaryId)}
          onChange={(event) => toggle(line.beneficiaryId, event.currentTarget.checked)}
        />
      ))}
      {nobodyPays ? (
        <div id={errorId}>
          <Alert tone={failed ? "danger" : "warning"}>{failed ? error : NO_FEE_PAYER_TEXT}</Alert>
        </div>
      ) : null}
    </fieldset>
  );
}
