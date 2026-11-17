"use client";

import { useEffect, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { Alert, Button, Checkbox, Dialog, Field, Input, Money, notify } from "@/components/ui";
import { ZERO } from "@/lib/pasarelas/decimal";
import { cmp, neg } from "@/lib/pasarelas/money";
import type { Currency, ISODate, Money as MoneyValue } from "@/lib/pasarelas/types";
import { owedForFilter, owedForTransactions, recordPayouts } from "@/server/pasarelas/actions/settlements";
import type { NamedOwedGroup } from "@/server/pasarelas/queries/settlements";
import { ActionError, DialogActionError, useRefreshOnClose } from "../ActionError";
import { RETRY_TEXT, callAction, callActionOr, failureOf, type ActionFailure } from "../callAction";
import { MAX_PAYOUT_ITEMS, payoutChunks } from "./payoutChunks";
import { cobros } from "./plural";
import { tooManyForSplitText } from "./splitText";

/**
 * «Pagar repartos…» de los cobros elegidos en la lista: lo que se le debe a cada parte en ellos, por moneda, con una
 * casilla por parte (todas marcadas). Al confirmar se registra un pago por parte y moneda, con lo de cada cobro: una
 * liquidación de ese beneficiario ligada a esos cobros.
 *
 * Lo que se debe se lee del servidor al abrir (lo de ahora, no lo de cuando se pintó la lista). Las partes que no
 * deben nada no salen. Si a alguna se le pagó de más (en total, en esos cobros), sale aparte y sin marcar: lo que
 * devuelve no se registra solo, lo decide el dueño.
 *
 * El mismo diálogo paga a UNA parte desde el «Reparto del filtro» (`fromFilter`): lo que le falta en los cobros del
 * filtro donde se le debe (los pagados de más no se descuentan y se dicen aparte). Un pago de más de 500 cobros se
 * registra como varios de hasta 500, todos en la misma llamada: quedan todos o ninguno.
 */

const DATE_TEXT = "Elige la fecha del pago.";

/** Una parte con su casilla y los ids de sus pagos (uno por cada 500 cobros; los mismos si se repite tras un corte). */
type Choice = NamedOwedGroup & { key: string; payoutIds: string[] };

/** «Pagar…» a una parte desde el «Reparto del filtro»: la URL de la lista, la parte y la moneda. */
export type FilterPayout = { query: string; beneficiaryId: string; currency: Currency; name: string };

type Common = {
  open: boolean;
  onClose: () => void;
  /** Tras registrar los pagos. */
  onDone: () => void;
  /** Hoy en Nueva York: la fecha que viene puesta. */
  today: ISODate;
};

/** Los cobros elegidos (`ids`), o una parte en los cobros del filtro (`fromFilter`). */
export type PayoutsDialogProps = Common &
  ({ ids: string[]; fromFilter?: undefined } | { ids?: undefined; fromFilter: FilterPayout });

export function PayoutsDialog({ ids, fromFilter, open, onClose, onDone, today }: PayoutsDialogProps) {
  const title = fromFilter === undefined ? "Pagar repartos" : `Pagar a ${fromFilter.name}`;
  const description =
    fromFilter === undefined
      ? `Lo que se le debe a cada parte en ${cobros(ids.length)}. Se registra un pago por parte y moneda, con lo de ` +
        "cada cobro."
      : `Lo que le falta en los cobros del filtro (${fromFilter.currency}) donde se le debe. Solo se anota lo que ya ` +
        "le pagaste por fuera: no se mueve dinero.";
  return (
    <Dialog open={open} onClose={onClose} title={title} description={description}>
      {/* Solo existe mientras está abierto: cada vez lee lo que se debe ahora y empieza sin errores. */}
      <PayoutsForm
        ids={ids}
        query={fromFilter?.query}
        beneficiaryId={fromFilter?.beneficiaryId}
        currency={fromFilter?.currency}
        name={fromFilter?.name}
        onClose={onClose}
        onDone={onDone}
        today={today}
      />
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

/** Lo que se leyó al abrir: las partes con lo que se les debe, o un aviso de que no hay nada que pagar. */
type Loaded = {
  groups: NamedOwedGroup[];
  /** Con `fromFilter`: en cuántos cobros del filtro se le pagó de más, y cuánto (no se descuenta). */
  overpaid: { count: number; amount: MoneyValue; currency: Currency } | null;
  /** Por qué no hay nada que pagar, si lo hay. */
  notice: string | null;
};

/** Qué se lee al abrir: los cobros elegidos, o una parte (con su nombre) en una moneda de los cobros del filtro. */
type OwedRequest = { ids?: string[]; query?: string; beneficiaryId?: string; currency?: Currency; name?: string };

type FormProps = Omit<Common, "open"> & OwedRequest;

/** Lo que se le debe ahora: a cada parte en los cobros elegidos, o a una parte en los cobros del filtro. */
async function loadOwed({ ids, query, beneficiaryId, currency, name }: OwedRequest) {
  const failed = () => ({ ok: false as const, error: RETRY_TEXT });
  if (ids !== undefined) {
    const result = await callActionOr(() => owedForTransactions({ ids }), failed);
    if (!result.ok) return result;
    return { ok: true as const, loaded: { groups: result.data.groups, overpaid: null, notice: null } };
  }
  const result = await callActionOr(() => owedForFilter({ query, beneficiaryId, currency }), failed);
  if (!result.ok) return result;
  const { owed } = result.data;
  const loaded: Loaded =
    owed.kind === "debe"
      ? {
          groups: [owed],
          overpaid: owed.overpaid === null ? null : { ...owed.overpaid, currency: owed.currency },
          notice: null,
        }
      : {
          groups: [],
          overpaid: null,
          notice:
            owed.kind === "nada"
              ? `A ${name ?? ""} ya no le falta nada en los cobros del filtro.`
              : tooManyForSplitText(owed.count),
        };
  return { ok: true as const, loaded };
}

function PayoutsForm({ ids, query, beneficiaryId, currency, name, onClose, onDone, today }: FormProps) {
  const [choices, setChoices] = useState<Choice[] | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
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
    void loadOwed({ ids, query, beneficiaryId, currency, name }).then((result) => {
      if (!current) return;
      if (!result.ok) {
        setLoadError({ text: result.error, unsure: false });
        return;
      }
      const list = result.loaded.groups.map((group) => ({
        ...group,
        key: `${group.currency} ${group.beneficiaryId}`,
        payoutIds: payoutChunks(group.items).map(() => crypto.randomUUID()),
      }));
      setLoaded(result.loaded);
      setChoices(list);
      // Las que deben algo vienen marcadas; las que tienen que devolver, no.
      setChosen(new Set(list.filter((choice) => cmp(choice.owed, ZERO) > 0).map((choice) => choice.key)));
    });
    return () => {
      current = false;
    };
  }, [ids, query, beneficiaryId, currency, name]);

  const owes = (choices ?? []).filter((choice) => cmp(choice.owed, ZERO) > 0);
  const returns = (choices ?? []).filter((choice) => cmp(choice.owed, ZERO) < 0);
  const picked = (choices ?? []).filter((choice) => chosen.has(choice.key));
  // Un pago por cada 500 cobros de cada parte elegida: todos van en la misma llamada.
  const payouts = picked.flatMap((choice) =>
    payoutChunks(choice.items).map((items, i) => ({
      id: choice.payoutIds[i] ?? "",
      beneficiaryId: choice.beneficiaryId,
      currency: choice.currency,
      paidOn,
      method,
      items,
    })),
  );

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

  const closeOnly = (message: ReactNode) => (
    <div className="flex flex-col gap-4">
      {message}
      <Button className="self-end" onClick={onClose}>
        Cerrar
      </Button>
    </div>
  );

  if (loadError !== null) return closeOnly(<ActionError failure={loadError} />);
  if (choices === null || loaded === null) {
    return (
      <p role="status" className="text-ink-soft">
        Leyendo lo que se le debe a cada parte…
      </p>
    );
  }
  if (loaded.notice !== null) return closeOnly(<p role="status">{loaded.notice}</p>);
  if (choices.length === 0) {
    return closeOnly(
      <p role="status">Las partes de estos cobros no deben nada: ya está todo pagado (o no tienen reparto).</p>,
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      {owes.length === 0 ? null : (
        <fieldset className="flex flex-col">
          <legend className="font-semibold">{query === undefined ? "Les falta" : "Le falta"}</legend>
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
      {loaded.overpaid === null ? null : (
        <p className="text-sm text-ink-soft">
          En {cobros(loaded.overpaid.count)} del filtro se le pagó de más{" "}
          <Money value={loaded.overpaid.amount} currency={loaded.overpaid.currency} />: no se descuenta de este pago.
        </p>
      )}
      {payouts.length > picked.length ? (
        <Alert tone="info">
          Son más de {MAX_PAYOUT_ITEMS} cobros: se registran {payouts.length} pagos de hasta {MAX_PAYOUT_ITEMS} cobros
          cada uno, todos juntos (si uno no se puede guardar, no se guarda ninguno).
        </Alert>
      ) : null}
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
        <Button type="submit" variant="primary" disabled={pending || payouts.length === 0}>
          {payouts.length === 1 ? "Registrar 1 pago" : `Registrar ${payouts.length} pagos`}
        </Button>
      </div>
    </form>
  );
}
