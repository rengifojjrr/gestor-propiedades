import Link from "next/link";
import type { ReactNode } from "react";
import { Alert } from "@/components/ui";
import { cobros } from "@/components/pasarelas/tx/plural";
import type { SummaryNotices } from "@/server/pasarelas/queries/summary";

const HEADING_ID = "resumen-avisos";
const LINK = "flex min-h-11 w-fit items-center font-semibold text-brand hover:underline";

/** Un aviso con su enlace: a la lista que muestra exactamente esos cobros, o a donde se resuelve. */
function NoticeItem({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <li>
      <Alert tone="warning" title={title}>
        {children}
      </Alert>
    </li>
  );
}

/**
 * Lo que pide atención: cobros atrasados, disputas abiertas, cobros del período sin comprobante, empresas sin
 * esquema de reparto activo por defecto y el año en curso o el siguiente sin feriados. Sin nada que avisar, lo dice.
 */
export function Notices({ notices }: { notices: SummaryNotices }) {
  const { overdue, disputes, withoutReceipt, companiesWithoutScheme, yearsWithoutHolidays } = notices;
  const empty =
    overdue === null &&
    disputes === null &&
    withoutReceipt === null &&
    companiesWithoutScheme.length === 0 &&
    yearsWithoutHolidays.length === 0;
  return (
    <section aria-labelledby={HEADING_ID} className="flex flex-col gap-3">
      <h2 id={HEADING_ID} className="titulo text-xl">
        Avisos
      </h2>
      {empty ? (
        <p className="text-ink-soft">Nada pendiente: no hay atrasos, disputas abiertas ni cobros sin comprobante.</p>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {overdue === null ? null : (
            <NoticeItem title={`${cobros(overdue.count)} ${overdue.count === 1 ? "atrasado" : "atrasados"}`}>
              Ya pasó su fecha estimada y no están marcados como depositados.
              <Link href={overdue.href} className={LINK}>
                Ver los atrasados
              </Link>
            </NoticeItem>
          )}
          {disputes === null ? null : (
            <NoticeItem title={`${cobros(disputes.count)} con la disputa abierta`}>
              La pasarela retiene ese dinero hasta que se resuelva.
              <Link href={disputes.href} className={LINK}>
                Ver las disputas
              </Link>
            </NoticeItem>
          )}
          {withoutReceipt === null ? null : (
            <NoticeItem title={`${cobros(withoutReceipt.count)} del período sin comprobante`}>
              Agrégale el comprobante a cada uno desde su detalle.
              <Link href={withoutReceipt.href} className={LINK}>
                Ver cuáles
              </Link>
            </NoticeItem>
          )}
          {companiesWithoutScheme.length === 0 ? null : (
            <NoticeItem
              title={
                companiesWithoutScheme.length === 1
                  ? "Una empresa sin esquema de reparto activo por defecto"
                  : `${companiesWithoutScheme.length} empresas sin esquema de reparto activo por defecto`
              }
            >
              Sus cobros nuevos no se reparten si no eliges un esquema al registrarlos. Un esquema desactivado ya no
              se ofrece al registrar.
              <span className="flex flex-wrap gap-x-4">
                {companiesWithoutScheme.map((company) => (
                  <Link key={company.id} href={`/pasarelas/empresas/${company.id}`} className={LINK}>
                    {company.schemeInactive ? `${company.name} (su esquema está desactivado)` : company.name}
                  </Link>
                ))}
              </span>
            </NoticeItem>
          )}
          {yearsWithoutHolidays.map((year) => (
            <NoticeItem key={year} title={`Faltan los feriados de ${year}`}>
              Sin ellos, las fechas estimadas de ese año cuentan los feriados como días hábiles.
              <Link href={`/pasarelas/feriados?anio=${year}`} className={LINK}>
                Cargar los feriados de {year}
              </Link>
            </NoticeItem>
          ))}
        </ul>
      )}
    </section>
  );
}
