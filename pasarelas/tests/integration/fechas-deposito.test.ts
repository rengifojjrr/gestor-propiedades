import { extractText, getDocumentProxy } from "unpdf";
import { describe, expect, it } from "vitest";
import { totalsOf, type PayConfig } from "@/lib/pasarelas";
import { txPdf } from "@/server/pasarelas/pdf/cobros";
import { pdfRequestOf } from "@/server/pasarelas/pdf/scope";
import { loadPayConfig } from "@/server/pasarelas/queries/config";
import { leanTx, listTx, parseTxFilters } from "@/server/pasarelas/queries/transactions";
import { createUser, e1Item, saveTransactions, seedBasics, type Db } from "./helpers";

/**
 * El período de Cobros por la fecha del depósito (`fechas=deposito`): la fecha en que se marcó depositado o, si no lo
 * está, la estimada (la más tardía de su ventana). Un cobro sin ninguna de las dos no entra. Lo mismo en la lista, su
 * página, los totales del filtro y el PDF (el CSV lee con `listTx`, igual que el PDF). Cada prueba crea su usuario.
 */

/** Martes 17 de noviembre de 2026, en Nueva York. */
const TODAY = "2026-11-17";
/** Martes 17 de noviembre de 2026, 15:00 de Nueva York: cuándo se genera el PDF. */
const NOW = new Date("2026-11-17T20:00:00Z");

type Ledger = { db: Db; cfg: PayConfig; ids: Record<string, string> };

/**
 * Cinco cobros E1 (100,00) del 2 al 6 de noviembre, por referencia:
 * - `cae-manana`: por caer, estimado (un solo día) el miércoles 18;
 * - `depositado-ayer`: estimado el 18, pero marcado depositado el lunes 16;
 * - `sin-fecha`: por caer y sin fecha estimada;
 * - `ventana`: estimado entre el 18 y el 19 (la fecha que cuenta es el 19);
 * - `cae-el-20`: estimado el viernes 20.
 */
async function ledger(): Promise<Ledger> {
  const { client: db } = await createUser();
  const basics = await seedBasics(db);
  const tx = (reference: string, day: string, columns: Record<string, string | null>) =>
    e1Item(basics, {
      reference,
      occurred_at: `2026-11-0${day}T15:00:00Z`,
      occurred_on: `2026-11-0${day}`,
      ...columns,
    });
  const saved = await saveTransactions(db, [
    tx("cae-manana", "2", { estimated_deposit_on: "2026-11-18" }),
    tx("depositado-ayer", "3", {
      estimated_deposit_on: "2026-11-18",
      status: "depositado",
      deposited_on: "2026-11-16",
    }),
    tx("sin-fecha", "4", { estimated_deposit_on: null }),
    tx("ventana", "5", { estimated_deposit_from: "2026-11-18", estimated_deposit_on: "2026-11-19" }),
    tx("cae-el-20", "6", { estimated_deposit_on: "2026-11-20" }),
  ]);
  const references = ["cae-manana", "depositado-ayer", "sin-fecha", "ventana", "cae-el-20"];
  const ids = Object.fromEntries(references.map((reference, i) => [reference, saved[i]?.id ?? ""]));
  return { db, cfg: await loadPayConfig(db), ids };
}

/** Las referencias de los cobros que trae la lista con esa URL, ordenadas. */
async function listed({ db, cfg }: Ledger, query: Record<string, string>): Promise<string[]> {
  const { filters, sort } = parseTxFilters(query, TODAY);
  const { rows, total } = await listTx(db, filters, sort, 1, TODAY, 50, cfg);
  expect(total).toBe(rows.length);
  return rows.map((row) => row.reference ?? "").sort();
}

const BY_DEPOSIT = { fechas: "deposito" };

describe("Cobros por la fecha del depósito", () => {
  it("R2: «Mañana» trae los por caer estimados el 18 (último día de su ventana), no el ya depositado", async () => {
    const book = await ledger();
    expect(await listed(book, { ...BY_DEPOSIT, periodo: "manana" })).toEqual(["cae-manana"]);
    // El depositado ayer sale con «Ayer», aunque su estimada fuera el 18.
    expect(await listed(book, { ...BY_DEPOSIT, periodo: "ayer" })).toEqual(["depositado-ayer"]);
    // La ventana del 18 al 19 cuenta por el 19: no sale el 18 para no pagar antes de que pueda llegar el dinero.
    const the19th = { ...BY_DEPOSIT, periodo: "personalizado", desde: "2026-11-19", hasta: "2026-11-19" };
    expect(await listed(book, the19th)).toEqual(["ventana"]);
    // Los próximos 7 días (del 17 al 23): los tres por caer con fecha.
    const nextDays = await listed(book, { ...BY_DEPOSIT, periodo: "proximos_7d" });
    expect(nextDays).toEqual(["cae-el-20", "cae-manana", "ventana"]);
    expect(await listed(book, { ...BY_DEPOSIT, periodo: "hoy" })).toEqual([]);
  });

  it("R3: sin fecha estimada ni depósito no sale por depósito; por la venta, sí", async () => {
    const book = await ledger();
    const all = ["cae-el-20", "cae-manana", "depositado-ayer", "sin-fecha", "ventana"];
    expect(await listed(book, { periodo: "este_mes" })).toEqual(all);
    expect(await listed(book, { ...BY_DEPOSIT, periodo: "este_mes" })).toEqual(["depositado-ayer"]);
    expect(
      await listed(book, { ...BY_DEPOSIT, periodo: "personalizado", desde: "2026-11-01", hasta: "2026-12-31" }),
    ).toEqual(all.filter((reference) => reference !== "sin-fecha"));
    // Con la venta, «Mañana» no vale: rige este mes (y fechas a futuro no traen ventas que no hubo).
    expect(await listed(book, { periodo: "manana" })).toEqual(all);
    expect(await listed(book, { periodo: "personalizado", desde: "2026-11-18", hasta: "2026-11-30" })).toEqual([]);
  });

  it("la página, los totales del filtro y el PDF dicen lo mismo que la lista", async () => {
    const book = await ledger();
    const query = { ...BY_DEPOSIT, periodo: "proximos_7d" };
    const { filters } = parseTxFilters(query, TODAY);
    // La página: dos de 2 en 2, sin repetir ni perder ninguno.
    const pages = await Promise.all(
      [1, 2].map((page) => listTx(book.db, filters, "estimada_asc", page, TODAY, 2, book.cfg)),
    );
    expect(pages.map((page) => page.total)).toEqual([3, 3]);
    const references = pages.flatMap((page) => page.rows.map((row) => row.reference));
    expect(references).toEqual(["cae-manana", "ventana", "cae-el-20"]);
    // Los totales: los tres, 3 × 90,30 de neto.
    const totals = totalsOf(await leanTx(book.db, filters, TODAY, book.cfg));
    expect(totals.USD).toMatchObject({ count: 3, gross: "300.00", net: "270.90" });
    // El PDF: los mismos tres, y lo dice en el encabezado.
    const pdf = await txPdf(book.db, book.cfg, pdfRequestOf(new URLSearchParams(query), TODAY), NOW);
    expect(pdf).toMatchObject({ ok: true, count: 3 });
    if (!pdf.ok) return;
    const { text } = await extractText(await getDocumentProxy(new Uint8Array(pdf.bytes)), { mergePages: true });
    expect(text).toContain("Depósitos del mar 17 nov 2026 al lun 23 nov 2026");
    for (const reference of ["cae-manana", "ventana", "cae-el-20"]) expect(text).toContain(reference);
    expect(text).not.toContain("depositado-ayer");
  });

  it("la RLS: otro usuario no ve ninguno", async () => {
    await ledger();
    const { client: other } = await createUser();
    const { filters, sort } = parseTxFilters({ ...BY_DEPOSIT, periodo: "proximos_7d" }, TODAY);
    expect(await listTx(other, filters, sort, 1, TODAY)).toEqual({ rows: [], total: 0 });
    expect(await leanTx(other, filters, TODAY)).toEqual([]);
  });
});
