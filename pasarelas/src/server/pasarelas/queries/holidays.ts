import "server-only";
import type { ISODate } from "@/lib/pasarelas";
import type { Db } from "../dto";

/** Lo que pinta la pantalla de feriados: los de un año y qué años no tienen ninguno. */

/** Los años que se pueden pedir: los que sabe calcular `usBankHolidays`. */
export const MIN_YEAR = 1900;
export const MAX_YEAR = 2200;

export type HolidayView = { id: string; day: ISODate; name: string };

const firstDay = (year: number): ISODate => `${year}-01-01`;
const lastDay = (year: number): ISODate => `${year}-12-31`;

/**
 * El año que pide la URL (`?anio=2028`). Si no viene, o no es un año entero entre 1900 y 2200, `fallback`
 * (el año en curso).
 */
export function parseYear(raw: string | string[] | undefined, fallback: number): number {
  if (typeof raw !== "string" || !/^\d{4}$/.test(raw)) return fallback;
  const year = Number(raw);
  return year >= MIN_YEAR && year <= MAX_YEAR ? year : fallback;
}

/** Los feriados del año, por fecha. Un año tiene unos pocos: no llega al tope de filas de la API. */
export async function listHolidays(supabase: Db, year: number): Promise<HolidayView[]> {
  const { data } = await supabase
    .from("pay_holidays")
    .select("id, day, name")
    .gte("day", firstDay(year))
    .lte("day", lastDay(year))
    .order("day")
    .throwOnError();
  return data;
}

/** De `years`, los que no tienen ningún feriado (en el mismo orden). Una petición sin filas por año. */
export async function yearsWithoutHolidays(supabase: Db, years: readonly number[]): Promise<number[]> {
  const counts = await Promise.all(
    years.map(async (year) => {
      const { count } = await supabase
        .from("pay_holidays")
        .select("id", { count: "exact", head: true })
        .gte("day", firstDay(year))
        .lte("day", lastDay(year))
        .throwOnError();
      if (count === null) throw new Error("El conteo de feriados de un año llegó sin el total (count).");
      return count;
    }),
  );
  return years.filter((_, index) => counts[index] === 0);
}
