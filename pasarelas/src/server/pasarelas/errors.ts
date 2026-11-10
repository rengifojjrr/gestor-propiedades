import "server-only";
import { ZodError } from "zod";
import { PAY_RULE_TEXT, PAY_STATE_TEXT, PayRuleError, PayStateError } from "@/lib/pasarelas";

/**
 * De un error a un mensaje en español para la persona. Función pura: no registra ni lanza.
 *
 * Lo que la base dice de sí misma (restricciones, tablas, ids, su mensaje original) nunca sale: cada mensaje viene
 * de las tablas de este archivo o del motor. Lo que no se reconoce da el mensaje general.
 */

/** Un error esperado: su mensaje ya está escrito para la persona y se le enseña tal cual. */
export class UserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserError";
  }
}

const GENERIC_TEXT = "No se pudo guardar. Inténtalo de nuevo.";
const SECOND_FACTOR_TEXT = "Verifica tu segundo factor para seguir";

/**
 * Los errores de la base, por SQLSTATE. `named` va por lo que identifica al error dentro de su mensaje: el nombre
 * de la restricción que falló o el prefijo `pay_…` que le ponen las funciones y los disparadores de la migración.
 * `other` es el mensaje del código cuando no trae ninguno de esos.
 */
const DATABASE_TEXT: Record<string, { named: Record<string, string>; other: string }> = {
  // Algo único que se repite.
  "23505": {
    named: {
      pay_companies_name_uq: "Ya hay una empresa con ese nombre.",
      pay_gateways_name_uq: "Ya hay una pasarela con ese nombre.",
      pay_beneficiaries_name_uq: "Ya hay un beneficiario con ese nombre.",
      pay_schemes_name_uq: "Ya hay un esquema de reparto con ese nombre.",
      pay_transactions_reference_uq: "Ya hay un cobro de esa pasarela con esa referencia.",
    },
    other: "Ya existe un registro con esos datos.",
  },
  // Una clave foránea: ver `foreignKeyText` para las que no tienen nombre propio.
  "23503": {
    named: {
      pay_scheme_version_in_use: "Ya hay cobros con la versión del esquema vigente desde esa fecha: elige otra fecha.",
    },
    other: "Algo de lo elegido ya no existe. Vuelve a cargar la página.",
  },
  // Los cuadres que defiende la base.
  "23514": {
    named: {
      pay_alloc_sum_mismatch: "El reparto no suma exactamente su base. No se guardó nada.",
      pay_scheme_over_100: "Las líneas del esquema suman más de 100 %.",
      pay_scheme_under_100: "Las líneas del esquema suman menos de 100 %: elige quién recibe el resto.",
      pay_scheme_remainder_in_lines: "Quien recibe el resto no puede ser además una línea del esquema.",
      pay_transactions_alloc_base_check: "La base del reparto no coincide con el cobro. No se guardó nada.",
    },
    other: "Algún dato no cumple las reglas del libro. Revísalo e inténtalo de nuevo.",
  },
  // El control optimista de pay_save_transactions.
  "40001": {
    named: { pay_tx_conflict: "Este cobro cambió mientras lo editabas: vuelve a abrirlo" },
    other: GENERIC_TEXT,
  },
  P0002: {
    named: {
      pay_tx_not_found: "Ese cobro ya no existe.",
      pay_scheme_not_found: "Ese esquema de reparto ya no existe.",
    },
    other: "Ese registro ya no existe.",
  },
  // La política restrictiva del segundo factor: la sesión es aal1 y el usuario tiene un factor verificado.
  "42501": { named: {}, other: SECOND_FACTOR_TEXT },
  "28000": { named: { pay_no_session: "Tu sesión terminó. Vuelve a entrar." }, other: GENERIC_TEXT },
};

/** Los rechazos de Storage, por su código HTTP (que llega como texto en `statusCode`). */
const STORAGE_TEXT: Record<string, string> = {
  "403": SECOND_FACTOR_TEXT,
  "404": "Ese archivo ya no existe.",
  "409": "Ya hay un archivo con ese nombre.",
  "413": "El archivo pesa más de 10 MB.",
  "415": "Ese tipo de archivo no se admite: solo JPG, PNG, WebP o PDF.",
};

const IN_USE_TEXT = "No se puede borrar: todavía se usa en cobros o en otros registros.";

/** `pay_tx_conflict: el cobro…` → `pay_tx_conflict`. */
const PAY_PREFIX = /^(pay_[a-z0-9_]+):/;
/** `…violates unique constraint "pay_companies_name_uq"` → `pay_companies_name_uq`. */
const CONSTRAINT = /constraint "([a-z0-9_]+)"/;

function databaseText(code: string, message: string): string {
  const known = DATABASE_TEXT[code];
  if (known === undefined) return GENERIC_TEXT;
  const name = PAY_PREFIX.exec(message)?.[1] ?? CONSTRAINT.exec(message)?.[1];
  const named = name === undefined ? undefined : known.named[name];
  if (named !== undefined) return named;
  // Postgres distingue los dos sentidos de una clave foránea por cómo empieza el mensaje.
  if (code === "23503" && message.startsWith("update or delete")) return IN_USE_TEXT;
  return known.other;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

/** El mensaje, en español y sin detalles internos, que se le enseña a la persona cuando algo falla. */
export function errorMessage(e: unknown): string {
  if (e instanceof UserError) return e.message;
  if (e instanceof PayStateError) return PAY_STATE_TEXT[e.code];
  if (e instanceof PayRuleError) return PAY_RULE_TEXT[e.code];
  // Un ZodError LANZADO es un fallo interno (un desglose guardado que no se deja leer, una respuesta de la base con
  // otra forma): su texto no es para la persona. Lo que ella escribe se valida con `safeParse` en `runAction`.
  if (e instanceof ZodError) return GENERIC_TEXT;
  if (!isRecord(e)) return GENERIC_TEXT;
  // Storage primero: sus errores traen además un `code` propio («KeyAlreadyExists») que no es un SQLSTATE.
  if (typeof e.statusCode === "string") return STORAGE_TEXT[e.statusCode] ?? GENERIC_TEXT;
  if (typeof e.code === "string") return databaseText(e.code, typeof e.message === "string" ? e.message : "");
  return GENERIC_TEXT;
}
