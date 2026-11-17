import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import {
  add,
  mapRows,
  presetFor,
  totalsOf,
  type ColumnMapping,
  type Currency,
  type ImportRow,
  type NewTxInput,
  type Totals,
} from "@/lib/pasarelas";
import { proposeMapping } from "@/components/pasarelas/import/plan";
import { UserError } from "@/server/pasarelas/errors";
import { importTransactions, previewImport, saveImportMapping } from "@/server/pasarelas/ops/import";
import { deleteLoader, saveLoader, setLoaderActive } from "@/server/pasarelas/ops/loaders";
import { assignLoaderTx, createTx, editTx, trashTx } from "@/server/pasarelas/ops/transactions";
import { loadPayConfig } from "@/server/pasarelas/queries/config";
import { getImportMappings } from "@/server/pasarelas/queries/import";
import { listLoaders, loadLoaderReport, type LoaderReport } from "@/server/pasarelas/queries/loaders";
import { loadSummary } from "@/server/pasarelas/queries/summary";
import { getTx, leanTx, listTx, parseTxFilters } from "@/server/pasarelas/queries/transactions";
import {
  adminClient,
  createUser,
  e1Item,
  expectRejected,
  saveTransactions,
  seedBasics,
  unwrap,
  type Basics,
  type Db,
  type TestUser,
} from "./helpers";

/**
 * El cargador de cada cobro (migración 20261117120000): la persona que trajo la venta, para reportarle lo suyo. Es
 * un catálogo del usuario (`pay_loaders`) y una columna opcional del cobro (`pay_transactions.loader_id`). Solo sirve
 * para reportar: no cambia ninguna cifra. Datos inventados: «Cargador Uno», «Cargador Dos».
 *
 * La RLS, el segundo factor y los permisos de `pay_loaders` los recorre `rls.test.ts`, como en todas las tablas; el
 * borrado del usuario, `borrar-usuario.test.ts`; «Exportar todo», `exportar.test.ts`.
 */

/** Viernes 13 de noviembre de 2026, 10:30 de Nueva York. */
const VIERNES_10_30 = "2026-11-13T15:30:00Z";
const VIERNES = "2026-11-13";
const TODAY = "2026-11-20";
/** El período «este mes» del 20 de noviembre: del 1 al 20. */
const ESTE_MES = { periodo: "este_mes" } as const;

async function nuevoCargador(client: Db, name: string): Promise<string> {
  return unwrap(await client.from("pay_loaders").insert({ name }).select("id").single(), name).id;
}

async function cargadorDe(client: Db, txId: string): Promise<string | null> {
  return unwrap(await client.from("pay_transactions").select("loader_id").eq("id", txId).single(), "cargador").loader_id;
}

/** El cobro E1 del spec: 100,00 por el canal al 5 %, con Stripe y «Pago rápido», repartido 50/30/20. */
function e1(b: Basics, patch: Partial<NewTxInput> = {}): NewTxInput {
  return {
    id: randomUUID(),
    companyId: b.companyId,
    channelId: b.channelId,
    gatewayId: b.gatewayId,
    extraIds: [b.extraId],
    schemeId: b.schemeId,
    occurredOn: VIERNES,
    occurredAt: VIERNES_10_30,
    currency: "USD",
    grossOriginal: "100.00",
    reference: null,
    note: null,
    ...patch,
  };
}

async function register(user: TestUser, b: Basics, patch: Partial<NewTxInput> = {}): Promise<string> {
  const { id, created } = await createTx(user.client, e1(b, patch));
  expect(created).toBe(true);
  return id;
}

/** Los resúmenes de los historiales de un cobro, del más reciente al más antiguo. */
async function historial(client: Db, txId: string): Promise<string[]> {
  return (await getTx(client, txId))?.events.map((event) => event.summary) ?? [];
}

describe("pay_loaders: el catálogo de cargadores", () => {
  let a: TestUser;
  let b: TestUser;

  beforeAll(async () => {
    [a, b] = await Promise.all([createUser(), createUser()]);
  });

  it("C1: el nombre es único por usuario, sin distinguir mayúsculas ni espacios de más", async () => {
    const id = await nuevoCargador(a.client, "Cargador Uno");
    const fila = unwrap(
      await a.client.from("pay_loaders").select("id, user_id, name, note, active, created_at").eq("id", id).single(),
      "cargador",
    );
    expect(fila).toMatchObject({ id, user_id: a.id, name: "Cargador Uno", note: null, active: true });

    for (const repetido of [" cargador uno ", "CARGADOR  UNO", "cargador\tuno"]) {
      expectRejected(await a.client.from("pay_loaders").insert({ name: repetido }).select("id"), "23505");
    }
    // Otro usuario sí puede tener uno con ese nombre: el único es por usuario.
    await expect(nuevoCargador(b.client, "Cargador Uno")).resolves.toEqual(expect.any(String));
  });

  it("el nombre no puede quedar vacío ni pasar de 80; la nota, de 500", async () => {
    expectRejected(await a.client.from("pay_loaders").insert({ name: "   " }).select("id"), "23514");
    expectRejected(await a.client.from("pay_loaders").insert({ name: "x".repeat(81) }).select("id"), "23514");
    expectRejected(
      await a.client.from("pay_loaders").insert({ name: "Con nota larga", note: "x".repeat(501) }).select("id"),
      "23514",
    );
  });
});

describe("pay_transactions.loader_id: el cargador de un cobro", () => {
  let user: TestUser;
  let otro: TestUser;
  let basics: Basics;

  beforeAll(async () => {
    [user, otro] = await Promise.all([createUser(), createUser()]);
    basics = await seedBasics(user.client);
  });

  it("un cobro sin decirlo queda sin cargador", async () => {
    const [cobro] = await saveTransactions(user.client, [e1Item(basics, { reference: "sin-cargador" })]);
    expect(await cargadorDe(user.client, cobro!.id)).toBeNull();
  });

  it("pay_save_transactions acepta loader_id en el alta y en la actualización; sin decirlo no lo toca", async () => {
    const uno = await nuevoCargador(user.client, "Cargador Uno");
    const dos = await nuevoCargador(user.client, "Cargador Dos");
    const [cobro] = await saveTransactions(user.client, [e1Item(basics, { reference: "con-cargador", loader_id: uno })]);
    const id = cobro!.id;
    expect(await cargadorDe(user.client, id)).toBe(uno);

    const editado = { kind: "editado", summary: "Editado: cargador", data: null };
    await saveTransactions(user.client, [{ mode: "update", tx: { id, loader_id: dos }, event: editado }]);
    expect(await cargadorDe(user.client, id)).toBe(dos);

    await saveTransactions(user.client, [{ mode: "update", tx: { id, note: "Otra nota" }, event: editado }]);
    expect(await cargadorDe(user.client, id)).toBe(dos);

    await saveTransactions(user.client, [{ mode: "update", tx: { id, loader_id: null }, event: editado }]);
    expect(await cargadorDe(user.client, id)).toBeNull();
  });

  it("la clave no lleva cascada: un cargador con cobros no se borra; sin cobros, sí", async () => {
    const conCobros = await nuevoCargador(user.client, "Con cobros");
    const sinCobros = await nuevoCargador(user.client, "Sin cobros");
    const [cobro] = await saveTransactions(user.client, [e1Item(basics, { reference: "fk", loader_id: conCobros })]);

    expectRejected(
      await user.client.from("pay_loaders").delete().eq("id", conCobros).select("id"),
      "23503",
      "pay_transactions_loader_fk",
    );
    expect(await cargadorDe(user.client, cobro!.id)).toBe(conCobros);

    const borrado = await user.client.from("pay_loaders").delete().eq("id", sinCobros).select("id");
    expect(borrado.error).toBeNull();
    expect(borrado.data).toEqual([{ id: sinCobros }]);
  });

  it("un cobro no puede llevar el cargador de otro usuario", async () => {
    const ajeno = await nuevoCargador(otro.client, "Cargador ajeno");
    const res = await user.client.rpc("pay_save_transactions", {
      p_items: [e1Item(basics, { reference: "ajeno", loader_id: ajeno })],
    });
    expectRejected(res, "23503", "pay_transactions_loader_fk");
    const guardados = unwrap(
      await adminClient().from("pay_transactions").select("id").eq("reference", "ajeno").eq("user_id", user.id),
      "cobros",
    );
    expect(guardados).toEqual([]);
  });
});

describe("los cargadores en la app: alta, nombre, desactivar y borrar", () => {
  let user: TestUser;

  /** El id del cargador con ese nombre. */
  const idOf = async (name: string): Promise<string> => {
    const loader = (await listLoaders(user.client)).find((candidate) => candidate.name === name);
    if (loader === undefined) throw new Error(`No hay un cargador «${name}»`);
    return loader.id;
  };

  beforeAll(async () => {
    user = await createUser();
  });

  it("C1: se crea con su nombre limpio; el mismo nombre con otras mayúsculas o espacios se rechaza y lo dice", async () => {
    const id = await saveLoader(user.client, { id: null, name: "  Cargador   Uno ", note: null });
    const [cargador] = await listLoaders(user.client);
    expect(cargador).toEqual({ id, name: "Cargador Uno", note: null, active: true, txCount: 0 });

    const repetido = saveLoader(user.client, { id: null, name: " cargador uno ", note: null });
    await expect(repetido).rejects.toThrow(UserError);
    await expect(repetido).rejects.toThrow("Ya hay un cargador con ese nombre.");
    expect(await listLoaders(user.client)).toHaveLength(1);
  });

  it("se renombra y se le pone una nota; renombrarlo como otro que ya existe se rechaza", async () => {
    const dos = await saveLoader(user.client, { id: null, name: "Cargador Dos", note: null });
    await saveLoader(user.client, { id: dos, name: "Cargador Dos Bis", note: "Trae las ventas de la feria" });
    expect((await listLoaders(user.client)).find((loader) => loader.id === dos)).toMatchObject({
      name: "Cargador Dos Bis",
      note: "Trae las ventas de la feria",
    });
    await expect(saveLoader(user.client, { id: dos, name: "CARGADOR UNO", note: null })).rejects.toThrow(
      "Ya hay un cargador con ese nombre.",
    );
    await expect(saveLoader(user.client, { id: randomUUID(), name: "Nadie", note: null })).rejects.toThrow(
      "Ese cargador ya no existe.",
    );
  });

  it("la lista va con los activos primero y cuántos cobros tiene cada uno (también los de la papelera)", async () => {
    const basics = await seedBasics(user.client);
    const [uno, dos] = await Promise.all([idOf("Cargador Uno"), idOf("Cargador Dos Bis")]);
    const cobro = await register(user, basics, { loaderId: uno });
    await register(user, basics, { loaderId: uno });
    await trashTx(user.client, [cobro]);
    await setLoaderActive(user.client, uno, false);

    expect((await listLoaders(user.client)).map(({ name, active, txCount }) => [name, active, txCount])).toEqual([
      ["Cargador Dos Bis", true, 0],
      ["Cargador Uno", false, 2],
    ]);
    // Desactivado sigue en la configuración: los cobros que lo tienen lo siguen nombrando.
    expect((await loadPayConfig(user.client)).loaders).toEqual([
      { id: dos, name: "Cargador Dos Bis", active: true },
      { id: uno, name: "Cargador Uno", active: false },
    ]);
  });

  it("C5: borrar uno con cobros se niega y ofrece desactivarlo; sin cobros se borra", async () => {
    const [uno, dos] = await Promise.all([idOf("Cargador Uno"), idOf("Cargador Dos Bis")]);
    const negado = deleteLoader(user.client, uno);
    await expect(negado).rejects.toThrow(UserError);
    await expect(negado).rejects.toThrow(/tiene cobros: no se puede borrar\. Desactívalo/);
    expect(await listLoaders(user.client)).toHaveLength(2);

    await deleteLoader(user.client, dos);
    expect((await listLoaders(user.client)).map((loader) => loader.id)).toEqual([uno]);
    await expect(deleteLoader(user.client, dos)).rejects.toThrow("Ese cargador ya no existe.");
  });
});

describe("el cargador de cada cobro: registrar, editar, asignar en lote y filtrar", () => {
  let user: TestUser;
  let basics: Basics;
  let uno: string;
  let dos: string;

  beforeAll(async () => {
    user = await createUser();
    basics = await seedBasics(user.client);
    uno = await saveLoader(user.client, { id: null, name: "Cargador Uno", note: null });
    dos = await saveLoader(user.client, { id: null, name: "Cargador Dos", note: null });
  });

  it("C2: registrar con «Cargador Uno» lo guarda; el detalle y la lista lo dicen; las cifras son las de siempre", async () => {
    const id = await register(user, basics, { loaderId: uno, reference: "c2" });
    const detalle = await getTx(user.client, id);
    expect(detalle).toMatchObject({ loaderId: uno, gross: "100.00", fees: "9.70", net: "90.30" });
    expect(detalle?.allocations.map((line) => line.amount)).toEqual(["45.15", "27.09", "18.06"]);
    const { rows } = await listTx(user.client, { q: "c2" }, "fecha_desc", 1, TODAY);
    expect(rows.map((row) => row.loaderId)).toEqual([uno]);
  });

  it("editar el cargador deja «Editado: cargador» en el historial, sin tocar ninguna cifra", async () => {
    const id = await register(user, basics, { reference: "editar" });
    const antes = await getTx(user.client, id);
    await editTx(user.client, id, { loaderId: dos }, antes?.updatedAt);
    const despues = await getTx(user.client, id);
    expect(despues?.loaderId).toBe(dos);
    expect(despues?.breakdown).toEqual(antes?.breakdown);
    expect(despues?.allocations).toEqual(antes?.allocations);
    expect(await historial(user.client, id)).toEqual(["Editado: cargador", "Cobro de $100,00 por Stripe"]);
  });

  it("C3: tres sin cargador → «Cargador Dos» en un paso, cada uno con su evento; repetirlo no cambia nada", async () => {
    const ids = await Promise.all(
      ["c3-a", "c3-b", "c3-c"].map((reference) => register(user, basics, { reference, grossOriginal: "50.00" })),
    );

    expect(await assignLoaderTx(user.client, ids, dos)).toBe(3);
    for (const id of ids) {
      expect(await cargadorDe(user.client, id)).toBe(dos);
      expect((await historial(user.client, id))[0]).toBe("Editado: cargador");
    }
    expect(await assignLoaderTx(user.client, ids, dos)).toBe(0);
    for (const id of ids) expect(await historial(user.client, id)).toHaveLength(2);
  });

  it("asignar en lote también quita el cargador y se salta los de la papelera", async () => {
    const [enLaPapelera, vivo] = await Promise.all([
      register(user, basics, { reference: "lote-papelera", loaderId: uno }),
      register(user, basics, { reference: "lote-vivo", loaderId: uno }),
    ]);
    await trashTx(user.client, [enLaPapelera]);
    expect(await assignLoaderTx(user.client, [enLaPapelera, vivo], null)).toBe(1);
    expect(await cargadorDe(user.client, vivo)).toBeNull();
    expect(await cargadorDe(user.client, enLaPapelera)).toBe(uno);
  });

  it("el filtro «Cargador» va en la URL: un cargador, o «sin»; lo demás se ignora", () => {
    expect(parseTxFilters({ cargador: dos }, TODAY).filters.loaderId).toBe(dos);
    expect(parseTxFilters({ cargador: dos.toUpperCase() }, TODAY).filters.loaderId).toBe(dos);
    expect(parseTxFilters({ cargador: "sin" }, TODAY).filters.loaderId).toBeNull();
    expect("loaderId" in parseTxFilters({ cargador: "otro" }, TODAY).filters).toBe(false);
    expect("loaderId" in parseTxFilters({}, TODAY).filters).toBe(false);
  });

  it("C3: el filtro «Cargador Dos» trae los suyos con sus totales; «sin cargador», los que no tienen", async () => {
    const deDos = parseTxFilters({ ...ESTE_MES, cargador: dos }, TODAY).filters;
    const lista = await listTx(user.client, deDos, "fecha_desc", 1, TODAY, 2);
    expect(lista.total).toBe(4);
    expect(lista.rows).toHaveLength(2);
    expect(lista.rows.every((row) => row.loaderId === dos)).toBe(true);
    const lean = await leanTx(user.client, deDos, TODAY);
    expect(lean).toHaveLength(4);
    // E1 (9,70 de comisiones) y tres de 50,00 (5,00 cada uno: 1,75 de Stripe, 0,75 de «Pago rápido» y 2,50 del canal).
    expect(totalsOf(lean)).toEqual({ USD: { count: 4, gross: "250.00", fees: "24.70", net: "225.30" } });

    const sin = parseTxFilters({ ...ESTE_MES, cargador: "sin" }, TODAY).filters;
    const sinCargador = await listTx(user.client, sin, "fecha_desc", 1, TODAY);
    expect(sinCargador.rows.map((row) => row.reference)).toEqual(["lote-vivo"]);
    expect(sinCargador.total).toBe(1);
  });
});

describe("C4: el reporte por cargador del período", () => {
  let user: TestUser;
  let basics: Basics;
  let uno: string;
  let dos: string;

  /** Las cifras de una moneda: lo que el reporte enseña de cada cargador. */
  const cifras = (totals: Totals) => ({
    count: totals.count,
    gross: totals.gross,
    fees: totals.fees,
    net: totals.net,
    pendingPayout: totals.pendingPayout,
    depositedPayout: totals.depositedPayout,
  });

  beforeAll(async () => {
    user = await createUser();
    basics = await seedBasics(user.client);
    uno = await saveLoader(user.client, { id: null, name: "Cargador Uno", note: null });
    dos = await saveLoader(user.client, { id: null, name: "Cargador Dos", note: null });
    await saveLoader(user.client, { id: null, name: "Cargador Tres", note: null });
    // Cargador Uno con 1 cobro, Cargador Dos con 3 y dos sin cargador; uno más, del mes anterior, que no cuenta.
    await register(user, basics, { loaderId: uno, grossOriginal: "200.00" });
    for (const gross of ["50.00", "60.00", "70.00"]) await register(user, basics, { loaderId: dos, grossOriginal: gross });
    await register(user, basics, { grossOriginal: "80.00" });
    await register(user, basics, { grossOriginal: "90.00", status: "depositado", depositedOn: "2026-11-17" });
    await register(user, basics, {
      loaderId: uno,
      occurredAt: "2026-10-13T15:30:00Z",
      occurredOn: "2026-10-13",
    });
  });

  it("cada cargador con sus cobros y cifras del motor, «Sin cargador» con el resto, y su enlace a la lista", async () => {
    const report = await loadLoaderReport(user.client, ESTE_MES, TODAY);
    expect(report.period).toEqual({ from: "2026-11-01", to: TODAY });
    const row = (name: string) => report.loaders.find((loader) => loader.name === name);

    expect(row("Cargador Uno")?.sales.map((sale) => [sale.currency, sale.totals.count, sale.totals.gross])).toEqual([
      ["USD", 1, "200.00"],
    ]);
    expect(row("Cargador Dos")?.sales.map((sale) => [sale.currency, sale.totals.count, sale.totals.gross])).toEqual([
      ["USD", 3, "180.00"],
    ]);
    expect(row("Cargador Tres")?.sales).toEqual([]);
    expect(report.unassigned.sales.map((sale) => [sale.currency, sale.totals.count, sale.totals.gross])).toEqual([
      ["USD", 2, "170.00"],
    ]);

    expect(row("Cargador Uno")?.href).toBe(`/pasarelas/cobros?periodo=este_mes&cargador=${uno}`);
    expect(report.unassigned.href).toBe("/pasarelas/cobros?periodo=este_mes&cargador=sin");
    // El enlace trae exactamente lo que suma su fila.
    const deDos = parseTxFilters({ periodo: "este_mes", cargador: dos }, TODAY).filters;
    expect(totalsOf(await leanTx(user.client, deDos, TODAY)).USD?.count).toBe(3);
  });

  it("D3: «Ayer» u «Hoy» escritos a mano en la URL valen «Este mes», como dice su selector, y sus enlaces también", async () => {
    const esteMes = await loadLoaderReport(user.client, ESTE_MES, TODAY);
    const sales = (report: LoaderReport) => [...report.loaders.map((loader) => loader.sales), report.unassigned.sales];
    for (const periodo of ["ayer", "hoy", "manana", "proximos_7d"]) {
      for (const fechas of [{}, { fechas: "deposito" }]) {
        const report = await loadLoaderReport(user.client, { periodo, ...fechas }, TODAY);
        expect(report.period).toEqual(esteMes.period);
        expect(sales(report)).toEqual(sales(esteMes));
        // El enlace a la lista no lleva ese período: la lista también dice «Este mes».
        expect(report.unassigned.href).toBe("/pasarelas/cobros?cargador=sin");
      }
    }
  });

  it("D3: el Resumen, igual: lo que filtra es lo que dice su selector, y lo que enlaza también", async () => {
    const cfg = await loadPayConfig(user.client);
    const esteMes = await loadSummary(user.client, ESTE_MES, TODAY, cfg);
    for (const periodo of ["ayer", "hoy"]) {
      const view = await loadSummary(user.client, { periodo }, TODAY, cfg);
      expect(view.period).toEqual(esteMes.period);
      expect(view.summary).toEqual(esteMes.summary);
      expect(view.links.pending).not.toContain("periodo=");
    }
  });

  it("las cifras cuadran con el Resumen del mismo período: cada una, sumada entre cargadores y «Sin cargador»", async () => {
    const report = await loadLoaderReport(user.client, ESTE_MES, TODAY);
    const resumen = await loadSummary(user.client, ESTE_MES, TODAY, await loadPayConfig(user.client));
    const grupos = [...report.loaders.map((loader) => loader.sales), report.unassigned.sales];
    const enUSD = (sales: { currency: Currency; totals: Totals }[]) =>
      sales.filter((sale) => sale.currency === "USD").map((sale) => cifras(sale.totals));
    const sumados = grupos.flatMap(enUSD).reduce((total, cada) => ({
      count: total.count + cada.count,
      gross: add(total.gross, cada.gross),
      fees: add(total.fees, cada.fees),
      net: add(total.net, cada.net),
      pendingPayout: add(total.pendingPayout, cada.pendingPayout),
      depositedPayout: add(total.depositedPayout, cada.depositedPayout),
    }));
    expect(resumen.summary).not.toBeNull();
    expect(sumados).toEqual(cifras(resumen.summary!.totals));
  });
});

describe("C6: importar un archivo con la columna «cargador»", () => {
  let user: TestUser;
  let basics: Basics;
  let uno: string;
  let dos: string;

  /** Una fila ya convertida, como la manda el navegador: 100,00 USD el 13/11/2026 a las 10:30 de Nueva York. */
  const fila = (line: number, reference: string, loader?: string): ImportRow => ({
    line,
    reference,
    occurredAt: "2026-11-13T15:30:00.000Z",
    occurredOn: "2026-11-13",
    grossOriginal: "100.00",
    currency: "USD",
    reportedFee: null,
    note: null,
    ...(loader === undefined ? {} : { loader }),
  });
  const lote = (rows: unknown[]) => ({
    companyId: basics.companyId,
    gatewayId: basics.gatewayId,
    channelId: null,
    extraIds: [],
    useReportedFee: false,
    rows,
  });
  const cargadorPorReferencia = async (references: string[]) => {
    const { data } = await user.client
      .from("pay_transactions")
      .select("reference, loader_id")
      .in("reference", references)
      .throwOnError();
    return Object.fromEntries(data.map((row) => [row.reference, row.loader_id]));
  };

  beforeAll(async () => {
    user = await createUser();
    basics = await seedBasics(user.client);
    uno = await saveLoader(user.client, { id: null, name: "Cargador Uno", note: null });
    dos = await saveLoader(user.client, { id: null, name: "Cargador Dos", note: null });
    // Desactivado sigue valiendo al importar: un archivo trae ventas pasadas, y sus cobros lo conservan.
    await setLoaderActive(user.client, dos, false);
  });

  it("con un nombre que existe (sin distinguir mayúsculas ni espacios de más), el cobro queda con ese cargador", async () => {
    const rows = [fila(2, "imp-uno", "cargador  UNO"), fila(3, "imp-dos", "Cargador Dos"), fila(4, "imp-sin")];
    const preview = await previewImport(user.client, lote(rows));
    expect(preview.unknownLoaders).toEqual([]);

    const result = await importTransactions(user.client, { ...lote(rows), alreadyDeposited: false });
    expect(result.created).toBe(3);
    expect(await cargadorPorReferencia(["imp-uno", "imp-dos", "imp-sin"])).toEqual({
      "imp-uno": uno,
      "imp-dos": dos,
      "imp-sin": null,
    });
  });

  it("con uno que no existe, la vista previa lo dice por fila; importarla igual no guarda nada del lote", async () => {
    const rows = [fila(2, "imp-ok", "Cargador Uno"), fila(3, "imp-nadie", "Cargador Tres"), fila(4, "imp-otra", "cargador tres")];
    const preview = await previewImport(user.client, lote(rows));
    expect(preview.unknownLoaders).toEqual([
      { line: 3, name: "Cargador Tres" },
      { line: 4, name: "cargador tres" },
    ]);
    // Las demás filas se calculan igual.
    expect(preview.estimates.map((estimate) => estimate.line)).toEqual([2, 3, 4]);

    const negado = importTransactions(user.client, { ...lote(rows), alreadyDeposited: false });
    await expect(negado).rejects.toThrow(UserError);
    await expect(negado).rejects.toThrow(
      "La línea 3 no se puede importar: no hay ningún cargador «Cargador Tres». Créalo en Cargadores (o quita la fila) y vuelve a importar. No se guardó nada de este lote.",
    );
    expect(await cargadorPorReferencia(["imp-ok", "imp-nadie", "imp-otra"])).toEqual({});

    // Creado el cargador, el mismo archivo entra entero.
    const tres = await saveLoader(user.client, { id: null, name: "Cargador Tres", note: null });
    expect((await previewImport(user.client, lote(rows))).unknownLoaders).toEqual([]);
    await importTransactions(user.client, { ...lote(rows), alreadyDeposited: false });
    expect(await cargadorPorReferencia(["imp-ok", "imp-nadie", "imp-otra"])).toEqual({
      "imp-ok": uno,
      "imp-nadie": tres,
      "imp-otra": tres,
    });
  });

  it("el mapeo recordado de la pasarela recuerda también la columna del cargador", async () => {
    const mapping: ColumnMapping = {
      reference: "ref",
      date: "fecha",
      gross: "monto",
      loader: "cargador",
      fixedZone: "UTC",
      decimal: ".",
      dateFormat: "YYYY-MM-DD",
      defaultCurrency: "USD",
    };
    await saveImportMapping(user.client, { gatewayId: basics.gatewayId, format: "otro", mapping });
    expect((await getImportMappings(user.client))[basics.gatewayId]?.mapping.loader).toBe("cargador");
    // Un mapeo de antes, sin la columna, se sigue leyendo: sin cargador.
    const { loader: _, ...before } = mapping;
    await saveImportMapping(user.client, { gatewayId: basics.gatewayId, format: "otro", mapping: before });
    expect((await getImportMappings(user.client))[basics.gatewayId]?.mapping.loader).toBeNull();
  });

  it("con un mapeo recordado antes del cargador, la columna «cargador» del archivo se lee igual", async () => {
    // Guardado como antes de la migración 8: sin la clave del cargador.
    const { loader: _, ...saldo } = presetFor("stripe_saldo")!;
    await user.client
      .from("pay_gateways")
      .update({ import_mapping: { format: "stripe_saldo", mapping: saldo } })
      .eq("id", basics.gatewayId)
      .throwOnError();
    const saved = (await getImportMappings(user.client))[basics.gatewayId];
    expect(saved?.mapping.loader).toBeNull();

    // Un informe de saldo de Stripe al que se le agregó la columna «Cargador».
    const headers = [
      "balance_transaction_id",
      "created_utc",
      "currency",
      "gross",
      "fee",
      "reporting_category",
      "Cargador",
    ];
    const cell = (reference: string, loader: string) => ({
      balance_transaction_id: reference,
      created_utc: "2026-11-13 15:30:00",
      currency: "usd",
      gross: "100.00",
      fee: "3.20",
      reporting_category: "charge",
      Cargador: loader,
    });
    const proposal = proposeMapping(headers, saved);
    expect(proposal).toEqual({ format: "stripe_saldo", mapping: { ...saldo, loader: "Cargador" }, from: "guardado" });

    const rows = [cell("txn_t55_uno", "Cargador Uno"), cell("txn_t55_sin", "")];
    const { ok, errors } = mapRows(rows, proposal.mapping, proposal.format);
    expect(errors).toEqual([]);
    expect(ok.map((row) => row.loader)).toEqual(["Cargador Uno", undefined]);
    await importTransactions(user.client, { ...lote(ok), alreadyDeposited: false });
    expect(await cargadorPorReferencia(["txn_t55_uno", "txn_t55_sin"])).toEqual({
      txn_t55_uno: uno,
      txn_t55_sin: null,
    });
  });

  it("un cargador vacío o de más de 80 caracteres no pasa la validación del servidor", async () => {
    for (const loader of ["", "  Cargador Uno", "c".repeat(81)]) {
      await expect(previewImport(user.client, lote([fila(7, "imp-mal", loader)]))).rejects.toThrow(
        "La línea 7 no se puede importar: el cargador está vacío, tiene espacios de más alrededor o pasa de 80 caracteres.",
      );
    }
  });
});

describe("lo que no cambia: los cobros, los totales y las vistas de siempre dan exactamente lo mismo", () => {
  it("asignar y quitar cargadores no mueve un centavo de ninguna vista ni de los totales", async () => {
    const user = await createUser();
    const basics = await seedBasics(user.client);
    const ids = await Promise.all(
      ["10.00", "20.00", "30.00"].map((gross) => register(user, basics, { grossOriginal: gross })),
    );
    await user.client
      .from("pay_settlements")
      .insert({ beneficiary_id: basics.beneficiaryIds.a, paid_on: "2026-11-16", amount: "5.00" })
      .throwOnError();

    const foto = async () => ({
      saldos: unwrap(await user.client.from("pay_beneficiary_balances").select("*").order("beneficiary_id"), "saldos"),
      empresas: unwrap(await user.client.from("pay_company_totals").select("*"), "empresas"),
      pasarelas: unwrap(await user.client.from("pay_gateway_totals").select("*"), "pasarelas"),
      cuentas: unwrap(await user.client.from("pay_bank_account_totals").select("*"), "cuentas"),
      totales: totalsOf(await leanTx(user.client, {}, TODAY)),
      cobros: (await listTx(user.client, {}, "fecha_desc", 1, TODAY)).rows.map(({ loaderId: _, updatedAt: __, ...row }) => row),
    });
    const antes = await foto();

    const cargador = await saveLoader(user.client, { id: null, name: "Cargador Uno", note: null });
    expect(await assignLoaderTx(user.client, ids, cargador)).toBe(3);
    expect(await foto()).toEqual(antes);
    expect(await assignLoaderTx(user.client, ids, null)).toBe(3);
    expect(await foto()).toEqual(antes);
  });
});
