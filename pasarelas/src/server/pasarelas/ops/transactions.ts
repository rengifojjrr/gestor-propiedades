import "server-only";
import {
  PayStateError,
  formatDate,
  formatMoney,
  planCreate,
  planDeposit,
  planDispute,
  planEdit,
  planEstimated,
  planFail,
  planRecalc,
  planRefund,
  planRefundTotal,
  planReopen,
  planRestore,
  planRevertDeposit,
  planTransit,
  planTrash,
} from "@/lib/pasarelas";
import type { DiffRow, EditTxInput, ISODate, Money, NewTxInput, TxSnapshot, TxWrite } from "@/lib/pasarelas";
import type { Db } from "../dto";
import { UserError } from "../errors";
import { loadPayConfig } from "../queries/config";
import { chunked, getSnapshots } from "../queries/transactions";
import { SAVE_BATCH_SIZE, saveTx } from "../tx-save";
import { LIST_LIMIT, RECEIPTS_BUCKET } from "./receipts";

/**
 * Las escrituras sobre cobros. Cada una lee el cobro, deja que el motor planee el cambio (y diga si no
 * corresponde) y lo guarda con `pay_save_transactions`, que escribe el cobro, su reparto y su evento en una sola
 * transacción y rechaza el cambio si el cobro se movió entretanto. El cliente llega de fuera, con la sesión del
 * usuario: aquí no hay Next.
 *
 * Una operación que no cambia nada (el plan no trae ninguna columna) no llama a la base y no deja evento.
 *
 * Las de un solo cobro propagan el `PayStateError` del motor. Las de varios se saltan los cobros que no admiten
 * el cambio (o que ya no existen) y devuelven cuántos se escribieron, todos en un solo lote: o todos o ninguno.
 */

type RecalcMode = "hoy" | "fecha_del_cobro";

const NOT_FOUND_TEXT = "Ese cobro ya no existe.";
const PURGE_FILES_FAILED =
  "No se pudieron borrar los comprobantes de un cobro. Ese cobro sigue en la papelera: inténtalo de nuevo.";

const hasChanges = (write: TxWrite): boolean => Object.keys(write.fields).length > 0;

/** El cobro tal como está guardado. Si no existe (o es de otro usuario), un error para la persona. */
async function load(supabase: Db, id: string): Promise<TxSnapshot> {
  const [tx] = await getSnapshots(supabase, [id]);
  if (tx === undefined) throw new UserError(NOT_FOUND_TEXT);
  return tx;
}

/** Guarda el cambio planeado sobre un cobro, salvo que no cambie nada. */
async function commit(supabase: Db, write: TxWrite): Promise<void> {
  if (hasChanges(write)) await saveTx(supabase, [write]);
}

/** Los ids de un lote, sin repetir. Vacío o con más de 500, no se acepta. */
function batchOf(ids: readonly string[]): string[] {
  if (ids.length === 0) throw new UserError("Elige al menos un cobro.");
  if (ids.length > SAVE_BATCH_SIZE) throw new UserError(`Elige como máximo ${SAVE_BATCH_SIZE} cobros a la vez.`);
  return [...new Set(ids)];
}

/** El plan de un cobro dentro de un lote: `null` si el cobro no admite el cambio. Cualquier otro error sigue. */
function planOrSkip<Plan>(plan: () => Plan): Plan | null {
  try {
    return plan();
  } catch (error) {
    if (error instanceof PayStateError) return null;
    throw error;
  }
}

/** Aplica el mismo cambio a varios cobros y devuelve cuántos se escribieron. */
async function applyToAll(supabase: Db, ids: readonly string[], plan: (tx: TxSnapshot) => TxWrite): Promise<number> {
  const snapshots = await getSnapshots(supabase, batchOf(ids));
  const writes = snapshots.flatMap((tx) => {
    const write = planOrSkip(() => plan(tx));
    return write !== null && hasChanges(write) ? [write] : [];
  });
  await saveTx(supabase, writes);
  return writes.length;
}

// ─── Registrar y editar ─────────────────────────────────────────────────────────────────────────────────────

async function exists(supabase: Db, id: string): Promise<boolean> {
  const { data } = await supabase.from("pay_transactions").select("id").eq("id", id).throwOnError();
  return data.length > 0;
}

/** ¿Falló el alta porque ya hay un cobro con ese id? */
function isDuplicateId(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  return code === "23505" && typeof message === "string" && message.includes('"pay_transactions_pkey"');
}

/**
 * Registra un cobro, calculado en el servidor con la configuración de ahora. Es idempotente por `id` (lo pone el
 * formulario): si ya existe un cobro con ese id —el mismo envío que llega dos veces— devuelve `created: false`
 * sin tocar nada.
 */
export async function createTx(supabase: Db, input: NewTxInput): Promise<{ id: string; created: boolean }> {
  if (await exists(supabase, input.id)) return { id: input.id, created: false };
  const cfg = await loadPayConfig(supabase);
  try {
    await saveTx(supabase, [planCreate(cfg, input)]);
  } catch (error) {
    // Dos envíos a la vez: los dos pasan la comprobación de arriba y la base deja entrar a uno solo.
    if (isDuplicateId(error) && (await exists(supabase, input.id))) return { id: input.id, created: false };
    throw error;
  }
  return { id: input.id, created: true };
}

/** Edita un cobro: solo se vuelve a calcular lo que cambia. Sin cambios, `PayStateError("sin_cambios")`. */
export async function editTx(supabase: Db, id: string, input: EditTxInput): Promise<void> {
  const [tx, cfg] = await Promise.all([load(supabase, id), loadPayConfig(supabase)]);
  await commit(supabase, planEdit(cfg, tx, input));
}

// ─── Reembolsos, disputas y fallido ─────────────────────────────────────────────────────────────────────────

/** Un reembolso más, que se suma a lo ya reembolsado. */
export async function refundTx(
  supabase: Db,
  id: string,
  a: { amount: Money; on: ISODate; note?: string | null },
): Promise<void> {
  await commit(supabase, planRefund(await load(supabase, id), a));
}

/** Corrige el total reembolsado (en vez de sumarle). */
export async function setRefundTotalTx(supabase: Db, id: string, total: Money): Promise<void> {
  await commit(supabase, planRefundTotal(await load(supabase, id), total));
}

export async function disputeTx(
  supabase: Db,
  id: string,
  a: { action: "abrir" | "ganar" | "perder" | "anular"; on: ISODate },
): Promise<void> {
  await commit(supabase, planDispute(await load(supabase, id), a));
}

export async function failTx(supabase: Db, id: string): Promise<void> {
  await commit(supabase, planFail(await load(supabase, id)));
}

export async function reopenTx(supabase: Db, id: string): Promise<void> {
  await commit(supabase, planReopen(await load(supabase, id)));
}

// ─── El camino del dinero ───────────────────────────────────────────────────────────────────────────────────

/** Pasa a «en tránsito» los cobros registrados de la lista. Devuelve cuántos. */
export async function transitTx(supabase: Db, ids: string[]): Promise<number> {
  return applyToAll(supabase, ids, planTransit);
}

/** Marca como depositados el día `on` los cobros de la lista (o corrige la fecha de los que ya lo estaban). */
export async function depositTx(supabase: Db, ids: string[], on: ISODate): Promise<number> {
  return applyToAll(supabase, ids, (tx) => planDeposit(tx, on));
}

export async function revertDepositTx(supabase: Db, id: string): Promise<void> {
  await commit(supabase, planRevertDeposit(await load(supabase, id)));
}

/** Fija la fecha estimada a mano, o con `null` vuelve a la automática. */
export async function setEstimatedTx(supabase: Db, id: string, date: ISODate | null): Promise<void> {
  const [tx, cfg] = await Promise.all([load(supabase, id), loadPayConfig(supabase)]);
  await commit(supabase, planEstimated(cfg, tx, date));
}

// ─── Papelera ───────────────────────────────────────────────────────────────────────────────────────────────

export async function trashTx(supabase: Db, ids: string[]): Promise<number> {
  const now = new Date().toISOString();
  return applyToAll(supabase, ids, (tx) => planTrash(tx, now));
}

export async function restoreTx(supabase: Db, ids: string[]): Promise<number> {
  return applyToAll(supabase, ids, planRestore);
}

/**
 * Borra todos los archivos de una carpeta del bucket (la de un cobro, o la del logo de una empresa). Si Storage
 * deja alguno, lanza un `UserError` con `message`, que dice a la persona qué no se borró y qué quedó como estaba.
 */
export async function emptyFolder(supabase: Db, folder: string, message: string): Promise<void> {
  const bucket = supabase.storage.from(RECEIPTS_BUCKET);
  for (;;) {
    const listed = await bucket.list(folder, { limit: LIST_LIMIT });
    if (listed.error) throw listed.error;
    // Una subcarpeta viene con `id` nulo: no es un archivo.
    const paths = listed.data.filter((entry) => entry.id !== null).map((entry) => `${folder}/${entry.name}`);
    if (paths.length === 0) return;
    const removed = await bucket.remove(paths);
    if (removed.error) throw removed.error;
    // Storage no da error cuando no borra: dice qué borró.
    if (removed.data.length !== paths.length) throw new UserError(message);
    // Si la lista no vino llena, la carpeta se vio entera y ya está vacía. Si vino llena, puede haber más.
    if (listed.data.length < LIST_LIMIT) return;
  }
}

/**
 * Borra del todo los cobros de la lista que están en la papelera (los demás se saltan) y devuelve cuántos.
 * De cada uno, primero los archivos de su carpeta `{userId}/{id}/` —la base no puede borrarlos— y después la
 * fila, que se lleva en cascada su reparto, sus comprobantes y su historial. Si Storage no borra todos los
 * archivos de un cobro, se detiene ahí sin borrar su fila; los anteriores ya quedaron borrados.
 *
 * `userId` es el usuario de la sesión, dueño de las carpetas. Si un cobro de la lista no es suyo no se borra
 * nada: con otra carpeta no se encontrarían sus archivos y quedarían huérfanos.
 */
export async function purgeTx(supabase: Db, userId: string, ids: string[]): Promise<number> {
  const pages = await Promise.all(
    chunked(batchOf(ids)).map((chunk) =>
      supabase
        .from("pay_transactions")
        .select("id, user_id")
        .in("id", chunk)
        .not("deleted_at", "is", null)
        .throwOnError(),
    ),
  );
  const trashed = pages.flatMap((page) => page.data);
  if (trashed.some((row) => row.user_id !== userId)) {
    throw new Error("purgeTx: el usuario indicado no es el dueño de los cobros");
  }
  let purged = 0;
  for (const { id } of trashed) {
    await emptyFolder(supabase, `${userId}/${id}`, PURGE_FILES_FAILED);
    const { data } = await supabase
      .from("pay_transactions")
      .delete()
      .eq("id", id)
      .not("deleted_at", "is", null)
      .select("id")
      .throwOnError();
    purged += data.length;
  }
  return purged;
}

// ─── Recalcular ─────────────────────────────────────────────────────────────────────────────────────────────

/** Cómo se nombra un cobro en la vista previa: su fecha, lo cobrado y la pasarela con la que se registró. */
function labelOf(tx: TxSnapshot): string {
  const amount = formatMoney(tx.grossOriginal, tx.currency);
  return `${formatDate(tx.occurredOn)} · ${amount} · ${tx.breakdown.rules.gateway.name}`;
}

/**
 * Qué cambiaría al recalcular esos cobros con la configuración de ahora, sin escribir nada. `items` son los que
 * se escribirían (los mismos que cuenta `applyRecalcTx`), cada uno con su antes y su después; si cambia la fecha
 * estimada lleva además una fila «Fecha estimada» (y puede ser la única). Un cobro al que solo le cambian datos
 * que no son montos —el nombre de la pasarela, la versión de una tarifa igual— viene sin filas. `unchanged` son
 * los que quedarían idénticos. Los que no se pueden recalcular (fallidos, en la papelera) no están en ninguno.
 */
export async function previewRecalcTx(
  supabase: Db,
  ids: string[],
  mode: RecalcMode,
  today: ISODate,
): Promise<{ items: { id: string; label: string; changes: DiffRow[] }[]; unchanged: number }> {
  const [snapshots, cfg] = await Promise.all([getSnapshots(supabase, batchOf(ids)), loadPayConfig(supabase)]);
  const items: { id: string; label: string; changes: DiffRow[] }[] = [];
  let unchanged = 0;
  for (const tx of snapshots) {
    const plan = planOrSkip(() => planRecalc(cfg, tx, mode, today));
    if (plan === null) continue;
    if (!hasChanges(plan.write)) {
      unchanged += 1;
      continue;
    }
    const estimated = plan.write.fields.estimatedDepositOn;
    const dateRow: DiffRow[] =
      estimated === undefined
        ? []
        : [
            {
              key: "estimatedDepositOn",
              label: "Fecha estimada",
              before: tx.estimatedDepositOn ?? "—",
              after: estimated ?? "—",
            },
          ];
    items.push({ id: tx.id, label: labelOf(tx), changes: [...plan.changes, ...dateRow] });
  }
  return { items, unchanged };
}

/**
 * Recalcula esos cobros con la tarifa y el esquema vigentes hoy (`hoy`) o con los que correspondían a su fecha
 * (`fecha_del_cobro`), y devuelve cuántos cambiaron. Se escribe todo cobro al que le cambie algo, aunque no sea
 * un monto: puede cambiar solo la fecha estimada.
 */
export async function applyRecalcTx(supabase: Db, ids: string[], mode: RecalcMode, today: ISODate): Promise<number> {
  const wanted = batchOf(ids);
  const cfg = await loadPayConfig(supabase);
  return applyToAll(supabase, wanted, (tx) => planRecalc(cfg, tx, mode, today).write);
}
