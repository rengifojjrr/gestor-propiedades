import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Card, CardBody, CardHeader, CardTitle, EmptyState, Money, PageHeader } from "@/components/ui";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getPayConfig } from "@/server/pasarelas/queries/session-config";
import { getTx, lastTx } from "@/server/pasarelas/queries/transactions";
import { ReceiptBench, RegisterE1, type E1Selection } from "./ActionsBench";

export const metadata: Metadata = { title: "Banco de pruebas de acciones" };

/** Cómo se nombra cada tipo de comprobante en la lista. */
const TYPE_LABEL: Record<string, string> = {
  "image/jpeg": "JPG",
  "image/png": "PNG",
  "image/webp": "WebP",
  "application/pdf": "PDF",
};

/**
 * Banco de pruebas de las Server Actions y de los comprobantes desde el navegador: registra el cobro E1 con la
 * configuración del usuario, enseña el último cobro tal como quedó en la base y sube o abre comprobantes. Es una
 * herramienta de desarrollo, como la galería: en producción no existe (404) salvo en un build con PASARELAS_KIT=1.
 * No es la pantalla «Registrar cobro».
 */
export default async function AccionesPage() {
  if (process.env.NODE_ENV === "production" && process.env.PASARELAS_KIT !== "1") notFound();
  await requireSession();

  const cfg = await getPayConfig();
  const supabase = await createClient();
  const last = await lastTx(supabase);
  const detail = last === null ? null : await getTx(supabase, last.id);
  const nameOf = new Map(cfg.beneficiaries.map((beneficiary) => [beneficiary.id, beneficiary.name]));

  // E1 se arma con lo primero de la configuración: la empresa, su canal, la pasarela con sus opciones y el
  // esquema por defecto de la empresa (lo que deja `seedBasics` en las pruebas).
  const company = cfg.companies[0];
  const gateway = cfg.gateways[0];
  const selection: E1Selection | null =
    company === undefined || gateway === undefined
      ? null
      : {
          companyId: company.id,
          channelId: cfg.channels.find((channel) => channel.companyId === company.id)?.id ?? null,
          gatewayId: gateway.id,
          extraIds: gateway.extras.map((extra) => extra.id),
          schemeId: company.defaultSchemeId,
        };

  return (
    <>
      <PageHeader
        title="Banco de pruebas de acciones"
        description="Llama a las Server Actions y sube comprobantes desde el navegador. Solo para desarrollo y pruebas."
      />
      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Cobro E1</CardTitle>
          </CardHeader>
          <CardBody>
            {selection === null ? (
              <EmptyState
                title="Falta configuración"
                description="Hace falta al menos una empresa y una pasarela para registrar el cobro E1."
              />
            ) : (
              <RegisterE1 selection={selection} />
            )}
          </CardBody>
        </Card>

        <Card>
          <section aria-labelledby="ultimo-cobro">
            <CardHeader>
              <CardTitle id="ultimo-cobro">Último cobro</CardTitle>
            </CardHeader>
            <CardBody>
              {detail === null ? (
                <EmptyState title="Todavía no hay cobros." />
              ) : (
                <div className="flex flex-col gap-4">
                  <dl className="grid grid-cols-2 gap-3">
                    <div className="flex flex-col gap-1">
                      <dt className="text-sm text-ink-soft">Comisiones</dt>
                      <dd data-testid="comisiones">
                        <Money value={detail.fees} currency={detail.currency} />
                      </dd>
                    </div>
                    <div className="flex flex-col gap-1">
                      <dt className="text-sm text-ink-soft">Neto</dt>
                      <dd data-testid="neto">
                        <Money value={detail.net} currency={detail.currency} />
                      </dd>
                    </div>
                  </dl>
                  <ul className="flex flex-col gap-1">
                    {detail.allocations.map((line) => (
                      <li key={line.beneficiaryId} className="flex justify-between gap-3">
                        <span>{nameOf.get(line.beneficiaryId) ?? "Beneficiario"}</span>
                        <Money value={line.amount} currency={detail.currency} />
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </CardBody>
          </section>
        </Card>

        <ReceiptBench
          key={detail?.id ?? "sin-cobro"}
          transactionId={detail?.id ?? null}
          receipts={(detail?.receipts ?? []).map((receipt, index) => ({
            id: receipt.id,
            label: `Comprobante ${index + 1} · ${TYPE_LABEL[receipt.mime] ?? receipt.mime}`,
          }))}
        />
      </div>
    </>
  );
}
