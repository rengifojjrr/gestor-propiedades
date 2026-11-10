"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
import { useId, useOptimistic, useState, useTransition } from "react";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  Dialog,
  EmptyState,
  notify,
  SubmitButton,
  Switch,
} from "@/components/ui";
import type { DayType, ExtraCfg } from "@/lib/pasarelas/types";
import { deleteExtra, saveExtra } from "@/server/pasarelas/actions/gateways";
import { payoutText } from "./days";
import {
  BASE_LABEL,
  EMPTY_EXTRA,
  extraDraft,
  extraInput,
  type ExtraDraft,
  type FieldErrors,
} from "./drafts";
import { ActionError, DialogActionError } from "../ActionError";
import { callAction, failureOf, type ActionFailure } from "../callAction";
import { ExtraFieldsInputs } from "./ExtraFieldsInputs";
import { FeeText } from "./FeeText";
import { isOption } from "./international";

/** Lo que se edita en el diálogo: una opción nueva (`id` nulo) o una que ya existe. */
type Editing = { id: string | null; draft: ExtraDraft; active: boolean };

/** Una opción de la lista, con su interruptor de «encendida por defecto», que rige al tocarlo. */
function ExtraItem({
  gatewayId,
  dayType,
  extra,
  onEdit,
  onDelete,
}: {
  gatewayId: string;
  dayType: DayType;
  extra: ExtraCfg;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const nameId = useId();
  const [defaultOn, setDefaultOn] = useOptimistic(extra.defaultOn);
  const [error, setError] = useState<ActionFailure | null>(null);
  const [pending, startTransition] = useTransition();
  const payout =
    extra.payoutDaysOverride === null
      ? null
      : payoutText(extra.payoutDaysOverride, dayType, extra.payoutDaysOverrideMax);

  /** Rige al tocarlo. Si falla (o se corta), vuelve a como estaba y se dice debajo. */
  function toggle(next: boolean) {
    startTransition(async () => {
      setError(null);
      setDefaultOn(next);
      const result = await callAction(() =>
        saveExtra({ ...extraInput(extra), id: extra.id, gatewayId, defaultOn: next }),
      );
      if (!result.ok) setError(failureOf(result));
    });
  }

  return (
    <li className="py-3">
      <div role="group" aria-labelledby={nameId} className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <h3 id={nameId} className="font-semibold">
            {extra.name}
          </h3>
          {extra.active ? null : <Badge>Inactiva</Badge>}
        </div>
        <p className="text-sm text-ink-soft">
          <FeeText pct={extra.pct} fixed={extra.fixed} /> · {BASE_LABEL[extra.base].toLowerCase()}
          {payout === null ? null : ` · depósito: ${payout.toLowerCase()}`}
        </p>
        <Switch
          label="Encendida por defecto"
          checked={defaultOn}
          disabled={pending}
          onChange={(event) => toggle(event.currentTarget.checked)}
        />
        <ActionError failure={error} />
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" onClick={onEdit} aria-label={`Editar ${extra.name}`}>
            <Pencil aria-hidden className="size-5" />
            Editar
          </Button>
          <Button variant="ghost" onClick={onDelete} aria-label={`Borrar ${extra.name}`}>
            <Trash2 aria-hidden className="size-5" />
            Borrar
          </Button>
        </div>
      </div>
    </li>
  );
}

/**
 * Las opciones de la pasarela: agregar, editar (también activarla o no), encender por defecto y borrar. El recargo
 * internacional no es una opción más: va en su propia tarjeta y aquí no se lista.
 */
export function ExtrasCard({
  gatewayId,
  dayType,
  extras: all,
}: {
  gatewayId: string;
  /** Los días de la pasarela (hábiles o corridos): los propios de una opción se cuentan igual. */
  dayType: DayType;
  extras: ExtraCfg[];
}) {
  const extras = all.filter(isOption);
  const titleId = useId();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [errors, setErrors] = useState<FieldErrors>(undefined);
  const [formError, setFormError] = useState<ActionFailure | null>(null);
  const [removing, setRemoving] = useState<ExtraCfg | null>(null);
  const [listError, setListError] = useState<ActionFailure | null>(null);
  const [pending, startTransition] = useTransition();

  function open(next: Editing) {
    setErrors(undefined);
    setFormError(null);
    setEditing(next);
  }

  async function save() {
    if (editing === null) return;
    // Si se corta, se dice en el diálogo, que sigue abierto con lo escrito (si no, la ficha entera caería).
    const result = await callAction(() =>
      saveExtra({ ...editing.draft, id: editing.id, gatewayId, active: editing.active }),
    );
    if (!result.ok) {
      setFormError(failureOf(result));
      setErrors(result.fieldErrors);
      return;
    }
    notify.success(editing.id === null ? "Opción agregada" : "Opción guardada");
    setEditing(null);
  }

  function remove(extra: ExtraCfg) {
    startTransition(async () => {
      const result = await callAction(() => deleteExtra({ id: extra.id }));
      setRemoving(null);
      if (!result.ok) {
        setListError(failureOf(result));
        return;
      }
      setListError(null);
      notify.success("Opción borrada");
    });
  }

  return (
    <Card>
      <section aria-labelledby={titleId}>
        <CardHeader>
          <CardTitle id={titleId}>Opciones</CardTitle>
          <Button onClick={() => open({ id: null, draft: EMPTY_EXTRA, active: true })}>
            <Plus aria-hidden className="size-5" />
            Agregar opción
          </Button>
        </CardHeader>
        <CardBody className="flex flex-col gap-3">
          {extras.length === 0 ? (
            <EmptyState
              title="Sin opciones"
              description="Agrega lo que la pasarela cobra aparte si lo eliges al registrar, como un pago rápido."
            />
          ) : (
            <ul className="flex flex-col divide-y divide-rule">
              {extras.map((extra) => (
                <ExtraItem
                  key={extra.id}
                  gatewayId={gatewayId}
                  dayType={dayType}
                  extra={extra}
                  onEdit={() => open({ id: extra.id, draft: extraDraft(extra), active: extra.active })}
                  onDelete={() => {
                    setListError(null);
                    setRemoving(extra);
                  }}
                />
              ))}
            </ul>
          )}
          <ActionError failure={listError} />
        </CardBody>
      </section>

      <Dialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing?.id ? "Editar opción" : "Agregar opción"}
        description="Lo ya registrado no cambia: cada cobro guarda las opciones con las que se calculó."
      >
        {editing ? (
          <form action={save} className="flex flex-col gap-4" noValidate>
            <ExtraFieldsInputs
              value={editing.draft}
              onChange={(draft) => setEditing({ ...editing, draft })}
              errors={errors}
            />
            {editing.id ? (
              <Switch
                label="Activa"
                hint="Una opción inactiva deja de ofrecerse al registrar."
                checked={editing.active}
                onChange={(event) => setEditing({ ...editing, active: event.currentTarget.checked })}
              />
            ) : null}
            <DialogActionError failure={formError} />
            <SubmitButton className="self-end">{editing.id ? "Guardar opción" : "Agregar opción"}</SubmitButton>
          </form>
        ) : null}
      </Dialog>

      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        onConfirm={() => {
          if (removing) remove(removing);
        }}
        pending={pending}
        title="¿Borrar esta opción?"
        description={`Se borra ${removing?.name ?? "la opción"}. Si algún cobro la usó no se borra: desactívala.`}
        confirmLabel="Borrar opción"
        variant="danger"
      />
    </Card>
  );
}
