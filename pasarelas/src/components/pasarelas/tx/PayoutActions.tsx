"use client";

import { useState, useTransition, type FormEvent } from "react";
import { PAYOUT_ALREADY_SAVED_TEXT } from "@/components/pasarelas/splits/settlementText";
import { Button, ConfirmDialog, Dialog, Field, Input, Money, MoneyInput, notify } from "@/components/ui";
import { ZERO } from "@/lib/pasarelas/decimal";
import { add, cmp, formatAmount, formatMoney, parseMoney } from "@/lib/pasarelas/money";
import type { Currency, ISODate, Money as MoneyValue } from "@/lib/pasarelas/types";
import { deleteSettlement, recordPayout, recordPayouts } from "@/server/pasarelas/actions/settlements";
import { ActionError, DialogActionError, useRefreshOnClose } from "../ActionError";
import { callAction, failureOf, type ActionFailure } from "../callAction";

/**
 * Los botones de los pagos a las partes del reparto, en el detalle de un cobro. Cada pago es una liquidación de ese
 * beneficiario ligada al cobro: el saldo de la parte baja en lo mismo.
 *
 * - «Marcar pagado…» de una parte: la fecha (hoy), el medio (opcional) y el monto, que viene con lo que falta y se
 *   puede bajar para un pago parcial.
 * - «Marcar todo el reparto pagado…»: un pago por cada parte a la que le falta algo, en un solo paso.
 * - «Deshacer» un pago: borra su liquidación; si cubre otros cobros, la confirmación dice cuáles se desmarcan.
 *
 * El id de cada pago se genera al abrir el diálogo: si la respuesta no llega y se repite, no se duplica.
 */

const DATE_TEXT = "Elige la fecha del pago.";
const UNDO_UNSURE_TEXT =
  "No se pudo confirmar si el pago se deshizo por un fallo de conexión. Mira cómo quedó antes de repetirlo.";

type FieldErrors = Partial<Record<"amount" | "paidOn" | "method", string | null>>;

/** El error de un campo que devolvió el servidor, si lo hay. */
const fieldError = (errors: Record<string, string[] | undefined> | undefined, key: string): string | null =>
  errors?.[key]?.[0] ?? null;

/** La fecha y el medio de un pago: lo que piden los dos diálogos. */
function DateAndMethod({
  paidOn,
  method,
  errors,
  onPaidOn,
  onMethod,
}: {
  paidOn: ISODate;
  method: string;
  errors: FieldErrors;
  onPaidOn: (value: string) => void;
  onMethod: (value: string) => void;
}) {
  return (
    <>
      <Field label="Fecha del pago" error={errors.paidOn}>
        <Input type="date" value={paidOn} onChange={(event) => onPaidOn(event.currentTarget.value)} required />
      </Field>
      <Field label="Medio" optional hint="Transferencia, efectivo, Zelle…" error={errors.method}>
        <Input value={method} onChange={(event) => onMethod(event.currentTarget.value)} maxLength={60} />
      </Field>
    </>
  );
}

export type PayPartProps = {
  transactionId: string;
  beneficiaryId: string;
  /** El nombre de la parte, como lo dice el desglose. */
  name: string;
  currency: Currency;
  /** Lo que le falta en este cobro (mayor que 0). */
  owed: MoneyValue;
  /** Hoy en Nueva York: la fecha que viene puesta. */
  today: ISODate;
};

/** «Marcar pagado…» de una parte del reparto. */
export function PayPartButton(props: PayPartProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        Marcar pagado…<span className="sr-only"> a {props.name}</span>
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={`Marcar pagado a ${props.name}`}
        description={
          <>
            Le falta <Money value={props.owed} currency={props.currency} /> en este cobro. Para un pago parcial, baja el
            monto.
          </>
        }
      >
        <PayPartForm {...props} onClose={() => setOpen(false)} />
      </Dialog>
    </>
  );
}

function PayPartForm({
  transactionId,
  beneficiaryId,
  name,
  currency,
  owed,
  today,
  onClose,
}: PayPartProps & { onClose: () => void }) {
  // Un id por pago: el mismo mientras no se sepa si quedó; uno nuevo si el servidor dice que ya había otro.
  const [id, setId] = useState(() => crypto.randomUUID());
  const [paidOn, setPaidOn] = useState(today);
  const [method, setMethod] = useState("");
  const [amount, setAmount] = useState(() => formatAmount(owed));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<ActionFailure | null>(null);
  useRefreshOnClose(error);
  const [pending, startTransition] = useTransition();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = parseMoney(amount);
    const amountProblem =
      parsed === null
        ? "Monto no válido"
        : cmp(parsed, ZERO) <= 0
          ? "El monto tiene que ser mayor que cero"
          : cmp(parsed, owed) > 0
            ? `No puede pasar de lo que falta (${formatMoney(owed, currency)})`
            : null;
    const dateProblem = paidOn === "" ? DATE_TEXT : null;
    if (parsed === null || amountProblem !== null || dateProblem !== null) {
      setErrors({ amount: amountProblem, paidOn: dateProblem });
      return;
    }
    setErrors({});
    setError(null);
    startTransition(async () => {
      const result = await callAction(() =>
        recordPayout({ id, transactionId, beneficiaryId, currency, paidOn, method, amount: parsed }),
      );
      if (!result.ok) {
        setError(failureOf(result));
        setErrors({
          amount: fieldError(result.fieldErrors, "amount"),
          paidOn: fieldError(result.fieldErrors, "paidOn"),
          method: fieldError(result.fieldErrors, "method"),
        });
        // Quedó el del primer intento: lo que siga es otro pago.
        if (result.error === PAYOUT_ALREADY_SAVED_TEXT) setId(crypto.randomUUID());
        return;
      }
      notify.success(`Pago a ${name} marcado`);
      onClose();
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <Field label="Monto" error={errors.amount}>
        <MoneyInput value={amount} onChange={(event) => setAmount(event.currentTarget.value)} required />
      </Field>
      <DateAndMethod
        paidOn={paidOn}
        method={method}
        errors={errors}
        onPaidOn={setPaidOn}
        onMethod={setMethod}
      />
      <DialogActionError failure={error} />
      <div className="flex flex-wrap justify-end gap-2">
        <Button onClick={onClose} disabled={pending}>
          Cancelar
        </Button>
        <Button type="submit" variant="primary" disabled={pending}>
          Marcar pagado
        </Button>
      </div>
    </form>
  );
}

/** Una parte a la que le falta algo, para «Marcar todo el reparto pagado…». */
export type MissingPart = { beneficiaryId: string; name: string; owed: MoneyValue };

export type PayAllProps = {
  transactionId: string;
  currency: Currency;
  /** Las partes a las que les falta algo, en el orden del reparto. */
  parts: readonly MissingPart[];
  today: ISODate;
};

/** «Marcar todo el reparto pagado…»: un pago por cada parte a la que le falta algo, con una sola confirmación. */
export function PayAllButton(props: PayAllProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="primary" className="self-start" onClick={() => setOpen(true)}>
        Marcar todo el reparto pagado…
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Marcar todo el reparto pagado"
        description="Se registra un pago por cada parte a la que le falta algo, con lo que le falta:"
      >
        <PayAllForm {...props} onClose={() => setOpen(false)} />
      </Dialog>
    </>
  );
}

function PayAllForm({ transactionId, currency, parts, today, onClose }: PayAllProps & { onClose: () => void }) {
  // Un id por pago, desde que se abre: repetir tras un corte no duplica ninguno.
  const [withIds] = useState(() => parts.map((part) => ({ part, id: crypto.randomUUID() })));
  const [paidOn, setPaidOn] = useState(today);
  const [method, setMethod] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<ActionFailure | null>(null);
  useRefreshOnClose(error);
  const [pending, startTransition] = useTransition();
  const total = add(ZERO, ...parts.map((part) => part.owed));

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (paidOn === "") {
      setErrors({ paidOn: DATE_TEXT });
      return;
    }
    setErrors({});
    setError(null);
    const payouts = withIds.map(({ part, id }) => ({
      id,
      beneficiaryId: part.beneficiaryId,
      currency,
      paidOn,
      method,
      items: [{ transactionId, amount: part.owed }],
    }));
    startTransition(async () => {
      const result = await callAction(() => recordPayouts({ payouts }));
      if (!result.ok) {
        setError(failureOf(result));
        return;
      }
      notify.success(parts.length === 1 ? "Pago marcado" : `${parts.length} pagos marcados`);
      onClose();
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <ul aria-label="Pagos que se registran" className="flex flex-col gap-1">
        {parts.map((part) => (
          <li key={part.beneficiaryId} className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 break-words">{part.name}</span>
            <Money value={part.owed} currency={currency} />
          </li>
        ))}
        <li className="flex items-baseline justify-between gap-3 border-t border-rule pt-1 font-semibold">
          <span>En total</span>
          <Money value={total} currency={currency} />
        </li>
      </ul>
      <DateAndMethod paidOn={paidOn} method={method} errors={errors} onPaidOn={setPaidOn} onMethod={setMethod} />
      <DialogActionError failure={error} />
      <div className="flex flex-wrap justify-end gap-2">
        <Button onClick={onClose} disabled={pending}>
          Cancelar
        </Button>
        <Button type="submit" variant="primary" disabled={pending}>
          {parts.length === 1 ? "Marcar pagado" : `Marcar ${parts.length} pagos`}
        </Button>
      </div>
    </form>
  );
}

export type UndoPayoutProps = {
  settlementId: string;
  /** Qué se deshace, para el lector de pantalla: «el pago a Grupo B del sáb 14 nov 2026». */
  label: string;
  /** Lo que dice la confirmación (`undoPayoutText`): qué se borra y, si cubre varios cobros, cuáles se desmarcan. */
  text: string;
};

/** «Deshacer» un pago: borra su liquidación (y con ella sus partes en todos los cobros que cubre). */
export function UndoPayoutButton({ settlementId, label, text }: UndoPayoutProps) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<ActionFailure | null>(null);
  const [pending, startTransition] = useTransition();

  function undo() {
    startTransition(async () => {
      const result = await callAction(() => deleteSettlement({ id: settlementId }), UNDO_UNSURE_TEXT);
      setConfirming(false);
      if (!result.ok) {
        setError(failureOf(result));
        return;
      }
      notify.success("Pago deshecho");
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant="ghost"
        className="-my-2"
        onClick={() => {
          setError(null);
          setConfirming(true);
        }}
        disabled={pending}
      >
        Deshacer<span className="sr-only"> {label}</span>
      </Button>
      {error === null ? null : <ActionError failure={error} align="end" />}
      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={undo}
        pending={pending}
        title="¿Deshacer este pago?"
        description={text}
        confirmLabel="Deshacer el pago"
        variant="danger"
      />
    </div>
  );
}
