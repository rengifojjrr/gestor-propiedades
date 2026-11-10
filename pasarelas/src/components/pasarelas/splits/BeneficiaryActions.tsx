"use client";

import { useState, useTransition } from "react";
import { Alert, Button, Dialog, notify } from "@/components/ui";
import { deleteBeneficiary, setBeneficiaryActive } from "@/server/pasarelas/actions/splits";
import { BeneficiaryFormDialog, type BeneficiaryFormValues } from "./BeneficiaryFormDialog";

/**
 * Editar, activar o desactivar y borrar un beneficiario. Borrar pregunta antes y ofrece desactivarlo: uno con
 * repartos, liquidaciones o en un esquema no se borra (lo dice la base y se enseña aquí mismo).
 *
 * Cada lugar enseña sus propios fallos: lo que falla desde la cabecera se pinta bajo los botones, y lo que falla
 * dentro del diálogo de borrar, en el diálogo. Así ninguno queda tragado ni aparece después en el otro.
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
  const [error, setError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  /** Activa o desactiva; `report` dice dónde se enseña el fallo (la cabecera o el diálogo de borrar). */
  const setActive = (next: boolean, report: (message: string | null) => void) => {
    report(null);
    startTransition(async () => {
      const result = await setBeneficiaryActive({ id, active: next });
      if (!result.ok) {
        report(result.error);
        return;
      }
      setDeleting(false);
      notify.success(next ? "Beneficiario activado." : "Beneficiario desactivado.");
    });
  };

  const remove = () => {
    setDeleteError(null);
    startTransition(async () => {
      // Si sale bien, la acción lleva a Repartos: esta ficha ya no existe.
      const result = await deleteBeneficiary({ id });
      if (!result.ok) setDeleteError(result.error);
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
      {error ? (
        <Alert tone="danger" announce className="basis-full">
          {error}
        </Alert>
      ) : null}

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
        {deleteError ? (
          <Alert tone="danger" announce>
            {deleteError}
          </Alert>
        ) : active ? (
          <p className="text-sm text-ink-soft">
            Si ya no le repartes, desactívalo: deja de ofrecerse en esquemas nuevos y conserva su historia.
          </p>
        ) : null}
      </Dialog>
    </>
  );
}
