import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { payoutChunks } from "@/components/pasarelas/tx/payoutChunks";
import { PAYOUT_CHANGED_TEXT } from "@/components/pasarelas/splits/settlementText";
import { ZERO, add, type Currency, type Money, type PayConfig } from "@/lib/pasarelas";
import { recordPayouts, type PayoutInput } from "@/server/pasarelas/ops/settlements";
import { createTx, failTx, setRefundTotalTx } from "@/server/pasarelas/ops/transactions";
import { txPdfModel } from "@/server/pasarelas/pdf/cobros";
import { pdfRequestOf } from "@/server/pasarelas/pdf/scope";
import { loadPayConfig } from "@/server/pasarelas/queries/config";
import { SPLIT_MAX, filterSplit, owedInFilter, type CurrencySplit } from "@/server/pasarelas/queries/filter-split";
import { listOwed, listTxPayouts, payoutStatuses } from "@/server/pasarelas/queries/settlements";
import { listTx, parseTxFilters, txRefs } from "@/server/pasarelas/queries/transactions";
import { createUser, e1Item, saveTransactions, seedBasics, unwrap, type Db } from "./helpers";

/**
 * El «Reparto del filtro» de Cobros y «Pagar…» desde él, contra el Supabase local con las operaciones de la app: lo de
 * cada parte en TODOS los cobros del filtro (por moneda: le toca, retenido, pagado y lo que falta), igual que el PDF
 * del mismo filtro; y el pago a una parte de lo que le falta en esos cobros, con la misma comprobación de
 * «Pagar repartos…» (`recordPayouts`). Cada prueba crea su usuario. Datos inventados.
 *
 * El libro: «Tienda Demo»; «Stripe Demo» (2,9 % + 0,30) y «OTF Demo» (2,9 % + 0,20, retiene el 5 % para «Titular A»);
 * el esquema «Socios» sobre el neto: Socio Uno 50 %, Socio Dos 40 % y Titular A 10 %; y «Cargador Uno».
 *  - Stripe 100,00 → neto 96,80 → 48,40 · 38,72 · 9,68
 *  - OTF 1000,00 → neto 970,80 → 485,40 · 388,32 · 97,08; retiene 50,00 para Titular A
 *  - Stripe 200,00 → neto 193,90 → 96,95 · 77,56 · 19,39
 */

/** Martes 17 de noviembre de 2026, en Nueva York. */
const TODAY = "2026-11-17";
const NOW = new Date("2026-11-17T20:00:00Z");

type Who = "Socio Uno" | "Socio Dos" | "Titular A";

type Book = {
  db: Db;
  ids: Record<Who, string>;
  loaderId: string;
  cfg: () => Promise<PayConfig>;
  /** Registra un cobro de «Tienda Demo» ese día de noviembre (al mediodía de Nueva York). */
  charge: (a: {
    gross: Money;
    day: number;
    gateway: "stripe" | "otf";
    loader?: boolean;
    currency?: Currency;
    schemeId?: string;
  }) => Promise<string>;
};

async function book(): Promise<Book> {
  const { client: db } = await createUser();
  const people = unwrap(
    await db
      .from("pay_beneficiaries")
      .insert([{ name: "Socio Uno" }, { name: "Socio Dos" }, { name: "Titular A" }])
      .select("id, name"),
    "partes",
  );
  const idOf = (name: Who) => people.find((row) => row.name === name)?.id ?? "";
  const ids = { "Socio Uno": idOf("Socio Uno"), "Socio Dos": idOf("Socio Dos"), "Titular A": idOf("Titular A") };
  const company = await db.from("pay_companies").insert({ name: "Tienda Demo" }).select("id").single();
  const companyId = unwrap(company, "empresa").id;
  const gateway = async (name: string, fixed: string) =>
    unwrap(await db.rpc("pay_create_gateway", { p: { name, fee: { pct: "2.9", fixed } } }), name) as string;
  const stripe = await gateway("Stripe Demo", "0.30");
  const otf = await gateway("OTF Demo", "0.20");
  await db
    .rpc("pay_save_gateway_retention", {
      p: { gateway_id: otf, pct: "5", days: 30, recipients: [{ beneficiary_id: ids["Titular A"], pct: "100" }] },
    })
    .throwOnError();
  const scheme = unwrap(
    await db.rpc("pay_save_scheme", {
      p: {
        name: "Socios",
        base: "neto",
        lines: [
          { beneficiary_id: ids["Socio Uno"], pct: "50" },
          { beneficiary_id: ids["Socio Dos"], pct: "40" },
          { beneficiary_id: ids["Titular A"], pct: "10" },
        ],
      },
    }),
    "esquema",
  ) as { scheme_id: string };
  const loader = await db.from("pay_loaders").insert({ name: "Cargador Uno" }).select("id").single();
  const loaderId = unwrap(loader, "cargador").id;
  const charge: Book["charge"] = async ({ gross, day, gateway: which, loader = true, currency = "USD", schemeId }) => {
    const id = randomUUID();
    const on = `2026-11-${String(day).padStart(2, "0")}`;
    await createTx(db, {
      id,
      companyId,
      channelId: null,
      gatewayId: which === "stripe" ? stripe : otf,
      extraIds: [],
      schemeId: schemeId ?? scheme.scheme_id,
      occurredAt: `${on}T17:00:00Z`,
      occurredOn: on,
      currency,
      grossOriginal: gross,
      reference: `ref-${day}-${gross}-${id.slice(0, 4)}`,
      note: null,
      loaderId: loader ? loaderId : null,
    });
    return id;
  };
  return { db, ids, loaderId, cfg: () => loadPayConfig(db), charge };
}

/** R1: los tres cobros de «Cargador Uno» del 10 al 12 de noviembre, y dos que no son del filtro. */
async function r1(b: Book): Promise<[string, string, string]> {
  const ids: [string, string, string] = [
    await b.charge({ gross: "100.00", day: 10, gateway: "stripe" }),
    await b.charge({ gross: "1000.00", day: 11, gateway: "otf" }),
    await b.charge({ gross: "200.00", day: 12, gateway: "stripe" }),
  ];
  await b.charge({ gross: "50.00", day: 11, gateway: "stripe", loader: false });
  await b.charge({ gross: "300.00", day: 13, gateway: "stripe" });
  return ids;
}

/** La URL del filtro de R1: Cargador Uno, ventas del 10 al 12 de noviembre. */
const r1Query = (b: Book, more: Record<string, string> = {}) => ({
  periodo: "personalizado",
  desde: "2026-11-10",
  hasta: "2026-11-12",
  cargador: b.loaderId,
  ...more,
});

/** El reparto del filtro de esa URL, como lo arma la pantalla de Cobros. */
async function splitOf(b: Book, query: Record<string, string>) {
  const { filters } = parseTxFilters(query, TODAY);
  return filterSplit(b.db, await txRefs(b.db, filters, TODAY), await b.cfg());
}

/** Lo de una parte en el reparto de una moneda: [le toca, retenido, pagado, falta]. */
function partyOf(split: CurrencySplit | undefined, name: string): Money[] | undefined {
  const party = split?.parties.find((item) => item.name === name);
  return party === undefined ? undefined : [party.allocated, party.retained, party.paid, party.owed];
}

/** Un pago de lo que dice `owedInFilter`, partido en pagos de hasta 500 cobros (como la pantalla). */
function payoutsOf(
  owed: { beneficiaryId: string; currency: Currency; items: { transactionId: string; amount: Money }[] },
  paidOn = TODAY,
): PayoutInput[] {
  return payoutChunks(owed.items).map((items) => ({
    id: randomUUID(),
    beneficiaryId: owed.beneficiaryId,
    currency: owed.currency,
    paidOn,
    method: "Transferencia",
    items,
  }));
}

/** Un pago a una parte de lo suyo en un cobro, como «Marcar pagado…». */
const payment = (beneficiaryId: string, transactionId: string, amount: Money, paidOn = TODAY): PayoutInput => ({
  id: randomUUID(),
  beneficiaryId,
  currency: "USD",
  paidOn,
  method: null,
  items: [{ transactionId, amount }],
});

/** Lo de cada cobro, por id: para comparar sin depender del orden. */
const sorted = (items: readonly { transactionId: string; amount: Money }[]) =>
  [...items].sort((a, b) => a.transactionId.localeCompare(b.transactionId));

/** Las liquidaciones de una parte: [monto, cobros que paga], de mayor a menor. */
async function settlementsOf(db: Db, beneficiaryId: string): Promise<[string, number][]> {
  const rows = unwrap(
    await db
      .from("pay_settlements")
      .select("amount::text, pay_settlement_items(transaction_id)")
      .eq("beneficiary_id", beneficiaryId)
      .order("amount", { ascending: false }),
    "liquidaciones",
  );
  return rows.map((row) => [row.amount, row.pay_settlement_items.length]);
}

describe("el reparto del filtro", () => {
  it("R1 y R6: por parte, la suma del detalle de cada cobro; lo retenido ya lo recibió Titular A", async () => {
    const b = await book();
    const ids = await r1(b);
    const split = await splitOf(b, r1Query(b));
    expect(split.ok).toBe(true);
    if (!split.ok) return;
    expect(split.currencies.map((item) => item.currency)).toEqual(["USD"]);
    const [usd] = split.currencies;
    expect(usd?.parties.map((party) => party.name)).toEqual(["Socio Dos", "Socio Uno", "Titular A"]);
    expect(partyOf(usd, "Socio Uno")).toEqual(["630.75", "0.00", "0.00", "630.75"]);
    expect(partyOf(usd, "Socio Dos")).toEqual(["504.60", "0.00", "0.00", "504.60"]);
    // R6: los 50,00 retenidos en OTF Demo ya los recibió: le faltan 126,15 − 50,00.
    expect(partyOf(usd, "Titular A")).toEqual(["126.15", "50.00", "0.00", "76.15"]);
    expect(usd?.advances).toEqual([]);

    // Lo mismo que sumar, cobro por cobro, lo que dice el detalle de cada uno (`payoutStatuses`).
    const details = await payoutStatuses(
      b.db,
      ids.map((id) => ({ id, status: "registrado", deletedAt: null })),
    );
    for (const party of usd?.parties ?? []) {
      const parts = [...details.values()].flatMap((status) =>
        (status?.parts ?? []).filter((part) => part.beneficiaryId === party.beneficiaryId),
      );
      expect(parts).toHaveLength(3);
      expect([party.allocated, party.retained, party.paid, party.owed]).toEqual([
        add(ZERO, ...parts.map((part) => part.allocated)),
        add(ZERO, ...parts.map((part) => part.retained)),
        add(ZERO, ...parts.map((part) => part.paid)),
        add(ZERO, ...parts.map((part) => part.owed)),
      ]);
    }
  });

  it("es igual al PDF del mismo filtro, también con pagos, un fallido y una parte pagada de más", async () => {
    const b = await book();
    const [first, second] = await r1(b);
    const failed = await b.charge({ gross: "80.00", day: 11, gateway: "stripe" });
    await failTx(b.db, failed);
    // Socio Uno cobró lo suyo del primero y después se reembolsó todo: se le pagó de más.
    await recordPayouts(b.db, [
      payment(b.ids["Socio Uno"], first, "48.40"),
      payment(b.ids["Titular A"], second, "20.00"),
    ]);
    await setRefundTotalTx(b.db, first, "100.00");
    const query = r1Query(b);
    const split = await splitOf(b, query);
    const pdf = await txPdfModel(b.db, await b.cfg(), pdfRequestOf(new URLSearchParams(query), TODAY), NOW);
    expect("model" in pdf && split.ok).toBe(true);
    if (!("model" in pdf) || !split.ok) return;
    expect(pdf.count).toBe(4);
    const fromPdf = pdf.model.totals
      .map(({ currency, parties, advances }) => ({ currency, parties, advances }))
      .filter((block) => block.parties.length > 0 || block.advances.length > 0);
    expect(split.currencies).toEqual(fromPdf);
    // Las cifras: el fallido no cuenta; el reembolso total deja la pérdida de 3,20 repartida.
    const [usd] = split.currencies;
    expect(partyOf(usd, "Socio Uno")).toEqual(["580.75", "0.00", "48.40", "532.35"]);
    expect(partyOf(usd, "Titular A")).toEqual(["116.15", "50.00", "20.00", "46.15"]);
  });

  it("R7: dos monedas, dos bloques; nada se suma entre monedas", async () => {
    const b = await book();
    await r1(b);
    await b.charge({ gross: "100.00", day: 11, gateway: "stripe", currency: "MXN" });
    const split = await splitOf(b, r1Query(b));
    if (!split.ok) throw new Error("debía sumar");
    expect(split.currencies.map((item) => item.currency)).toEqual(["MXN", "USD"]);
    const [mxn, usd] = split.currencies;
    expect(partyOf(mxn, "Socio Uno")).toEqual(["48.40", "0.00", "0.00", "48.40"]);
    expect(partyOf(mxn, "Titular A")).toEqual(["9.68", "0.00", "0.00", "9.68"]);
    expect(partyOf(usd, "Socio Uno")).toEqual(["630.75", "0.00", "0.00", "630.75"]);
    // Con la moneda en el filtro, un solo bloque.
    const onlyMxn = await splitOf(b, r1Query(b, { moneda: "MXN" }));
    expect(onlyMxn.ok && onlyMxn.currencies.map((item) => item.currency)).toEqual(["MXN"]);
  });

  it("quien recibe lo retenido sin estar en el reparto: su adelanto va aparte", async () => {
    const b = await book();
    // Titular A deja el esquema: solo los socios, 60/40. OTF le sigue reteniendo a él.
    const scheme = unwrap(
      await b.db.rpc("pay_save_scheme", {
        p: {
          name: "Solo socios",
          base: "neto",
          lines: [
            { beneficiary_id: b.ids["Socio Uno"], pct: "60" },
            { beneficiary_id: b.ids["Socio Dos"], pct: "40" },
          ],
        },
      }),
      "esquema",
    ) as { scheme_id: string };
    await b.charge({ gross: "1000.00", day: 11, gateway: "otf", schemeId: scheme.scheme_id });
    const split = await splitOf(b, r1Query(b));
    if (!split.ok) throw new Error("debía sumar");
    const [usd] = split.currencies;
    expect(usd?.parties.map((party) => party.name)).toEqual(["Socio Dos", "Socio Uno"]);
    expect(partyOf(usd, "Socio Uno")).toEqual(["582.48", "0.00", "0.00", "582.48"]);
    expect(usd?.advances).toEqual([{ beneficiaryId: b.ids["Titular A"], name: "Titular A", amount: "50.00" }]);
  });

  it("la RLS: otro usuario no ve nada, ni con los ids de los cobros", async () => {
    const b = await book();
    const ids = await r1(b);
    const { client: other } = await createUser();
    const { filters } = parseTxFilters(r1Query(b), TODAY);
    expect(await txRefs(other, filters, TODAY)).toEqual([]);
    const cfg = await loadPayConfig(other);
    const stolen = ids.map((id) => ({ id, currency: "USD", status: "registrado" }));
    expect(await filterSplit(other, stolen, cfg)).toEqual({ ok: true, currencies: [] });
    expect(await owedInFilter(other, filters, TODAY, b.ids["Socio Dos"], "USD")).toEqual({ kind: "nada" });
  });

  it(`con más de ${SPLIT_MAX} cobros no suma nada: dice cuántos son`, async () => {
    const b = await book();
    const many = Array.from({ length: SPLIT_MAX + 1 }, (_, i) => ({
      id: `tx-${i}`,
      currency: "USD",
      status: "registrado",
    }));
    expect(await filterSplit(b.db, many, await b.cfg())).toEqual({ ok: false, count: SPLIT_MAX + 1 });
  });
});

describe("«Pagar…» desde el reparto del filtro", () => {
  it("R4: a Socio Dos, solo en los cobros donde se le debía; el resto no cambia y el filtro se ajusta", async () => {
    const b = await book();
    const [first, second, third] = await r1(b);
    // Antes: a Socio Dos ya se le pagó el primero; a Socio Uno y Titular A, el tercero.
    await recordPayouts(b.db, [
      payment(b.ids["Socio Dos"], first, "38.72", "2026-11-15"),
      payment(b.ids["Socio Uno"], third, "96.95", "2026-11-15"),
      payment(b.ids["Titular A"], third, "19.39", "2026-11-15"),
    ]);
    const pending = async () => {
      const { filters, sort } = parseTxFilters(r1Query(b, { reparto: "pendiente" }), TODAY);
      return (await listTx(b.db, filters, sort, 1, TODAY)).rows.map((row) => row.id).sort();
    };
    expect(await pending()).toEqual([first, second, third].sort());
    const before = await splitOf(b, r1Query(b));
    if (!before.ok) throw new Error("debía sumar");
    expect(partyOf(before.currencies[0], "Socio Dos")).toEqual(["504.60", "0.00", "38.72", "465.88"]);

    const { filters } = parseTxFilters(r1Query(b), TODAY);
    const owed = await owedInFilter(b.db, filters, TODAY, b.ids["Socio Dos"], "USD");
    expect(owed).toMatchObject({ kind: "debe", name: "Socio Dos", currency: "USD", owed: "465.88", overpaid: null });
    if (owed.kind !== "debe") return;
    expect(sorted(owed.items)).toEqual(
      sorted([
        { transactionId: second, amount: "388.32" },
        { transactionId: third, amount: "77.56" },
      ]),
    );
    // Lo mismo que «Pagar repartos…» de esos cobros (`listOwed`), para la misma parte.
    const fromList = (await listOwed(b.db, [first, second, third])).find((group) => group.name === "Socio Dos");
    expect(fromList?.items).toEqual(owed.items);

    expect(await recordPayouts(b.db, payoutsOf(owed))).toEqual({ created: 1 });
    expect(await settlementsOf(b.db, b.ids["Socio Dos"])).toEqual([
      ["465.88", 2],
      ["38.72", 1],
    ]);
    const after = await splitOf(b, r1Query(b));
    if (!after.ok) throw new Error("debía sumar");
    expect(partyOf(after.currencies[0], "Socio Dos")).toEqual(["504.60", "0.00", "504.60", "0.00"]);
    expect(partyOf(after.currencies[0], "Socio Uno")).toEqual(partyOf(before.currencies[0], "Socio Uno"));
    expect(partyOf(after.currencies[0], "Titular A")).toEqual(partyOf(before.currencies[0], "Titular A"));
    // El tercero quedó saldado: «Reparto pendiente» ya no lo trae.
    expect(await pending()).toEqual([first, second].sort());
    // El historial del cobro dice lo mismo que con «Pagar repartos…»: el pago, lo de este cobro y el otro que cubre.
    const [payout] = (await listTxPayouts(b.db, second)).filter((item) => item.beneficiaryId === b.ids["Socio Dos"]);
    expect(payout).toMatchObject({ paidOn: TODAY, method: "Transferencia", amount: "465.88", here: "388.32" });
    expect(payout?.others.map((item) => [item.transactionId, item.amount])).toEqual([[third, "77.56"]]);
    // Ya no hay nada que pagarle.
    expect(await owedInFilter(b.db, filters, TODAY, b.ids["Socio Dos"], "USD")).toEqual({ kind: "nada" });
  });

  it("si algo cambió entre leer y pagar, no se guarda nada y se dice por qué", async () => {
    const b = await book();
    const [, second] = await r1(b);
    const { filters } = parseTxFilters(r1Query(b), TODAY);
    const owed = await owedInFilter(b.db, filters, TODAY, b.ids["Socio Dos"], "USD");
    if (owed.kind !== "debe") throw new Error("debía deberle");
    // Otra pestaña le paga el segundo mientras tanto.
    await recordPayouts(b.db, [
      payment(b.ids["Socio Dos"], second, "388.32"),
    ]);
    await expect(recordPayouts(b.db, payoutsOf(owed))).rejects.toThrow(PAYOUT_CHANGED_TEXT);
    expect(await settlementsOf(b.db, b.ids["Socio Dos"])).toEqual([["388.32", 1]]);
  });

  it("R5: a quien se le pagó de más no se le paga; un cobro pagado de más se descuenta, como en el resumen", async () => {
    const b = await book();
    const [first, second, third] = await r1(b);
    await recordPayouts(b.db, [
      payment(b.ids["Socio Uno"], first, "48.40"),
    ]);
    await setRefundTotalTx(b.db, first, "100.00");
    // Solo el primero (del 10): a Socio Uno se le pagó de más 48,40 + 1,60 de la pérdida.
    const firstOnly = r1Query(b, { hasta: "2026-11-10" });
    const split = await splitOf(b, firstOnly);
    if (!split.ok) throw new Error("debía sumar");
    expect(partyOf(split.currencies[0], "Socio Uno")).toEqual(["-1.60", "0.00", "48.40", "-50.00"]);
    const { filters } = parseTxFilters(firstOnly, TODAY);
    expect(await owedInFilter(b.db, filters, TODAY, b.ids["Socio Uno"], "USD")).toEqual({ kind: "nada" });

    // Con los tres, en total le falta 485,40 + 96,95 − 50,00 = 532,35: lo que dice el resumen («Falta $532,35»). Lo
    // pagado de más en el primero se descuenta (y se dice), como en «Pagar repartos…» de esos cobros.
    const before = await splitOf(b, r1Query(b));
    if (!before.ok) throw new Error("debía sumar");
    expect(partyOf(before.currencies[0], "Socio Uno")).toEqual(["580.75", "0.00", "48.40", "532.35"]);
    const all = parseTxFilters(r1Query(b), TODAY).filters;
    const owed = await owedInFilter(b.db, all, TODAY, b.ids["Socio Uno"], "USD");
    expect(owed).toMatchObject({ kind: "debe", owed: "532.35", overpaid: { count: 1, amount: "50.00" } });
    if (owed.kind !== "debe") return;
    expect(sorted(owed.items)).toEqual(
      sorted([
        { transactionId: first, amount: "-50.00" },
        { transactionId: second, amount: "485.40" },
        { transactionId: third, amount: "96.95" },
      ]),
    );
    const fromList = (await listOwed(b.db, [first, second, third])).find((group) => group.name === "Socio Uno");
    expect(fromList?.items).toEqual(owed.items);

    // Pagado: un solo pago de 532,35 ligado a los tres; su «falta» queda en 0 y el resto de las partes no cambia.
    expect(await recordPayouts(b.db, payoutsOf(owed))).toEqual({ created: 1 });
    expect(await settlementsOf(b.db, b.ids["Socio Uno"])).toEqual([
      ["532.35", 3],
      ["48.40", 1],
    ]);
    const after = await splitOf(b, r1Query(b));
    if (!after.ok) throw new Error("debía sumar");
    expect(partyOf(after.currencies[0], "Socio Uno")).toEqual(["580.75", "0.00", "580.75", "0.00"]);
    expect(partyOf(after.currencies[0], "Socio Dos")).toEqual(partyOf(before.currencies[0], "Socio Dos"));
    expect(partyOf(after.currencies[0], "Titular A")).toEqual(partyOf(before.currencies[0], "Titular A"));
    expect(await owedInFilter(b.db, all, TODAY, b.ids["Socio Uno"], "USD")).toEqual({ kind: "nada" });
  });

  it("R8: más de 500 cobros con deuda: varios pagos de hasta 500 en una sola llamada, todos o ninguno; lo de más, aparte", async () => {
    const { client: db } = await createUser();
    const basics = await seedBasics(db);
    const item = (n: number) =>
      e1Item(basics, {
        reference: `R8-${n}`,
        occurred_at: `2026-11-${String(1 + (n % 16)).padStart(2, "0")}T15:00:00Z`,
        occurred_on: `2026-11-${String(1 + (n % 16)).padStart(2, "0")}`,
      });
    const count = 520;
    const saved = [
      ...(await saveTransactions(db, Array.from({ length: 500 }, (_, n) => item(n)))),
      ...(await saveTransactions(db, Array.from({ length: count - 500 }, (_, n) => item(500 + n)))),
    ];
    const november = { periodo: "personalizado", desde: "2026-11-01", hasta: "2026-11-30" };
    const { filters } = parseTxFilters(november, TODAY);
    const owed = await owedInFilter(db, filters, TODAY, basics.beneficiaryIds.b, "USD");
    if (owed.kind !== "debe") throw new Error("debía deberle");
    expect(owed.items).toHaveLength(count);
    expect(owed.owed).toBe("14086.80");
    const payouts = payoutsOf(owed);
    expect(payouts.map((payout) => payout.items.length)).toEqual([500, 20]);

    // Si uno de los cobros cambió (otra pestaña le pagó), ninguno de los dos pagos queda.
    const [one] = saved;
    await recordPayouts(db, [
      payment(basics.beneficiaryIds.b, one?.id ?? "", "27.09"),
    ]);
    await expect(recordPayouts(db, payouts)).rejects.toThrow(PAYOUT_CHANGED_TEXT);
    expect(await settlementsOf(db, basics.beneficiaryIds.b)).toEqual([["27.09", 1]]);

    // Y después ese cobro se reembolsó entero: la pérdida (2,9 % + 0,30 = 3,20) se reparte y a Grupo B le toca el
    // 30 %, −0,96. Ahí se le pagó de más 27,09 + 0,96 = 28,05. En total le falta 519 × 27,09 − 28,05 = 14.031,66.
    await setRefundTotalTx(db, one?.id ?? "", "100.00");
    const before = await filterSplit(db, await txRefs(db, filters, TODAY), await loadPayConfig(db));
    if (!before.ok) throw new Error("debía sumar");
    expect(partyOf(before.currencies[0], "Grupo B")).toEqual(["14058.75", "0.00", "27.09", "14031.66"]);

    // Leído de nuevo: lo de más se descuenta, como en el resumen. Los 519 que faltan van en dos pagos y lo que se
    // descuenta en un tercero (en tramos seguidos, uno podría sumar cero); los tres quedan juntos.
    const again = await owedInFilter(db, filters, TODAY, basics.beneficiaryIds.b, "USD");
    if (again.kind !== "debe") throw new Error("debía deberle");
    expect(again).toMatchObject({ owed: "14031.66", overpaid: { count: 1, amount: "28.05" } });
    const last = payoutsOf(again);
    expect(last.map((payout) => payout.items.length)).toEqual([500, 19, 1]);
    expect(await recordPayouts(db, last)).toEqual({ created: 3 });
    expect(await settlementsOf(db, basics.beneficiaryIds.b)).toEqual([
      ["13545.00", 500],
      ["514.71", 19],
      ["27.09", 1],
      ["-28.05", 1],
    ]);
    const split = await filterSplit(db, await txRefs(db, filters, TODAY), await loadPayConfig(db));
    if (!split.ok) throw new Error("debía sumar");
    expect(partyOf(split.currencies[0], "Grupo B")).toEqual(["14058.75", "0.00", "14058.75", "0.00"]);
  });
});
