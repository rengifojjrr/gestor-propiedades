import "server-only";
import { usBankHolidays } from "@/lib/pasarelas";
import type { ISODate } from "@/lib/pasarelas";
import type { Db } from "../dto";
import { UserError } from "../errors";

/**
 * Los feriados del usuario: los días sin movimiento bancario que saltan las fechas estimadas en días hábiles.
 * Se agregan y se quitan a mano, o se cargan los bancarios de EE. UU. de un año.
 */

/** La restricción `unique (user_id, day)` de `pay_holidays`, con el nombre que le da Postgres. */
const ONE_PER_DAY = "pay_holidays_user_id_day_key";

/** Agrega un feriado y devuelve su id. Si ya hay uno ese día, lo dice. */
export async function addHoliday(supabase: Db, h: { day: ISODate; name: string }): Promise<string> {
  const { data, error } = await supabase.from("pay_holidays").insert(h).select("id").single();
  if (error?.code === "23505" && error.message.includes(ONE_PER_DAY)) {
    throw new UserError("Ya hay un feriado ese día.");
  }
  if (error) throw error;
  return data.id;
}

/** Quita un feriado. Si ya no existe (o es de otro usuario), lo dice. */
export async function deleteHoliday(supabase: Db, id: string): Promise<void> {
  const { data } = await supabase.from("pay_holidays").delete().eq("id", id).select("id").throwOnError();
  if (data.length === 0) throw new UserError("Ese feriado ya no existe.");
}

/**
 * Carga los feriados bancarios de EE. UU. de `year` (`usBankHolidays`). Inserta solo los días que faltan: un día
 * que ya tiene feriado (cargado antes o puesto a mano, con su nombre) se queda como está. Cargar dos veces no
 * duplica ni falla. Devuelve cuántos agregó.
 */
export async function loadUsHolidays(supabase: Db, year: number): Promise<{ added: number }> {
  const { data } = await supabase
    .from("pay_holidays")
    .upsert(usBankHolidays(year), { onConflict: "user_id,day", ignoreDuplicates: true })
    .select("id")
    .throwOnError();
  return { added: data.length };
}
