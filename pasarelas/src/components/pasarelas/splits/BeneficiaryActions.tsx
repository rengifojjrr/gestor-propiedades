"use client";

import { useState, useTransition } from "react";
import { Alert, Button, Dialog, notify } from "@/components/ui";
import { deleteBeneficiary, setBeneficiaryActive } from "@/server/pasarelas/actions/splits";
import { BeneficiaryFormDialog, type BeneficiaryFormValues } from "./BeneficiaryFormDialog";

/**
 * Editar, activar o desactivar y borrar un beneficiario. Borrar pregunta antes y ofrece desactivarlo: uno con
 * repartos, liquidaciones o en un esquema no se borra (lo dice la base y se enseña aquí mismo).
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
  const [pending, startTransition] = useTransition();

  const setActive = (next: boolean) =>
    startTransition(async () => {
      const result = await setBeneficiaryActive({ id, active: next });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setDeleting(false);
      notify.success(next ? "Beneficiario activado." : "Beneficiario desactivado.");
    });

  const remove = () =>
    startTransition(async () => {
      // Si sale bien, la acción lleva a Repartos: esta ficha ya no existe.
      const result = await deleteBeneficiary({ id });
      if (!result.ok) setError(result.error);
    });

  const closeDelete = () => {
    setDeleting(false);
    setError(null);
  };

  return (
    <>
      <Button onClick={() => setEditing(true)} disabled={pending}>
        Editar
      </Button>
      <Button onClick={() => setActive(!active)} disabled={pending}>
        {active ? "Desactivar" : "Activar"}
      </Button>
      <Button variant="ghost" onClick={() => setDeleting(true)} disabled={pending}>
        Borrar
      </Button>

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
              <Button onClick={() => setActive(false)} disabled={pending}>
                Desactivar
              </Button>
            ) : null}
            <Button variant="danger" onClick={remove} disabled={pending}>
              Borrar
            </Button>
          </>
        }
      >
        {error ? (
          <Alert tone="danger" announce>
            {error}
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
