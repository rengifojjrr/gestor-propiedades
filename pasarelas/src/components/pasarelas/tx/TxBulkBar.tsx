"use client";

import { useRouter } from "next/navigation";
import { createContext, use, useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { Alert, Button, Checkbox, ConfirmDialog, notify } from "@/components/ui";
import type { Currency, ISODate } from "@/lib/pasarelas/types";
import { markInTransit, trashTransactions } from "@/server/pasarelas/actions/transactions";
import { callAction } from "../callAction";
import { DepositDialog } from "./DepositDialog";
import { batchDone, cobros } from "./plural";
import { RecalcDialog } from "./RecalcDialog";

// ─── La selección ───────────────────────────────────────────────────────────────────────────────────────────

type Selection = {
  /** Los cobros elegidos, en el orden de la página. */
  selected: string[];
  isSelected: (id: string) => boolean;
  toggle: (id: string, on: boolean) => void;
  /** Elige todos los de la página, o ninguno. */
  toggleAll: (on: boolean) => void;
  clear: () => void;
  /** Cuántos cobros tiene la página. */
  total: number;
};

const SelectionContext = createContext<Selection | null>(null);

/** La selección de la lista. Solo cuenta lo que está en la página: lo elegido que ya no se ve, se olvida. */
export function useTxSelection(): Selection {
  const selection = use(SelectionContext);
  if (selection === null) throw new Error("useTxSelection va dentro de <TxSelectionProvider>");
  return selection;
}

/** Guarda qué cobros de la página están elegidos. `ids`: los de la página, en su orden. */
export function TxSelectionProvider({ ids, children }: { ids: string[]; children: ReactNode }) {
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const selected = ids.filter((id) => chosen.has(id));
  const value: Selection = {
    selected,
    isSelected: (id) => chosen.has(id),
    toggle: (id, on) =>
      setChosen((previous) => {
        const next = new Set(previous);
        if (on) next.add(id);
        else next.delete(id);
        return next;
      }),
    toggleAll: (on) => setChosen(on ? new Set(ids) : new Set()),
    clear: () => setChosen(new Set()),
    total: ids.length,
  };
  return <SelectionContext value={value}>{children}</SelectionContext>;
}

/** La casilla de «todos los de esta página»: marcada si están todos, a medias si hay algunos. */
export function SelectAllCheckbox({ visibleLabel = false }: { visibleLabel?: boolean }) {
  const { selected, total, toggleAll } = useTxSelection();
  const text = "Seleccionar todos los cobros de esta página";
  return (
    <Checkbox
      label={visibleLabel ? text : <span className="sr-only">{text}</span>}
      // Sin texto a la vista, la fila tocable mediría lo que la casilla: el ancho la deja en 44 px.
      className={visibleLabel ? undefined : "w-11"}
      checked={total > 0 && selected.length === total}
      ref={(input: HTMLInputElement | null) => {
        if (input) input.indeterminate = selected.length > 0 && selected.length < total;
      }}
      onChange={(event) => toggleAll(event.currentTarget.checked)}
    />
  );
}

// ─── La barra ───────────────────────────────────────────────────────────────────────────────────────────────

type Dialogs = "deposit" | "recalc" | "trash" | null;

export type TxBulkBarProps = {
  /** Los cobros de la página con su moneda (para pintar el antes y el después al recalcular). */
  transactions: { id: string; currency: Currency }[];
  /** Hoy en Nueva York: la fecha que propone «Marcar depositado». */
  today: ISODate;
  /**
   * El id de lo que recibe el foco cuando, tras una acción que sale bien, la barra desaparece (con ella se va el
   * botón que se pulsó): el contador de la lista, con `tabIndex={-1}`.
   */
  focusAfterId: string;
};

/**
 * Las acciones sobre los cobros elegidos: marcar en tránsito, marcar depositado (con fecha), recalcular (con el
 * antes y el después) y enviar a la papelera. «Marcar depositado» solo marca lo que está por caer: lo ya depositado
 * conserva su fecha. Solo aparece cuando hay alguno elegido; tras una acción que sale bien, la selección se vacía y
 * el foco pasa al contador de la lista (`focusAfterId`).
 */
export function TxBulkBar({ transactions, today, focusAfterId }: TxBulkBarProps) {
  const router = useRouter();
  const { selected, clear } = useTxSelection();
  const [dialog, setDialog] = useState<Dialogs>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // Mientras un diálogo está abierto, la selección que usa es la del momento en que se abrió.
  const [ids, setIds] = useState<string[]>([]);
  // Tras una acción que vació la selección: cuando la barra ya no está, el foco va al contador.
  const refocus = useRef(false);
  const hidden = selected.length === 0 && dialog === null;

  useEffect(() => {
    if (!refocus.current || !hidden) return;
    refocus.current = false;
    document.getElementById(focusAfterId)?.focus();
  });

  if (hidden) return null;

  const open = (which: Exclude<Dialogs, null>) => {
    setError(null);
    setIds(selected);
    setDialog(which);
  };
  const close = () => setDialog(null);
  const done = () => {
    setDialog(null);
    clear();
    refocus.current = true;
  };

  function transit() {
    setError(null);
    const chosen = selected;
    startTransition(async () => {
      const result = await callAction(() => markInTransit({ ids: chosen }), router.refresh);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      notify.success(batchDone(result.data.count, chosen.length, { one: "marcado en tránsito", many: "marcados en tránsito" }));
      clear();
      refocus.current = true;
    });
  }

  function trash() {
    startTransition(async () => {
      const result = await callAction(() => trashTransactions({ ids }), router.refresh);
      if (!result.ok) {
        setDialog(null);
        setError(result.error);
        return;
      }
      notify.success(
        batchDone(result.data.count, ids.length, { one: "enviado a la papelera", many: "enviados a la papelera" }),
      );
      done();
    });
  }

  const chosenTransactions = transactions.filter((tx) => ids.includes(tx.id));

  return (
    <div className="sticky top-0 z-[5] -mx-1 flex flex-col gap-3 rounded-card border border-rule bg-surface p-3 shadow-raised">
      {selected.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <p aria-live="polite" className="mr-auto font-semibold">
            {selected.length} {selected.length === 1 ? "seleccionado" : "seleccionados"}
          </p>
          <Button variant="ghost" onClick={clear} disabled={pending}>
            Quitar selección
          </Button>
        </div>
      ) : null}
      {selected.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          <Button onClick={transit} disabled={pending}>
            Marcar en tránsito
          </Button>
          <Button variant="primary" onClick={() => open("deposit")} disabled={pending}>
            Marcar depositado
          </Button>
          <Button onClick={() => open("recalc")} disabled={pending}>
            Recalcular
          </Button>
          <Button variant="danger" onClick={() => open("trash")} disabled={pending}>
            A la papelera
          </Button>
        </div>
      ) : null}
      {error ? (
        <Alert tone="danger" announce>
          {error}
        </Alert>
      ) : null}

      <DepositDialog
        ids={ids}
        open={dialog === "deposit"}
        onClose={close}
        onDone={done}
        defaultDate={today}
        today={today}
        onlyPending
      />
      <RecalcDialog transactions={chosenTransactions} open={dialog === "recalc"} onClose={close} onDone={done} />
      <ConfirmDialog
        open={dialog === "trash"}
        onClose={close}
        onConfirm={trash}
        title={`¿Enviar ${cobros(ids.length)} a la papelera?`}
        description="Dejan de contar en los totales y en el Resumen. Puedes restaurarlos desde la Papelera."
        confirmLabel="Enviar a la papelera"
        variant="danger"
        pending={pending}
      />
    </div>
  );
}
