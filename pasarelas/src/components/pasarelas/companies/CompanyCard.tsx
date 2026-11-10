"use client";

import { unstable_rethrow } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { Button, Card, CardBody, CardHeader, CardTitle, ConfirmDialog, Dialog, Switch, notify } from "@/components/ui";
import { deleteCompany, setCompanyActive } from "@/server/pasarelas/actions/companies";
import type { ActionResult } from "@/server/pasarelas/result";
import { CompanyForm, type CompanyFormValues } from "./CompanyForm";
import { ExternalLink } from "./ExternalLink";
import { LogoEditor } from "./LogoEditor";

const NETWORK_TEXT = "No se pudo guardar. Revisa tu conexión e inténtalo de nuevo.";

export type CompanyCardProps = {
  company: { id: string; active: boolean } & CompanyFormValues;
  /** La URL firmada del logo, o `null`. */
  logoUrl: string | null;
  /** El nombre del esquema por defecto, o `null` si no tiene. */
  schemeName: string | null;
  /** Los esquemas que se pueden elegir al editar. */
  schemes: readonly { id: string; name: string }[];
};

/**
 * Lo que devuelve una acción, o el error de red si la llamada no llegó. La redirección de una acción también llega
 * como un error: esa se deja pasar, para que Next la siga.
 */
async function call(action: () => Promise<ActionResult>): Promise<ActionResult> {
  try {
    return await action();
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, error: NETWORK_TEXT };
  }
}

/** La web sin `https://` ni la barra final: lo que se lee en el enlace. */
const shortUrl = (url: string) => url.replace(/^https?:\/\//i, "").replace(/\/$/, "");

/** La ficha de la empresa: logo, web, moneda, esquema y notas; editarla, activarla o desactivarla y borrarla. */
export function CompanyCard({ company, logoUrl, schemeName, schemes }: CompanyCardProps) {
  const titleId = useId();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [removing, startRemove] = useTransition();
  const busy = toggling || removing;

  async function toggle(active: boolean) {
    setToggling(true);
    const result = await call(() => setCompanyActive({ id: company.id, active }));
    setToggling(false);
    if (result.ok) notify.success(active ? "Empresa activada" : "Empresa desactivada");
    else notify.error(result.error);
  }

  // Dentro de una transición: si sale bien, la acción lleva a la lista y Next sigue esa redirección.
  function remove() {
    startRemove(async () => {
      const result = await call(() => deleteCompany({ id: company.id }));
      setConfirming(false);
      if (!result.ok) notify.error(result.error);
    });
  }

  return (
    <Card>
      <section aria-labelledby={titleId}>
        <CardHeader>
          <CardTitle id={titleId}>Ficha</CardTitle>
          <Button onClick={() => setEditing(true)}>Editar ficha</Button>
        </CardHeader>
        <CardBody className="flex flex-col gap-4">
          <LogoEditor companyId={company.id} name={company.name} url={logoUrl} />
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
            <div className="min-w-0">
              <dt className="text-sm text-ink-soft">Web</dt>
              <dd>
                {company.website ? (
                  <ExternalLink href={company.website} appearance="text">
                    {shortUrl(company.website)}
                  </ExternalLink>
                ) : (
                  <span className="text-ink-soft">Sin web</span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-ink-soft">Moneda</dt>
              <dd className="font-semibold">{company.currency}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-sm text-ink-soft">Esquema de reparto por defecto</dt>
              <dd className={schemeName ? "font-semibold" : "text-ink-soft"}>{schemeName ?? "Sin esquema"}</dd>
            </div>
            {company.notes ? (
              <div className="min-w-0 sm:col-span-2">
                <dt className="text-sm text-ink-soft">Notas</dt>
                <dd className="whitespace-pre-line">{company.notes}</dd>
              </div>
            ) : null}
          </dl>
          <Switch
            label="Activa"
            hint="Una empresa inactiva no se ofrece al registrar cobros; lo que ya cobró sigue contando."
            checked={company.active}
            disabled={busy}
            onChange={(event) => void toggle(event.currentTarget.checked)}
          />
          <Button variant="danger" className="self-start" disabled={busy} onClick={() => setConfirming(true)}>
            Borrar empresa
          </Button>
        </CardBody>
      </section>

      <Dialog open={editing} onClose={() => setEditing(false)} title="Editar ficha">
        <CompanyForm company={company} schemes={schemes} onSaved={() => setEditing(false)} />
      </Dialog>
      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={remove}
        title={`¿Borrar «${company.name}»?`}
        description="Se borran la empresa, sus canales, sus pasarelas y su logo, y no se puede deshacer. Si ya tiene cobros no se puede borrar: desactívala."
        confirmLabel="Borrar empresa"
        variant="danger"
        pending={busy}
      />
    </Card>
  );
}
