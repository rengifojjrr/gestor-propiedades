import type { ISODate } from "./types";

/**
 * Feriados bancarios de EE. UU. (los días en que no se mueven los depósitos), calculados para cualquier año.
 * Todo es aritmética de calendario en UTC puro: aquí no hay zonas horarias ni reloj.
 */

const MIN_YEAR = 1900;
const MAX_YEAR = 2200;

const SUNDAY = 0;
const MONDAY = 1;
const THURSDAY = 4;

const utcDate = (year: number, month: number, day: number) => new Date(Date.UTC(year, month - 1, day));
const iso = (date: Date): ISODate => date.toISOString().slice(0, 10);

/** El enésimo día de la semana `weekday` (0 = domingo) del mes: «3.er lunes de enero». */
function nthWeekday(year: number, month: number, weekday: number, nth: number): Date {
  const first = utcDate(year, month, 1).getUTCDay();
  return utcDate(year, month, 1 + ((weekday - first + 7) % 7) + (nth - 1) * 7);
}

/** El último día de la semana `weekday` del mes: «último lunes de mayo». */
function lastWeekday(year: number, month: number, weekday: number): Date {
  const last = utcDate(year, month + 1, 0); // el día 0 del mes siguiente es el último de este
  return utcDate(year, month, last.getUTCDate() - ((last.getUTCDay() - weekday + 7) % 7));
}

/**
 * Feriado de fecha fija, con la regla del calendario BANCARIO: si cae en sábado se queda en su fecha (el viernes
 * anterior los bancos abren); si cae en domingo se pasa al lunes siguiente y el nombre termina en «(observado)».
 */
function fixed(year: number, month: number, day: number, name: string): { day: ISODate; name: string } {
  const date = utcDate(year, month, day);
  if (date.getUTCDay() !== SUNDAY) return { day: iso(date), name };
  return { day: iso(utcDate(year, month, day + 1)), name: `${name} (observado)` };
}

/** Los once feriados bancarios del año, ordenados por fecha. Año fuera de 1900–2200 o no entero: `RangeError`. */
export function usBankHolidays(year: number): { day: ISODate; name: string }[] {
  if (!Number.isInteger(year) || year < MIN_YEAR || year > MAX_YEAR) {
    throw new RangeError(`Año fuera de rango (${MIN_YEAR}–${MAX_YEAR}): ${year}`);
  }
  return [
    fixed(year, 1, 1, "Año Nuevo"),
    { day: iso(nthWeekday(year, 1, MONDAY, 3)), name: "Día de Martin Luther King Jr." },
    { day: iso(nthWeekday(year, 2, MONDAY, 3)), name: "Día de los Presidentes" },
    { day: iso(lastWeekday(year, 5, MONDAY)), name: "Día de los Caídos" },
    fixed(year, 6, 19, "Juneteenth"),
    fixed(year, 7, 4, "Día de la Independencia"),
    { day: iso(nthWeekday(year, 9, MONDAY, 1)), name: "Día del Trabajo" },
    { day: iso(nthWeekday(year, 10, MONDAY, 2)), name: "Día de Colón" },
    fixed(year, 11, 11, "Día de los Veteranos"),
    { day: iso(nthWeekday(year, 11, THURSDAY, 4)), name: "Acción de Gracias" },
    fixed(year, 12, 25, "Navidad"),
  ];
}
