"use client";

import { useId, useState, useTransition } from "react";
import {
  Button,
  DateText,
  Dialog,
  Money,
  TBody,
  THead,
  Table,
  Td,
  Th,
  Tr,
  notify,
} from "@/components/ui";
import { isISODate } from "@/lib/pasarelas/dates";
import { isMoney } from "@/lib/pasarelas/decimal";
import type { Currency, DiffRow } from "@/lib/pasarelas/types";
import { applyRecalc, previewRecalc } from "@/server/pasarelas/actions/transactions";
import { ActionError, useRefreshOnClose } from "../ActionError";
import { callAction, failureOf, type ActionFailure } from "../callAction";
import { batchDone, cobros } from "./plural";

type Mode = "hoy" | "fecha_del_cobro";

const MODES: { value: Mode; label: string; hint: string }[] = [
  { value: "hoy", label: "Tarifa vigente hoy", hint: "Las tarifas y el reparto que rigen hoy." },
  {
    value: "fecha_del_cobro",
    label: "La de la fecha del cobro",
    hint: "Las que regían el día de cada cobro, según lo que tienes configurado ahora.",
  },
];

type Preview = { items: { id: string; label: string; changes: DiffRow[] }[]; unchanged: number };

export type RecalcDialogProps = {
  /** Los cobros que se recalculan (de 1 a 500), con su moneda para pintar los montos. */
  transactions: { id: string; currency: Currency }[];
  open: boolean;
  /** Al cerrarlo (Cancelar, Escape, el fondo) y después de aplicar: ahí se pone `open` en falso. */
  onClose: () => void;
  /** Tras aplicar, con cuántos cambiaron (antes de `onClose`). */
  onDone?: (count: number) => void;
  /**
   * El detalle de un cobro manda la versión que se está viendo (su `updatedAt`; entonces `transactions` es ese
   * solo cobro): si cambió desde entonces, el servidor da conflicto en vez de recalcular sobre otra cosa.
   */
  expectedUpdatedAt?: string;
};

/**
 * Recalcular uno o varios cobros con la configuración de ahora. Primero se elige la tarifa («vigente hoy», por
 * defecto, o «la de la fecha del cobro») y se ve el antes y el después de cada uno (`previewRecalc`, que no
 * escribe); solo entonces se puede aplicar (`applyRecalc`).
 */
export function RecalcDialog({ transactions, open, onClose, onDone, expectedUpdatedAt }: RecalcDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Recalcular"
      description={`${cobros(transactions.length)}. Se vuelven a calcular las comisiones y el reparto; antes de aplicar ves qué cambia.`}
    >
      {/* Solo existe mientras está abierto: cada vez empieza en «Tarifa vigente hoy» y sin vista previa. */}
      <RecalcForm
        transactions={transactions}
        onClose={onClose}
        onDone={onDone}
        expectedUpdatedAt={expectedUpdatedAt}
      />
    </Dialog>
  );
}

function RecalcForm({ transactions, onClose, onDone, expectedUpdatedAt: current }: Omit<RecalcDialogProps, "open">) {
  // La versión que se vio al abrir: aunque la pantalla se refresque detrás, se manda esa.
  const [expectedUpdatedAt] = useState(current);
  const ids = transactions.map((tx) => tx.id);
  const currencies = new Map(transactions.map((tx) => [tx.id, tx.currency]));
  /** La vista previa solo trae cobros de los que se le pasaron: todos tienen su moneda. */
  const currencyOf = (id: string): Currency => {
    const currency = currencies.get(id);
    if (currency === undefined) throw new Error(`RecalcDialog: el cobro ${id} no estaba entre los elegidos`);
    return currency;
  };
  const [mode, setMode] = useState<Mode>("hoy");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<ActionFailure | null>(null);
  const [pending, startTransition] = useTransition();
  const name = useId();
  useRefreshOnClose(error);

  function choose(next: Mode) {
    setMode(next);
    // Lo que se vio era de la otra tarifa: hay que volver a verlo antes de aplicar.
    setPreview(null);
    setError(null);
  }

  function showPreview() {
    startTransition(async () => {
      // Solo lee: si no vuelve, no hay nada que revisar; basta con volver a pedirla.
      const result = await callAction(
        () => previewRecalc({ ids, mode }),
        "No se pudo traer el antes y el después por un fallo de conexión. Inténtalo de nuevo.",
      );
      // Solo leía: no hay ninguna duda de si se guardó algo.
      setError(result.ok ? null : { text: result.error, unsure: false });
      setPreview(result.ok ? result.data : null);
    });
  }

  function apply(changing: string[]) {
    startTransition(async () => {
      const result = await callAction(() => applyRecalc({ ids: changing, mode, expectedUpdatedAt }));
      if (!result.ok) {
        setError(failureOf(result));
        return;
      }
      notify.success(batchDone(result.data.count, changing.length, { one: "recalculado", many: "recalculados" }));
      onDone?.(result.data.count);
      onClose();
    });
  }

  const skipped = preview === null ? 0 : new Set(ids).size - preview.items.length - preview.unchanged;

  return (
    <div className="flex flex-col gap-4">
      <fieldset className="flex flex-col gap-1" disabled={pending}>
        <legend className="mb-1 text-sm font-semibold">¿Con qué tarifa?</legend>
        {MODES.map((option) => (
          <div key={option.value} className="flex flex-col">
            <label className="flex min-h-11 cursor-pointer items-center gap-3 py-1">
              <input
                type="radio"
                name={name}
                value={option.value}
                checked={mode === option.value}
                onChange={() => choose(option.value)}
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

      {preview === null ? (
        <Button className="self-start" onClick={showPreview} disabled={pending}>
          Ver el antes y el después
        </Button>
      ) : (
        <div className="flex flex-col gap-4">
          {preview.items.map((item) => (
            <section key={item.id} aria-label={item.label} className="flex flex-col gap-2">
              <h3 className="font-semibold">{item.label}</h3>
              {item.changes.length === 0 ? (
                <p className="text-ink-soft">
                  Las cifras quedan iguales: solo cambian datos que no son montos (un nombre o la versión de la
                  tarifa).
                </p>
              ) : (
                <ChangesTable
                  label={`Antes y después: ${item.label}`}
                  changes={item.changes}
                  currency={currencyOf(item.id)}
                />
              )}
            </section>
          ))}
          {preview.unchanged > 0 ? (
            <p>
              {cobros(preview.unchanged)} {preview.unchanged === 1 ? "queda" : "quedan"} igual.
            </p>
          ) : null}
          {skipped > 0 ? (
            <p className="text-ink-soft">
              {cobros(skipped)} no se {skipped === 1 ? "puede" : "pueden"} recalcular (fallidos o en la papelera).
            </p>
          ) : null}
        </div>
      )}

      <ActionError failure={error} />

      <div className="flex flex-wrap justify-end gap-2">
        <Button onClick={onClose} disabled={pending}>
          Cancelar
        </Button>
        {preview !== null && preview.items.length > 0 ? (
          <Button variant="primary" onClick={() => apply(preview.items.map((item) => item.id))} disabled={pending}>
            Aplicar a {cobros(preview.items.length)}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/** Una cifra del antes o del después: un monto, la fecha estimada o «—» si ese lado no la tiene. */
function Value({ row, value, currency }: { row: DiffRow; value: string; currency: Currency }) {
  if (row.key === "estimatedDepositOn") return isISODate(value) ? <DateText value={value} /> : <>—</>;
  return isMoney(value) ? <Money value={value} currency={currency} /> : <>—</>;
}

/** El antes y el después de un cambio, fila por fila. También lo usan el reembolso y la disputa del detalle. */
export function ChangesTable({ label, changes, currency }: { label: string; changes: DiffRow[]; currency: Currency }) {
  // Dentro de un diálogo del celular queda poco ancho: celdas más estrechas y el concepto se parte en líneas,
  // para que las dos columnas de cifras quepan sin desplazar.
  const cell = "px-2 sm:px-3";
  return (
    <Table label={label} className="text-sm sm:text-base">
      <THead>
        <Tr>
          <Th className={cell}>Concepto</Th>
          <Th numeric className={cell}>
            Antes
          </Th>
          <Th numeric className={cell}>
            Después
          </Th>
        </Tr>
      </THead>
      <TBody>
        {changes.map((row) => (
          <Tr key={row.key}>
            <Th scope="row" className={`${cell} break-words`}>
              {row.label}
            </Th>
            <Td numeric className={cell}>
              <Value row={row} value={row.before} currency={currency} />
            </Td>
            <Td numeric className={cell}>
              <Value row={row} value={row.after} currency={currency} />
            </Td>
          </Tr>
        ))}
      </TBody>
    </Table>
  );
}
