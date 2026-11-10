"use client";

import { useId, useState, useTransition, type FormEvent } from "react";
import { Alert, Button, ButtonLink, Card, CardBody, ConfirmDialog, Dialog, Field, Input, notify } from "@/components/ui";
import type { ISODate, TxSnapshot } from "@/lib/pasarelas/types";
import type { ActionResult } from "@/server/pasarelas/result";
import {
  failTransaction,
  markInTransit,
  reopenTransaction,
  restoreTransactions,
  revertDeposit,
  setEstimatedDate,
  trashTransactions,
} from "@/server/pasarelas/actions/transactions";
import { allowedActions } from "./allowed";
import { DepositDialog } from "./DepositDialog";
import { DisputeDialog } from "./DisputeDialog";
import { RecalcDialog } from "./RecalcDialog";
import { RefundDialog } from "./RefundDialog";

const STALE_TEXT = "El cobro ya no admitía ese cambio. Vuelve a cargar la página para ver cómo está.";

/** ¿Es la respuesta de una acción de lote que no cambió ningún cobro? */
const changedNone = (data: unknown): boolean =>
  typeof data === "object" && data !== null && "count" in data && data.count === 0;

type Open = "fecha" | "deposito" | "reembolso" | "disputa" | "recalcular" | "revertir" | "fallido" | "papelera" | null;

export type TxActionsProps = {
  tx: TxSnapshot;
  /** Hoy en Nueva York: la fecha que proponen el depósito, el reembolso y la disputa. */
  today: ISODate;
};

/**
 * Lo que se puede hacer con el cobro, según su estado: solo las acciones que el motor acepta (`allowedActions`).
 * Las que cambian números (reembolso, disputa, recalcular) enseñan antes el antes y el después; las que cuestan
 * deshacer piden confirmación. Tras cada una, el servidor vuelve a pintar el detalle.
 */
export function TxActions({ tx, today }: TxActionsProps) {
  const titleId = useId();
  const can = new Set(allowedActions(tx));
  const [open, setOpen] = useState<Open>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const close = () => setOpen(null);

  function show(which: Exclude<Open, null>) {
    setError(null);
    setOpen(which);
  }

  /**
   * Corre una acción sin diálogo propio (o tras su confirmación) y avisa cómo fue. Las de lote dicen cuántos
   * cambiaron: cero es que el cobro ya no admitía el cambio (la pantalla estaba vieja).
   */
  function run(action: () => Promise<ActionResult<unknown>>, done: string) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      setOpen(null);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (changedNone(result.data)) {
        setError(STALE_TEXT);
        return;
      }
      notify.success(done);
    });
  }

  const ids = [tx.id];
  const refundModes = [
    ...(can.has("reembolso") ? (["agregar"] as const) : []),
    ...(can.has("corregir_reembolso") ? (["corregir"] as const) : []),
  ];

  return (
    <Card role="region" aria-labelledby={titleId}>
      <CardBody className="flex flex-col gap-3">
        <h2 id={titleId} className="sr-only">
          Acciones
        </h2>
        <div className="flex flex-wrap gap-2">
          {can.has("restaurar") ? (
            <Button
              variant="primary"
              onClick={() => run(() => restoreTransactions({ ids }), "Cobro restaurado.")}
              disabled={pending}
            >
              Restaurar
            </Button>
          ) : null}
          {can.has("depositado") ? (
            <Button variant="primary" onClick={() => show("deposito")} disabled={pending}>
              {tx.status === "depositado" ? "Cambiar fecha del depósito" : "Marcar depositado"}
            </Button>
          ) : null}
          {can.has("en_transito") ? (
            <Button onClick={() => run(() => markInTransit({ ids }), "Cobro en tránsito.")} disabled={pending}>
              Marcar en tránsito
            </Button>
          ) : null}
          {can.has("revertir_deposito") ? (
            <Button onClick={() => show("revertir")} disabled={pending}>
              Revertir depósito
            </Button>
          ) : null}
          {can.has("editar") ? <ButtonLink href={`/pasarelas/cobros/${tx.id}/editar`}>Editar</ButtonLink> : null}
          {can.has("fecha_estimada") ? (
            <Button onClick={() => show("fecha")} disabled={pending}>
              Cambiar fecha estimada
            </Button>
          ) : null}
          {refundModes.length > 0 ? (
            <Button onClick={() => show("reembolso")} disabled={pending}>
              {can.has("reembolso") ? "Registrar reembolso" : "Corregir reembolso"}
            </Button>
          ) : null}
          {can.has("abrir_disputa") ? (
            <Button onClick={() => show("disputa")} disabled={pending}>
              Abrir disputa
            </Button>
          ) : null}
          {can.has("resolver_disputa") ? (
            <Button onClick={() => show("disputa")} disabled={pending}>
              Resolver disputa
            </Button>
          ) : null}
          {can.has("recalcular") ? (
            <Button onClick={() => show("recalcular")} disabled={pending}>
              Recalcular
            </Button>
          ) : null}
          {can.has("reabrir") ? (
            <Button onClick={() => run(() => reopenTransaction({ id: tx.id }), "Cobro reabierto.")} disabled={pending}>
              Reabrir
            </Button>
          ) : null}
          {can.has("fallido") ? (
            <Button onClick={() => show("fallido")} disabled={pending}>
              Marcar fallido
            </Button>
          ) : null}
          {can.has("papelera") ? (
            <Button variant="danger" onClick={() => show("papelera")} disabled={pending}>
              A la papelera
            </Button>
          ) : null}
        </div>
        {error ? (
          <Alert tone="danger" announce>
            {error}
          </Alert>
        ) : null}
      </CardBody>

      <EstimatedDialog
        tx={tx}
        canAutomatic={can.has("fecha_automatica")}
        today={today}
        open={open === "fecha"}
        onClose={close}
      />
      <DepositDialog ids={ids} open={open === "deposito"} onClose={close} defaultDate={tx.depositedOn ?? today} />
      <RefundDialog tx={tx} modes={refundModes} open={open === "reembolso"} onClose={close} today={today} />
      <DisputeDialog
        tx={tx}
        mode={can.has("resolver_disputa") ? "resolver" : "abrir"}
        open={open === "disputa"}
        onClose={close}
        today={today}
      />
      <RecalcDialog transactions={[{ id: tx.id, currency: tx.currency }]} open={open === "recalcular"} onClose={close} />
      <ConfirmDialog
        open={open === "revertir"}
        onClose={close}
        onConfirm={() => run(() => revertDeposit({ id: tx.id }), "Depósito revertido.")}
        title="¿Revertir el depósito?"
        description="El cobro vuelve a «En tránsito» y se borra la fecha real del depósito."
        confirmLabel="Revertir depósito"
        pending={pending}
      />
      <ConfirmDialog
        open={open === "fallido"}
        onClose={close}
        onConfirm={() => run(() => failTransaction({ id: tx.id }), "Cobro marcado como fallido.")}
        title="¿Marcar el cobro como fallido?"
        description="Sus comisiones, su neto y su reparto quedan en cero y deja de contar en los totales. Puedes reabrirlo después."
        confirmLabel="Marcar fallido"
        variant="danger"
        pending={pending}
      />
      <ConfirmDialog
        open={open === "papelera"}
        onClose={close}
        onConfirm={() => run(() => trashTransactions({ ids }), "Cobro enviado a la papelera.")}
        title="¿Enviar este cobro a la papelera?"
        description="Deja de contar en los totales y en el Resumen. Puedes restaurarlo desde la Papelera."
        confirmLabel="Enviar a la papelera"
        variant="danger"
        pending={pending}
      />
    </Card>
  );
}

type EstimatedDialogProps = {
  tx: TxSnapshot;
  /** Si la fecha está puesta a mano: entonces se puede volver a la automática. */
  canAutomatic: boolean;
  today: ISODate;
  open: boolean;
  onClose: () => void;
};

/** La fecha estimada del depósito: fijarla a mano o volver a la que calcula la app. */
function EstimatedDialog({ tx, canAutomatic, today, open, onClose }: EstimatedDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Fecha estimada"
      description="Puesta a mano, recalcular no la cambia. La automática sale de los días de la pasarela y los feriados."
    >
      <EstimatedForm tx={tx} canAutomatic={canAutomatic} today={today} onClose={onClose} />
    </Dialog>
  );
}

function EstimatedForm({ tx, canAutomatic, today, onClose }: Omit<EstimatedDialogProps, "open">) {
  const [date, setDate] = useState(tx.estimatedDepositOn ?? today);
  const [dateError, setDateError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save(next: ISODate | null) {
    startTransition(async () => {
      const result = await setEstimatedDate({ id: tx.id, date: next });
      if (!result.ok) {
        setError(result.error);
        setDateError(result.fieldErrors?.date?.[0] ?? null);
        return;
      }
      notify.success(next === null ? "Fecha estimada automática." : "Fecha estimada guardada.");
      onClose();
    });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (date === "") {
      setDateError("Elige la fecha.");
      return;
    }
    save(date);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <Field label="Fecha estimada del depósito" error={dateError}>
        <Input
          type="date"
          value={date}
          onChange={(event) => {
            setDate(event.currentTarget.value);
            setDateError(null);
          }}
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
        {canAutomatic ? (
          <Button onClick={() => save(null)} disabled={pending}>
            Volver a la automática
          </Button>
        ) : null}
        <Button type="submit" variant="primary" disabled={pending}>
          Guardar
        </Button>
      </div>
    </form>
  );
}
