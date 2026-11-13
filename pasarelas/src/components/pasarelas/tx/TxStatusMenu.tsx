"use client";

import { ChevronDown } from "lucide-react";
import { useState, useSyncExternalStore, useTransition } from "react";
import { flushSync } from "react-dom";
import { ConfirmDialog, Dialog, cn, notify } from "@/components/ui";
import { STATUS_LABEL, displayStatus } from "@/lib/pasarelas";
import type { ISODate } from "@/lib/pasarelas/types";
import { failTransaction, markInTransit, reopenTransaction, revertDeposit } from "@/server/pasarelas/actions/transactions";
import type { TxListItem } from "@/server/pasarelas/dto";
import type { ActionResult } from "@/server/pasarelas/result";
import { DialogActionError } from "../ActionError";
import { callAction, failureOf, type ActionFailure } from "../callAction";
import { DepositDialog } from "./DepositDialog";
import { STALE_TEXT } from "./plural";
import { STATUS_MENU_ATTR, useTxSelection } from "./TxBulkBar";
import {
  REVERT_DEPOSIT_CONFIRM,
  STATUS_CHANGE_LABEL,
  statusChanges,
  txName,
  type StatusChange,
} from "./statusChanges";

/** `useSyncExternalStore` sin nada que escuchar: solo distingue el HTML del servidor de la página ya hidratada. */
const noSubscription = () => () => {};

type Open = "menu" | "deposito" | "revertir" | "fallido" | null;

export type TxStatusMenuProps = {
  tx: TxListItem;
  /** Hoy en Nueva York: la fecha que propone «Marcar depositado…». */
  today: ISODate;
  /** `bottom` en las tarjetas del celular (una hoja pegada abajo, como «Más»); `center` en la tabla. */
  placement: "center" | "bottom";
  className?: string;
};

/**
 * «Cambiar estado» de un cobro de la lista: abre un menú con los cambios de estado que el motor admite para ese
 * cobro (`statusChanges`, que sale de `allowedActions`, como el detalle). Si no admite ninguno (en la papelera), no
 * hay botón. Usa las mismas acciones que el detalle y, como ahí, las de un solo cobro mandan la versión que se está
 * viendo (`updatedAt`). Tras el cambio, el servidor vuelve a pintar la lista con los mismos filtros y la misma
 * página (la URL no cambia), y con ella el estado, la columna Depósito y los totales del filtro.
 */
export function TxStatusMenu(props: TxStatusMenuProps) {
  const changes = statusChanges(props.tx);
  if (changes.length === 0) return null;
  return <StatusMenu {...props} changes={changes} />;
}

/**
 * El botón y sus diálogos. El menú es un diálogo (en el celular, una hoja abajo): atrapa el foco, Escape lo cierra
 * y el foco vuelve al botón. Las opciones que no piden nada más corren ahí mismo; si fallan, el error (o la duda de
 * un corte, con «Ver cómo quedó») se enseña en el menú. «Marcar depositado…» abre el diálogo de siempre, con su
 * fecha; «Revertir el depósito» pide la misma confirmación que en el detalle, porque borra la fecha real del
 * depósito, y «Marcar como fallido» también, porque deja el cobro en cero. Si el cambio saca el cobro de la lista (ya
 * no pasa el filtro), el foco pasa al menú de al lado (`followChange`).
 */
function StatusMenu({ tx, today, placement, className, changes }: TxStatusMenuProps & { changes: StatusChange[] }) {
  // Como el enlace de la misma fila: «cobro pi_123» o «cobro del jue 12 nov 2026 por $675,00».
  const subject = `cobro ${txName(tx)}`;
  const [open, setOpen] = useState<Open>(null);
  // Los diálogos se montan la primera vez que se abre el menú: la lista pinta hasta 50 cobros dos veces (tarjetas y
  // tabla), y casi ninguno lo abre.
  const [used, setUsed] = useState(false);
  // Antes de hidratar, el botón no respondería: se ve, pero desactivado.
  const hydrated = useSyncExternalStore(noSubscription, () => true, () => false);
  const [error, setError] = useState<ActionFailure | null>(null);
  const [pending, startTransition] = useTransition();
  const { followChange } = useTxSelection();
  const close = () => setOpen(null);
  const seen = { id: tx.id, expectedUpdatedAt: tx.updatedAt };

  function show(which: Exclude<Open, null>) {
    setError(null);
    setUsed(true);
    setOpen(which);
  }

  /**
   * Corre el cambio y avisa cómo fue. Si falla, o si no cambió nada (`unchanged`: el cobro ya no lo admitía), el
   * menú queda abierto (o se vuelve a abrir, si se cerró mientras corría) con el error.
   */
  function run<T>(action: () => Promise<ActionResult<T>>, done: string, unchanged: (data: T) => boolean = () => false) {
    // Desde dónde se pidió: el menú, o la confirmación de «Revertir el depósito» o de «Marcar como fallido».
    const from = open;
    setError(null);
    startTransition(async () => {
      const result = await callAction(action);
      const failed = !result.ok || unchanged(result.data);
      // Si falló una confirmación, se cierra ella antes de volver a abrir el menú: así su foco vuelve al botón del
      // cobro y el menú se abre desde ahí (al cerrarlo, el foco vuelve al botón y no se pierde).
      if (failed && from !== "menu") flushSync(() => setOpen(null));
      // Lo que sigue va en la misma transición, para que se pinte junto con el fin de `pending`: si el menú se
      // volviera a abrir antes, con las opciones todavía desactivadas, el foco caería en «Cerrar».
      startTransition(() => {
        if (failed) {
          setError(result.ok ? { text: STALE_TEXT, unsure: false } : failureOf(result));
          setOpen("menu");
          return;
        }
        setOpen(null);
        notify.success(done);
        followChange(tx.id);
      });
    });
  }

  const choose: Record<StatusChange, () => void> = {
    en_transito: () => run(() => markInTransit({ ids: [tx.id] }), "Cobro en tránsito.", ({ count }) => count === 0),
    depositado: () => show("deposito"),
    revertir_deposito: () => show("revertir"),
    fallido: () => show("fallido"),
    reabrir: () => run(() => reopenTransaction(seen), "Cobro reabierto."),
  };

  return (
    <>
      {/* Como el enlace al cobro de la misma fila: sin caja, para que el texto quede alineado con los sellos. */}
      <button
        type="button"
        aria-haspopup="dialog"
        {...{ [STATUS_MENU_ATTR]: tx.id }}
        disabled={!hydrated}
        onClick={() => show("menu")}
        className={cn(
          "inline-flex min-h-11 items-center gap-1 font-semibold text-brand hover:underline disabled:cursor-not-allowed disabled:opacity-55",
          className,
        )}
      >
        Cambiar estado<span className="sr-only"> del {subject}</span>
        <ChevronDown aria-hidden className="size-5" />
      </button>
      {used ? (
        <>
          <Dialog
            open={open === "menu"}
            onClose={close}
            title="Cambiar estado"
            description={`El ${subject} está «${STATUS_LABEL[displayStatus(tx)]}».`}
            placement={placement}
          >
            <ul className="-mx-2 flex flex-col divide-y divide-rule">
              {changes.map((change) => (
                <li key={change}>
                  <button
                    type="button"
                    onClick={choose[change]}
                    disabled={pending}
                    className="flex min-h-12 w-full items-center rounded-control px-2 text-left font-semibold text-ink hover:bg-sunken disabled:cursor-not-allowed disabled:opacity-55"
                  >
                    {STATUS_CHANGE_LABEL[change]}
                  </button>
                </li>
              ))}
            </ul>
            <DialogActionError failure={error} />
          </Dialog>
          <DepositDialog
            ids={[tx.id]}
            open={open === "deposito"}
            onClose={close}
            defaultDate={today}
            today={today}
            earliest={tx.occurredOn}
            onlyPending={false}
            expectedUpdatedAt={tx.updatedAt}
            onDone={() => followChange(tx.id)}
          />
          <ConfirmDialog
            open={open === "revertir"}
            onClose={close}
            onConfirm={() => run(() => revertDeposit(seen), "Depósito revertido.")}
            {...REVERT_DEPOSIT_CONFIRM}
            pending={pending}
          />
          <ConfirmDialog
            open={open === "fallido"}
            onClose={close}
            onConfirm={() => run(() => failTransaction(seen), "Cobro marcado como fallido.")}
            title={`¿Marcar como fallido el ${subject}?`}
            description="Sus comisiones, su neto y su reparto quedan en cero y deja de contar en los totales. Puedes reabrirlo después."
            confirmLabel="Marcar como fallido"
            variant="danger"
            pending={pending}
          />
        </>
      ) : null}
    </>
  );
}
