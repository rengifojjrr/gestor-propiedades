import "server-only";
import type { Db } from "../dto";
import { UserError } from "../errors";

/**
 * Los cargadores: las personas que le traen cada venta al dueño, para reportarle a cada una lo suyo. Solo sirven para
 * reportar: no cobran del reparto (si uno se lleva un porcentaje, eso es un beneficiario del esquema).
 *
 * El nombre es único por usuario sin distinguir mayúsculas ni espacios de más (lo exige la base con
 * `pay_loaders_name_uq`); aquí se guarda ya limpio. Un cargador con cobros no se borra (la clave del cobro hacia su
 * cargador no lleva cascada): se desactiva.
 */

const NOT_FOUND_TEXT = "Ese cargador ya no existe.";
const DUPLICATE_TEXT = "Ya hay un cargador con ese nombre.";
const IN_USE_TEXT =
  "Este cargador tiene cobros: no se puede borrar. Desactívalo: deja de ofrecerse al registrar y sus cobros lo " +
  "siguen mostrando.";

/** El único del nombre y la clave de los cobros hacia su cargador, como los nombra la base en sus errores. */
const NAME_UNIQUE = "pay_loaders_name_uq";
const TX_LOADER_FK = "pay_transactions_loader_fk";

/** Lo que se guarda de un cargador, ya validado. Sin `id` se crea; con `id`, se edita ese. */
export type LoaderInput = { id: string | null; name: string; note: string | null };

/** El nombre como se guarda: sin los espacios de los extremos y con los de en medio juntados en uno. */
export function cleanLoaderName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

/** ¿Es este el error de la base por esa restricción (con ese SQLSTATE)? */
function isViolation(error: { code?: string; message?: string } | null, code: string, constraint: string): boolean {
  return error?.code === code && (error.message ?? "").includes(`"${constraint}"`);
}

/**
 * El id de la fila que tocó la escritura. Si no tocó ninguna, el cargador no existe (o es de otro usuario: la RLS no
 * lo deja ver).
 */
function touched(rows: { id: string }[]): string {
  const [row] = rows;
  if (row === undefined) throw new UserError(NOT_FOUND_TEXT);
  return row.id;
}

/** Crea el cargador (sin `id`) o cambia su nombre y su nota. Devuelve su id. Un nombre repetido lo dice. */
export async function saveLoader(supabase: Db, input: LoaderInput): Promise<string> {
  const fields = { name: cleanLoaderName(input.name), note: input.note };
  const { data, error } =
    input.id === null
      ? await supabase.from("pay_loaders").insert(fields).select("id")
      : await supabase.from("pay_loaders").update(fields).eq("id", input.id).select("id");
  if (isViolation(error, "23505", NAME_UNIQUE)) throw new UserError(DUPLICATE_TEXT);
  if (error) throw error;
  return touched(data);
}

/** Activa o desactiva el cargador. Desactivado no se ofrece al registrar; los cobros que lo tienen lo conservan. */
export async function setLoaderActive(supabase: Db, id: string, active: boolean): Promise<void> {
  const { data } = await supabase.from("pay_loaders").update({ active }).eq("id", id).select("id").throwOnError();
  touched(data);
}

/**
 * Borra el cargador, solo si no tiene cobros (también los de la papelera cuentan). Si tiene, la base no lo deja y se
 * dice que se desactive.
 */
export async function deleteLoader(supabase: Db, id: string): Promise<void> {
  const { data, error } = await supabase.from("pay_loaders").delete().eq("id", id).select("id");
  if (isViolation(error, "23503", TX_LOADER_FK)) throw new UserError(IN_USE_TEXT);
  if (error) throw error;
  touched(data);
}
