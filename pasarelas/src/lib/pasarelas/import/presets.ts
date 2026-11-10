/**
 * Lo que el importador sabe de cada pasarela: el mapeo por defecto de sus columnas y qué fila es un cobro logrado.
 *
 * Fuentes (consultadas el 2026-11-10):
 *
 * - Stripe, movimientos de saldo (`stripe_saldo`): el informe «Balance» del panel y del Reports API,
 *   `balance_change_from_activity.itemized.*`, con sus columnas en `snake_case`. Por defecto trae
 *   `balance_transaction_id`, `created_utc` (en UTC), `available_on_utc`, `currency`, `gross`, `fee`, `net`,
 *   `reporting_category` y `description`; los datos del comprador (`customer_email`, `customer_name`,
 *   `customer_description`, direcciones) son columnas opcionales.
 *   https://docs.stripe.com/reports/report-types/balance
 *   Las categorías (`charge`, `refund`, `payout`, `fee`, `adjustment`, `dispute`, `partial_capture_reversal`…):
 *   https://docs.stripe.com/reports/reporting-categories
 *   Las versiones `.3` y `.7` del informe traen por defecto `created` (en la zona que se pidió, que el archivo no
 *   dice) y `created_utc` solo si se agrega: sin `created_utc` el archivo no se reconoce y se mapea a mano.
 *
 * - Stripe, pagos (`stripe_pagos`): la exportación de la lista de pagos del panel.
 *   https://support.stripe.com/questions/exporting-payment-data
 *   OJO: esa página (ni ninguna otra oficial que se encontrara) no publica los encabezados. Los de aquí («id»,
 *   «Created date (UTC)», «Amount», «Amount Refunded», «Currency», «Captured», «Fee», «Status») NO están
 *   confirmados en una fuente oficial: hay que comprobarlos con una exportación real. Si no coinciden, el archivo
 *   sale como «otro» y se mapea a mano; no se importa nada mal. Los estados del panel (Succeeded, Pending,
 *   Uncaptured, Partial capture, Incomplete, Failed, Canceled…):
 *   https://docs.stripe.com/payments/payment-intents/verifying-status
 *
 * - PayPal, descarga de actividad (`paypal_actividad`): columnas obligatorias `Date` (MM/DD/YYYY en cuentas de
 *   EE. UU.), `Time` (HH:MM:SS), `TimeZone`, `Name`, `Type`, `Status`, `Currency`, `Gross`, `Fee`, `Net`,
 *   `From Email Address`, `To Email Address`, `Transaction ID`, `Reference Txn ID` y `Receipt ID`; estados
 *   Completed, Denied, Reversed, Pending, Active, Expired, Unverified, Voided, Processing, Processed, Created,
 *   Canceled y Error. https://developer.paypal.com/docs/reports/online-reports/activity-download/
 *   `Type` es la descripción del código de evento (T-code): T00xx pagos, T01xx comisiones, T02xx conversiones de
 *   moneda, T03xx/T04xx depósitos y retiros de banco, T11xx reversos (T1107 «Payment refund»), T12xx ajustes
 *   (T1201 «Chargeback»), T15xx/T21xx retenciones y liberaciones. https://developer.paypal.com/reports/reference/tcodes/
 *   El separador decimal no está documentado: el mapeo por defecto usa el punto (cuentas de EE. UU.).
 */
import type { Currency } from "../types";
import type { ImportFormat } from "./detect";

/**
 * Qué columna del archivo es cada dato. Los nombres se comparan sin distinguir mayúsculas, espacios alrededor ni la
 * marca BOM. Un campo opcional en `null` (o vacío) no se lee.
 */
export type ColumnMapping = {
  reference: string;
  date: string;
  time?: string | null;
  timezone?: string | null;
  gross: string;
  currency?: string | null;
  fee?: string | null;
  status?: string | null;
  type?: string | null;
  /** Por defecto ninguna: una columna de descripción puede traer datos de terceros. */
  note?: string | null;
  /** Zona IANA (o `UTC`) cuando el archivo no trae columna de zona. */
  fixedZone: string;
  decimal: "." | ",";
  /** La hora, si viene, es HH:mm o HH:mm:ss (pegada a la fecha o en su columna). */
  dateFormat: "YYYY-MM-DD" | "MM/DD/YYYY" | "DD/MM/YYYY";
  /** Cuando no hay columna de moneda o viene vacía. */
  defaultCurrency: Currency;
};

const PRESETS: Readonly<Record<Exclude<ImportFormat, "otro">, Readonly<ColumnMapping>>> = {
  stripe_pagos: {
    reference: "id",
    date: "Created date (UTC)",
    time: null,
    timezone: null,
    gross: "Amount",
    currency: "Currency",
    fee: "Fee",
    status: "Status",
    type: null,
    note: null,
    fixedZone: "UTC",
    decimal: ".",
    dateFormat: "YYYY-MM-DD",
    defaultCurrency: "USD",
  },
  stripe_saldo: {
    reference: "balance_transaction_id",
    date: "created_utc",
    time: null,
    timezone: null,
    gross: "gross",
    currency: "currency",
    fee: "fee",
    status: null,
    type: "reporting_category",
    note: null,
    fixedZone: "UTC",
    decimal: ".",
    dateFormat: "YYYY-MM-DD",
    defaultCurrency: "USD",
  },
  paypal_actividad: {
    reference: "Transaction ID",
    date: "Date",
    time: "Time",
    timezone: "TimeZone",
    gross: "Gross",
    currency: "Currency",
    fee: "Fee",
    status: "Status",
    type: "Type",
    note: null,
    // No se usa: el archivo trae la zona en cada fila. Está porque el mapeo la exige.
    fixedZone: "America/New_York",
    decimal: ".",
    dateFormat: "MM/DD/YYYY",
    defaultCurrency: "USD",
  },
};

/** El mapeo por defecto de un formato reconocido (una copia: se puede ajustar sin tocar el original). */
export function presetFor(format: ImportFormat): ColumnMapping | null {
  return format === "otro" ? null : { ...PRESETS[format] };
}

/** Columnas de Stripe, pagos, que el importador lee por su nombre además del mapeo. */
export const STRIPE_CAPTURED = "Captured";
export const STRIPE_REFUNDED = "Amount Refunded";

/** Las columnas sin las que un formato no se reconoce: las de su mapeo por defecto y las que lee por su nombre. */
export function requiredColumns(format: Exclude<ImportFormat, "otro">): string[] {
  const m = PRESETS[format];
  const mapped = [m.reference, m.date, m.time, m.timezone, m.gross, m.currency, m.fee, m.status, m.type, m.note];
  const extra = format === "stripe_pagos" ? [STRIPE_CAPTURED, STRIPE_REFUNDED] : [];
  return [...mapped, ...extra].filter((c): c is string => typeof c === "string");
}

// ─── Qué fila es un cobro logrado ───────────────────────────────────────────────────────────────────────────

export const SKIP = {
  refund: "reembolso: el importador solo trae cobros (el reembolso se registra en el detalle del cobro)",
  bank: "retiro, depósito o transferencia de saldo: no es un cobro",
  fee: "comisión suelta: no es un cobro",
  adjustment: "ajuste, disputa o contracargo: no es un cobro",
  hold: "retención o liberación de saldo: no es un cobro",
  conversion: "conversión de moneda: no es un cobro",
  failed: "cobro fallido o cancelado",
  pending: "cobro pendiente o sin capturar",
} as const;

const unknown = (value: string): string => `«${value}» no es un cobro logrado`;
const missing = (what: "tipo" | "estado"): string => `sin ${what}: no se sabe si es un cobro`;

/**
 * Lo que una fila dice de sí misma. `type` y `status` son `null` si el mapeo no tiene esa columna (entonces no se
 * filtra por ella); `cell` lee cualquier otra columna por su nombre (vacía si no está).
 */
export type RowFacts = { type: string | null; status: string | null; cell: (column: string) => string };

/** Lista de valores → motivo, para buscar uno exacto (sin distinguir mayúsculas). */
const byValue = (groups: [readonly string[], string | null][]): Map<string, string | null> =>
  new Map(groups.flatMap(([values, reason]) => values.map((v) => [v, reason] as const)));

/** `reporting_category` de Stripe (null = es un cobro). */
const STRIPE_CATEGORIES = byValue([
  [["charge", "payment"], null],
  [["refund", "payment_refund", "partial_capture_reversal"], SKIP.refund],
  [["payout", "payout_reversal", "topup", "topup_reversal", "transfer", "transfer_reversal"], SKIP.bank],
  [["fee"], SKIP.fee],
  [["adjustment", "other_adjustment", "dispute", "dispute_reversal", "refund_failure"], SKIP.adjustment],
  [["risk_reserved_funds", "connect_reserved_funds"], SKIP.hold],
]);

/** Estado de un pago en el panel de Stripe (null = es un cobro: se cobró, aunque después se reembolsara). */
const STRIPE_STATUSES = byValue([
  [["paid", "succeeded", "refunded", "partially refunded", "disputed"], null],
  [["failed", "canceled", "cancelled", "blocked"], SKIP.failed],
  [["pending", "uncaptured", "partial capture", "partially paid", "incomplete", "waiting on funding", "processing"], SKIP.pending],
]);

/** Estado de una fila de PayPal (null = es un cobro). */
const PAYPAL_STATUSES = byValue([
  [["completed"], null],
  [["pending", "processing", "created", "unverified", "payment pending"], SKIP.pending],
  [["denied", "reversed", "voided", "canceled", "cancelled", "expired", "error"], SKIP.failed],
]);

/**
 * Tipo de PayPal: es texto libre (la descripción del T-code), así que se busca por palabras, en este orden: una
 * liberación de retención («Reversal of general account hold») es retención y no reverso, y una comisión de
 * disputa es una disputa.
 */
const PAYPAL_TYPE_WORDS: [RegExp, string | null][] = [
  [/\b(hold|release|reserve)\b/, SKIP.hold],
  [/\b(refund|reversal)\b/, SKIP.refund],
  [/\b(chargeback|dispute|adjustment|correction)\b/, SKIP.adjustment],
  [/\b(withdrawal|deposit|transfer)\b/, SKIP.bank],
  [/\bconversion\b/, SKIP.conversion],
  [/\bfee\b/, SKIP.fee],
  [/\b(payment|donation)\b/, null],
];

/** Busca un valor en su tabla; vacío o desconocido también es motivo para omitir. */
function lookup(table: Map<string, string | null>, value: string, what: "tipo" | "estado"): string | null {
  const key = value.trim().toLowerCase();
  if (key === "") return missing(what);
  const reason = table.get(key);
  return reason === undefined ? unknown(value.trim()) : reason;
}

function paypalType(value: string): string | null {
  const text = value.trim().toLowerCase();
  if (text === "") return missing("tipo");
  const hit = PAYPAL_TYPE_WORDS.find(([words]) => words.test(text));
  return hit === undefined ? unknown(value.trim()) : hit[1];
}

/**
 * Por qué una fila NO es un cobro logrado, o `null` si lo es (el monto positivo se comprueba después, al leerlo).
 * «otro» no sabe nada de tipos ni de estados: cada fila es un cobro.
 */
export function skipReason(format: ImportFormat, facts: RowFacts): string | null {
  switch (format) {
    case "stripe_saldo":
      return facts.type === null ? null : lookup(STRIPE_CATEGORIES, facts.type, "tipo");
    case "stripe_pagos": {
      const reason = facts.status === null ? null : lookup(STRIPE_STATUSES, facts.status, "estado");
      if (reason !== null) return reason;
      return facts.cell(STRIPE_CAPTURED).trim().toLowerCase() === "false" ? SKIP.pending : null;
    }
    case "paypal_actividad":
      return (
        (facts.type === null ? null : paypalType(facts.type)) ??
        (facts.status === null ? null : lookup(PAYPAL_STATUSES, facts.status, "estado"))
      );
    case "otro":
      return null;
  }
}
