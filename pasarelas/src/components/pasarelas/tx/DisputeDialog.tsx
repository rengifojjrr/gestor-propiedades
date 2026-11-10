"use client";

import { useId, useState, useTransition, type FormEvent } from "react";
import { Alert, Button, Dialog, Field, Input, Money, notify } from "@/components/ui";
import { isZero } from "@/lib/pasarelas/money";
import type { ISODate, TxSnapshot } from "@/lib/pasarelas/types";
import { planDispute } from "@/lib/pasarelas/write";
import { disputeTransaction } from "@/server/pasarelas/actions/transactions";
import { previewChange } from "./preview";
import { ChangesTable } from "./RecalcDialog";

type Outcome = "ganar" | "perder" | "anular";

const OUTCOMES: { value: Outcome; label: string; hint: string; done: string }[] = [
  { value: "ganar", label: "Ganada", hint: "Se revierte el costo de la disputa.", done: "Disputa ganada." },
  {
    value: "perder",
    label: "Perdida",
    hint: "El cobro queda reembolsado por completo y el costo de la disputa se queda.",
    done: "Disputa perdida.",
  },
  { value: "anular", label: "Anulada", hint: "Se quita, como si no hubiera habido disputa.", done: "Disputa anulada." },
];

export type DisputeDialogProps = {
  tx: TxSnapshot;
  /** `abrir` sobre un cobro sin disputa (o con una ganada); `resolver` una abierta: ganada, perdida o anulada. */
  mode: "abrir" | "resolver";
  open: boolean;
  onClose: () => void;
  /** Hoy en Nueva York: la fecha que viene puesta. */
  today: ISODate;
};

/**
 * Abrir una disputa o resolverla. El costo es el de la pasarela, congelado en el desglose del cobro: abrirla lo
 * suma, perderla lo deja (y reembolsa todo) y ganarla o anularla lo revierte. Antes de confirmar se ve el antes y
 * el después.
 */
export function DisputeDialog({ tx, mode, open, onClose, today }: DisputeDialogProps) {
  const { disputeFee, name } = tx.breakdown.rules.gateway;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={mode === "abrir" ? "Abrir disputa" : "Resolver disputa"}
      description={
        isZero(disputeFee) ? (
          <>{name} no cobra por disputa en este cobro.</>
        ) : (
          <>
            {name} cobra <Money value={disputeFee} currency={tx.currency} /> por disputa (lo que quedó congelado en este
            cobro). Si la disputa se gana, se revierte.
          </>
        )
      }
    >
      <DisputeForm tx={tx} mode={mode} onClose={onClose} today={today} />
    </Dialog>
  );
}

function DisputeForm({ tx, mode, onClose, today }: Omit<DisputeDialogProps, "open">) {
  const name = useId();
  const [outcome, setOutcome] = useState<Outcome>("ganar");
  const [on, setOn] = useState(today);
  const [dateError, setDateError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const action = mode === "abrir" ? "abrir" : outcome;
  const preview = previewChange(tx, (t) => planDispute(t, { action, on: on || today }));

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (on === "") {
      setDateError("Elige la fecha.");
      return;
    }
    startTransition(async () => {
      const result = await disputeTransaction({ id: tx.id, action, on });
      if (!result.ok) {
        setError(result.error);
        setDateError(result.fieldErrors?.on?.[0] ?? null);
        return;
      }
      notify.success(mode === "abrir" ? "Disputa abierta." : (OUTCOMES.find((o) => o.value === outcome)?.done ?? ""));
      onClose();
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      {mode === "resolver" ? (
        <fieldset className="flex flex-col gap-1" disabled={pending}>
          <legend className="mb-1 text-sm font-semibold">¿Cómo terminó?</legend>
          {OUTCOMES.map((option) => (
            <div key={option.value} className="flex flex-col">
              <label className="flex min-h-11 cursor-pointer items-center gap-3 py-1">
                <input
                  type="radio"
                  name={name}
                  value={option.value}
                  checked={outcome === option.value}
                  onChange={() => setOutcome(option.value)}
                  aria-describedby={`${name}-${option.value}`}
                  className="size-5 shrink-0 accent-brand"
                />
                {option.label}
              </label>
              <p id={`${name}-${option.value}`} className="pl-8 text-sm text-ink-soft">
                {option.hint}
              </p>
            </div>
          ))}
        </fieldset>
      ) : null}

      <Field label="Fecha" error={dateError}>
        <Input
          type="date"
          value={on}
          onChange={(event) => {
            setOn(event.currentTarget.value);
            setDateError(null);
          }}
        />
      </Field>

      {preview.ok ? (
        <ChangesTable label="Antes y después" changes={preview.changes} currency={tx.currency} />
      ) : (
        <Alert tone="warning">{preview.error}</Alert>
      )}

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
          {mode === "abrir" ? "Abrir disputa" : "Guardar"}
        </Button>
      </div>
    </form>
  );
}
