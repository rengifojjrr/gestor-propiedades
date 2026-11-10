"use client";

import { useId, useState, useTransition, type FormEvent } from "react";
import { Alert, Button, Dialog, Field, Input, MoneyInput, Textarea, notify } from "@/components/ui";
import { formatAmount, parseMoney } from "@/lib/pasarelas/money";
import type { ISODate, TxSnapshot } from "@/lib/pasarelas/types";
import { planRefund, planRefundTotal } from "@/lib/pasarelas/write";
import { refundTransaction, setRefundTotal } from "@/server/pasarelas/actions/transactions";
import { previewChange } from "./preview";
import { ChangesTable } from "./RecalcDialog";

type Mode = "agregar" | "corregir";

const MODE_LABEL: Record<Mode, string> = {
  agregar: "Agregar un reembolso",
  corregir: "Corregir el total reembolsado",
};

const NOTE_MAX = 280;

export type RefundDialogProps = {
  tx: TxSnapshot;
  /** Lo que el estado admite (`allowedActions`): agregar un reembolso, corregir el total, o los dos. */
  modes: Mode[];
  open: boolean;
  onClose: () => void;
  /** Hoy en Nueva York: la fecha que viene puesta. */
  today: ISODate;
};

/**
 * Un reembolso: el monto, la fecha y una nota; o, si ya hubo, corregir el total reembolsado. Antes de confirmar se
 * ve el antes y el después del desglose, calculado con el mismo plan del motor que usará el servidor.
 */
export function RefundDialog({ tx, modes, open, onClose, today }: RefundDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Reembolso"
      description="Lo reembolsado baja el bruto; las comisiones y el reparto se vuelven a calcular con las reglas del cobro."
    >
      {/* Solo existe mientras está abierto: cada vez empieza vacío. */}
      <RefundForm tx={tx} modes={modes} onClose={onClose} today={today} />
    </Dialog>
  );
}

type FieldErrors = Partial<Record<"amount" | "on" | "note" | "total", string>>;

function RefundForm({ tx, modes, onClose, today }: Omit<RefundDialogProps, "open">) {
  const name = useId();
  const [mode, setMode] = useState<Mode>(modes[0] ?? "agregar");
  const [amount, setAmount] = useState("");
  const [on, setOn] = useState(today);
  const [note, setNote] = useState("");
  const [total, setTotal] = useState(() => formatAmount(tx.refunded));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // El antes y el después de lo escrito, si ya es un monto.
  const typed = parseMoney(mode === "agregar" ? amount : total);
  const preview =
    typed === null
      ? null
      : previewChange(tx, (t) =>
          mode === "agregar" ? planRefund(t, { amount: typed, on: on || today }) : planRefundTotal(t, typed),
        );

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const missing: FieldErrors =
      mode === "agregar"
        ? { amount: amount.trim() === "" ? "Escribe el monto." : undefined, on: on === "" ? "Elige la fecha." : undefined }
        : { total: total.trim() === "" ? "Escribe el total reembolsado." : undefined };
    if (Object.values(missing).some(Boolean)) {
      setErrors(missing);
      return;
    }
    setErrors({});
    startTransition(async () => {
      const result =
        mode === "agregar"
          ? await refundTransaction({ id: tx.id, amount, on, note })
          : await setRefundTotal({ id: tx.id, total });
      if (!result.ok) {
        setError(result.error);
        const fields = result.fieldErrors ?? {};
        setErrors({ amount: fields.amount?.[0], on: fields.on?.[0], note: fields.note?.[0], total: fields.total?.[0] });
        return;
      }
      notify.success(mode === "agregar" ? "Reembolso registrado." : "Total reembolsado corregido.");
      onClose();
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      {modes.length > 1 ? (
        <fieldset className="flex flex-col gap-1" disabled={pending}>
          <legend className="mb-1 text-sm font-semibold">¿Qué quieres hacer?</legend>
          {modes.map((value) => (
            <label key={value} className="flex min-h-11 cursor-pointer items-center gap-3 py-1">
              <input
                type="radio"
                name={name}
                value={value}
                checked={mode === value}
                onChange={() => {
                  setMode(value);
                  setErrors({});
                  setError(null);
                }}
                className="size-5 shrink-0 accent-brand"
              />
              {MODE_LABEL[value]}
            </label>
          ))}
        </fieldset>
      ) : null}

      {mode === "agregar" ? (
        <>
          <Field label="Monto del reembolso" error={errors.amount}>
            <MoneyInput value={amount} currency={tx.currency} onChange={(event) => setAmount(event.currentTarget.value)} />
          </Field>
          <Field label="Fecha del reembolso" error={errors.on}>
            <Input type="date" value={on} onChange={(event) => setOn(event.currentTarget.value)} />
          </Field>
          <Field label="Nota" optional hint={`Hasta ${NOTE_MAX} caracteres.`} error={errors.note}>
            <Textarea value={note} maxLength={NOTE_MAX} onChange={(event) => setNote(event.currentTarget.value)} />
          </Field>
        </>
      ) : (
        <Field label="Total reembolsado" hint="Lo reembolsado en total, de cero a lo cobrado." error={errors.total}>
          <MoneyInput value={total} currency={tx.currency} onChange={(event) => setTotal(event.currentTarget.value)} />
        </Field>
      )}

      {preview === null ? null : preview.ok ? (
        preview.changes.length === 0 ? (
          <p className="text-ink-soft">Con este total no cambia ningún número.</p>
        ) : (
          <ChangesTable label="Antes y después" changes={preview.changes} currency={tx.currency} />
        )
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
          {mode === "agregar" ? "Registrar reembolso" : "Guardar el total"}
        </Button>
      </div>
    </form>
  );
}
