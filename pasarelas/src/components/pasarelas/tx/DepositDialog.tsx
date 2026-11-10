"use client";

import { useState, useTransition, type FormEvent } from "react";
import { Alert, Button, Dialog, Field, Input, notify } from "@/components/ui";
import type { ISODate } from "@/lib/pasarelas/types";
import { markDeposited } from "@/server/pasarelas/actions/transactions";
import { batchDone, cobros } from "./plural";

export type DepositDialogProps = {
  /** Los cobros que se marcan (de 1 a 500). */
  ids: string[];
  open: boolean;
  /** Al cerrarlo (Cancelar, Escape, el fondo) y después de marcar: ahí se pone `open` en falso. */
  onClose: () => void;
  /** La fecha que viene puesta: hoy, o la estimada de un grupo del Resumen. */
  defaultDate: ISODate;
  /** Tras marcar, con cuántos cambiaron (antes de `onClose`). */
  onDone?: (count: number) => void;
};

/**
 * «Marcar depositado» para uno o varios cobros: pide la fecha real del depósito y llama a `markDeposited`. Los que
 * no admiten el cambio (fallidos) se saltan y el aviso lo dice. Un cobro ya depositado toma la fecha nueva.
 */
export function DepositDialog({ ids, open, onClose, defaultDate, onDone }: DepositDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Marcar depositado"
      description={`${cobros(ids.length)}. Elige el día en que el dinero llegó a la cuenta.`}
    >
      {/* Solo existe mientras está abierto: cada vez empieza con la fecha propuesta y sin errores. */}
      <DepositForm ids={ids} defaultDate={defaultDate} onClose={onClose} onDone={onDone} />
    </Dialog>
  );
}

function DepositForm({ ids, defaultDate, onClose, onDone }: Omit<DepositDialogProps, "open">) {
  const [date, setDate] = useState(defaultDate);
  const [error, setError] = useState<string | null>(null);
  const [dateError, setDateError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (date === "") {
      setDateError("Elige la fecha del depósito.");
      return;
    }
    startTransition(async () => {
      const result = await markDeposited({ ids, on: date });
      if (!result.ok) {
        setError(result.error);
        setDateError(result.fieldErrors?.on?.[0] ?? null);
        return;
      }
      notify.success(
        batchDone(result.data.count, new Set(ids).size, {
          one: "marcado como depositado",
          many: "marcados como depositados",
        }),
      );
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
          Marcar depositado
        </Button>
      </div>
    </form>
  );
}
