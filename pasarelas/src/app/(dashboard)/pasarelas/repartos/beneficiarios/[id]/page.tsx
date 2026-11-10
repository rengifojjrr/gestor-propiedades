import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BalanceFigures } from "@/components/pasarelas/splits/BalanceList";
import { BeneficiaryActions } from "@/components/pasarelas/splits/BeneficiaryActions";
import { KIND_LABEL } from "@/components/pasarelas/splits/labels";
import { AllocationMovements, SettlementMovements } from "@/components/pasarelas/splits/Movements";
import { SettlementForm } from "@/components/pasarelas/splits/SettlementForm";
import { Badge, Card, CardBody, CardHeader, CardTitle, PageHeader } from "@/components/ui";
import { requireSession } from "@/lib/auth/session";
import { isZero, todayNY } from "@/lib/pasarelas";
import { createClient } from "@/lib/supabase/server";
import { listSettlements } from "@/server/pasarelas/queries/settlements";
import {
  MOVEMENTS_PAGE_SIZE,
  getBeneficiary,
  listBalances,
  listBeneficiaryAllocations,
} from "@/server/pasarelas/queries/splits";
import { getPayConfig } from "@/server/pasarelas/queries/session-config";
import { zId } from "@/server/pasarelas/zod";

export const metadata: Metadata = { title: "Beneficiario" };

/** La página pedida en la URL (`?repartos=2`): un entero desde 1; cualquier otra cosa es la primera. */
function pageParam(value: string | string[] | undefined): number {
  const page = Number(typeof value === "string" ? value : undefined);
  return Number.isInteger(page) && page >= 1 ? page : 1;
}

/**
 * La ficha de un beneficiario: su saldo por moneda, «Registrar liquidación», y sus movimientos (cada reparto con su
 * cobro y cada liquidación con su comprobante), cada lista con sus páginas.
 */
export default async function BeneficiarioPage({
  params,
  searchParams,
}: PageProps<"/pasarelas/repartos/beneficiarios/[id]">) {
  await requireSession();
  const parsed = zId.safeParse((await params).id);
  if (!parsed.success) notFound();
  const query = await searchParams;
  const allocationsPage = pageParam(query.repartos);
  const settlementsPage = pageParam(query.liquidaciones);
  const supabase = await createClient();
  const [beneficiary, cfg, balances, allocations, settlements] = await Promise.all([
    getBeneficiary(supabase, parsed.data),
    getPayConfig(),
    listBalances(supabase, parsed.data),
    listBeneficiaryAllocations(supabase, parsed.data, allocationsPage),
    listSettlements(supabase, parsed.data, settlementsPage),
  ]);
  if (beneficiary === null) notFound();

  const companyName = (id: string) => cfg.companies.find((c) => c.id === id)?.name ?? "Empresa borrada";
  // La moneda que se propone al liquidar: la de un saldo pendiente; si no hay, la del primer movimiento.
  const defaultCurrency =
    balances.find((row) => !isZero(row.balance))?.currency ?? balances[0]?.currency ?? "USD";
  const details = [KIND_LABEL[beneficiary.kind], beneficiary.accountAlias].filter(Boolean).join(" · ");

  return (
    <>
      <PageHeader
        title={beneficiary.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {details}
            {beneficiary.active ? null : <Badge>Inactivo</Badge>}
          </span>
        }
        back={{ href: "/pasarelas/repartos", label: "Repartos" }}
        actions={
          <BeneficiaryActions
            id={beneficiary.id}
            active={beneficiary.active}
            values={{
              name: beneficiary.name,
              kind: beneficiary.kind,
              accountAlias: beneficiary.accountAlias ?? "",
              notes: beneficiary.notes ?? "",
            }}
          />
        }
      />
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <section aria-labelledby="beneficiario-saldo">
              <CardHeader>
                <CardTitle id="beneficiario-saldo">Saldo</CardTitle>
              </CardHeader>
              <CardBody className="flex flex-col gap-3">
                {balances.length === 0 ? (
                  <p className="text-ink-soft">Todavía no tiene repartos ni liquidaciones.</p>
                ) : (
                  <BalanceFigures rows={balances} />
                )}
                {beneficiary.notes ? <p className="text-sm break-words text-ink-soft">{beneficiary.notes}</p> : null}
              </CardBody>
            </section>
          </Card>
          <SettlementForm
            beneficiaryId={beneficiary.id}
            defaultCurrency={defaultCurrency}
            today={todayNY(new Date())}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <AllocationMovements
            rows={allocations.rows}
            total={allocations.total}
            page={allocationsPage}
            pageSize={MOVEMENTS_PAGE_SIZE}
            companyName={companyName}
          />
          <SettlementMovements
            rows={settlements.rows}
            total={settlements.total}
            page={settlementsPage}
            pageSize={MOVEMENTS_PAGE_SIZE}
          />
        </div>
      </div>
    </>
  );
}
