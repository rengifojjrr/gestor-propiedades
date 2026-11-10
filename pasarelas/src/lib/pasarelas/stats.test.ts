import { describe, expect, test } from "vitest";
import { addDays } from "./dates";
import { lagStats, summarize, totalsOf, upcomingDeposits } from "./stats";
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
  depositedOn: null,
  receiptsCount: 0,
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
/** Reembolso total con costo: bruto vigente 0,00 y neto negativo, sin cuenta destino. */
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
      fees: "23.88",
      net: "439.45",
      avgTicket: "77.22", // 463,33 ÷ 6 = 77,2216…
      feePct: "5.15", // 23,88 ÷ 463,33 = 5,1540… %
      pendingNet: "107.50", // u4 + u5 + u6 = 32,06 + 76,90 − 1,46
      pendingCount: 3,
      depositedNet: "331.95", // u1 + u2 + u3 = 90,30 + 193,90 + 47,75
      depositedCount: 3,
    });
  });

  test("totales en EUR", () => {
    expect(resumen.EUR?.totals).toEqual({
      count: 2,
      gross: "100.00",
      fees: "3.50",
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
      { month: "2026-09", gross: "100.00", fees: "9.70", net: "90.30", count: 1 },
      { month: "2026-10", gross: "250.00", fees: "8.35", net: "241.65", count: 2 },
      { month: "2026-11", gross: "113.33", fees: "5.83", net: "107.50", count: 3 },
    ]);
    expect(resumen.EUR?.byMonth).toEqual([
      { month: "2026-10", gross: "60.00", fees: "2.04", net: "57.96", count: 1 },
      { month: "2026-11", gross: "40.00", fees: "1.46", net: "38.54", count: 1 },
    ]);
  });

  test("byCompany: de mayor a menor bruto (como decimales: 380,00 va antes que 83,33)", () => {
    expect(resumen.USD?.byCompany).toEqual([
      { companyId: "emp-tienda", gross: "380.00", fees: "18.90", net: "361.10", count: 3 },
      { companyId: "emp-escuela", gross: "83.33", fees: "3.52", net: "79.81", count: 2 },
      { companyId: "emp-estudio", gross: "0.00", fees: "1.46", net: "-1.46", count: 1 },
    ]);
    expect(resumen.EUR?.byCompany).toEqual([
      { companyId: "emp-tienda", gross: "100.00", fees: "3.50", net: "96.50", count: 2 },
    ]);
  });

  test("byGateway: de mayor a menor bruto, con su parte del bruto y su costo efectivo", () => {
    expect(resumen.USD?.byGateway).toEqual([
      {
        gatewayId: "pas-stripe",
        gross: "333.33",
        fees: "17.07",
        net: "316.26",
        count: 3,
        sharePct: "71.94", // 333,33 ÷ 463,33
        effectiveCostPct: "5.12", // 17,07 ÷ 333,33
      },
      {
        gatewayId: "pas-paypal",
        gross: "130.00",
        fees: "5.35",
        net: "124.65",
        count: 2,
        sharePct: "28.06", // 130,00 ÷ 463,33
        effectiveCostPct: "4.12", // 5,35 ÷ 130,00 = 4,1153… %
      },
      // Bruto 0,00: su parte es 0 % y no tiene costo efectivo (no se divide entre cero).
      { gatewayId: "pas-zelle", gross: "0.00", fees: "1.46", net: "-1.46", count: 1, sharePct: "0", effectiveCostPct: null },
    ]);
    expect(resumen.EUR?.byGateway).toEqual([
      {
        gatewayId: "pas-stripe",
        gross: "100.00",
        fees: "3.50",
        net: "96.50",
        count: 2,
        sharePct: "100",
        effectiveCostPct: "3.5",
      },
    ]);
  });

  test("byAccount: de mayor a menor neto, con su parte del neto y lo que tardan sus depósitos", () => {
    expect(resumen.USD?.byAccount).toEqual([
      // u1 cayó en 1 día y u2 en 2; u4 sigue en tránsito y no cuenta para los días.
      { bankAccountId: "cta-a", net: "316.26", count: 3, sharePct: "71.97", avgDays: "1.5", medianDays: "1.5" },
      // 124,65 ÷ 439,45 = 28,36500017… %: pasa de la mitad por muy poco.
      { bankAccountId: "cta-b", net: "124.65", count: 2, sharePct: "28.37", avgDays: "4.0", medianDays: "4.0" },
      // «Sin cuenta»: nada depositado todavía.
      { bankAccountId: null, net: "-1.46", count: 1, sharePct: "-0.33", avgDays: null, medianDays: null },
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
    expect(usd?.totals).toMatchObject({ count: 2, gross: "0.00", fees: "2.92", net: "-2.92", avgTicket: "0.00" });
    expect(usd?.totals.feePct).toBeNull();
    expect(usd?.byGateway).toEqual([
      { gatewayId: "pas-stripe", gross: "0.00", fees: "2.92", net: "-2.92", count: 2, sharePct: null, effectiveCostPct: null },
    ]);
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

  test("a igual bruto, las empresas van por su id", () => {
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

  test("con las filas a mano: primero el atrasado; fuera el depositado, el fallido y el de bruto 0.00", () => {
    expect(upcomingDeposits(FILAS, HOY)).toEqual([
      { date: "2026-11-04", bankAccountId: "cta-a", currency: "USD", net: "32.06", count: 1, ids: ["u4"], overdue: true },
      { date: HOY, bankAccountId: "cta-eur", currency: "EUR", net: "38.54", count: 1, ids: ["e2"], overdue: false },
      { date: "2026-11-10", bankAccountId: "cta-b", currency: "USD", net: "76.90", count: 1, ids: ["u5"], overdue: false },
    ]);
  });

  test("excluye depositados, fallidos, bruto 0.00 y los que no tienen fecha estimada", () => {
    const filas = [
      tx("depositado", { status: "depositado", estimatedDepositOn: "2026-11-10", depositedOn: "2026-11-08" }),
      tx("fallido", { status: "fallido", estimatedDepositOn: "2026-11-10" }),
      porCaer("reembolsado", "2026-11-10", { refunded: "100.00", gross: "0.00", fees: "3.20", net: "-3.20" }),
      tx("sin-fecha", { status: "registrado", estimatedDepositOn: null }),
      porCaer("atrasado-reembolsado", "2026-11-01", { refunded: "100.00", gross: "0.00", fees: "3.20", net: "-3.20" }),
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
      { date: "2026-11-10", bankAccountId: "cta-a", currency: "EUR", net: "90.30", count: 1, ids: ["otra-moneda"], overdue: false },
      { date: "2026-11-10", bankAccountId: "cta-a", currency: "USD", net: "122.36", count: 2, ids: ["b", "a"], overdue: false },
      { date: "2026-11-10", bankAccountId: "cta-b", currency: "USD", net: "90.30", count: 1, ids: ["otra-cuenta"], overdue: false },
      { date: "2026-11-11", bankAccountId: "cta-a", currency: "USD", net: "90.30", count: 1, ids: ["otra-fecha"], overdue: false },
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

  test("un neto negativo por caer también se suma (bruto vigente mayor que cero)", () => {
    const filas = [
      porCaer("disputa", "2026-11-10", { ...monto("10.00", "15.59", "-5.59") }),
      porCaer("normal", "2026-11-10", { ...monto("33.33", "1.27", "32.06") }),
    ];
    expect(upcomingDeposits(filas, HOY)).toEqual([
      { date: "2026-11-10", bankAccountId: "cta-a", currency: "USD", net: "26.47", count: 2, ids: ["disputa", "normal"], overdue: false },
    ]);
  });

  test("sin filas no hay grupos", () => {
    expect(upcomingDeposits([], HOY)).toEqual([]);
  });
});
