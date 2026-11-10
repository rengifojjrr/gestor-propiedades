import "server-only";

/** El tope de filas por petición de la API. */
export const PAGE_SIZE = 1000;

/** Lo que se pasa a `select()` para que cada tramo traiga el total de filas de la lectura. */
export const EXACT_COUNT = { count: "exact" } as const;

/** La lectura de un tramo: las filas `from` a `to` (ambas incluidas) y el total de filas de toda la lectura. */
export type PageRead<Row> = (from: number, to: number) => PromiseLike<{ data: Row[]; count: number | null }>;

/**
 * Todas las filas de una lectura. La API da 1000 por petición como mucho, sin avisar de que hay más: se pide por
 * tramos hasta tener las que la propia lectura dice que hay. Con menos de 1000 filas es una sola petición. Si un
 * tramo llega sin ese total no se puede saber si están todas: se lanza, en vez de dar la lectura por completa.
 *
 * `page` arma la lectura de un tramo (filas `from` a `to`, ambas incluidas) con `EXACT_COUNT` y un orden que termine
 * en una columna única, para que sea estable entre tramos. `what` nombra la lectura en el error («de configuración»).
 */
export async function readAll<Row>(page: PageRead<Row>, what: string): Promise<Row[]> {
  const rows: Row[] = [];
  for (;;) {
    const { data, count } = await page(rows.length, rows.length + PAGE_SIZE - 1);
    if (count === null) {
      throw new Error(`Una lectura ${what} llegó sin el total de filas (count): no se sabe si están todas.`);
    }
    rows.push(...data);
    if (data.length === 0 || rows.length >= count) return rows;
  }
}
