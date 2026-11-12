import { describe, expect, test } from "vitest";
import { addDays } from "./dates";
import { businessFigures, lagStats, summarize, totalsOf, upcomingDeposits } from "./stats";
import type { LeanTx, Money } from "./types";

const HOY = "2026-11-09";

/** Un cobro de 100,00 registrado hoy en «Tienda Demo» por Stripe; cada prueba cambia solo lo que le importa. */
const tx = (id: string, patch: Partial<LeanTx> = {}): LeanTx => ({
  id,
  occurredOn: HOY,
  companyId: "emp-tienda",
  channelId: null,
  gatewayId: "pas-stripe",
  bankAccountId: "cta-a",
  currency: "USD",
  grossOriginal: "100.00",
  refunded: "0.00",
  gross: "100.00",
  fees: "9.70",
  net: "90.30",
  status: "registrado",
  disputeState: null,
  estimatedDepositOn: null,
  estimatedDepositFrom: null,
  depositedOn: null,
  receiptsCount: 0,
  feesPaidBy: "nosotros",
  ...patch,
});

/** Los tres montos de un cobro sin reembolso. */
const monto = (gross: Money, fees: Money, net: Money) => ({ grossOriginal: gross, gross, fees, net });

/** Un cobro del 2 de noviembre que cayó `dias` después. */
const caido = (id: string, dias: number, patch: Partial<LeanTx> = {}): LeanTx =>
  tx(id, { occurredOn: "2026-11-02", status: "depositado", depositedOn: addDays("2026-11-02", dias), ...patch });

// ─── Las filas a mano: 6 en USD, 2 en EUR y un fallido que no debe contar en nada ───────────────────────────

const u1 = tx("u1", {
  occurredOn: "2026-09-15",
  ...monto("100.00", "9.70", "90.30"),
  status: "depositado",
  depositedOn: "2026-09-16",
});
const u2 = tx("u2", {
  occurredOn: "2026-10-05",
  ...monto("200.00", "6.10", "193.90"),
  status: "depositado",
  depositedOn: "2026-10-07",
});
const u3 = tx("u3", {
  occurredOn: "2026-10-20",
  companyId: "emp-escuela",
  gatewayId: "pas-paypal",
  bankAccountId: "cta-b",
  ...monto("50.00", "2.25", "47.75"),
  status: "depositado",
  depositedOn: "2026-10-24",
});
const u4 = tx("u4", {
  occurredOn: "2026-11-02",
  companyId: "emp-escuela",
  ...monto("33.33", "1.27", "32.06"),
  status: "en_transito",
  estimatedDepositOn: "2026-11-04",
});
const u5 = tx("u5", {
  occurredOn: "2026-11-06",
  gatewayId: "pas-paypal",
  bankAccountId: "cta-b",
  ...monto("80.00", "3.10", "76.90"),
  estimatedDepositOn: "2026-11-10",
});
/** Reembolso total con costo: bruto vigente 0,00 y neto negativo, sin cuenta destino. Ya no está por caer. */
const u6 = tx("u6", {
  occurredOn: "2026-11-07",
  companyId: "emp-estudio",
  gatewayId: "pas-zelle",
  bankAccountId: null,
  grossOriginal: "40.00",
  refunded: "40.00",
  gross: "0.00",
  fees: "1.46",
  net: "-1.46",
  estimatedDepositOn: "2026-11-12",
});
/** Con montos (la base los deja en cero) y con mes, empresa, pasarela y cuenta propios: si contara, se vería. */
const fallido = tx("uf", {
  occurredOn: "2026-08-30",
  companyId: "emp-fallida",
  gatewayId: "pas-fallida",
  bankAccountId: "cta-fallida",
  ...monto("500.00", "10.00", "490.00"),
  status: "fallido",
  estimatedDepositOn: "2026-11-10",
});
const e1 = tx("e1", {
  currency: "EUR",
  occurredOn: "2026-10-10",
  bankAccountId: "cta-eur",
  ...monto("60.00", "2.04", "57.96"),
  status: "depositado",
  depositedOn: "2026-10-13",
});
const e2 = tx("e2", {
  currency: "EUR",
  occurredOn: "2026-11-03",
  bankAccountId: "cta-eur",
  ...monto("40.00", "1.46", "38.54"),
  estimatedDepositOn: HOY,
});

/** Desordenadas a propósito: el resultado no puede depender del orden de llegada. */
const FILAS = [u5, e2, u1, fallido, u6, u3, e1, u2, u4];

describe("summarize: 6 filas en USD y 2 en EUR", () => {
  const resumen = summarize(FILAS, HOY);

  test("una entrada por moneda, en el orden en que aparecen, y nunca sumadas", () => {
    expect(Object.keys(resumen)).toEqual(["USD", "EUR"]);
  });

  test("totales en USD", () => {
    expect(resumen.USD?.totals).toEqual({
      count: 6,
      gross: "463.33",
      // Ningún cobro lo pagó el comprador: lo facturado es el bruto, y las comisiones, todas del negocio.
      sale: "463.33",
      fees: "23.88",
      buyerFees: "0.00",
      net: "439.45",
      avgTicket: "77.22", // 463,33 ÷ 6 = 77,2216…
      feePct: "5.15", // 23,88 ÷ 463,33 = 5,1540… %
      pendingNet: "108.96", // u4 + u5 = 32,06 + 76,90 (u6, reembolsado del todo, ya no está por caer)
      pendingCount: 2,
      depositedNet: "331.95", // u1 + u2 + u3 = 90,30 + 193,90 + 47,75
      depositedCount: 3,
    });
  });

  test("totales en EUR", () => {
    expect(resumen.EUR?.totals).toEqual({
      count: 2,
      gross: "100.00",
      sale: "100.00",
      fees: "3.50",
      buyerFees: "0.00",
      net: "96.50",
      avgTicket: "50.00",
      feePct: "3.5",
      pendingNet: "38.54",
      pendingCount: 1,
      depositedNet: "57.96",
      depositedCount: 1,
    });
  });

  test("byMonth: por mes del cobro, en orden ascendente y solo los meses con filas", () => {
    expect(resumen.USD?.byMonth).toEqual([
      { month: "2026-09", gross: "100.00", sale: "100.00", fees: "9.70", buyerFees: "0.00", net: "90.30", count: 1 },
      { month: "2026-10", gross: "250.00", sale: "250.00", fees: "8.35", buyerFees: "0.00", net: "241.65", count: 2 },
      { month: "2026-11", gross: "113.33", sale: "113.33", fees: "5.83", buyerFees: "0.00", net: "107.50", count: 3 },
    ]);
    expect(resumen.EUR?.byMonth).toEqual([
      { month: "2026-10", gross: "60.00", sale: "60.00", fees: "2.04", buyerFees: "0.00", net: "57.96", count: 1 },
      { month: "2026-11", gross: "40.00", sale: "40.00", fees: "1.46", buyerFees: "0.00", net: "38.54", count: 1 },
    ]);
  });

  test("byCompany: de mayor a menor lo facturado (como decimales: 380,00 va antes que 83,33)", () => {
    expect(resumen.USD?.byCompany).toEqual([
      { companyId: "emp-tienda", gross: "380.00", sale: "380.00", fees: "18.90", buyerFees: "0.00", net: "361.10", count: 3 },
      { companyId: "emp-escuela", gross: "83.33", sale: "83.33", fees: "3.52", buyerFees: "0.00", net: "79.81", count: 2 },
      { companyId: "emp-estudio", gross: "0.00", sale: "0.00", fees: "1.46", buyerFees: "0.00", net: "-1.46", count: 1 },
    ]);
    expect(resumen.EUR?.byCompany).toEqual([
      { companyId: "emp-tienda", gross: "100.00", sale: "100.00", fees: "3.50", buyerFees: "0.00", net: "96.50", count: 2 },
    ]);
  });

  test("byGateway: de mayor a menor bruto, con su parte del bruto y su costo efectivo", () => {
    expect(resumen.USD?.byGateway).toEqual([
      {
        gatewayId: "pas-stripe",
        gross: "333.33",
        sale: "333.33",
        fees: "17.07",
        buyerFees: "0.00",
        net: "316.26",
        count: 3,
        sharePct: "71.94", // 333,33 ÷ 463,33
        effectiveCostPct: "5.12", // 17,07 ÷ 333,33
      },
      {
        gatewayId: "pas-paypal",
        gross: "130.00",
        sale: "130.00",
        fees: "5.35",
        buyerFees: "0.00",
        net: "124.65",
        count: 2,
        sharePct: "28.06", // 130,00 ÷ 463,33
        effectiveCostPct: "4.12", // 5,35 ÷ 130,00 = 4,1153… %
      },
      // Bruto 0,00: su parte es 0 % y no tiene costo efectivo (no se divide entre cero).
      {
        gatewayId: "pas-zelle",
        gross: "0.00",
        sale: "0.00",
        fees: "1.46",
        buyerFees: "0.00",
        net: "-1.46",
        count: 1,
        sharePct: "0",
        effectiveCostPct: null,
      },
    ]);
    expect(resumen.EUR?.byGateway).toEqual([
      {
        gatewayId: "pas-stripe",
        gross: "100.00",
        sale: "100.00",
        fees: "3.50",
        buyerFees: "0.00",
        net: "96.50",
        count: 2,
        sharePct: "100",
        effectiveCostPct: "3.5",
      },
    ]);
  });

  test("byAccount: de mayor a menor neto, con lo que tardan sus depósitos; con pérdidas en una cuenta, sin parte", () => {
    expect(resumen.USD?.byAccount).toEqual([
      // u1 cayó en 1 día y u2 en 2; u4 sigue en tránsito y no cuenta para los días.
      { bankAccountId: "cta-a", net: "316.26", count: 3, sharePct: null, avgDays: "1.5", medianDays: "1.5" },
      { bankAccountId: "cta-b", net: "124.65", count: 2, sharePct: null, avgDays: "4.0", medianDays: "4.0" },
      // «Sin cuenta»: nada depositado todavía, y un neto negativo. Sobre el neto total, cta-a sería el 71,97 %,
      // cta-b el 28,37 % y esta el −0,33 %: por eso, con pérdidas, ninguna tiene parte.
      { bankAccountId: null, net: "-1.46", count: 1, sharePct: null, avgDays: null, medianDays: null },
    ]);
    expect(resumen.EUR?.byAccount).toEqual([
      { bankAccountId: "cta-eur", net: "96.50", count: 2, sharePct: "100", avgDays: "3.0", medianDays: "3.0" },
    ]);
  });

  test("el fallido no cuenta en nada: sin él sale exactamente lo mismo", () => {
    expect(summarize(FILAS.filter((fila) => fila !== fallido), HOY)).toEqual(resumen);
  });
});

describe("summarize: bordes", () => {
  test("sin filas no hay monedas", () => {
    expect(summarize([], HOY)).toEqual({});
  });

  test("una moneda cuyas filas son todas fallidas no aparece", () => {
    const filas = [tx("f1", { currency: "MXN", status: "fallido" }), tx("a", { currency: "USD" })];
    expect(Object.keys(summarize(filas, HOY))).toEqual(["USD"]);
    expect(summarize([tx("f2", { status: "fallido" })], HOY)).toEqual({});
  });

  test("con bruto 0,00 no hay % de comisión, ni parte del bruto, ni costo efectivo", () => {
    const reembolsado = { grossOriginal: "40.00", refunded: "40.00", gross: "0.00", fees: "1.46", net: "-1.46" };
    const usd = summarize([tx("r1", reembolsado), tx("r2", reembolsado)], HOY).USD;
    expect(usd?.totals).toMatchObject({
      count: 2,
      gross: "0.00",
      sale: "0.00",
      fees: "2.92",
      buyerFees: "0.00",
      net: "-2.92",
      avgTicket: "0.00",
    });
    expect(usd?.totals.feePct).toBeNull();
    expect(usd?.byGateway).toEqual([
      {
        gatewayId: "pas-stripe",
        gross: "0.00",
        sale: "0.00",
        fees: "2.92",
        buyerFees: "0.00",
        net: "-2.92",
        count: 2,
        sharePct: null,
        effectiveCostPct: null,
      },
    ]);
  });

  test("sin pérdidas, la parte del neto de cada cuenta va de 0 a 100 %", () => {
    const filas = [
      tx("a", { ...monto("75.00", "0.00", "75.00") }),
      tx("b", { bankAccountId: "cta-b", ...monto("25.00", "0.00", "25.00") }),
      tx("c", { bankAccountId: "cta-c", grossOriginal: "40.00", refunded: "40.00", gross: "0.00", fees: "0.00", net: "0.00" }),
    ];
    expect(summarize(filas, HOY).USD?.byAccount.map(({ bankAccountId, sharePct }) => [bankAccountId, sharePct])).toEqual([
      ["cta-a", "75"],
      ["cta-b", "25"],
      ["cta-c", "0"],
    ]);
  });

  test("con pérdidas en una cuenta, ninguna tiene parte: nunca más de 100 % ni porcentajes negativos", () => {
    // Sobre el neto total (50,00) saldría 200 %, 0 % y −100 %.
    const filas = [
      tx("g", { ...monto("100.00", "0.00", "100.00") }),
      tx("p", { bankAccountId: "cta-b", grossOriginal: "60.00", refunded: "60.00", gross: "0.00", fees: "50.00", net: "-50.00" }),
    ];
    expect(summarize(filas, HOY).USD?.byAccount.map((account) => account.sharePct)).toEqual([null, null]);
  });

  test("con neto total 0,00 las cuentas no tienen parte del neto", () => {
    const filas = [
      tx("g", { ...monto("10.00", "0.00", "10.00") }),
      tx("p", { bankAccountId: "cta-b", grossOriginal: "40.00", refunded: "40.00", gross: "0.00", fees: "10.00", net: "-10.00" }),
    ];
    expect(summarize(filas, HOY).USD?.byAccount).toEqual([
      { bankAccountId: "cta-a", net: "10.00", count: 1, sharePct: null, avgDays: null, medianDays: null },
      { bankAccountId: "cta-b", net: "-10.00", count: 1, sharePct: null, avgDays: null, medianDays: null },
    ]);
  });

  test("«sin cuenta» también mide lo que tardaron sus depósitos", () => {
    const filas = [caido("a", 1, { bankAccountId: null }), caido("b", 2, { bankAccountId: null })];
    expect(summarize(filas, HOY).USD?.byAccount).toEqual([
      { bankAccountId: null, net: "180.60", count: 2, sharePct: "100", avgDays: "1.5", medianDays: "1.5" },
    ]);
  });

  test("los días de una cuenta salen solo de las filas de esa moneda", () => {
    const resumen = summarize([caido("usd", 1), caido("eur", 5, { currency: "EUR" })], HOY);
    expect(resumen.USD?.byAccount[0]).toMatchObject({ bankAccountId: "cta-a", avgDays: "1.0", medianDays: "1.0" });
    expect(resumen.EUR?.byAccount[0]).toMatchObject({ bankAccountId: "cta-a", avgDays: "5.0", medianDays: "5.0" });
  });

  test("a igual lo facturado, las empresas van por su id", () => {
    const filas = [
      tx("1", { companyId: "emp-b" }),
      tx("2", { companyId: "emp-c", ...monto("250.00", "0.00", "250.00") }),
      tx("3", { companyId: "emp-a" }),
    ];
    expect(summarize(filas, HOY).USD?.byCompany.map((empresa) => empresa.companyId)).toEqual([
      "emp-c",
      "emp-a",
      "emp-b",
    ]);
  });

  test("a igual bruto, las pasarelas van por su id", () => {
    const filas = [
      tx("1", { gatewayId: "pas-b" }),
      tx("2", { gatewayId: "pas-c", ...monto("250.00", "0.00", "250.00") }),
      tx("3", { gatewayId: "pas-a" }),
    ];
    expect(summarize(filas, HOY).USD?.byGateway.map((pasarela) => pasarela.gatewayId)).toEqual([
      "pas-c",
      "pas-a",
      "pas-b",
    ]);
  });

  test("a igual neto, las cuentas van por su id y «sin cuenta» al final", () => {
    const filas = [
      tx("1", { bankAccountId: null }),
      tx("2", { bankAccountId: "cta-z" }),
      tx("3", { bankAccountId: "cta-c", ...monto("250.00", "0.00", "250.00") }),
      tx("4", { bankAccountId: "cta-a" }),
    ];
    expect(summarize(filas, HOY).USD?.byAccount.map((cuenta) => cuenta.bankAccountId)).toEqual([
      "cta-c",
      "cta-a",
      "cta-z",
      null,
    ]);
  });
});

describe("quién paga la comisión: la venta y las comisiones del negocio", () => {
  /** E1 pagando nosotros y E7 pagando el comprador (1040 por algo de 1000; Stripe se lleva 30,46). */
  const nuestro = tx("n1", { ...monto("100.00", "9.70", "90.30") });
  const delComprador = tx("c1", { ...monto("1040.00", "30.46", "1009.54"), feesPaidBy: "comprador" });

  test("por cobro: la venta es el bruto o el neto, y la comisión, del negocio o del comprador", () => {
    expect(businessFigures(nuestro)).toEqual({ sale: "100.00", fees: "9.70", buyerFees: "0.00" });
    expect(businessFigures(delComprador)).toEqual({ sale: "1009.54", fees: "0.00", buyerFees: "30.46" });
  });

  test("con un cobro de cada uno: el bruto es todo lo cobrado; lo facturado y las comisiones, del negocio", () => {
    const usd = summarize([nuestro, delComprador], HOY).USD;
    expect(usd?.totals).toEqual({
      count: 2,
      gross: "1140.00", // todo lo cobrado: cuadra con la pasarela
      sale: "1109.54", // 100,00 + 1009,54
      fees: "9.70", // solo las que pagamos nosotros
      buyerFees: "30.46", // aparte: las pagaron los compradores
      net: "1099.84",
      avgTicket: "570.00",
      feePct: "9.7", // 9,70 sobre los 100,00 en que pagamos la comisión, no sobre los 1140,00
      pendingNet: "1099.84",
      pendingCount: 2,
      depositedNet: "0.00",
      depositedCount: 0,
    });
    expect(usd?.byMonth).toEqual([
      { month: "2026-11", gross: "1140.00", sale: "1109.54", fees: "9.70", buyerFees: "30.46", net: "1099.84", count: 2 },
    ]);
    expect(usd?.byCompany).toEqual([
      { companyId: "emp-tienda", gross: "1140.00", sale: "1109.54", fees: "9.70", buyerFees: "30.46", net: "1099.84", count: 2 },
    ]);
  });

  test("las empresas van por lo facturado, no por lo cobrado", () => {
    const otra = tx("a", { companyId: "emp-a", ...monto("1015.00", "0.00", "1015.00") });
    const usd = summarize([otra, { ...delComprador, companyId: "emp-c" }], HOY).USD;
    // emp-c cobró 1040,00 pero facturó 1009,54: va detrás de emp-a, que facturó 1015,00.
    expect(usd?.byCompany.map((company) => [company.companyId, company.sale])).toEqual([
      ["emp-a", "1015.00"],
      ["emp-c", "1009.54"],
    ]);
  });

  test("por pasarela: el costo efectivo es de las comisiones del negocio sobre lo que cobró pagándolas", () => {
    const paypal = tx("p1", { gatewayId: "pas-paypal", ...monto("60.00", "2.04", "57.96"), feesPaidBy: "comprador" });
    const usd = summarize([nuestro, delComprador, paypal], HOY).USD;
    expect(usd?.byGateway).toEqual([
      {
        gatewayId: "pas-stripe",
        gross: "1140.00",
        sale: "1109.54",
        fees: "9.70",
        buyerFees: "30.46",
        net: "1099.84",
        count: 2,
        sharePct: "95", // 1140,00 ÷ 1200,00: la parte de lo cobrado
        effectiveCostPct: "9.7", // 9,70 ÷ 100,00
      },
      // Todas sus comisiones las pagaron los compradores: al negocio no le costó nada, y no hay % que medir.
      {
        gatewayId: "pas-paypal",
        gross: "60.00",
        sale: "57.96",
        fees: "0.00",
        buyerFees: "2.04",
        net: "57.96",
        count: 1,
        sharePct: "5",
        effectiveCostPct: null,
      },
    ]);
  });

  test("todo pagado por los compradores: comisiones del negocio en cero y sin % de comisión", () => {
    const usd = summarize([delComprador], HOY).USD;
    expect(usd?.totals).toMatchObject({ fees: "0.00", buyerFees: "30.46", sale: "1009.54", feePct: null });
  });

  test("un libro sin cobros del comprador da los mismos totales de siempre", () => {
    // Las filas a mano son todas «nosotros»: lo facturado es el bruto, las comisiones son todas y no hay de
    // compradores.
    const resumen = summarize(FILAS, HOY);
    const raw = totalsOf(FILAS);
    for (const [currency, { totals, byMonth, byCompany, byGateway }] of Object.entries(resumen)) {
      expect(totals).toMatchObject({ ...raw[currency], sale: raw[currency]?.gross, buyerFees: "0.00" });
      for (const group of [...byMonth, ...byCompany, ...byGateway]) {
        expect(group.sale).toBe(group.gross);
        expect(group.buyerFees).toBe("0.00");
      }
    }
  });

  test("totalsOf (los totales de la lista) suma las comisiones de todos sus cobros, las haya pagado quien sea", () => {
    expect(totalsOf([nuestro, delComprador])).toEqual({
      USD: { count: 2, gross: "1140.00", fees: "40.16", net: "1099.84" },
    });
  });
});

describe("por caer: una sola definición para la tarjeta y para los próximos depósitos", () => {
  /** Cuatro cobros de 100,00, los cuatro `registrado` y con la misma fecha estimada; solo dos están por caer. */
  const normal = tx("normal", { estimatedDepositOn: "2026-11-10" });
  /** E5: reembolso parcial de 40,00. Sigue por caer, con su neto ya rebajado. */
  const parcial = tx("parcial", {
    refunded: "40.00",
    gross: "60.00",
    fees: "7.10",
    net: "52.90",
    estimatedDepositOn: "2026-11-10",
  });
  /** E6: disputa abierta con costo de 15,00. La pasarela retiene ese dinero. */
  const enDisputa = tx("en-disputa", {
    disputeState: "abierta",
    fees: "24.70",
    net: "75.30",
    estimatedDepositOn: "2026-11-10",
  });
  /** E4: reembolso total; la pasarela no devuelve su comisión. */
  const reembolsado = tx("reembolsado", {
    refunded: "100.00",
    gross: "0.00",
    fees: "3.20",
    net: "-3.20",
    estimatedDepositOn: "2026-11-10",
  });
  const grupo = [reembolsado, normal, enDisputa, parcial];

  test("la tarjeta cuenta solo el normal y el del reembolso parcial", () => {
    expect(summarize(grupo, HOY).USD?.totals).toMatchObject({
      count: 4,
      pendingNet: "143.20", // 90,30 + 52,90
      pendingCount: 2,
    });
  });

  test("los próximos depósitos traen esos mismos dos", () => {
    expect(upcomingDeposits(grupo, HOY)).toEqual([
      {
        date: "2026-11-10",
        from: "2026-11-10",
        bankAccountId: "cta-a",
        currency: "USD",
        net: "143.20",
        count: 2,
        ids: ["normal", "parcial"],
        overdue: false,
      },
    ]);
  });

  test("y atrasados, también: con la fecha estimada ya pasada salen los mismos dos", () => {
    const atrasados = grupo.map((fila) => ({ ...fila, estimatedDepositOn: "2026-11-05" }));
    expect(upcomingDeposits(atrasados, HOY)).toEqual([
      {
        date: "2026-11-05",
        from: "2026-11-05",
        bankAccountId: "cta-a",
        currency: "USD",
        net: "143.20",
        count: 2,
        ids: ["normal", "parcial"],
        overdue: true,
      },
    ]);
  });

  test("al ganar la disputa el cobro vuelve a estar por caer", () => {
    const ganada = tx("ganada", { disputeState: "ganada", estimatedDepositOn: "2026-11-10" });
    expect(summarize([ganada], HOY).USD?.totals).toMatchObject({ pendingNet: "90.30", pendingCount: 1 });
    expect(upcomingDeposits([ganada], HOY).map((deposito) => deposito.ids)).toEqual([["ganada"]]);
  });
});

describe("totalsOf", () => {
  test("cuenta, bruto, comisiones y neto por moneda, sin los fallidos", () => {
    expect(totalsOf(FILAS)).toEqual({
      USD: { count: 6, gross: "463.33", fees: "23.88", net: "439.45" },
      EUR: { count: 2, gross: "100.00", fees: "3.50", net: "96.50" },
    });
  });

  test("sin filas, o con todas fallidas, no hay monedas", () => {
    expect(totalsOf([])).toEqual({});
    expect(totalsOf([fallido])).toEqual({});
  });
});

describe("lagStats", () => {
  const porPasarela = (fila: LeanTx) => fila.gatewayId;

  test("la mediana de [1, 2, 4] es 2.0 y la de [1, 2] es 1.5", () => {
    const filas = [
      caido("a", 4),
      caido("b", 1),
      caido("c", 2),
      caido("d", 2, { gatewayId: "pas-paypal" }),
      caido("e", 1, { gatewayId: "pas-paypal" }),
    ];
    expect(lagStats(filas, porPasarela)).toEqual({
      "pas-stripe": { count: 3, avgDays: "2.3", medianDays: "2.0" }, // promedio 7 ÷ 3 = 2,33…
      "pas-paypal": { count: 2, avgDays: "1.5", medianDays: "1.5" },
    });
  });

  test("los días se ordenan como números, no como texto (2, 9, 10)", () => {
    expect(lagStats([caido("a", 10), caido("b", 2), caido("c", 9)], porPasarela)).toEqual({
      "pas-stripe": { count: 3, avgDays: "7.0", medianDays: "9.0" },
    });
  });

  test("el promedio se redondea a 1 decimal con la mitad hacia arriba", () => {
    // 1 ÷ 4 = 0,25 → 0,3 · 5 ÷ 3 = 1,66… → 1,7
    expect(lagStats([caido("a", 0), caido("b", 0), caido("c", 0), caido("d", 1)], porPasarela)["pas-stripe"]).toEqual({
      count: 4,
      avgDays: "0.3",
      medianDays: "0.0",
    });
    expect(lagStats([caido("a", 1), caido("b", 2), caido("c", 2)], porPasarela)["pas-stripe"]?.avgDays).toBe("1.7");
  });

  test("los días son de calendario entre la fecha del cobro y la del depósito real", () => {
    const fila = tx("a", { occurredOn: "2026-10-30", status: "depositado", depositedOn: "2026-11-03" });
    expect(lagStats([fila], porPasarela)).toEqual({ "pas-stripe": { count: 1, avgDays: "4.0", medianDays: "4.0" } });
  });

  test("solo cuentan los depositados con fecha real", () => {
    const filas = [
      caido("a", 3),
      tx("registrado", { estimatedDepositOn: "2026-11-20" }),
      tx("en-transito", { status: "en_transito", estimatedDepositOn: "2026-11-20" }),
      tx("fallido", { status: "fallido" }),
      tx("sin-fecha", { status: "depositado", depositedOn: null }),
      tx("otra", { gatewayId: "pas-paypal", status: "en_transito" }),
    ];
    expect(lagStats(filas, porPasarela)).toEqual({ "pas-stripe": { count: 1, avgDays: "3.0", medianDays: "3.0" } });
  });

  test("las filas cuya clave es null se omiten", () => {
    const filas = [caido("a", 1), caido("b", 5, { bankAccountId: null })];
    expect(lagStats(filas, (fila) => fila.bankAccountId)).toEqual({
      "cta-a": { count: 1, avgDays: "1.0", medianDays: "1.0" },
    });
  });

  test("un promedio negativo que redondea a cero se escribe 0.0, sin signo", () => {
    // Un depósito fechado un día antes del cobro entre 21: −1 ÷ 21 = −0,047…
    const filas = [caido("antes", -1), ...Array.from({ length: 20 }, (_, i) => caido(`mismo-dia-${i}`, 0))];
    expect(lagStats(filas, porPasarela)["pas-stripe"]).toEqual({ count: 21, avgDays: "0.0", medianDays: "0.0" });
  });

  test("sin filas no hay claves", () => {
    expect(lagStats([], porPasarela)).toEqual({});
  });
});

describe("upcomingDeposits", () => {
  /** Un cobro por caer con su fecha estimada. */
  const porCaer = (id: string, estimatedDepositOn: string, patch: Partial<LeanTx> = {}): LeanTx =>
    tx(id, { status: "en_transito", estimatedDepositOn, ...patch });

  test("con las filas a mano: primero el atrasado; fuera el depositado, el fallido y el reembolsado", () => {
    expect(upcomingDeposits(FILAS, HOY)).toEqual([
      { date: "2026-11-04", from: "2026-11-04", bankAccountId: "cta-a", currency: "USD", net: "32.06", count: 1, ids: ["u4"], overdue: true },
      { date: HOY, from: HOY, bankAccountId: "cta-eur", currency: "EUR", net: "38.54", count: 1, ids: ["e2"], overdue: false },
      { date: "2026-11-10", from: "2026-11-10", bankAccountId: "cta-b", currency: "USD", net: "76.90", count: 1, ids: ["u5"], overdue: false },
    ]);
  });

  test("excluye depositados, fallidos, reembolsados del todo, en disputa y los que no tienen fecha estimada", () => {
    const filas = [
      tx("depositado", { status: "depositado", estimatedDepositOn: "2026-11-10", depositedOn: "2026-11-08" }),
      tx("fallido", { status: "fallido", estimatedDepositOn: "2026-11-10" }),
      porCaer("reembolsado", "2026-11-10", { refunded: "100.00", gross: "0.00", fees: "3.20", net: "-3.20" }),
      tx("sin-fecha", { status: "registrado", estimatedDepositOn: null }),
      porCaer("atrasado-reembolsado", "2026-11-01", { refunded: "100.00", gross: "0.00", fees: "3.20", net: "-3.20" }),
      porCaer("en-disputa", "2026-11-10", { disputeState: "abierta", fees: "24.70", net: "75.30" }),
      porCaer("atrasado-en-disputa", "2026-11-01", { disputeState: "abierta", fees: "24.70", net: "75.30" }),
    ];
    expect(upcomingDeposits(filas, HOY)).toEqual([]);
  });

  test("entran los registrados y los que están en tránsito", () => {
    const filas = [tx("r", { status: "registrado", estimatedDepositOn: "2026-11-10" }), porCaer("t", "2026-11-11")];
    expect(upcomingDeposits(filas, HOY).map((grupo) => grupo.ids)).toEqual([["r"], ["t"]]);
  });

  test("agrupa por fecha, cuenta y moneda: suma los netos y guarda los ids en el orden de entrada", () => {
    const filas = [
      porCaer("b", "2026-11-10", { ...monto("33.33", "1.27", "32.06") }),
      porCaer("otra-fecha", "2026-11-11"),
      porCaer("a", "2026-11-10"),
      porCaer("otra-cuenta", "2026-11-10", { bankAccountId: "cta-b" }),
      porCaer("otra-moneda", "2026-11-10", { currency: "EUR" }),
    ];
    expect(upcomingDeposits(filas, HOY)).toEqual([
      // A igual fecha: por moneda y luego por cuenta.
      { date: "2026-11-10", from: "2026-11-10", bankAccountId: "cta-a", currency: "EUR", net: "90.30", count: 1, ids: ["otra-moneda"], overdue: false },
      { date: "2026-11-10", from: "2026-11-10", bankAccountId: "cta-a", currency: "USD", net: "122.36", count: 2, ids: ["b", "a"], overdue: false },
      { date: "2026-11-10", from: "2026-11-10", bankAccountId: "cta-b", currency: "USD", net: "90.30", count: 1, ids: ["otra-cuenta"], overdue: false },
      { date: "2026-11-11", from: "2026-11-11", bankAccountId: "cta-a", currency: "USD", net: "90.30", count: 1, ids: ["otra-fecha"], overdue: false },
    ]);
  });

  test("a igual fecha y moneda, «sin cuenta» va al final", () => {
    const filas = [
      porCaer("sin-cuenta", "2026-11-10", { bankAccountId: null }),
      porCaer("z", "2026-11-10", { bankAccountId: "cta-z" }),
      porCaer("a", "2026-11-10", { bankAccountId: "cta-a" }),
    ];
    expect(upcomingDeposits(filas, HOY).map((grupo) => grupo.bankAccountId)).toEqual(["cta-a", "cta-z", null]);
  });

  test("atrasado es fecha estimada anterior a hoy: ayer sí, hoy no", () => {
    const filas = [porCaer("hoy", HOY), porCaer("ayer", "2026-11-08")];
    expect(upcomingDeposits(filas, HOY).map((grupo) => [grupo.date, grupo.overdue])).toEqual([
      ["2026-11-08", true],
      [HOY, false],
    ]);
  });

  test("los atrasados entran todos, por viejos que sean, y van primero por fecha ascendente", () => {
    const filas = [
      porCaer("proximo", "2026-11-12"),
      porCaer("atrasado-reciente", "2026-11-06"),
      porCaer("atrasado-viejo", "2025-01-15"),
    ];
    expect(upcomingDeposits(filas, HOY).map((grupo) => grupo.ids[0])).toEqual([
      "atrasado-viejo",
      "atrasado-reciente",
      "proximo",
    ]);
  });

  test("por defecto mira 14 días contando hoy: hasta hoy + 13", () => {
    const filas = [porCaer("dia-14", "2026-11-22"), porCaer("dia-15", "2026-11-23"), porCaer("lejos", "2027-01-01")];
    expect(upcomingDeposits(filas, HOY).map((grupo) => grupo.date)).toEqual(["2026-11-22"]);
  });

  test("con otra cantidad de días la ventana es [hoy, hoy + días − 1]", () => {
    const filas = [porCaer("a", HOY), porCaer("b", "2026-11-11"), porCaer("c", "2026-11-12"), porCaer("viejo", "2026-11-01")];
    expect(upcomingDeposits(filas, HOY, 3).map((grupo) => grupo.date)).toEqual(["2026-11-01", HOY, "2026-11-11"]);
    expect(upcomingDeposits(filas, HOY, 1).map((grupo) => grupo.date)).toEqual(["2026-11-01", HOY]);
  });

  test("un neto negativo por caer también se suma (una cuota fija mayor que lo cobrado)", () => {
    const filas = [
      porCaer("cuota-fija", "2026-11-10", { ...monto("0.20", "0.31", "-0.11") }),
      porCaer("normal", "2026-11-10", { ...monto("33.33", "1.27", "32.06") }),
    ];
    expect(upcomingDeposits(filas, HOY)).toEqual([
      { date: "2026-11-10", from: "2026-11-10", bankAccountId: "cta-a", currency: "USD", net: "31.95", count: 2, ids: ["cuota-fija", "normal"], overdue: false },
    ]);
  });

  test("una ventana cuenta en el día de su fecha más tardía; el grupo dice desde cuándo puede caer", () => {
    const filas = [
      porCaer("un-dia", "2026-11-12"),
      porCaer("ventana", "2026-11-12", { estimatedDepositFrom: "2026-11-10" }),
      porCaer("otra-ventana", "2026-11-12", { estimatedDepositFrom: "2026-11-11" }),
      porCaer("solo-esta", "2026-11-13", { estimatedDepositFrom: "2026-11-11" }),
    ];
    expect(upcomingDeposits(filas, HOY).map(({ date, from, ids }) => [date, from, ids])).toEqual([
      ["2026-11-12", "2026-11-10", ["un-dia", "ventana", "otra-ventana"]],
      ["2026-11-13", "2026-11-11", ["solo-esta"]],
    ]);
  });

  test("atrasado solo después de la más tardía: con la más temprana ya pasada y la más tardía hoy, todavía no", () => {
    const filas = [
      porCaer("hoy-la-ultima", HOY, { estimatedDepositFrom: "2026-11-05" }),
      porCaer("ayer-la-ultima", "2026-11-08", { estimatedDepositFrom: "2026-11-04" }),
    ];
    expect(upcomingDeposits(filas, HOY).map(({ ids, from, overdue }) => [ids[0], from, overdue])).toEqual([
      ["ayer-la-ultima", "2026-11-04", true],
      ["hoy-la-ultima", "2026-11-05", false],
    ]);
  });

  test("sin filas no hay grupos", () => {
    expect(upcomingDeposits([], HOY)).toEqual([]);
  });
});
