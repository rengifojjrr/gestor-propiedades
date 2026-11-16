import "server-only";
import { hrefWith } from "@/components/ui/url";
import { summarize } from "@/lib/pasarelas";
import type { Currency, ISODate, Totals } from "@/lib/pasarelas";
import type { Db } from "../dto";
import { NO_LOADER, leanTx, parseTxFilters, type TxFilters } from "./transactions";

/**
 * Lo que pinta la pantalla de Cargadores: cada cargador con su nota, cuántos cobros tiene (lo que decide si se puede
 * borrar) y sus ventas del período, y una fila más con las ventas sin cargador (lo que falta asignar).
 *
 * Las ventas de cada fila son los cobros que trae la lista de Cobros con el filtro de ese cargador y ese período
 * (`leanTx`, con el mismo constructor de filtros que la lista), y sus cifras salen del motor (`summarize`), las
 * mismas que el Resumen: por eso, sumadas entre todas las filas, dan las del Resumen del mismo período. Cada fila
 * trae el enlace a esa lista, desde donde se exporta el CSV o el PDF.
 */

const TX_LIST = "/pasarelas/cobros";
/** Las claves de la URL del período, que pasan tal cual al enlace de cada fila. */
const PERIOD_KEYS = ["periodo", "desde", "hasta"] as const;

type SearchParams = Record<string, string | string[] | undefined>;

/** Un cargador como lo pinta su tarjeta. */
export type LoaderView = {
  id: string;
  name: string;
  note: string | null;
  active: boolean;
  /** Sus cobros, contando los fallidos y los de la papelera: con alguno, no se puede borrar. */
  txCount: number;
};

/** Las cifras del período en una moneda (`summarize` del motor). */
export type CurrencySales = { currency: Currency; totals: Totals };

/** Las ventas del período de una fila del reporte, por moneda, y el enlace a esos cobros en la lista. */
export type LoaderSales = { sales: CurrencySales[]; href: string };

export type LoaderReport = {
  period: { from: ISODate; to: ISODate };
  /** Los cargadores, los activos primero y por nombre, cada uno con sus ventas del período. */
  loaders: (LoaderView & LoaderSales)[];
  /** Las ventas del período sin cargador. */
  unassigned: LoaderSales;
};

/** Cuántos cobros tiene el cargador. Una petición sin filas: solo el total. */
async function txCountOf(supabase: Db, id: string): Promise<number> {
  const { count } = await supabase
    .from("pay_transactions")
    .select("id", { count: "exact", head: true })
    .eq("loader_id", id)
    .throwOnError();
  if (count === null) throw new Error("El conteo de cobros de un cargador llegó sin el total (count).");
  return count;
}

/**
 * Todos los cargadores del usuario, los activos primero y por nombre. Son pocos: los cobros de cada uno se cuentan
 * con una petición por cargador, todas a la vez (como las cuentas destino).
 */
export async function listLoaders(supabase: Db): Promise<LoaderView[]> {
  const { data } = await supabase
    .from("pay_loaders")
    .select("id, name, note, active")
    .order("active", { ascending: false })
    .order("name")
    .order("id")
    .throwOnError();
  const counts = await Promise.all(data.map((row) => txCountOf(supabase, row.id)));
  return data.map((row, index) => ({ ...row, txCount: counts[index] ?? 0 }));
}

/** Las cifras por moneda de los cobros del filtro, en orden alfabético de moneda (sin las que solo tienen fallidos). */
async function salesOf(supabase: Db, filters: TxFilters, today: ISODate): Promise<CurrencySales[]> {
  const byCurrency = summarize(await leanTx(supabase, filters, today), today);
  return Object.keys(byCurrency)
    .sort()
    .flatMap((currency) => {
      const summary = byCurrency[currency];
      return summary === undefined ? [] : [{ currency, totals: summary.totals }];
    });
}

/**
 * El reporte del período que pide la URL (`periodo`, `desde`, `hasta`, como el Resumen; sin ellos, este mes): cada
 * cargador con sus ventas y su enlace, y la fila «Sin cargador». Una lectura por fila, todas a la vez.
 */
export async function loadLoaderReport(supabase: Db, sp: SearchParams, today: ISODate): Promise<LoaderReport> {
  // `parseTxFilters` siempre trae el período (sin `periodo`, este mes).
  const { from = today, to = today } = parseTxFilters(sp, today).filters;
  const query = new URLSearchParams();
  for (const key of PERIOD_KEYS) {
    const value = sp[key];
    const first = Array.isArray(value) ? value[0] : value;
    if (first !== undefined && first !== "") query.set(key, first);
  }
  const rowOf = async (loaderId: string | null): Promise<LoaderSales> => ({
    sales: await salesOf(supabase, { from, to, loaderId }, today),
    href: hrefWith(TX_LIST, query, { cargador: loaderId ?? NO_LOADER }),
  });
  const [unassigned, loaders] = await Promise.all([
    rowOf(null),
    listLoaders(supabase).then((list) =>
      Promise.all(list.map(async (loader) => ({ ...loader, ...(await rowOf(loader.id)) }))),
    ),
  ]);
  return { period: { from, to }, loaders, unassigned };
}
