import { randomUUID } from "node:crypto";
import { extractText, getDocumentProxy } from "unpdf";
import { describe, expect, it } from "vitest";
import type { PayConfig } from "@/lib/pasarelas";
import { pdfResponse, txPdf } from "@/server/pasarelas/pdf/cobros";
import { pdfRequestOf } from "@/server/pasarelas/pdf/scope";
import { recordPayouts, type PayoutInput } from "@/server/pasarelas/ops/settlements";
import { createTx, trashTx } from "@/server/pasarelas/ops/transactions";
import { loadPayConfig } from "@/server/pasarelas/queries/config";
import { anonClient, createUser, e1Item, saveTransactions, seedBasics, unwrap, type Basics, type Db } from "./helpers";

/**
 * El PDF de cobros contra el Supabase local: lee con el cliente del usuario (la RLS manda), toma cada cobro de su
 * desglose congelado y arma un PDF de verdad, cuyo texto se extrae con `unpdf`. Cada prueba crea su usuario.
 */

/** Las 03:30 del sábado 14 de noviembre en UTC: todavía viernes 13, 22:30, en Nueva York. */
const NOW = new Date("2026-11-14T03:30:00Z");
const TODAY = "2026-11-13";

type Owner = { db: Db; basics: Basics; cfg: () => Promise<PayConfig> };

async function owner(): Promise<Owner> {
  const { client: db } = await createUser();
  const basics = await seedBasics(db);
  return { db, basics, cfg: () => loadPayConfig(db) };
}

/** El PDF que pide esa URL, como lo pide la ruta. */
async function pdfOf({ db, cfg }: Owner, query: string) {
  return txPdf(db, await cfg(), pdfRequestOf(new URLSearchParams(query), TODAY), NOW);
}

/** El texto de todo el PDF. */
async function textOf(bytes: Uint8Array): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
}

/** Un pago a ese beneficiario de lo suyo en esos cobros (cobro y monto), como «Marcar pagado…». */
function payout(beneficiaryId: string, items: [transactionId: string, amount: string][]): PayoutInput {
  return {
    id: randomUUID(),
    beneficiaryId,
    currency: "USD",
    paidOn: "2026-11-12",
    method: null,
    items: items.map(([transactionId, amount]) => ({ transactionId, amount })),
  };
}

/** Un cobro E1 (100,00 → comisiones 9,70, neto 90,30) con esa referencia, a esa hora (UTC) y en esa moneda. */
async function e1({ db, basics }: Owner, reference: string, at = "2026-11-13T15:00:00Z", currency = "USD") {
  const on = new Date(new Date(at).getTime() - 5 * 3_600_000).toISOString().slice(0, 10);
  const [saved] = await saveTransactions(db, [
    e1Item(basics, { reference, currency, occurred_at: at, occurred_on: on, estimated_deposit_on: on }),
  ]);
  return unwrap({ data: saved?.id ?? null, error: null }, "cobro");
}

/** OTF Demo con su retención y el esquema de E10, y los ids de cada beneficiario por nombre. */
type E10 = {
  gatewayId: string;
  schemeId: string;
  ids: Record<"Grupo A" | "Grupo B" | "Titular A" | "Titular B", string>;
};

/**
 * E10 con las operaciones de la app: Titular A y Titular B; «OTF Demo» (2,9 % + 0,20) retiene el 5 % durante 30
 * días para los dos, mitad y mitad; el esquema «Sobre el neto» da Grupo A 60 %, Grupo B 30 % y 5 % a cada titular,
 * los dos sin comisión.
 */
async function setupE10({ db, basics }: Owner): Promise<E10> {
  const titulares = unwrap(
    await db.from("pay_beneficiaries").insert([{ name: "Titular A" }, { name: "Titular B" }]).select("id, name"),
    "titulares",
  );
  const idOf = (name: string) => titulares.find((row) => row.name === name)?.id ?? "";
  const gatewayId = unwrap(
    await db.rpc("pay_create_gateway", { p: { name: "OTF Demo", fee: { pct: "2.9", fixed: "0.20" } } }),
    "pasarela",
  ) as string;
  const scheme = unwrap(
    await db.rpc("pay_save_scheme", {
      p: {
        name: "Sobre el neto",
        base: "neto",
        lines: [
          { beneficiary_id: basics.beneficiaryIds.a, pct: "60" },
          { beneficiary_id: basics.beneficiaryIds.b, pct: "30" },
          { beneficiary_id: idOf("Titular A"), pct: "5", fee_exempt: true },
          { beneficiary_id: idOf("Titular B"), pct: "5", fee_exempt: true },
        ],
      },
    }),
    "esquema",
  ) as { scheme_id: string };
  await db
    .rpc("pay_save_gateway_retention", {
      p: {
        gateway_id: gatewayId,
        pct: "5",
        days: 30,
        recipients: [
          { beneficiary_id: idOf("Titular A"), pct: "50" },
          { beneficiary_id: idOf("Titular B"), pct: "50" },
        ],
      },
    })
    .throwOnError();
  const ids = {
    "Grupo A": basics.beneficiaryIds.a,
    "Grupo B": basics.beneficiaryIds.b,
    "Titular A": idOf("Titular A"),
    "Titular B": idOf("Titular B"),
  };
  return { gatewayId, schemeId: scheme.scheme_id, ids };
}

/** Un cobro E10: 1000,00 USD el martes 10 de noviembre al mediodía, por OTF Demo y con el esquema de E10. */
async function chargeE10({ db, basics }: Owner, e10: E10, reference: string): Promise<string> {
  const id = randomUUID();
  await createTx(db, {
    id,
    companyId: basics.companyId,
    channelId: null,
    gatewayId: e10.gatewayId,
    extraIds: [],
    schemeId: e10.schemeId,
    occurredAt: "2026-11-10T17:00:00Z",
    occurredOn: "2026-11-10",
    currency: "USD",
    grossOriginal: "1000.00",
    reference,
    note: null,
    feesPaidBy: "nosotros",
  });
  return id;
}

describe("el PDF de cobros", () => {
  it("D1: E10 solo, elegido: un PDF válido con sus cifras, su retención, su reparto y los acentos bien", async () => {
    const me = await owner();
    const id = await chargeE10(me, await setupE10(me), "pi_d1");
    const result = await pdfOf(me, `id=${id}`);
    if (!result.ok) throw new Error(result.message);
    expect(result).toMatchObject({ fileName: "cobros-elegidos-2026-11-13.pdf", count: 1 });

    const pdf = await getDocumentProxy(new Uint8Array(result.bytes));
    expect(pdf.numPages).toBe(1);
    expect((await pdf.getPage(1)).getViewport({ scale: 1 })).toMatchObject({ width: 612, height: 792 });

    const text = await textOf(result.bytes);
    for (const expected of [
      "Cobros",
      "Seleccionados (1)",
      "Generado el vie 13 nov 2026, 22:30 (hora de Nueva York)",
      "Escuela Demo",
      "mar 10 nov 2026, 12:00",
      "OTF Demo · Ref. pi_d1 · USD",
      "Bruto $1.000,00",
      "OTF Demo $29,20",
      "2,9 % + $0,20 de $1.000,00",
      "Comisiones $29,20",
      "Comisión pagada por Nosotros",
      "Neto $970,80",
      "Retiene OTF Demo (5 %) $50,00",
      "Titular A $25,00",
      "Titular B $25,00",
      "Se libera hacia el jue 10 dic 2026",
      "Llega al banco $920,80",
      "Sobre el neto $970,80",
      "Grupo A (60 %) $580,53",
      "Grupo B (30 %) $290,27",
      "Titular A (5 %) · no paga comisión $50,00",
      "Titular B (5 %) · no paga comisión $50,00",
      "ya recibió $25,00 de la retención · Falta $25,00",
      "Titular A y Titular B no pagan comisión",
      "Totales en USD",
      "Cobros 1",
      "Retenido $50,00",
      "Página 1 de 1",
    ]) {
      expect(text).toContain(expected);
    }
  });

  it("la respuesta: application/pdf como descarga, sin caché, con el nombre del archivo", async () => {
    const me = await owner();
    const id = await e1(me, "pi_resp");
    const result = await pdfOf(me, `id=${id}`);
    const response = pdfResponse(result);
    expect(response.status).toBe(200);
    expect(Object.fromEntries(response.headers)).toMatchObject({
      "content-type": "application/pdf",
      "content-disposition": 'attachment; filename="cobros-elegidos-2026-11-13.pdf"',
      "cache-control": "no-store",
    });
    const body = new Uint8Array(await response.arrayBuffer());
    expect(new TextDecoder().decode(body.slice(0, 5))).toBe("%PDF-");
  });

  it("D2: dos elegidos de monedas distintas dan dos bloques de totales, uno por moneda", async () => {
    const me = await owner();
    const usd = await e1(me, "pi_usd");
    const mxn = await e1(me, "pi_mxn", "2026-11-13T16:00:00Z", "MXN");
    const result = await pdfOf(me, `id=${usd}&id=${mxn}`);
    if (!result.ok) throw new Error(result.message);
    const text = await textOf(result.bytes);
    expect(text).toContain("Seleccionados (2)");
    expect(text).toContain("Stripe · Ref. pi_usd · USD");
    expect(text).toContain("Stripe · Ref. pi_mxn · MXN");
    // En el orden en que se eligieron, y un bloque de totales por moneda.
    expect(text.indexOf("pi_usd")).toBeLessThan(text.indexOf("pi_mxn"));
    expect(text).toContain("Totales en USD");
    expect(text).toContain("Totales en MXN");
    expect(text).toContain("Llega al banco $90,30");
    expect(text).toContain("Llega al banco 90,30 MXN");
  });

  it("D3: «hoy» trae solo los cobros del día de hoy en Nueva York, del más reciente al más antiguo", async () => {
    const me = await owner();
    await e1(me, "pi_hoy_manana", "2026-11-13T15:00:00Z");
    // Las 21:00 del 13 en Nueva York: en UTC ya es el 14, y sigue siendo hoy.
    await e1(me, "pi_hoy_noche", "2026-11-14T02:00:00Z");
    await e1(me, "pi_ayer", "2026-11-12T15:00:00Z");
    // El 14 en Nueva York (el día UTC de NOW): todavía no es hoy.
    await e1(me, "pi_manana", "2026-11-14T15:00:00Z");
    const result = await pdfOf(me, "periodo=hoy");
    if (!result.ok) throw new Error(result.message);
    expect(result).toMatchObject({ fileName: "cobros-2026-11-13.pdf", count: 2 });
    const text = await textOf(result.bytes);
    expect(text).toContain("Hoy, vie 13 nov 2026");
    expect(text).not.toContain("pi_ayer");
    expect(text).not.toContain("pi_manana");
    expect(text.indexOf("pi_hoy_noche")).toBeGreaterThan(-1);
    expect(text.indexOf("pi_hoy_noche")).toBeLessThan(text.indexOf("pi_hoy_manana"));
    expect(text).toContain("Cobros 2");
  });

  it("el filtro de la lista: las mismas claves que el CSV, dicho en palabras", async () => {
    const me = await owner();
    await e1(me, "pi_filtro_1");
    await e1(me, "pi_otro_1");
    const query = `periodo=personalizado&desde=${TODAY}&hasta=${TODAY}&q=pi_filtro&empresa=${me.basics.companyId}`;
    const result = await pdfOf(me, query);
    if (!result.ok) throw new Error(result.message);
    const text = await textOf(result.bytes);
    expect(text).toContain("Hoy, vie 13 nov 2026 · Empresa: Escuela Demo · Búsqueda: «pi_filtro»");
    expect(text).toContain("pi_filtro_1");
    expect(text).not.toContain("pi_otro_1");
  });

  it("D4: un id de otro usuario (o que no existe) mezclado con uno propio: solo sale el propio, sin error", async () => {
    const me = await owner();
    const other = await owner();
    const mine = await e1(me, "pi_mio");
    const theirs = await e1(other, "pi_ajeno");
    const result = await pdfOf(me, `id=${theirs}&id=${mine}&id=${randomUUID()}&id=no-es-un-id`);
    if (!result.ok) throw new Error(result.message);
    expect(result.count).toBe(1);
    const text = await textOf(result.bytes);
    expect(text).toContain("Seleccionados (1)");
    expect(text).toContain("pi_mio");
    expect(text).not.toContain("pi_ajeno");
  });

  it("un elegido que ya se fue a la papelera no sale", async () => {
    const me = await owner();
    const kept = await e1(me, "pi_queda");
    const trashed = await e1(me, "pi_papelera");
    expect(await trashTx(me.db, [trashed])).toBe(1);
    const result = await pdfOf(me, `id=${kept}&id=${trashed}`);
    if (!result.ok) throw new Error(result.message);
    const text = await textOf(result.bytes);
    expect(text).toContain("Seleccionados (1)");
    expect(text).not.toContain("pi_papelera");
  });

  it("D5: con 300 cobros en el filtro (con pagos) sale el PDF; con 301, el mensaje y ningún PDF", async () => {
    const me = await owner();
    const items = (from: number, count: number) =>
      Array.from({ length: count }, (_, i) =>
        e1Item(me.basics, { reference: `pi_tope_${String(from + i).padStart(3, "0")}`, occurred_on: TODAY }),
      );
    const saved = await saveTransactions(me.db, items(1, 300));
    // A Grupo A se le pagó lo suyo de los 300 en un solo pago; a Grupo B, lo del primero.
    const [first] = saved;
    await recordPayouts(me.db, [
      payout(
        me.basics.beneficiaryIds.a,
        saved.map((row) => [row.id, "45.15"]),
      ),
      payout(me.basics.beneficiaryIds.b, [[first?.id ?? "", "27.09"]]),
    ]);
    const full = await pdfOf(me, "periodo=este_mes");
    if (!full.ok) throw new Error(full.message);
    expect(full.count).toBe(300);
    const text = await textOf(full.bytes);
    expect(text).toContain("pi_tope_001");
    expect(text).toContain("pi_tope_300");
    expect(text).toContain("Cobros 300");
    expect(text.match(/Grupo A \(50 %\) \$45,15\nPagado/g)).toHaveLength(300);
    expect(text.match(/Grupo B \(30 %\) \$27,09\nPagado/g)).toHaveLength(1);
    expect(text).toContain("Grupo A $13.545,00 $0,00 $13.545,00 $0,00");
    expect(text).toContain("Grupo B $8.127,00 $0,00 $27,09 $8.099,91");
    expect(text).toContain("Grupo C $5.418,00 $0,00 $0,00 $5.418,00");

    await saveTransactions(me.db, items(301, 1));
    const tooMany = await pdfOf(me, "periodo=este_mes");
    expect(tooMany).toEqual({
      ok: false,
      count: 301,
      message: "Son 301 cobros; el PDF admite hasta 300. Acota el filtro.",
    });
    const response = pdfResponse(tooMany);
    expect(response.status).toBe(422);
    expect(Object.fromEntries(response.headers)).toMatchObject({
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    });
    expect(response.headers.has("content-disposition")).toBe(false);
    expect(await response.text()).toBe("Son 301 cobros; el PDF admite hasta 300. Acota el filtro.");
  });

  it("más de 300 elegidos tampoco: se pide elegir menos", async () => {
    const me = await owner();
    const ids = Array.from({ length: 301 }, () => `id=${randomUUID()}`).join("&");
    expect(await pdfOf(me, ids)).toEqual({
      ok: false,
      count: 301,
      message: "Son 301 cobros; el PDF admite hasta 300. Elige menos.",
    });
  });

  it("un cobro con pagos: cada parte dice «Pagado» o lo que le falta, y los totales por parte lo cuentan", async () => {
    const me = await owner();
    const e10 = await setupE10(me);
    const id = await chargeE10(me, e10, "pi_pagos");
    await recordPayouts(me.db, [
      payout(e10.ids["Grupo A"], [[id, "580.53"]]),
      payout(e10.ids["Grupo B"], [[id, "100.00"]]),
      payout(e10.ids["Titular A"], [[id, "25.00"]]),
    ]);
    const result = await pdfOf(me, `id=${id}`);
    if (!result.ok) throw new Error(result.message);
    const text = await textOf(result.bytes);
    for (const expected of [
      // Cada parte, con su estado de pago debajo; lo retenido, como ya recibido.
      "Grupo A (60 %) $580,53\nPagado",
      "Grupo B (30 %) $290,27\nFalta $190,27",
      "Titular A (5 %) · no paga comisión $50,00\nya recibió $25,00 de la retención · Pagado",
      "Titular B (5 %) · no paga comisión $50,00\nya recibió $25,00 de la retención · Falta $25,00",
      // Los totales por parte, en columnas: reparto, retenido, pagado y lo que falta.
      "Reparto por parte\nReparto Retenido Pagado Falta",
      "Grupo A $580,53 $0,00 $580,53 $0,00",
      "Grupo B $290,27 $0,00 $100,00 $190,27",
      "Titular A $50,00 $25,00 $25,00 $0,00",
      "Titular B $50,00 $25,00 $0,00 $25,00",
    ]) {
      expect(text).toContain(expected);
    }
    expect(text).not.toContain("falta $25,00");
  });

  it("«Reparto pendiente»: el encabezado lo nombra y solo salen los cobros a los que les falta algo", async () => {
    const me = await owner();
    const e10 = await setupE10(me);
    const paidUp = await chargeE10(me, e10, "pi_pagado");
    await chargeE10(me, e10, "pi_pendiente");
    await recordPayouts(me.db, [
      payout(e10.ids["Grupo A"], [[paidUp, "580.53"]]),
      payout(e10.ids["Grupo B"], [[paidUp, "290.27"]]),
      payout(e10.ids["Titular A"], [[paidUp, "25.00"]]),
      payout(e10.ids["Titular B"], [[paidUp, "25.00"]]),
    ]);
    const result = await pdfOf(me, "periodo=personalizado&desde=2026-11-10&hasta=2026-11-10&reparto=pendiente");
    if (!result.ok) throw new Error(result.message);
    expect(result.count).toBe(1);
    const text = await textOf(result.bytes);
    expect(text).toContain("El mar 10 nov 2026 · Reparto pendiente");
    expect(text).toContain("pi_pendiente");
    expect(text).not.toContain("pi_pagado");
    expect(text).toContain("Grupo A $580,53 $0,00 $0,00 $580,53");
  });

  it("sin sesión no sale nada: la base no le deja leer ni los elegidos ni el filtro", async () => {
    const me = await owner();
    const id = await e1(me, "pi_privado");
    const anon = anonClient();
    const cfg = await me.cfg();
    for (const query of [`id=${id}`, "periodo=este_mes"]) {
      await expect(txPdf(anon, cfg, pdfRequestOf(new URLSearchParams(query), TODAY), NOW)).rejects.toThrow(
        "permission denied for table pay_transactions",
      );
    }
  });
});
