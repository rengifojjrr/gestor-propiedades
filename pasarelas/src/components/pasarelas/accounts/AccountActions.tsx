"use client";

import { useState, useTransition } from "react";
import { Button, Dialog, notify } from "@/components/ui";
import { deleteBankAccount, setBankAccountActive } from "@/server/pasarelas/actions/accounts";
import { AccountFormDialog, type AccountFormValues } from "./AccountFormDialog";

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Lo que el borrado cambia, dicho en claro: cuántos cobros y cuentas de pasarela se quedan sin cuenta. */
function usageText(txCount: number, gatewayCount: number): string {
  const users = [
    txCount > 0 ? count(txCount, "cobro", "cobros") : null,
    gatewayCount > 0 ? count(gatewayCount, "cuenta de pasarela", "cuentas de pasarela") : null,
  ].filter((part) => part !== null);
  if (users.length === 0) return "Ningún cobro la usa.";
  const total = txCount + gatewayCount;
  return `${users.join(" y ")} ${total === 1 ? "la usa: quedará" : "la usan: quedarán"} sin cuenta destino, y eso cambia su historial.`;
}

/** Editar, activar o desactivar y borrar una cuenta. Borrar pregunta antes y ofrece desactivarla. */
export function AccountActions({
  id,
  active,
  values,
  txCount,
  gatewayCount,
}: {
  id: string;
  active: boolean;
  values: AccountFormValues;
  txCount: number;
  gatewayCount: number;
}) {
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [pending, startTransition] = useTransition();

  const setActive = (next: boolean) =>
    startTransition(async () => {
      const result = await setBankAccountActive({ id, active: next });
      if (!result.ok) {
        notify.error(result.error);
        return;
      }
      setDeleting(false);
      notify.success(next ? "Cuenta activada." : "Cuenta desactivada.");
    });

  const remove = () =>
    startTransition(async () => {
      const result = await deleteBankAccount({ id });
      if (!result.ok) {
        notify.error(result.error);
        return;
      }
      setDeleting(false);
      notify.success("Cuenta borrada.");
    });

  return (
    <div className="flex flex-wrap gap-2">
      <Button onClick={() => setEditing(true)} disabled={pending}>
        Editar
      </Button>
      <Button onClick={() => setActive(!active)} disabled={pending}>
        {active ? "Desactivar" : "Activar"}
      </Button>
      <Button variant="ghost" onClick={() => setDeleting(true)} disabled={pending}>
        Borrar
      </Button>

      <AccountFormDialog open={editing} onClose={() => setEditing(false)} id={id} initial={values} />

      <Dialog
        open={deleting}
        onClose={() => setDeleting(false)}
        role="alertdialog"
        title={`¿Borrar «${values.alias}»?`}
        description={`${usageText(txCount, gatewayCount)} No se puede deshacer.`}
        footer={
          <>
            <Button onClick={() => setDeleting(false)} disabled={pending}>
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
        {active ? (
          <p className="text-sm text-ink-soft">
            Si ya no la usas, desactívala: deja de ofrecerse para cobros nuevos y lo registrado la conserva.
          </p>
        ) : null}
      </Dialog>
    </div>
  );
}
