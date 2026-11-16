"use client";

import { useState, useTransition } from "react";
import { Button, Dialog, notify } from "@/components/ui";
import { deleteLoader, setLoaderActive } from "@/server/pasarelas/actions/loaders";
import { ActionError, DialogActionError } from "../ActionError";
import { callAction, failureOf, type ActionFailure } from "../callAction";
import { cobros } from "../tx/plural";
import { LoaderFormDialog, type LoaderFormValues } from "./LoaderFormDialog";

type Open = "editar" | "borrar" | null;

/** Lo que dice el diálogo de borrar: con cobros no se puede (la base no lo deja), y por qué desactivarlo basta. */
function deleteText(txCount: number, active: boolean): string {
  if (txCount === 0) return "Ningún cobro lo tiene. No se puede deshacer.";
  const head = `Tiene ${cobros(txCount)}: no se puede borrar.`;
  return active
    ? `${head} Desactívalo: deja de ofrecerse al registrar y sus cobros lo siguen mostrando.`
    : `${head} Ya está desactivado: no se ofrece al registrar y sus cobros lo siguen mostrando.`;
}

/**
 * Editar, activar o desactivar y borrar un cargador. Borrar solo se puede sin cobros (contando los de la papelera):
 * con alguno, el diálogo lo dice y ofrece desactivarlo. Si la base lo niega igual (un cobro que llegó entretanto), el
 * diálogo dice su mensaje.
 *
 * Lo que falla dentro de un diálogo se dice en el diálogo: un aviso pasajero quedaría detrás de él. Lo que falla
 * fuera (activar o desactivar sin preguntar), debajo de los botones. Si se corta, con «Ver cómo quedó».
 */
export function LoaderActions({
  id,
  active,
  txCount,
  values,
}: {
  id: string;
  active: boolean;
  txCount: number;
  values: LoaderFormValues;
}) {
  const [open, setOpen] = useState<Open>(null);
  const [dialogError, setDialogError] = useState<ActionFailure | null>(null);
  const [error, setError] = useState<ActionFailure | null>(null);
  const [pending, startTransition] = useTransition();

  const show = (next: Open) => {
    setDialogError(null);
    setError(null);
    setOpen(next);
  };

  /** Activa o desactiva. Desde el diálogo de borrar (`inDialog`), el fallo se dice en él; si no, debajo. */
  const setActive = (next: boolean, inDialog: boolean) =>
    startTransition(async () => {
      setError(null);
      const result = await callAction(() => setLoaderActive({ id, active: next }));
      if (!result.ok) {
        if (inDialog) setDialogError(failureOf(result));
        else setError(failureOf(result));
        return;
      }
      setOpen(null);
      notify.success(next ? "Cargador activado." : "Cargador desactivado.");
    });

  const remove = () =>
    startTransition(async () => {
      setDialogError(null);
      const result = await callAction(() => deleteLoader({ id }));
      if (!result.ok) {
        setDialogError(failureOf(result));
        return;
      }
      setOpen(null);
      notify.success("Cargador borrado.");
    });

  return (
    <div className="flex flex-wrap gap-2">
      <Button onClick={() => show("editar")} disabled={pending}>
        Editar
      </Button>
      <Button onClick={() => setActive(!active, false)} disabled={pending}>
        {active ? "Desactivar" : "Activar"}
      </Button>
      <Button variant="ghost" onClick={() => show("borrar")} disabled={pending}>
        Borrar
      </Button>
      <ActionError failure={error} className="basis-full" />

      <LoaderFormDialog open={open === "editar"} onClose={() => setOpen(null)} id={id} initial={values} />

      <Dialog
        open={open === "borrar"}
        onClose={() => setOpen(null)}
        role="alertdialog"
        title={`¿Borrar «${values.name}»?`}
        description={deleteText(txCount, active)}
        footer={
          <>
            <Button onClick={() => setOpen(null)} disabled={pending}>
              Cancelar
            </Button>
            {active ? (
              <Button variant={txCount > 0 ? "primary" : "secondary"} onClick={() => setActive(false, true)} disabled={pending}>
                Desactivar
              </Button>
            ) : null}
            {txCount === 0 ? (
              <Button variant="danger" onClick={remove} disabled={pending}>
                Borrar
              </Button>
            ) : null}
          </>
        }
      >
        <DialogActionError failure={dialogError} />
      </Dialog>
    </div>
  );
}
