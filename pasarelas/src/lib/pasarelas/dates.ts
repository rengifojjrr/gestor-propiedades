import { DateTime, IANAZone } from "luxon";
import type { DayType, ISODate } from "./types";

/**
 * Fechas del motor. Dos mundos que no se mezclan:
 *  - Fechas de calendario (AAAA-MM-DD): toda su aritmética es en UTC puro, así ningún cambio de horario corre un día.
 *  - Instantes (un momento exacto): solo aquí importa la zona, y solo aquí se usa Luxon.
 * Los textos en español salen de tablas propias (no de `Intl`): servidor y navegador dan exactamente lo mismo.
 */

export const ZONE = "America/New_York";

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;
const WEEKDAYS = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"] as const;
const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"] as const;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_KEY = /^(\d{4})-(0[1-9]|1[0-2])$/;
/** Lo que entrega un `<input type="datetime-local">`: AAAA-MM-DDTHH:mm. */
const LOCAL_INPUT = /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/;
/** Una hora de pared: AAAA-MM-DDTHH:mm con segundos opcionales (`:ss`). */
const WALL_TIME = /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/;
/** Un instante en texto trae hora y zona: termina en `Z` o en un desfase (`+00:00`, `-05:00`, `+00`). */
const HAS_ZONE = /T[\d:.,]+(?:Z|[+-]\d{2}(?::?\d{2})?)$/;

// ─── Fechas de calendario (UTC puro) ────────────────────────────────────────────────────────────────────────

/** ¿Es una fecha de calendario AAAA-MM-DD que existe? (`2026-02-30` no existe). */
export function isISODate(x: unknown): x is ISODate {
  if (typeof x !== "string" || !ISO_DATE.test(x)) return false;
  const ms = Date.parse(`${x}T00:00:00Z`);
  // JavaScript «corre» los días que no existen (30 de febrero → 2 de marzo): se comprueba la ida y vuelta.
  return !Number.isNaN(ms) && fromUtcMs(ms) === x;
}

function assertISODate(d: ISODate): void {
  if (!isISODate(d)) throw new RangeError(`Fecha inválida (se espera AAAA-MM-DD): ${String(d)}`);
}

/** La medianoche UTC de la fecha, en milisegundos. */
function utcMs(d: ISODate): number {
  assertISODate(d);
  return Date.parse(`${d}T00:00:00Z`);
}

const fromUtcMs = (ms: number): ISODate => new Date(ms).toISOString().slice(0, 10);

/** Día de la semana con lunes = 0 … domingo = 6 (el orden de `WEEKDAYS`). */
const weekdayIndex = (d: ISODate): number => (new Date(utcMs(d)).getUTCDay() + 6) % 7;

const firstOfMonth = (d: ISODate): ISODate => `${d.slice(0, 7)}-01`;

/** Suma (o resta) días de calendario. */
export function addDays(d: ISODate, n: number): ISODate {
  if (!Number.isInteger(n)) throw new RangeError(`Los días tienen que ser un número entero: ${n}`);
  return fromUtcMs(utcMs(d) + n * DAY_MS);
}

/** Días de calendario de `from` a `to` (negativo si `to` es anterior). */
export function daysBetween(from: ISODate, to: ISODate): number {
  return (utcMs(to) - utcMs(from)) / DAY_MS;
}

/** Día hábil bancario: ni sábado, ni domingo, ni feriado. */
export function isBusinessDay(d: ISODate, holidays: ReadonlySet<ISODate>): boolean {
  return weekdayIndex(d) < 5 && !holidays.has(d);
}

/**
 * Cuándo cae el dinero. 0 días es el mismo día, aunque sea fin de semana o feriado. `corridos` es suma de
 * calendario (sin correr al siguiente hábil); `habiles` avanza día por día y solo cuenta los días hábiles.
 */
export function estimateDepositDate(a: {
  occurredOn: ISODate;
  days: number;
  dayType: DayType;
  holidays: ReadonlySet<ISODate>;
}): ISODate {
  if (!Number.isInteger(a.days) || a.days < 0) {
    throw new RangeError(`Los días de depósito tienen que ser un entero mayor o igual que cero: ${a.days}`);
  }
  if (a.dayType === "corridos") return addDays(a.occurredOn, a.days);
  assertISODate(a.occurredOn);
  let day = a.occurredOn;
  for (let pending = a.days; pending > 0; ) {
    day = addDays(day, 1);
    if (isBusinessDay(day, a.holidays)) pending -= 1;
  }
  return day;
}

/** Una ventana de fechas de calendario, las dos incluidas: `from` ≤ `to`. Un solo día: `from` = `to`. */
export type DateWindow = { from: ISODate; to: ISODate };

/**
 * Cuándo cae el dinero cuando la pasarela promete una ventana («de 3 a 5 días hábiles»): `from` con el mínimo
 * (`days`) y `to` con el máximo (`daysMax`; `null` = igual al mínimo, un solo día). Cada punta se cuenta como en
 * `estimateDepositDate`. Un máximo menor que el mínimo, o que no es un entero, es un error.
 */
export function estimateDepositWindow(a: {
  occurredOn: ISODate;
  days: number;
  daysMax: number | null;
  dayType: DayType;
  holidays: ReadonlySet<ISODate>;
}): DateWindow {
  const max = a.daysMax ?? a.days;
  if (!Number.isInteger(max) || max < a.days) {
    throw new RangeError(`El máximo de días tiene que ser un entero mayor o igual que el mínimo: ${a.daysMax}`);
  }
  const at = (days: number): ISODate => estimateDepositDate({ ...a, days });
  return { from: at(a.days), to: at(max) };
}

/**
 * La ventana de un cobro guardado: de `estimatedDepositFrom` (vacía = la misma) a `estimatedDepositOn`, la más
 * tardía. Sin fecha estimada no hay ventana.
 */
export function depositWindowOf(t: {
  estimatedDepositFrom: ISODate | null;
  estimatedDepositOn: ISODate | null;
}): DateWindow | null {
  if (t.estimatedDepositOn === null) return null;
  return { from: t.estimatedDepositFrom ?? t.estimatedDepositOn, to: t.estimatedDepositOn };
}

// ─── Períodos ───────────────────────────────────────────────────────────────────────────────────────────────

export type PeriodPreset = "este_mes" | "mes_anterior" | "30d" | "90d" | "365d" | "este_anio" | "personalizado";

const ROLLING_DAYS = { "30d": 30, "90d": 90, "365d": 365 } as const;

/**
 * El rango de fechas (ambas incluidas) de un período, contado desde `today`. Las fechas de `custom` solo se usan
 * con `personalizado`: las dos → esas (en orden); solo `from` → hasta hoy; solo `to` → desde el día 1 de su mes;
 * ninguna → este mes.
 */
export function periodRange(
  preset: PeriodPreset,
  today: ISODate,
  custom?: { from?: ISODate | null; to?: ISODate | null },
): { from: ISODate; to: ISODate } {
  assertISODate(today);
  const thisMonth = { from: firstOfMonth(today), to: today };
  switch (preset) {
    case "este_mes":
      return thisMonth;
    case "mes_anterior": {
      const to = addDays(thisMonth.from, -1);
      return { from: firstOfMonth(to), to };
    }
    case "30d":
    case "90d":
    case "365d":
      return { from: addDays(today, 1 - ROLLING_DAYS[preset]), to: today };
    case "este_anio":
      return { from: `${today.slice(0, 4)}-01-01`, to: today };
    case "personalizado": {
      const from = custom?.from ?? null;
      const to = custom?.to ?? null;
      if (from !== null) assertISODate(from);
      if (to !== null) assertISODate(to);
      if (from !== null && to !== null) return from <= to ? { from, to } : { from: to, to: from };
      if (from !== null) return { from, to: from > today ? from : today };
      if (to !== null) return { from: firstOfMonth(to), to };
      return thisMonth;
    }
    default:
      throw new RangeError(`Período desconocido: ${String(preset)}`);
  }
}

// ─── Instantes (aquí sí importa la zona) ────────────────────────────────────────────────────────────────────

/**
 * El instante visto en Nueva York. Un texto sin zona (`2026-11-13`, `2026-11-13T22:30`) no es un instante: se
 * rechaza en vez de adivinarle una zona, porque adivinar mal corre el día.
 */
function inNY(instant: string | Date): DateTime<true> {
  const isDate = instant instanceof Date;
  const dt = isDate ? DateTime.fromJSDate(instant, { zone: ZONE }) : DateTime.fromISO(instant, { zone: ZONE });
  if (!dt.isValid || !(isDate || HAS_ZONE.test(instant))) {
    throw new RangeError(`Instante inválido (se espera ISO 8601 con zona): ${String(instant)}`);
  }
  return dt;
}

const pad2 = (n: number): string => String(n).padStart(2, "0");
const hhmm = (dt: DateTime<true>): string => `${pad2(dt.hour)}:${pad2(dt.minute)}`;

/** La fecha de calendario de un instante en Nueva York. */
export function nyDate(instant: string | Date): ISODate {
  return inNY(instant).toISODate();
}

/** «Hoy» en Nueva York. El reloj entra como parámetro: el motor no lo lee. */
export function todayNY(now: Date): ISODate {
  return nyDate(now);
}

/**
 * De la hora local de Nueva York de un formulario (`2026-11-13T22:30`) al instante en UTC
 * (`2026-11-14T03:30:00.000Z`). Una hora que no existe por el cambio de horario se resuelve hacia adelante
 * (02:30 → 03:30 EDT) y una que ocurre dos veces toma la primera (EDT). Es `wallTimeToInstant` con la zona de
 * Nueva York y sin segundos.
 */
export function localInputToInstant(local: string): string {
  if (!LOCAL_INPUT.test(local) || !isISODate(local.slice(0, 10))) {
    throw new RangeError(`Fecha y hora inválidas (se espera AAAA-MM-DDTHH:mm): ${local}`);
  }
  return wallTimeToInstant(local, ZONE);
}

/**
 * De una hora «de pared» (`AAAA-MM-DDTHH:mm` o `AAAA-MM-DDTHH:mm:ss`) en una zona IANA al instante en UTC. Igual
 * que en `localInputToInstant`: una hora que no existe por el cambio de horario se resuelve hacia adelante y una
 * que ocurre dos veces toma la primera.
 *
 * No se le pide a Luxon que lea la hora local: ante una hora ambigua elige según el horario que rija «ahora»
 * (el reloj de la máquina), y el motor tiene que dar siempre el mismo instante. De Luxon solo sale el desfase.
 */
export function wallTimeToInstant(wall: string, zoneName: string): string {
  if (!WALL_TIME.test(wall) || !isISODate(wall.slice(0, 10))) {
    throw new RangeError(`Fecha y hora inválidas (se espera AAAA-MM-DDTHH:mm[:ss]): ${wall}`);
  }
  // `create` guarda cada zona ya vista (y si es válida): no se vuelve a preguntar a `Intl` en cada llamada.
  const zone = IANAZone.create(zoneName);
  if (!zone.isValid) throw new RangeError(`Zona horaria desconocida: «${zoneName}»`);
  // La hora «de pared» leída como si fuera UTC: el instante real es esa hora menos el desfase de la zona.
  const wallMs = Date.parse(`${wall.length === 16 ? `${wall}:00` : wall}Z`);
  // Desfases en minutos (EDT = −240, EST = −300) un día antes y un día después: solo difieren junto a un cambio.
  const dayBefore = zone.offset(wallMs - DAY_MS);
  const dayAfter = zone.offset(wallMs + DAY_MS);
  const summer = Math.max(dayBefore, dayAfter);
  const winter = Math.min(dayBefore, dayAfter);
  // Con el desfase de verano sale el instante más temprano. Si en ese instante de verdad rige ese desfase, es el
  // bueno: el caso normal y «la primera» de una hora ambigua. Si no, vale el del desfase de invierno: el caso normal
  // al otro lado del cambio y «hacia adelante» para una hora que no existe.
  const earliest = wallMs - summer * MINUTE_MS;
  const instant = zone.offset(earliest) === summer ? earliest : wallMs - winter * MINUTE_MS;
  return new Date(instant).toISOString();
}

/** La inversa: de un instante a la hora local de Nueva York para un formulario (`AAAA-MM-DDTHH:mm`). */
export function instantToLocalInput(instant: string): string {
  const dt = inNY(instant);
  return `${dt.toISODate()}T${hhmm(dt)}`;
}

// ─── Textos ─────────────────────────────────────────────────────────────────────────────────────────────────

/** `2026-11-13` → `2026-11`. */
export function monthKey(d: ISODate): string {
  assertISODate(d);
  return d.slice(0, 7);
}

/** `2026-11` → `nov 2026`. */
export function monthLabel(key: string): string {
  const match = MONTH_KEY.exec(key);
  if (!match) throw new RangeError(`Mes inválido (se espera AAAA-MM): ${key}`);
  return `${MONTHS[Number(match[2]) - 1]} ${match[1]}`;
}

/** `2026-11-13` → `vie 13 nov 2026`. */
export function formatDate(d: ISODate): string {
  const weekday = WEEKDAYS[weekdayIndex(d)];
  return `${weekday} ${Number(d.slice(8))} ${monthLabel(monthKey(d))}`;
}

/** Una ventana que se puede leer: dos fechas que existen y en orden. Si no, `RangeError`. */
function assertWindow(w: DateWindow): void {
  assertISODate(w.from);
  assertISODate(w.to);
  if (w.from > w.to) throw new RangeError(`Ventana al revés: del ${w.from} al ${w.to}`);
}

/** Lo que una punta de la ventana repite de la otra, y se omite: el mes y el año, o solo el año. */
type Shared = "mes" | "anio" | "nada";

function sharedOf(w: DateWindow): Shared {
  assertWindow(w);
  if (w.from.slice(0, 7) === w.to.slice(0, 7)) return "mes";
  return w.from.slice(0, 4) === w.to.slice(0, 4) ? "anio" : "nada";
}

/** `2026-11-16` → `16`, `16 nov` o `16 nov 2026`, según cuánto se diga. */
function dayText(d: ISODate, say: "dia" | "mes" | "anio"): string {
  const day = String(Number(d.slice(8)));
  if (say === "dia") return day;
  const month = MONTHS[Number(d.slice(5, 7)) - 1];
  return say === "mes" ? `${day} ${month}` : `${day} ${month} ${d.slice(0, 4)}`;
}

/**
 * Las puntas de una ventana para leerlas en una frase («Llega entre el lun 16 y el mié 18 nov»), sin repetir lo
 * que comparten: `["lun 16", "mié 18 nov"]`, `["lun 30 nov", "mié 2 dic"]` y, solo si cruza el año, con el año:
 * `["mar 29 dic 2026", "lun 4 ene 2027"]`. Un solo día, una sola: `["mié 18 nov"]`.
 */
export function windowDayLabels(w: DateWindow): [string] | [string, string] {
  const shared = sharedOf(w);
  const withWeekday = (d: ISODate, say: "dia" | "mes" | "anio") => `${WEEKDAYS[weekdayIndex(d)]} ${dayText(d, say)}`;
  if (w.from === w.to) return [withWeekday(w.to, "mes")];
  const last = shared === "nada" ? "anio" : "mes";
  return [withWeekday(w.from, shared === "mes" ? "dia" : last), withWeekday(w.to, last)];
}

/**
 * La ventana corta, para listas: `16–18 nov`, `30 nov – 2 dic`, `29 dic 2026 – 4 ene 2027` o, de un solo día,
 * `18 nov`.
 */
export function formatWindowShort(w: DateWindow): string {
  const shared = sharedOf(w);
  if (w.from === w.to) return dayText(w.to, "mes");
  if (shared === "mes") return `${dayText(w.from, "dia")}–${dayText(w.to, "mes")}`;
  const say = shared === "anio" ? "mes" : "anio";
  return `${dayText(w.from, say)} – ${dayText(w.to, say)}`;
}

/** `2026-11-13T15:30:00Z` → `vie 13 nov 2026, 10:30` (hora de Nueva York, 24 horas). */
export function formatDateTime(instant: string): string {
  const dt = inNY(instant);
  return `${formatDate(dt.toISODate())}, ${hhmm(dt)}`;
}
