import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { exportAll, type ExportFile } from "@/server/pasarelas/queries/export";
import { createUser, e1Item, saveTransactions, seedBasics, unwrap, type Db, type TestUser } from "./helpers";

/**
 * «Exportar todo»: la copia propia del dueño. Tiene que traer las 17 tablas con todas sus columnas, el dinero como
 * texto exacto, las tablas largas enteras y nada de otro usuario.
 */

const TABLAS = [
  "pay_companies",
  "pay_channels",
  "pay_gateways",
  "pay_gateway_fee_versions",
  "pay_gateway_extras",
  "pay_bank_accounts",
  "pay_company_gateways",
  "pay_beneficiaries",
  "pay_schemes",
  "pay_scheme_versions",
  "pay_scheme_lines",
  "pay_transactions",
  "pay_allocations",
  "pay_transaction_receipts",
  "pay_transaction_events",
  "pay_settlements",
  "pay_holidays",
];
/**
 * Columnas que ya no existen en la migración. Una base creada antes de quitarlas todavía las tiene, y aun así la
 * exportación no las trae: el contrato es la migración, no la base de turno.
 */
const RETIRADAS: Record<string, string[]> = { pay_transaction_receipts: ["original_name"] };

/** Las vistas de totales no se exportan: se calculan de las tablas. */
const VISTAS = ["pay_beneficiary_balances", "pay_company_totals", "pay_gateway_totals", "pay_bank_account_totals"];

const AHORA = "2026-11-13T15:00:00.000Z";
/** Más de un tramo de lectura (la API entrega 1000 filas por petición como mucho). */
const FERIADOS = 1005;

type Fila = Record<string, unknown>;
const sinTipos = (client: Db): SupabaseClient => client as unknown as SupabaseClient;

/**
 * Las columnas `numeric` de cada tabla y vista `pay_*`, según la propia API (su descripción OpenAPI): así la prueba
 * no depende de una lista escrita a mano que se quede vieja.
 */
async function numericosPorTabla(): Promise<Map<string, string[]>> {
  const secret = process.env.SUPABASE_SECRET_KEY ?? "";
  const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/`, {
    headers: { apikey: secret, Authorization: `Bearer ${secret}` },
  });
  if (!res.ok) throw new Error(`La API no describió sus tablas: estado ${res.status}`);
  const { definitions } = (await res.json()) as {
    definitions: Record<string, { properties: Record<string, { format?: string }> }>;
  };
  return new Map(
    Object.entries(definitions)
      .filter(([nombre]) => nombre.startsWith("pay_"))
      .map(([nombre, tabla]) => [
        nombre,
        Object.entries(tabla.properties)
          .filter(([, columna]) => columna.format?.startsWith("numeric"))
          .map(([columna]) => columna),
      ]),
  );
}

/** Un cliente cuya lectura siempre responde lo mismo, para ver qué hace el lector con una respuesta rara. */
function clienteQueResponde(respuesta: { data: Fila[]; count: number | null }): Db {
  const cadena: unknown = new Proxy(() => undefined, {
    get: (_destino, propiedad) =>
      propiedad === "then"
        ? (resolver: (valor: unknown) => void) => resolver({ ...respuesta, error: null })
        : () => cadena,
  });
  return { from: () => cadena } as unknown as Db;
}

let a: TestUser;
let b: TestUser;
let numericos: Map<string, string[]>;
let exportado: ExportFile;
let cobroId: string;

const filas = (tabla: string): Fila[] => exportado.tables[tabla] ?? [];

beforeAll(async () => {
  [a, b, numericos] = await Promise.all([createUser(), createUser(), numericosPorTabla()]);
  const basics = await seedBasics(a.client);
  await seedBasics(b.client);

  const [cobro] = await saveTransactions(a.client, [e1Item(basics)]);
  cobroId = cobro!.id;
  unwrap(
    await a.client
      .from("pay_transaction_receipts")
      .insert({ transaction_id: cobroId, path: `${a.id}/${cobroId}/comprobante.png`, mime: "image/png", size_bytes: 1234 })
      .select("id")
      .single(),
    "comprobante",
  );
  unwrap(
    await a.client
      .from("pay_settlements")
      .insert({ beneficiary_id: basics.beneficiaryIds.a, paid_on: "2026-11-16", amount: "45.15" })
      .select("id")
      .single(),
    "liquidación",
  );
  const feriados = Array.from({ length: FERIADOS }, (_, i) => ({
    day: new Date(Date.UTC(2001, 0, 1 + i)).toISOString().slice(0, 10),
    name: `Feriado de prueba ${i + 1}`,
  }));
  const { error } = await a.client.from("pay_holidays").insert(feriados);
  if (error) throw new Error(`feriados: ${error.message}`);

  exportado = await exportAll(a.client, AHORA);
});

describe("exportAll", () => {
  it("lleva el formato, su versión, la fecha y hora, y las 17 tablas", () => {
    expect(exportado.format).toBe("pasarelas-export");
    expect(exportado.version).toBe(1);
    expect(exportado.exportedAt).toBe(AHORA);
    expect(Object.keys(exportado.tables).sort()).toEqual([...TABLAS].sort());
  });

  it("no deja fuera ninguna tabla pay_* de la base", () => {
    const enLaBase = [...numericos.keys()].filter((nombre) => !VISTAS.includes(nombre));
    expect(enLaBase.sort()).toEqual([...TABLAS].sort());
  });

  it.each(TABLAS)("%s sale con todas sus columnas y sus valores", async (tabla) => {
    const exportadas = filas(tabla);
    expect(exportadas.length).toBeGreaterThan(0);

    const primera = exportadas[0]!;
    const enLaBase = unwrap(
      await sinTipos(a.client).from(tabla).select("*").eq("id", primera.id).single(),
      `${tabla} con select('*')`,
    ) as Fila;
    const columnas = Object.keys(enLaBase)
      .filter((columna) => !(RETIRADAS[tabla] ?? []).includes(columna))
      .sort();
    for (const fila of exportadas) expect(Object.keys(fila).sort()).toEqual(columnas);

    // Lo que no es dinero sale idéntico; el dinero, como texto que vale lo mismo.
    const dinero = numericos.get(tabla) ?? [];
    for (const columna of columnas) {
      if (dinero.includes(columna)) expect(Number(primera[columna]), columna).toBe(enLaBase[columna]);
      else expect(primera[columna], columna).toEqual(enLaBase[columna]);
    }
  });

  it("los comprobantes no traen el nombre original del archivo: puede traer datos de otra persona", () => {
    const [comprobante] = filas("pay_transaction_receipts");
    expect(comprobante).toBeDefined();
    expect(comprobante).not.toHaveProperty("original_name");
  });

  it("ningún numeric sale como número: todos son texto con sus decimales", () => {
    for (const tabla of TABLAS) {
      for (const columna of numericos.get(tabla) ?? []) {
        for (const fila of filas(tabla)) expect(fila[columna], `${tabla}.${columna}`).toEqual(expect.stringMatching(/^-?\d+\.\d+$/));
      }
    }
  });

  it("el cobro E1 sale con sus montos y porcentajes tal como están guardados", () => {
    const cobro = filas("pay_transactions").find((fila) => fila.id === cobroId);
    expect(cobro).toMatchObject({
      gross_original: "100.00",
      refunded_amount: "0.00",
      gross_amount: "100.00",
      fees_total: "9.70",
      net_amount: "90.30",
      alloc_base_amount: "90.30",
    });
    const reparto = filas("pay_allocations").map((fila) => `${String(fila.pct)} → ${String(fila.amount)}`);
    expect(reparto.sort()).toEqual(["20.0000 → 18.06", "30.0000 → 27.09", "50.0000 → 45.15"]);
    expect(filas("pay_gateway_fee_versions")[0]).toMatchObject({ pct: "2.9000", fixed: "0.30" });
    expect(filas("pay_gateway_extras")[0]).toMatchObject({ pct: "1.5000", fixed: "0.00" });
    expect(filas("pay_gateways")[0]).toMatchObject({ dispute_fee: "0.00" });
    expect(filas("pay_channels")[0]).toMatchObject({ platform_fee_pct: "5.0000", platform_fee_fixed: "0.00" });
    expect(filas("pay_scheme_lines").map((fila) => fila.pct).sort()).toEqual(["20.0000", "30.0000", "50.0000"]);
    expect(filas("pay_settlements")[0]).toMatchObject({ amount: "45.15" });
  });

  it(`con ${FERIADOS} feriados salen los ${FERIADOS}, sin repetir ninguno`, () => {
    const feriados = filas("pay_holidays");
    expect(feriados).toHaveLength(FERIADOS);
    expect(new Set(feriados.map((fila) => fila.id)).size).toBe(FERIADOS);
    expect(new Set(feriados.map((fila) => fila.day)).size).toBe(FERIADOS);
  });

  it("solo salen las filas de quien exporta: otro usuario no ve nada de eso", async () => {
    for (const tabla of TABLAS) {
      for (const fila of filas(tabla)) expect(fila.user_id, tabla).toBe(a.id);
    }

    const deB = await exportAll(b.client, AHORA);
    expect(Object.keys(deB.tables).sort()).toEqual([...TABLAS].sort());
    for (const tabla of TABLAS) {
      for (const fila of deB.tables[tabla] ?? []) expect(fila.user_id, tabla).toBe(b.id);
    }
    // B tiene su propia configuración, y nada de los cobros ni de los feriados de A.
    expect(deB.tables.pay_companies).toHaveLength(1);
    expect(deB.tables.pay_transactions).toEqual([]);
    expect(deB.tables.pay_holidays).toEqual([]);
  });

  it("si la API no dice cuántas filas hay, no da la tabla por leída", async () => {
    await expect(exportAll(clienteQueResponde({ data: [], count: null }), AHORA)).rejects.toThrow(/sin el total de filas/);
  });

  it("si la API dice que hay más filas de las que entrega, falla en vez de exportar a medias", async () => {
    await expect(exportAll(clienteQueResponde({ data: [], count: 3 }), AHORA)).rejects.toThrow(/faltan filas/);
  });
});
