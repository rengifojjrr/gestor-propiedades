"use client";

import { createContext, use, useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { Button, Checkbox, ConfirmDialog, notify } from "@/components/ui";
import type { Currency, ISODate } from "@/lib/pasarelas/types";
import { markInTransit, trashTransactions } from "@/server/pasarelas/actions/transactions";
import { ActionError } from "../ActionError";
import { callAction, failureOf, type ActionFailure } from "../callAction";
import { DepositDialog } from "./DepositDialog";
import { PayoutsDialog } from "./PayoutsDialog";
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
  /**
   * Tras una acción en lote que salió bien: vacía la selección y, cuando la pantalla ya se volvió a pintar, lleva el
   * foco a `focusAfterId` (la barra se fue con el botón pulsado, y quizá la lista entera).
   */
  finish: () => void;
  /** Cuántos cobros tiene la página. */
  total: number;
  /**
   * Tras cambiar el estado de un cobro desde su menú: si con la lista nueva ese cobro ya no está (el cambio lo sacó
   * del filtro), su botón se fue con él y el foco caería en <body>. Entonces pasa al menú del cobro siguiente, al del
   * anterior si era el último o, si no queda ninguno, a `focusAfterId`.
   */
  followChange: (id: string) => void;
};

/**
 * El atributo que lleva el botón «Cambiar estado» de cada cobro (`TxStatusMenu`), con el id del cobro: ahí busca
 * `followChange` a dónde llevar el foco.
 */
export const STATUS_MENU_ATTR = "data-menu-estado";

/** El botón «Cambiar estado» de ese cobro que se ve: la lista se pinta dos veces (tarjetas y tabla), una oculta. */
function visibleStatusMenu(id: string): HTMLElement | null {
  const buttons = document.querySelectorAll<HTMLElement>(`[${STATUS_MENU_ATTR}="${CSS.escape(id)}"]`);
  return [...buttons].find((button) => button.getClientRects().length > 0) ?? null;
}

/** Un cambio de estado hecho desde el menú de un cobro: cuál, sus vecinos (primero los de después) y la lista de entonces. */
type MenuChange = { id: string; neighbors: string[]; ids: string[] };

const SelectionContext = createContext<Selection | null>(null);

/** El foco todavía no se llevó a ningún lado tras la acción en lote. */
const PENDING = "pendiente";

/** La selección de la lista. Solo cuenta lo que está en la página: lo elegido que ya no se ve, se olvida. */
export function useTxSelection(): Selection {
  const selection = use(SelectionContext);
  if (selection === null) throw new Error("useTxSelection va dentro de <TxSelectionProvider>");
  return selection;
}

export type TxSelectionProviderProps = {
  /** Los cobros de la página, en su orden (ninguno si la lista quedó vacía). */
  ids: string[];
  /**
   * El id de lo que recibe el foco tras una acción en lote que sale bien: el contador de la lista o, si la acción
   * la vació, el aviso de la lista vacía (con `tabIndex={-1}`). Va fuera de la lista y de la barra, que se pueden
   * ir con la acción: por eso lo mueve el proveedor, que sigue en la página.
   */
  focusAfterId: string;
  children: ReactNode;
};

/** Guarda qué cobros de la página están elegidos y, tras una acción en lote, a dónde va el foco. */
export function TxSelectionProvider({ ids, focusAfterId, children }: TxSelectionProviderProps) {
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const selected = ids.filter((id) => chosen.has(id));
  // Tras una acción en lote: a qué se llevó el foco («pendiente» hasta que se pinte sin la selección). La lista
  // nueva puede llegar después: si se lleva lo que tenía el foco (la lista quedó vacía), el foco caería en <body> y
  // se pasa a lo que lo reemplaza. Si la persona ya lo movió a otra parte, se deja de vigilar.
  const focusGuard = useRef<HTMLElement | typeof PENDING | null>(null);
  // Tras un cambio desde el menú de un cobro: lo que hay que mirar cuando llegue la lista nueva (`ids` cambia con
  // cada lista que pinta el servidor, aunque traiga los mismos cobros).
  const menuChange = useRef<MenuChange | null>(null);
  const shownIds = useRef(ids);

  /** Con la lista nueva (`current`): si el cobro ya no está y el foco cayó en <body>, lo lleva al vecino. */
  function focusAfterMenuChange(change: MenuChange, current: string[]): void {
    if (current.includes(change.id)) return;
    const active = document.activeElement;
    if (active !== null && active !== document.body) return;
    const target =
      change.neighbors.map(visibleStatusMenu).find((button) => button !== null) ?? document.getElementById(focusAfterId);
    target?.focus();
  }

  useEffect(() => {
    shownIds.current = ids;
    const change = menuChange.current;
    if (change === null || change.ids === ids) return;
    menuChange.current = null;
    focusAfterMenuChange(change, ids);
  });

  useEffect(() => {
    const guarded = focusGuard.current;
    if (guarded === null || selected.length > 0) return;
    if (guarded !== PENDING) {
      const active = document.activeElement;
      if (guarded.isConnected) {
        if (active !== guarded) focusGuard.current = null;
        return;
      }
      if (active !== null && active !== document.body) {
        focusGuard.current = null;
        return;
      }
    }
    const target = document.getElementById(focusAfterId);
    focusGuard.current = target;
    target?.focus();
  });

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
    finish: () => {
      focusGuard.current = PENDING;
      setChosen(new Set());
    },
    total: ids.length,
    followChange: (id) => {
      const at = ids.indexOf(id);
      const neighbors = at < 0 ? [] : [...ids.slice(at + 1), ...ids.slice(0, at).reverse()];
      const change = { id, neighbors, ids };
      // Si la lista nueva ya se pintó, se mira ahora; si no, cuando llegue.
      if (shownIds.current === ids) menuChange.current = change;
      else focusAfterMenuChange(change, shownIds.current);
    },
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

type Dialogs = "deposit" | "recalc" | "trash" | "payouts" | null;

export type TxBulkBarProps = {
  /** Los cobros de la página con su moneda (para pintar el antes y el después al recalcular). */
  transactions: { id: string; currency: Currency }[];
  /** Hoy en Nueva York: la fecha que propone «Marcar depositado». */
  today: ISODate;
};

/**
 * Las acciones sobre los cobros elegidos: marcar en tránsito, marcar depositado (con fecha), recalcular (con el
 * antes y el después) y enviar a la papelera. «Marcar depositado» solo marca lo que está por caer: lo ya depositado
 * conserva su fecha. Solo aparece cuando hay alguno elegido; tras una acción que sale bien, la selección se vacía y
 * el foco pasa a donde diga `TxSelectionProvider` (el contador de la lista, o el aviso de la lista vacía).
 */
export function TxBulkBar({ transactions, today }: TxBulkBarProps) {
  const { selected, clear, finish } = useTxSelection();
  const [dialog, setDialog] = useState<Dialogs>(null);
  const [error, setError] = useState<ActionFailure | null>(null);
  const [pending, startTransition] = useTransition();
  // Mientras un diálogo está abierto, la selección que usa es la del momento en que se abrió.
  const [ids, setIds] = useState<string[]>([]);
  const hidden = selected.length === 0 && dialog === null;

  if (hidden) return null;

  const open = (which: Exclude<Dialogs, null>) => {
    setError(null);
    setIds(selected);
    setDialog(which);
  };
  const close = () => setDialog(null);
  const done = () => {
    setDialog(null);
    finish();
  };

  function transit() {
    setError(null);
    const chosen = selected;
    startTransition(async () => {
      const result = await callAction(() => markInTransit({ ids: chosen }));
      if (!result.ok) {
        setError(failureOf(result));
        return;
      }
      notify.success(batchDone(result.data.count, chosen.length, { one: "marcado en tránsito", many: "marcados en tránsito" }));
      finish();
    });
  }

  function trash() {
    startTransition(async () => {
      const result = await callAction(() => trashTransactions({ ids }));
      if (!result.ok) {
        setDialog(null);
        setError(failureOf(result));
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
          <Button onClick={() => open("payouts")} disabled={pending}>
            Pagar repartos…
          </Button>
          <Button variant="danger" onClick={() => open("trash")} disabled={pending}>
            A la papelera
          </Button>
        </div>
      ) : null}
      <ActionError failure={error} />

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
      <PayoutsDialog ids={ids} open={dialog === "payouts"} onClose={close} onDone={done} today={today} />
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
