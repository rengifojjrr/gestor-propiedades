import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { AddHolidayForm } from "@/components/pasarelas/holidays/AddHolidayForm";
import { DeleteHolidayButton } from "@/components/pasarelas/holidays/DeleteHolidayButton";
import { LoadUsHolidaysButton } from "@/components/pasarelas/holidays/LoadUsHolidaysButton";
import {
  Alert,
  ButtonLink,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  DateText,
  EmptyState,
  PageHeader,
} from "@/components/ui";
import { requireSession } from "@/lib/auth/session";
import { todayNY } from "@/lib/pasarelas";
import { createClient } from "@/lib/supabase/server";
import { ensureHolidays } from "@/server/pasarelas/queries/config";
import {
  MAX_YEAR,
  MIN_YEAR,
  listHolidays,
  parseYear,
  yearsWithoutHolidays,
} from "@/server/pasarelas/queries/holidays";

export const metadata: Metadata = { title: "Feriados" };

const yearHref = (year: number) => `/pasarelas/feriados?anio=${year}`;

/** Feriados por año (el año va en la URL): agregar, quitar y cargar los bancarios de EE. UU. */
export default async function FeriadosPage({ searchParams }: PageProps<"/pasarelas/feriados">) {
  await requireSession();
  const supabase = await createClient();
  // La primera vez se siembran los feriados de siempre, igual que en el resto de la app (`getPayConfig`): esta
  // pantalla enseña los mismos que usan las fechas estimadas.
  await ensureHolidays(supabase);

  const thisYear = Number(todayNY(new Date()).slice(0, 4));
  const year = parseYear((await searchParams).anio, thisYear);
  const [holidays, missing] = await Promise.all([
    listHolidays(supabase, year),
    yearsWithoutHolidays(supabase, [thisYear, thisYear + 1]),
  ]);
  const listTitle = `Feriados de ${year}`;
  /** Los años sin feriados que no son el que se está viendo: a esos se llega con un enlace. */
  const otherMissing = missing.filter((missingYear) => missingYear !== year);

  return (
    <>
      <PageHeader
        title="Feriados"
        description="Los días sin movimiento bancario. Al estimar un depósito en días hábiles, se saltan."
      />
      <div className="flex flex-col gap-6">
        {missing.length > 0 ? (
          <Alert tone="warning" title={`Faltan los feriados de ${missing.join(" y ")}`}>
            <p>Sin ellos, las fechas estimadas de depósito de ese año no saltan ningún feriado.</p>
            {otherMissing.length > 0 ? (
              <p className="mt-1 flex flex-wrap gap-x-4">
                {otherMissing.map((missingYear) => (
                  <Link key={missingYear} href={yearHref(missingYear)} className="font-semibold text-brand underline">
                    Ver {missingYear}
                  </Link>
                ))}
              </p>
            ) : null}
          </Alert>
        ) : null}

        <Card>
          <section aria-labelledby="feriados-del-anio">
            <CardHeader>
              <div className="flex min-w-0 flex-col">
                <CardTitle id="feriados-del-anio">{listTitle}</CardTitle>
                <p className="text-sm text-ink-soft">
                  {holidays.length === 1 ? "1 feriado" : `${holidays.length} feriados`}
                </p>
              </div>
              <nav aria-label="Cambiar de año" className="flex gap-2">
                {year > MIN_YEAR ? (
                  <ButtonLink href={yearHref(year - 1)} aria-label={`Año anterior: ${year - 1}`}>
                    <ChevronLeft aria-hidden className="size-5" />
                    {year - 1}
                  </ButtonLink>
                ) : null}
                {year < MAX_YEAR ? (
                  <ButtonLink href={yearHref(year + 1)} aria-label={`Año siguiente: ${year + 1}`}>
                    {year + 1}
                    <ChevronRight aria-hidden className="size-5" />
                  </ButtonLink>
                ) : null}
              </nav>
            </CardHeader>
            <CardBody className="flex flex-col gap-4">
              {holidays.length === 0 ? (
                <EmptyState
                  icon={<CalendarDays aria-hidden className="size-8" />}
                  title={`No hay feriados en ${year}`}
                  description="Carga los bancarios de EE. UU. con un toque, o agrégalos uno por uno."
                />
              ) : (
                <ul aria-label={listTitle} className="flex flex-col divide-y divide-rule">
                  {holidays.map((holiday) => (
                    <li key={holiday.id} className="flex items-center justify-between gap-3 py-1.5">
                      <div className="flex min-w-0 flex-col sm:flex-row sm:items-baseline sm:gap-4">
                        <DateText value={holiday.day} className="text-sm text-ink-soft sm:w-32 sm:shrink-0" />
                        <span className="break-words">{holiday.name}</span>
                      </div>
                      <DeleteHolidayButton id={holiday.id} day={holiday.day} name={holiday.name} />
                    </li>
                  ))}
                </ul>
              )}
              <LoadUsHolidaysButton year={year} />
            </CardBody>
          </section>
        </Card>

        <Card>
          <section aria-labelledby="agregar-feriado">
            <CardHeader>
              <CardTitle id="agregar-feriado">Agregar un feriado</CardTitle>
            </CardHeader>
            <CardBody>
              <AddHolidayForm year={year} />
            </CardBody>
          </section>
        </Card>
      </div>
    </>
  );
}
