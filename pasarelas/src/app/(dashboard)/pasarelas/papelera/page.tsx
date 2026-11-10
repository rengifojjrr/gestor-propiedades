import { Trash2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { EmptyTrashButton, TrashRowActions } from "@/components/pasarelas/tx/TrashActions";
import { ButtonLink, DateText, DateTimeText, EmptyState, Money, PageHeader, Pagination } from "@/components/ui";
import { requireSession } from "@/lib/auth/session";
import { formatDate, formatMoney, todayNY } from "@/lib/pasarelas";
import { createClient } from "@/lib/supabase/server";
import { getPayConfig } from "@/server/pasarelas/queries/session-config";
import { leanTx, listTx, parseTxFilters, type TxFilters } from "@/server/pasarelas/queries/transactions";

export const metadata: Metadata = { title: "Papelera" };

const PAGE_SIZE = 50;
const TRASH: TxFilters = { trashed: true };

/**
 * La papelera: los cobros borrados, de 50 en 50. Cada uno se restaura o se borra del todo (con sus comprobantes);
 * «Vaciar la papelera» borra todos. Lo que está aquí no cuenta en ningún total.
 */
export default async function PapeleraPage({ searchParams }: PageProps<"/pasarelas/papelera">) {
  await requireSession();
  const today = todayNY(new Date());
  const { page } = parseTxFilters(await searchParams, today);
  const [supabase, cfg] = await Promise.all([createClient(), getPayConfig()]);
  const [list, all] = await Promise.all([
    listTx(supabase, TRASH, "fecha_desc", page, today, PAGE_SIZE, cfg),
    leanTx(supabase, TRASH, today, cfg),
  ]);
  const names = (items: readonly { id: string; name: string }[]) => new Map(items.map((item) => [item.id, item.name]));
  const companies = names(cfg.companies);
  const gateways = names(cfg.gateways);
  const first = (page - 1) * PAGE_SIZE + 1;

  return (
    <>
      <PageHeader
        title="Papelera"
        description="Los cobros borrados no cuentan en ningún total. Restáuralos o bórralos del todo."
        actions={all.length > 0 ? <EmptyTrashButton ids={all.map((tx) => tx.id)} /> : null}
      />
      {list.total === 0 ? (
        <EmptyState
          icon={<Trash2 aria-hidden className="size-8" />}
          title="La papelera está vacía"
          description="Lo que envíes a la papelera queda aquí hasta que lo restaures o lo borres del todo."
          action={<ButtonLink href="/pasarelas/cobros">Ir a Cobros</ButtonLink>}
        />
      ) : list.rows.length === 0 ? (
        <EmptyState
          title="Esta página ya no tiene cobros"
          description="La papelera tiene menos páginas. Vuelve a la primera."
          action={<ButtonLink href="/pasarelas/papelera">Ir a la primera página</ButtonLink>}
        />
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-ink-soft">
            Cobros {first}–{first + list.rows.length - 1} de {list.total}
          </p>
          <ul aria-label="Cobros en la papelera" className="flex flex-col gap-2">
            {list.rows.map((tx) => {
              const label =
                tx.reference ?? `del ${formatDate(tx.occurredOn)} por ${formatMoney(tx.grossOriginal, tx.currency)}`;
              return (
                <li
                  key={tx.id}
                  className="flex flex-col gap-3 rounded-card border border-rule bg-surface p-3 md:flex-row md:items-center md:justify-between"
                >
                  <div className="flex min-w-0 flex-col gap-1">
                    <div className="flex items-baseline justify-between gap-3 md:justify-start">
                      <Link
                        href={`/pasarelas/cobros/${tx.id}`}
                        className="inline-flex min-h-11 min-w-0 items-center font-semibold break-all text-brand hover:underline"
                      >
                        {tx.reference ?? "Ver cobro"}
                        {tx.reference === null ? <span className="sr-only"> {label}</span> : null}
                      </Link>
                      <Money value={tx.grossOriginal} currency={tx.currency} className="text-lg font-semibold" />
                    </div>
                    <p className="text-sm text-ink-soft">
                      <DateText value={tx.occurredOn} /> · {companies.get(tx.companyId) ?? "—"} ·{" "}
                      {gateways.get(tx.gatewayId) ?? "—"}
                      {tx.receiptsCount > 0
                        ? ` · ${tx.receiptsCount} ${tx.receiptsCount === 1 ? "comprobante" : "comprobantes"}`
                        : null}
                    </p>
                    {tx.deletedAt === null ? null : (
                      <p className="text-sm text-ink-soft">
                        En la papelera desde <DateTimeText value={tx.deletedAt} />
                      </p>
                    )}
                  </div>
                  <TrashRowActions id={tx.id} label={label} />
                </li>
              );
            })}
          </ul>
          <Suspense fallback={null}>
            <Pagination page={page} pageSize={PAGE_SIZE} total={list.total} />
          </Suspense>
        </div>
      )}
    </>
  );
}
