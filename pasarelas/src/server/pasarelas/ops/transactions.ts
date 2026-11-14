import "server-only";
import {
  PayStateError,
  depositWindowOf,
  formatDate,
  isPending,
  formatMoney,
  planCreate,
  planDeposit,
  planDispute,
  planEdit,
  planEstimateRefresh,
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
  requireSameRegistration,
} from "@/lib/pasarelas";
import type {
  DateWindow,
  DiffRow,
  EditTxInput,
  ISODate,
  Money,
  NewTxInput,
  TxSnapshot,
  TxWrite,
} from "@/lib/pasarelas";
import type { Db } from "../dto";
import { PAID_TX_PURGE_TEXT, UserError } from "../errors";
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
 * Las de un solo cobro propagan el `PayStateError` del motor y reciben, si la hay, la versión del cobro que vio la
 * persona (`expected`, su `updatedAt`): la base compara contra esa y no contra la que se acaba de leer, así que una
 * pantalla vieja (o un reintento tras un corte, cuando el primer envío sí llegó) da conflicto en vez de pisar o
 * de sumar dos veces. Las de varios se saltan los cobros que no admiten el cambio (o que ya no existen) y
 * devuelven cuántos se escribieron, todos en un solo lote: o todos o ninguno.
 */

type RecalcMode = "hoy" | "fecha_del_cobro";

const NOT_FOUND_TEXT = "Ese cobro ya no existe.";
const PURGE_FILES_FAILED =
  "No se pudieron borrar los comprobantes de un cobro. Ese cobro sigue en la papelera: inténtalo de nuevo.";
/** La clave de las partes pagadas hacia su cobro: sin cascada, la base no deja borrar un cobro que las tenga. */
const PAID_ITEMS_FK = "pay_settlement_items_transaction_fk";

const hasChanges = (write: TxWrite): boolean => Object.keys(write.fields).length > 0;

/**
 * El cobro tal como está guardado. Si no existe (o es de otro usuario), un error para la persona. Con `expected`
 * (la versión que vio la persona), el plan lleva esa versión: es `pay_save_transactions` quien la compara, como
 * instante y no como texto. Si el cambio no toca nada, no se escribe y no hay conflicto.
 */
async function load(supabase: Db, id: string, expected?: string): Promise<TxSnapshot> {
  const [tx] = await getSnapshots(supabase, [id]);
  if (tx === undefined) throw new UserError(NOT_FOUND_TEXT);
  return expected === undefined ? tx : { ...tx, updatedAt: expected };
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

/**
 * Aplica el mismo cambio a varios cobros: cuántos se escribieron y, de los que el motor rechazó, cuántos con cada
 * código. Los que no existen o no cambian no están en ninguno de los dos.
 */
async function applyToAllWithSkips(
  supabase: Db,
  ids: readonly string[],
  plan: (tx: TxSnapshot) => TxWrite,
): Promise<{ count: number; refused: Partial<Record<PayStateError["code"], number>> }> {
  const snapshots = await getSnapshots(supabase, batchOf(ids));
  const refused: Partial<Record<PayStateError["code"], number>> = {};
  const writes = snapshots.flatMap((tx) => {
    try {
      const write = plan(tx);
      return hasChanges(write) ? [write] : [];
    } catch (error) {
      if (!(error instanceof PayStateError)) throw error;
      refused[error.code] = (refused[error.code] ?? 0) + 1;
      return [];
    }
  });
  await saveTx(supabase, writes);
  return { count: writes.length, refused };
}

/** Aplica el mismo cambio a varios cobros y devuelve cuántos se escribieron. */
async function applyToAll(supabase: Db, ids: readonly string[], plan: (tx: TxSnapshot) => TxWrite): Promise<number> {
  return (await applyToAllWithSkips(supabase, ids, plan)).count;
}

// ─── Registrar y editar ─────────────────────────────────────────────────────────────────────────────────────

/** ¿Falló el alta porque ya hay un cobro con ese id? */
function isDuplicateId(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  return code === "23505" && typeof message === "string" && message.includes('"pay_transactions_pkey"');
}

/**
 * Si ya hay un cobro con ese id: `false` si no; si lo hay y trae lo mismo, `true` (el mismo envío); si lo hay con
 * otros datos, `PayStateError("ya_registrado")`.
 */
async function alreadyRegistered(supabase: Db, input: NewTxInput): Promise<boolean> {
  const [saved] = await getSnapshots(supabase, [input.id]);
  if (saved === undefined) return false;
  requireSameRegistration(saved, input);
  return true;
}

/**
 * Registra un cobro, calculado en el servidor con la configuración de ahora. Es idempotente por `id` (lo pone el
 * formulario): si ya existe un cobro con ese id —el mismo envío que llega dos veces— devuelve `created: false`
 * sin tocar nada. Si el que existe tiene otros datos (se corrigió el monto tras un corte en el que el primer
 * envío sí llegó), no escribe nada y lanza `PayStateError("ya_registrado")`: lo corregido no se guardó.
 */
export async function createTx(supabase: Db, input: NewTxInput): Promise<{ id: string; created: boolean }> {
  if (await alreadyRegistered(supabase, input)) return { id: input.id, created: false };
  const cfg = await loadPayConfig(supabase);
  try {
    await saveTx(supabase, [planCreate(cfg, input)]);
  } catch (error) {
    // Dos envíos a la vez: los dos pasan la comprobación de arriba y la base deja entrar a uno solo.
    // El que entró se compara igual que arriba; si el id es de otro usuario (no se ve), sigue el error de la base.
    if (isDuplicateId(error) && (await alreadyRegistered(supabase, input))) return { id: input.id, created: false };
    throw error;
  }
  return { id: input.id, created: true };
}

/** Edita un cobro: solo se vuelve a calcular lo que cambia. Sin cambios, `PayStateError("sin_cambios")`. */
export async function editTx(supabase: Db, id: string, input: EditTxInput, expected?: string): Promise<void> {
  const [tx, cfg] = await Promise.all([load(supabase, id, expected), loadPayConfig(supabase)]);
  await commit(supabase, planEdit(cfg, tx, input));
}

// ─── Reembolsos, disputas y fallido ─────────────────────────────────────────────────────────────────────────

/** Un reembolso más, que se suma a lo ya reembolsado. */
export async function refundTx(
  supabase: Db,
  id: string,
  a: { amount: Money; on: ISODate; note?: string | null },
  expected?: string,
): Promise<void> {
  await commit(supabase, planRefund(await load(supabase, id, expected), a));
}

/** Corrige el total reembolsado (en vez de sumarle). */
export async function setRefundTotalTx(supabase: Db, id: string, total: Money, expected?: string): Promise<void> {
  await commit(supabase, planRefundTotal(await load(supabase, id, expected), total));
}

export async function disputeTx(
  supabase: Db,
  id: string,
  a: { action: "abrir" | "ganar" | "perder" | "anular"; on: ISODate },
  expected?: string,
): Promise<void> {
  await commit(supabase, planDispute(await load(supabase, id, expected), a));
}

export async function failTx(supabase: Db, id: string, expected?: string): Promise<void> {
  await commit(supabase, planFail(await load(supabase, id, expected)));
}

export async function reopenTx(supabase: Db, id: string, expected?: string): Promise<void> {
  await commit(supabase, planReopen(await load(supabase, id, expected)));
}

// ─── El camino del dinero ───────────────────────────────────────────────────────────────────────────────────

/** Pasa a «en tránsito» los cobros registrados de la lista. Devuelve cuántos. */
export async function transitTx(supabase: Db, ids: string[]): Promise<number> {
  return applyToAll(supabase, ids, planTransit);
}

/** Lo que dice un depósito en lote: cuántos se marcaron y, de los que no, por qué. */
export type DepositOutcome = {
  count: number;
  skipped: {
    /** Ya estaban depositados: conservan su fecha real (solo con `onlyPending`). */
    deposited: number;
    /** Con la disputa abierta o reembolsados del todo: no están por caer (solo con `onlyPending`). */
    notPending: number;
    /** Fallidos, en la papelera, con el depósito antes del cobro, que ya no existen o que no cambiaban. */
    other: number;
  };
};

/**
 * Marca como depositados el día `on` los cobros de la lista y dice cuántos se saltaron y por qué. Con
 * `onlyPending` (el lote de Cobros y del Resumen) solo lo que está por caer: lo ya depositado conserva su fecha
 * real. Sin la marca (el detalle de un cobro), uno ya depositado toma la fecha nueva.
 */
export async function depositTxWithSkips(
  supabase: Db,
  ids: string[],
  on: ISODate,
  opts: { onlyPending: boolean },
): Promise<DepositOutcome> {
  const { count, refused } = await applyToAllWithSkips(supabase, ids, (tx) => planDeposit(tx, on, opts));
  const deposited = refused.depositado ?? 0;
  const notPending = refused.no_por_caer ?? 0;
  return { count, skipped: { deposited, notPending, other: new Set(ids).size - count - deposited - notPending } };
}

/**
 * Marca depositado el día `on` un solo cobro, el del detalle, con la versión que vio la persona (`expected`): si el
 * cobro cambió desde entonces (otra pestaña abrió una disputa, o puso otra fecha de depósito), conflicto en vez de
 * pisarlo. Si ya está depositado, cambia la fecha. Lo que el cobro no admite lo dice con `PayStateError`, en vez
 * de saltarlo como el lote. Devuelve lo mismo que el lote: `count` 0 si la fecha ya era esa.
 */
export async function depositOneTx(supabase: Db, id: string, on: ISODate, expected: string): Promise<DepositOutcome> {
  const write = planDeposit(await load(supabase, id, expected), on);
  await commit(supabase, write);
  const count = hasChanges(write) ? 1 : 0;
  return { count, skipped: { deposited: 0, notPending: 0, other: 1 - count } };
}

/** Como `depositTxWithSkips`, solo con cuántos se marcaron. Sin `onlyPending`, corrige la fecha de los ya depositados. */
export async function depositTx(
  supabase: Db,
  ids: string[],
  on: ISODate,
  opts: { onlyPending: boolean } = { onlyPending: false },
): Promise<number> {
  return (await depositTxWithSkips(supabase, ids, on, opts)).count;
}

export async function revertDepositTx(supabase: Db, id: string, expected?: string): Promise<void> {
  await commit(supabase, planRevertDeposit(await load(supabase, id, expected)));
}

/** Fija la fecha estimada a mano, o con `null` vuelve a la automática. */
export async function setEstimatedTx(
  supabase: Db,
  id: string,
  date: ISODate | null,
  expected?: string,
): Promise<void> {
  const [tx, cfg] = await Promise.all([load(supabase, id, expected), loadPayConfig(supabase)]);
  await commit(supabase, planEstimated(cfg, tx, date));
}

/** Lo más que trae una página de la API. */
const API_PAGE = 1000;

/** Qué cobros recalcula `refreshEstimatesTx`: los de una pasarela, los de una empresa, o los de las dos. */
export type EstimatesScope = { gatewayId?: string; companyId?: string };

/**
 * Vuelve a calcular, con la configuración de ahora (los feriados, los días de cada pasarela y de su cuenta en cada
 * empresa), la fecha estimada AUTOMÁTICA de lo que está por caer: no toca las puestas a mano, ni comisiones ni
 * montos. Con `gatewayId` o `companyId`, solo los cobros de esa pasarela o de esa empresa. Devuelve cuántas fechas
 * cambiaron; las que ya estaban al día no se escriben. El historial dice que las cambió la app.
 */
export async function refreshEstimatesTx(supabase: Db, opts: EstimatesScope = {}): Promise<number> {
  const ids: string[] = [];
  for (;;) {
    let query = supabase
      .from("pay_transactions")
      .select("id")
      .is("deleted_at", null)
      .in("status", ["registrado", "en_transito"])
      .eq("estimated_is_manual", false);
    if (opts.gatewayId !== undefined) query = query.eq("gateway_id", opts.gatewayId);
    if (opts.companyId !== undefined) query = query.eq("company_id", opts.companyId);
    const { data } = await query
      .order("id")
      .range(ids.length, ids.length + API_PAGE - 1)
      .throwOnError();
    ids.push(...data.map((row) => row.id));
    if (data.length < API_PAGE) break;
  }
  if (ids.length === 0) return 0;
  const cfg = await loadPayConfig(supabase);
  let changed = 0;
  for (const chunk of chunked(ids, SAVE_BATCH_SIZE)) {
    const writes = (await getSnapshots(supabase, chunk))
      .filter((tx) => isPending(tx) && !tx.estimatedIsManual)
      .map((tx) => planEstimateRefresh(cfg, tx))
      .filter(hasChanges);
    await saveTx(supabase, writes);
    changed += writes.length;
  }
  return changed;
}

/**
 * `refreshEstimatesTx` después de un cambio que ya quedó guardado (un feriado, los días de una pasarela o de su
 * cuenta en una empresa): si no se pudo, el cambio sigue en pie y devuelve `null` —no un «No se pudo guardar» que
 * no sería cierto— y deja el fallo en el registro del servidor, como `runAction` con lo que no se esperaba.
 */
export async function refreshEstimatesAfterTx(supabase: Db, opts: EstimatesScope = {}): Promise<number | null> {
  try {
    return await refreshEstimatesTx(supabase, opts);
  } catch (error) {
    console.error("[refreshEstimatesTx]", error);
    return null;
  }
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
 *
 * Un cobro con partes del reparto ya pagadas (`pay_settlement_items`) no se borra: primero se deshacen esos pagos.
 * Se mira antes de tocar nada (también sus archivos); si alguno lo tiene, no se borra ninguno de la lista. La base
 * lo vuelve a exigir al borrar la fila (un pago que llega entre medias).
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
  const paid = await Promise.all(
    chunked(trashed.map((row) => row.id)).map((chunk) =>
      supabase.from("pay_settlement_items").select("id").in("transaction_id", chunk).limit(1).throwOnError(),
    ),
  );
  if (paid.some((page) => page.data.length > 0)) throw new UserError(PAID_TX_PURGE_TEXT);
  let purged = 0;
  for (const { id } of trashed) {
    await emptyFolder(supabase, `${userId}/${id}`, PURGE_FILES_FAILED);
    const { data, error } = await supabase
      .from("pay_transactions")
      .delete()
      .eq("id", id)
      .not("deleted_at", "is", null)
      .select("id");
    if (error?.code === "23503" && error.message.includes(PAID_ITEMS_FK)) throw new UserError(PAID_TX_PURGE_TEXT);
    if (error) throw error;
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
 * Las filas de la fecha estimada en el antes y el después de recalcular: ninguna si no cambia. Si antes y después es
 * un solo día, «Fecha estimada»; si hay una ventana de por medio, «Llega desde» y «Llega hasta», cada una solo si
 * cambia.
 */
function estimateRows(tx: TxSnapshot, write: TxWrite): DiffRow[] {
  const { estimatedDepositFrom: from, estimatedDepositOn: on } = write.fields;
  if (from === undefined && on === undefined) return [];
  const before = depositWindowOf(tx);
  const after = depositWindowOf({
    estimatedDepositFrom: from === undefined ? tx.estimatedDepositFrom : from,
    estimatedDepositOn: on === undefined ? tx.estimatedDepositOn : on,
  });
  const isWindow = (w: DateWindow | null): boolean => w !== null && w.from !== w.to;
  const row = (key: "estimatedDepositFrom" | "estimatedDepositOn", label: string, end: "from" | "to"): DiffRow[] => {
    const [was, will] = [before?.[end] ?? "—", after?.[end] ?? "—"];
    return was === will ? [] : [{ key, label, before: was, after: will }];
  };
  if (!isWindow(before) && !isWindow(after)) return row("estimatedDepositOn", "Fecha estimada", "to");
  return [...row("estimatedDepositFrom", "Llega desde", "from"), ...row("estimatedDepositOn", "Llega hasta", "to")];
}

/**
 * Qué cambiaría al recalcular esos cobros con la configuración de ahora, sin escribir nada. `items` son los que
 * se escribirían (los mismos que cuenta `applyRecalcTx`), cada uno con su antes y su después; si cambia la fecha
 * estimada lleva además sus filas (`estimateRows`, y pueden ser las únicas). Un cobro al que solo le cambian datos
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
    items.push({ id: tx.id, label: labelOf(tx), changes: [...plan.changes, ...estimateRows(tx, plan.write)] });
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

/**
 * Recalcula un solo cobro, el del detalle, con la versión que vio la persona (`expected`): si cambió desde que
 * se vio el antes y el después, conflicto. Devuelve 1 si cambió algo y 0 si ya estaba al día.
 */
export async function applyRecalcOneTx(
  supabase: Db,
  id: string,
  mode: RecalcMode,
  today: ISODate,
  expected: string,
): Promise<number> {
  const [tx, cfg] = await Promise.all([load(supabase, id, expected), loadPayConfig(supabase)]);
  const { write } = planRecalc(cfg, tx, mode, today);
  await commit(supabase, write);
  return hasChanges(write) ? 1 : 0;
}
