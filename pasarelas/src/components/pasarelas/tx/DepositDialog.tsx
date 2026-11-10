"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { Alert, Button, Dialog, Field, Input, notify } from "@/components/ui";
import type { ISODate } from "@/lib/pasarelas/types";
import { PAY_STATE_TEXT } from "@/lib/pasarelas/write";
import { markDeposited } from "@/server/pasarelas/actions/transactions";
import { callAction } from "../callAction";
import { cobros, depositDone } from "./plural";

const FUTURE_TEXT = "La fecha del depósito no puede ser futura.";

export type DepositDialogProps = {
  /** Los cobros que se marcan (de 1 a 500). */
  ids: string[];
  open: boolean;
  /** Al cerrarlo (Cancelar, Escape, el fondo) y después de marcar: ahí se pone `open` en falso. */
  onClose: () => void;
  /** La fecha que viene puesta: hoy, o la estimada de un grupo del Resumen. */
  defaultDate: ISODate;
  /** Hoy en Nueva York: el depósito no puede ser de un día que todavía no llegó. */
  today: ISODate;
  /**
   * El lote (la barra de Cobros, los próximos depósitos del Resumen): solo se marca lo que está por caer, y lo ya
   * depositado conserva su fecha real. El detalle de un cobro manda `false`: ahí se puede cambiar esa fecha.
   */
  onlyPending: boolean;
  /** La fecha del cobro, si es uno solo: el depósito no puede ser anterior. */
  earliest?: ISODate;
  /** Por defecto «Marcar depositado»; el detalle de un cobro ya depositado dice «Cambiar la fecha del depósito». */
  title?: string;
  /** Tras marcar, con cuántos cambiaron (antes de `onClose`). */
  onDone?: (count: number) => void;
};

/**
 * «Marcar depositado» para uno o varios cobros: pide la fecha real del depósito y llama a `markDeposited`. El aviso
 * dice cuántos se marcaron y, de los que se saltaron, por qué: en el lote, los ya depositados (que conservan su
 * fecha) y los que no están por caer; siempre, los que no admiten el cambio (fallidos, en la papelera).
 */
export function DepositDialog({ ids, open, onClose, title = "Marcar depositado", ...form }: DepositDialogProps) {
  const many = new Set(ids).size;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={
        form.onlyPending
          ? `${cobros(many)}. Solo se marcan los que están por caer: los ya depositados conservan su fecha.`
          : "Elige el día en que el dinero llegó a la cuenta."
      }
    >
      {/* Solo existe mientras está abierto: cada vez empieza con la fecha propuesta y sin errores. */}
      <DepositForm ids={ids} onClose={onClose} title={title} {...form} />
    </Dialog>
  );
}

function DepositForm({
  ids,
  defaultDate,
  today,
  onlyPending,
  earliest,
  title,
  onClose,
  onDone,
}: Omit<DepositDialogProps, "open">) {
  const router = useRouter();
  const [date, setDate] = useState(defaultDate);
  const [error, setError] = useState<string | null>(null);
  const [dateError, setDateError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const problem =
      date === ""
        ? "Elige la fecha del depósito."
        : date > today
          ? FUTURE_TEXT
          : earliest !== undefined && date < earliest
            ? PAY_STATE_TEXT.deposito_antes_del_cobro
            : null;
    if (problem !== null) {
      setDateError(problem);
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await callAction(() => markDeposited({ ids, on: date, onlyPending }), router.refresh);
      if (!result.ok) {
        setError(result.error);
        setDateError(result.fieldErrors?.on?.[0] ?? null);
        return;
      }
      notify.success(depositDone(result.data));
      onDone?.(result.data.count);
      onClose();
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <Field label="Fecha del depósito" error={dateError}>
        <Input
          type="date"
          value={date}
          min={earliest}
          max={today}
          onChange={(event) => {
            setDate(event.currentTarget.value);
            setDateError(null);
          }}
          required
        />
      </Field>
      {error ? (
        <Alert tone="danger" announce>
          {error}
        </Alert>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button onClick={onClose} disabled={pending}>
          Cancelar
        </Button>
        <Button type="submit" variant="primary" disabled={pending}>
          {title}
        </Button>
      </div>
    </form>
  );
}
