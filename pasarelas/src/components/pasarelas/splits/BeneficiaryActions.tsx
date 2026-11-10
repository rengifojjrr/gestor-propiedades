"use client";

import { useState, useTransition } from "react";
import { Button, Dialog, notify } from "@/components/ui";
import { deleteBeneficiary, setBeneficiaryActive } from "@/server/pasarelas/actions/splits";
import { ActionError, DialogActionError } from "../ActionError";
import { callAction, failureOf, type ActionFailure } from "../callAction";
import { BeneficiaryFormDialog, type BeneficiaryFormValues } from "./BeneficiaryFormDialog";

/**
 * Editar, activar o desactivar y borrar un beneficiario. Borrar pregunta antes y ofrece desactivarlo: uno con
 * repartos, liquidaciones o en un esquema no se borra (lo dice la base y se enseña aquí mismo).
 *
 * Cada lugar enseña sus propios fallos: lo que falla desde la cabecera se pinta bajo los botones, y lo que falla
 * dentro del diálogo de borrar, en el diálogo. Así ninguno queda tragado ni aparece después en el otro. Si se
 * corta la red, con «Ver cómo quedó»; cerrar el diálogo con esa duda vuelve a pintar la ficha.
 */
export function BeneficiaryActions({
  id,
  active,
  values,
}: {
  id: string;
  active: boolean;
  values: BeneficiaryFormValues;
}) {
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<ActionFailure | null>(null);
  const [deleteError, setDeleteError] = useState<ActionFailure | null>(null);
  const [pending, startTransition] = useTransition();

  /** Activa o desactiva; `report` dice dónde se enseña el fallo (la cabecera o el diálogo de borrar). */
  const setActive = (next: boolean, report: (failure: ActionFailure | null) => void) => {
    report(null);
    startTransition(async () => {
      const result = await callAction(() => setBeneficiaryActive({ id, active: next }));
      if (!result.ok) {
        report(failureOf(result));
        return;
      }
      setDeleting(false);
      notify.success(next ? "Beneficiario activado." : "Beneficiario desactivado.");
    });
  };

  const remove = () => {
    setDeleteError(null);
    startTransition(async () => {
      // Si sale bien, la acción lleva a Repartos (`callAction` deja pasar la redirección): esta ficha ya no existe.
      const result = await callAction(() => deleteBeneficiary({ id }));
      if (!result.ok) setDeleteError(failureOf(result));
    });
  };

  const openDelete = () => {
    setError(null);
    setDeleteError(null);
    setDeleting(true);
  };

  const closeDelete = () => {
    setDeleting(false);
    setDeleteError(null);
  };

  return (
    <>
      <Button onClick={() => setEditing(true)} disabled={pending}>
        Editar
      </Button>
      <Button onClick={() => setActive(!active, setError)} disabled={pending}>
        {active ? "Desactivar" : "Activar"}
      </Button>
      <Button variant="ghost" onClick={openDelete} disabled={pending}>
        Borrar
      </Button>
      <ActionError failure={error} className="basis-full" />

      <BeneficiaryFormDialog open={editing} onClose={() => setEditing(false)} id={id} initial={values} />

      <Dialog
        open={deleting}
        onClose={closeDelete}
        role="alertdialog"
        title={`¿Borrar «${values.name}»?`}
        description="Solo se puede borrar si no tiene repartos ni liquidaciones y no está en ningún esquema. No se puede deshacer."
        footer={
          <>
            <Button onClick={closeDelete} disabled={pending}>
              Cancelar
            </Button>
            {active ? (
              <Button onClick={() => setActive(false, setDeleteError)} disabled={pending}>
                Desactivar
              </Button>
            ) : null}
            <Button variant="danger" onClick={remove} disabled={pending}>
              Borrar
            </Button>
          </>
        }
      >
        <DialogActionError failure={deleteError} />
        {deleteError === null && active ? (
          <p className="text-sm text-ink-soft">
            Si ya no le repartes, desactívalo: deja de ofrecerse en esquemas nuevos y conserva su historia.
          </p>
        ) : null}
      </Dialog>
    </>
  );
}
