import { describe, expect, it } from "vitest";
import { summarize, type LeanTx } from "@/lib/pasarelas";
import { chooseCurrency, monthRows, splitRows, summaryScope } from "./summary";

/** Un cobro mínimo de 100,00 sin comisiones. */
function tx(patch: Partial<LeanTx> = {}): LeanTx {
  return {
    id: "t1",
    occurredOn: "2026-11-05",
    companyId: "c1",
    channelId: null,
    gatewayId: "g1",
    bankAccountId: "a1",
    currency: "USD",
    grossOriginal: "100.00",
    refunded: "0.00",
    gross: "100.00",
    fees: "0.00",
    net: "100.00",
    status: "registrado",
    disputeState: null,
    estimatedDepositOn: "2026-11-09",
    depositedOn: null,
    receiptsCount: 0,
    ...patch,
  };
}

const COMPANY = "8f0c6f8e-6b8f-4a3e-9d0c-2f1b6a7c9e01";
const GATEWAY = "8f0c6f8e-6b8f-4a3e-9d0c-2f1b6a7c9e02";
const CHANNEL = "8f0c6f8e-6b8f-4a3e-9d0c-2f1b6a7c9e03";
const ACCOUNT = "8f0c6f8e-6b8f-4a3e-9d0c-2f1b6a7c9e04";

describe("summaryScope", () => {
  it("sin parámetros rige este mes, sin más filtros", () => {
    const scope = summaryScope({}, "2026-11-10");
    expect(scope.filters).toEqual({ from: "2026-11-01", to: "2026-11-10" });
    expect(scope.requestedCurrency).toBeUndefined();
    expect(scope.query.toString()).toBe("");
  });

  it("toma período, empresa, canal, pasarela y moneda; ignora lo que el Resumen no filtra", () => {
    const scope = summaryScope(
      {
        periodo: "personalizado",
        desde: "2026-10-01",
        hasta: "2026-10-31",
        empresa: COMPANY,
        canal: CHANNEL,
        pasarela: GATEWAY,
        moneda: "EUR",
        cuenta: ACCOUNT,
        estado: "atrasado",
        comprobante: "sin",
        q: "algo",
        orden: "monto_asc",
        pagina: "3",
      },
      "2026-11-10",
    );
    expect(scope.filters).toEqual({
      from: "2026-10-01",
      to: "2026-10-31",
      companyId: COMPANY,
      channelId: CHANNEL,
      gatewayId: GATEWAY,
    });
    expect(scope.requestedCurrency).toBe("EUR");
    // Para los enlaces a la lista: solo las claves del alcance, tal como llegaron.
    expect(scope.query.toString()).toBe(
      `periodo=personalizado&desde=2026-10-01&hasta=2026-10-31&empresa=${COMPANY}&canal=${CHANNEL}&pasarela=${GATEWAY}`,
    );
  });

  it("un valor que no se entiende no filtra (y no lanza)", () => {
    const scope = summaryScope({ periodo: "siempre", empresa: "no-es-un-id", moneda: "dólares" }, "2026-11-10");
    expect(scope.filters).toEqual({ from: "2026-11-01", to: "2026-11-10" });
    expect(scope.requestedCurrency).toBeUndefined();
  });
});

describe("chooseCurrency", () => {
  const byCurrency = summarize(
    [
      tx({ id: "u1", currency: "USD", gross: "50.00", net: "50.00" }),
      tx({ id: "e1", currency: "EUR", gross: "80.00", net: "80.00" }),
    ],
    "2026-11-10",
  );

  it("por defecto, la de más bruto en el período (sin sumar monedas)", () => {
    expect(chooseCurrency(byCurrency, [], undefined)).toEqual({
      currencies: ["EUR", "USD"],
      currency: "EUR",
      defaultCurrency: "EUR",
    });
  });

  it("la pedida, si hay algo en ella", () => {
    expect(chooseCurrency(byCurrency, [], "USD").currency).toBe("USD");
  });

  it("una pedida sin nada que mostrar no se elige", () => {
    expect(chooseCurrency(byCurrency, [], "MXN").currency).toBe("EUR");
  });

  it("cuentan también las monedas de lo demás (depósitos, repartos), sin período", () => {
    expect(chooseCurrency({}, ["MXN", "USD", "MXN"], undefined)).toEqual({
      currencies: ["MXN", "USD"],
      currency: "MXN",
      defaultCurrency: "MXN",
    });
    expect(chooseCurrency({}, ["MXN", "USD"], "USD").currency).toBe("USD");
  });

  it("a igual bruto, la primera por orden alfabético", () => {
    const tie = summarize([tx({ id: "u", currency: "USD" }), tx({ id: "e", currency: "EUR" })], "2026-11-10");
    expect(chooseCurrency(tie, [], undefined).currency).toBe("EUR");
  });

  it("sin nada, ninguna", () => {
    expect(chooseCurrency({}, [], "USD")).toEqual({ currencies: [], currency: null, defaultCurrency: null });
  });
});

describe("monthRows", () => {
  it("todos los meses del período, en orden, con cero los que no tienen cobros", () => {
    const { USD } = summarize(
      [tx({ id: "a", occurredOn: "2026-09-03" }), tx({ id: "b", occurredOn: "2026-11-05", gross: "40.00", net: "38.00", fees: "2.00" })],
      "2026-11-10",
    );
    expect(monthRows({ from: "2026-08-15", to: "2026-11-10" }, USD?.byMonth ?? [])).toEqual([
      { month: "2026-08", label: "ago 2026", gross: "0.00", fees: "0.00", net: "0.00", count: 0 },
      { month: "2026-09", label: "sep 2026", gross: "100.00", fees: "0.00", net: "100.00", count: 1 },
      { month: "2026-10", label: "oct 2026", gross: "0.00", fees: "0.00", net: "0.00", count: 0 },
      { month: "2026-11", label: "nov 2026", gross: "40.00", fees: "2.00", net: "38.00", count: 1 },
    ]);
  });

  it("cruza el cambio de año", () => {
    expect(monthRows({ from: "2026-12-31", to: "2027-01-01" }, []).map((row) => row.month)).toEqual([
      "2026-12",
      "2027-01",
    ]);
  });
});

describe("splitRows", () => {
  const order = ["ga", "gb", "gc"];

  it("asignado y liquidado del período y saldo de toda la historia, solo de la moneda pedida", () => {
    const rows = splitRows(
      "USD",
      [
        { beneficiaryId: "gb", currency: "USD", amount: "29.04" },
        { beneficiaryId: "ga", currency: "USD", amount: "48.40" },
        { beneficiaryId: "ga", currency: "EUR", amount: "10.00" },
      ],
      [{ beneficiaryId: "gc", currency: "USD", amount: "70.00" }],
      [
        { beneficiaryId: "ga", currency: "USD", assigned: "148.40", settled: "40.00", balance: "108.40" },
        { beneficiaryId: "gc", currency: "USD", assigned: "19.36", settled: "70.00", balance: "-50.64" },
        { beneficiaryId: "gb", currency: "EUR", assigned: "5.00", settled: "0.00", balance: "5.00" },
      ],
      order,
    );
    expect(rows).toEqual([
      { beneficiaryId: "ga", assigned: "48.40", settled: "0.00", balance: "108.40" },
      // Grupo B tiene saldo en EUR, pero en USD solo lo asignado del período (aún sin fila en la vista).
      { beneficiaryId: "gb", assigned: "29.04", settled: "0.00", balance: "0.00" },
      { beneficiaryId: "gc", assigned: "0.00", settled: "70.00", balance: "-50.64" },
    ]);
  });

  it("los beneficiarios que no están en el orden van al final, por id", () => {
    const rows = splitRows(
      "USD",
      [
        { beneficiaryId: "zz", currency: "USD", amount: "1.00" },
        { beneficiaryId: "yy", currency: "USD", amount: "1.00" },
        { beneficiaryId: "gb", currency: "USD", amount: "1.00" },
      ],
      [],
      [],
      order,
    );
    expect(rows.map((row) => row.beneficiaryId)).toEqual(["gb", "yy", "zz"]);
  });

  it("sin moneda, nada", () => {
    expect(splitRows(null, [{ beneficiaryId: "ga", currency: "USD", amount: "1.00" }], [], [], order)).toEqual([]);
  });
});
