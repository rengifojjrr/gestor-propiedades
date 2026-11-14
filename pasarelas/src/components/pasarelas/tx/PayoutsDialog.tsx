"use client";

import { useEffect, useState, useTransition, type FormEvent } from "react";
import { Button, Checkbox, Dialog, Field, Input, Money, notify } from "@/components/ui";
import { ZERO } from "@/lib/pasarelas/decimal";
import { cmp, neg } from "@/lib/pasarelas/money";
import type { ISODate } from "@/lib/pasarelas/types";
import { owedForTransactions, recordPayouts } from "@/server/pasarelas/actions/settlements";
import type { NamedOwedGroup } from "@/server/pasarelas/queries/settlements";
import { ActionError, DialogActionError, useRefreshOnClose } from "../ActionError";
import { RETRY_TEXT, callAction, callActionOr, failureOf, type ActionFailure } from "../callAction";
import { cobros } from "./plural";

/**
 * «Pagar repartos…» de los cobros elegidos en la lista: lo que se le debe a cada parte en ellos, por moneda, con una
 * casilla por parte (todas marcadas). Al confirmar se registra un pago por parte y moneda, con lo de cada cobro: una
 * liquidación de ese beneficiario ligada a esos cobros.
 *
 * Lo que se debe se lee del servidor al abrir (lo de ahora, no lo de cuando se pintó la lista). Las partes que no
 * deben nada no salen. Si a alguna se le pagó de más (en total, en esos cobros), sale aparte y sin marcar: lo que
 * devuelve no se registra solo, lo decide el dueño.
 */

const DATE_TEXT = "Elige la fecha del pago.";

/** Una parte con su casilla y el id del pago que se registra si se marca (el mismo si se repite tras un corte). */
type Choice = NamedOwedGroup & { key: string; payoutId: string };

export type PayoutsDialogProps = {
  /** Los cobros elegidos. */
  ids: string[];
  open: boolean;
  onClose: () => void;
  /** Tras registrar los pagos. */
  onDone: () => void;
  /** Hoy en Nueva York: la fecha que viene puesta. */
  today: ISODate;
};

export function PayoutsDialog({ ids, open, onClose, onDone, today }: PayoutsDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Pagar repartos"
      description={`Lo que se le debe a cada parte en ${cobros(ids.length)}. Se registra un pago por parte y moneda, con lo de cada cobro.`}
    >
      {/* Solo existe mientras está abierto: cada vez lee lo que se debe ahora y empieza sin errores. */}
      <PayoutsForm ids={ids} onClose={onClose} onDone={onDone} today={today} />
    </Dialog>
  );
}

/** «Grupo A» con lo suyo a la derecha y, debajo, en cuántos cobros. */
function ChoiceLabel({ choice, owes }: { choice: Choice; owes: boolean }) {
  return (
    <span className="flex flex-wrap items-baseline justify-between gap-x-3">
      <span className="min-w-0 break-words">{choice.name}</span>
      <span>
        {owes ? null : "devuelve "}
        <Money value={owes ? choice.owed : neg(choice.owed)} currency={choice.currency} />
      </span>
    </span>
  );
}

function PayoutsForm({ ids, onClose, onDone, today }: Omit<PayoutsDialogProps, "open">) {
  const [choices, setChoices] = useState<Choice[] | null>(null);
  const [loadError, setLoadError] = useState<ActionFailure | null>(null);
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const [paidOn, setPaidOn] = useState(today);
  const [method, setMethod] = useState("");
  const [dateError, setDateError] = useState<string | null>(null);
  const [error, setError] = useState<ActionFailure | null>(null);
  useRefreshOnClose(error);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let current = true;
    void callActionOr(
      () => owedForTransactions({ ids }),
      () => ({ ok: false as const, error: RETRY_TEXT }),
    ).then((result) => {
      if (!current) return;
      if (!result.ok) {
        setLoadError({ text: result.error, unsure: false });
        return;
      }
      const loaded = result.data.groups.map((group) => ({
        ...group,
        key: `${group.currency} ${group.beneficiaryId}`,
        payoutId: crypto.randomUUID(),
      }));
      setChoices(loaded);
      // Las que deben algo vienen marcadas; las que tienen que devolver, no.
      setChosen(new Set(loaded.filter((choice) => cmp(choice.owed, ZERO) > 0).map((choice) => choice.key)));
    });
    return () => {
      current = false;
    };
  }, [ids]);

  const owes = (choices ?? []).filter((choice) => cmp(choice.owed, ZERO) > 0);
  const returns = (choices ?? []).filter((choice) => cmp(choice.owed, ZERO) < 0);
  const picked = (choices ?? []).filter((choice) => chosen.has(choice.key));

  function toggle(key: string, on: boolean) {
    setChosen((previous) => {
      const next = new Set(previous);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (paidOn === "") {
      setDateError(DATE_TEXT);
      return;
    }
    setDateError(null);
    setError(null);
    const payouts = picked.map((choice) => ({
      id: choice.payoutId,
      beneficiaryId: choice.beneficiaryId,
      currency: choice.currency,
      paidOn,
      method,
      items: choice.items,
    }));
    startTransition(async () => {
      const result = await callAction(() => recordPayouts({ payouts }));
      if (!result.ok) {
        setError(failureOf(result));
        return;
      }
      notify.success(payouts.length === 1 ? "Pago registrado" : `${payouts.length} pagos registrados`);
      onDone();
    });
  }

  if (loadError !== null) {
    return (
      <div className="flex flex-col gap-4">
        <ActionError failure={loadError} />
        <Button className="self-end" onClick={onClose}>
          Cerrar
        </Button>
      </div>
    );
  }
  if (choices === null) {
    return (
      <p role="status" className="text-ink-soft">
        Leyendo lo que se le debe a cada parte…
      </p>
    );
  }
  if (choices.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <p role="status">Las partes de estos cobros no deben nada: ya está todo pagado (o no tienen reparto).</p>
        <Button className="self-end" onClick={onClose}>
          Cerrar
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      {owes.length === 0 ? null : (
        <fieldset className="flex flex-col">
          <legend className="font-semibold">Les falta</legend>
          {owes.map((choice) => (
            <Checkbox
              key={choice.key}
              label={<ChoiceLabel choice={choice} owes />}
              hint={`en ${cobros(choice.items.length)}`}
              checked={chosen.has(choice.key)}
              onChange={(event) => toggle(choice.key, event.currentTarget.checked)}
            />
          ))}
        </fieldset>
      )}
      {returns.length === 0 ? null : (
        <fieldset className="flex flex-col">
          <legend className="font-semibold">Se les pagó de más</legend>
          <p className="text-sm text-ink-soft">
            No se incluyen solas: si marcas una, se registra lo que devuelve en esos cobros.
          </p>
          {returns.map((choice) => (
            <Checkbox
              key={choice.key}
              label={<ChoiceLabel choice={choice} owes={false} />}
              hint={`en ${cobros(choice.items.length)}`}
              checked={chosen.has(choice.key)}
              onChange={(event) => toggle(choice.key, event.currentTarget.checked)}
            />
          ))}
        </fieldset>
      )}
      <Field label="Fecha del pago" error={dateError}>
        <Input type="date" value={paidOn} onChange={(event) => setPaidOn(event.currentTarget.value)} required />
      </Field>
      <Field label="Medio" optional hint="Transferencia, efectivo, Zelle…">
        <Input value={method} onChange={(event) => setMethod(event.currentTarget.value)} maxLength={60} />
      </Field>
      <DialogActionError failure={error} />
      <div className="flex flex-wrap justify-end gap-2">
        <Button onClick={onClose} disabled={pending}>
          Cancelar
        </Button>
        <Button type="submit" variant="primary" disabled={pending || picked.length === 0}>
          {picked.length === 1 ? "Registrar 1 pago" : `Registrar ${picked.length} pagos`}
        </Button>
      </div>
    </form>
  );
}
