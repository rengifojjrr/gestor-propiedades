"use client";

import { Power, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { Button, ConfirmDialog, Dialog, notify } from "@/components/ui";
import { companiesWithDefaultScheme } from "@/server/pasarelas/actions/companies";
import { deleteScheme, setSchemeActive } from "@/server/pasarelas/actions/splits";
import { ActionError, DialogActionError } from "../ActionError";
import { callAction, failureOf, type ActionFailure } from "../callAction";

/**
 * Activar o desactivar el esquema, y borrarlo. Un esquema con cobros no se borra (la base no deja): se desactiva,
 * y deja de ofrecerse al registrar sin tocar lo ya repartido.
 *
 * Antes de desactivarlo se pregunta qué empresas lo tienen por defecto: si hay alguna, se nombran y se pide
 * confirmación, porque sus cobros nuevos se quedarían sin reparto. Lo que falla dentro de ese diálogo se dice en él.
 * Si se corta, se dice ahí mismo, con «Ver cómo quedó».
 */
export function SchemeStatusActions({ id, name, active }: { id: string; name: string; active: boolean }) {
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<ActionFailure | null>(null);
  /** Las empresas que lo tienen por defecto, mientras se confirma desactivarlo. */
  const [users, setUsers] = useState<string[] | null>(null);
  const [usersError, setUsersError] = useState<ActionFailure | null>(null);

  async function applyActive(next: boolean, report: (failure: ActionFailure) => void) {
    const result = await callAction(() => setSchemeActive({ id, active: next }));
    if (!result.ok) {
      report(failureOf(result));
      return;
    }
    setUsers(null);
    notify.success(next ? "Esquema activado" : "Esquema desactivado");
  }

  function toggle() {
    setError(null);
    startTransition(async () => {
      if (active) {
        // Solo lee: si se corta, no hay ninguna duda de si se guardó algo.
        const found = await callAction(
          () => companiesWithDefaultScheme({ schemeId: id }),
          "No se pudo comprobar qué empresas lo usan por un fallo de conexión. Inténtalo de nuevo.",
        );
        if (!found.ok) {
          setError({ text: found.error, unsure: false });
          return;
        }
        if (found.data.length > 0) {
          setUsersError(null);
          setUsers(found.data);
          return;
        }
      }
      await applyActive(!active, setError);
    });
  }

  function confirmDeactivate() {
    setUsersError(null);
    startTransition(() => applyActive(false, setUsersError));
  }

  function remove() {
    startTransition(async () => {
      // Si sale bien, la acción lleva a Repartos: esta página ya no existe.
      const result = await callAction(() => deleteScheme({ id }));
      setConfirming(false);
      if (!result.ok) setError(failureOf(result));
    });
  }

  const one = users?.length === 1;

  return (
    <>
      <Button onClick={toggle} disabled={pending}>
        <Power aria-hidden className="size-5" />
        {active ? "Desactivar" : "Activar"}
      </Button>
      <Button
        onClick={() => {
          setError(null);
          setConfirming(true);
        }}
        disabled={pending}
      >
        <Trash2 aria-hidden className="size-5" />
        Borrar esquema
      </Button>
      <ActionError failure={error} className="basis-full" />
      <Dialog
        open={users !== null}
        onClose={() => setUsers(null)}
        role="alertdialog"
        title={`¿Desactivar «${name}»?`}
        description={
          one ? `Es el esquema por defecto de ${users?.[0]}.` : `Es el esquema por defecto de ${users?.length} empresas:`
        }
        footer={
          <>
            <Button onClick={() => setUsers(null)} disabled={pending}>
              Cancelar
            </Button>
            <Button variant="primary" onClick={confirmDeactivate} disabled={pending}>
              Desactivar
            </Button>
          </>
        }
      >
        {one ? null : (
          <ul className="list-disc pl-5">
            {users?.map((company) => (
              <li key={company} className="break-words">
                {company}
              </li>
            ))}
          </ul>
        )}
        <p className="text-sm text-ink-soft">
          Desactivado deja de ofrecerse al registrar: los cobros nuevos de {one ? "esa empresa" : "esas empresas"}{" "}
          quedarán sin reparto hasta que {one ? "le" : "les"} elijas otro esquema o lo vuelvas a activar. Lo ya
          repartido no cambia.
        </p>
        <DialogActionError failure={usersError} />
      </Dialog>
      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={remove}
        pending={pending}
        title="¿Borrar este esquema?"
        description={`Se borran ${name} y todas sus versiones; la empresa que lo tenía por defecto queda sin esquema. No se puede deshacer. Si algún cobro lo usa no se borra: desactívalo.`}
        confirmLabel="Borrar esquema"
        variant="danger"
      />
    </>
  );
}
