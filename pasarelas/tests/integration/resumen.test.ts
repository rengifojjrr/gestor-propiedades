import { beforeAll, describe, expect, it } from "vitest";
import { ensureHolidays, loadPayConfig } from "@/server/pasarelas/queries/config";
import {
  beneficiaryBalances,
  loadSummary,
  periodAllocations,
  periodSettlements,
} from "@/server/pasarelas/queries/summary";
import { leanTx } from "@/server/pasarelas/queries/transactions";
import { createUser, e1Item, saveTransactions, seedBasics, unwrap, type Basics, type TestUser } from "./helpers";

/**
 * Las lecturas del Resumen con la sesión real de un usuario de prueba: lo asignado a cada beneficiario por los
 * cobros del período, lo liquidado en el período, el saldo de toda la historia (vista `pay_beneficiary_balances`) y
 * el Resumen entero armado desde los parámetros de la URL.
 *
 * Datos: 120 cobros E1 en USD el 13 de noviembre (más de un tramo de 100 ids al leer sus repartos), uno E1 en EUR
 * el mismo día, uno E1 en USD el 20 de octubre (fuera del período) y liquidaciones dentro y fuera del período.
 */

const TODAY = "2026-11-20";
const NOV = { from: "2026-11-01", to: TODAY };
const USD_COUNT = 120;

let user: TestUser;
let other: TestUser;
let b: Basics;
let shopId: string;

beforeAll(async () => {
  [user, other] = await Promise.all([createUser(), createUser()]);
  b = await seedBasics(user.client);
  const c = user.client;
  shopId = unwrap(await c.from("pay_companies").insert({ name: "Tienda Demo" }).select("id").single(), "tienda").id;

  // Uno de los de noviembre tiene la disputa abierta (la pasarela de prueba no cobra por disputa): no está por caer.
  const november = Array.from({ length: USD_COUNT - 1 }, () => e1Item(b));
  await saveTransactions(c, [
    ...november,
    e1Item(b, { dispute_state: "abierta", dispute_opened_on: "2026-11-15" }),
    e1Item(b, { currency: "EUR" }),
    e1Item(b, {
      occurred_at: "2026-10-20T15:00:00+00:00",
      occurred_on: "2026-10-20",
      estimated_deposit_on: "2026-10-22",
    }),
  ]);

  unwrap(
    await c
      .from("pay_settlements")
      .insert([
        { beneficiary_id: b.beneficiaryIds.a, paid_on: "2026-11-14", currency: "USD", amount: "100.00" },
        { beneficiary_id: b.beneficiaryIds.a, paid_on: "2026-10-31", currency: "USD", amount: "50.00" },
        { beneficiary_id: b.beneficiaryIds.c, paid_on: "2026-11-01", currency: "EUR", amount: "30.00" },
      ])
      .select("id"),
    "liquidaciones",
  );
  // Otro usuario con lo suyo: no se cuela en nada.
  const otherBasics = await seedBasics(other.client);
  await saveTransactions(other.client, [e1Item(otherBasics)]);
});

describe("lecturas del Resumen", () => {
  it("periodAllocations suma lo asignado por beneficiario y moneda a los cobros dados", async () => {
    const rows = await leanTx(user.client, NOV, TODAY);
    const amounts = await periodAllocations(user.client, rows);
    // El cobro en disputa sigue contando: su reparto ya refleja el costo de la disputa (0,00 aquí).
    expect(amounts).toEqual(
      expect.arrayContaining([
        { beneficiaryId: b.beneficiaryIds.a, currency: "USD", amount: "5418.00" },
        { beneficiaryId: b.beneficiaryIds.b, currency: "USD", amount: "3250.80" },
        { beneficiaryId: b.beneficiaryIds.c, currency: "USD", amount: "2167.20" },
        { beneficiaryId: b.beneficiaryIds.a, currency: "EUR", amount: "45.15" },
        { beneficiaryId: b.beneficiaryIds.b, currency: "EUR", amount: "27.09" },
        { beneficiaryId: b.beneficiaryIds.c, currency: "EUR", amount: "18.06" },
      ]),
    );
    expect(amounts).toHaveLength(6);
    expect(await periodAllocations(user.client, [])).toEqual([]);
  });

  it("periodSettlements suma lo liquidado en el período, por beneficiario y moneda", async () => {
    expect(await periodSettlements(user.client, NOV)).toEqual(
      expect.arrayContaining([
        { beneficiaryId: b.beneficiaryIds.a, currency: "USD", amount: "100.00" },
        { beneficiaryId: b.beneficiaryIds.c, currency: "EUR", amount: "30.00" },
      ]),
    );
    expect(await periodSettlements(user.client, NOV)).toHaveLength(2);
    expect(await periodSettlements(user.client, { from: "2026-10-01", to: "2026-10-31" })).toEqual([
      { beneficiaryId: b.beneficiaryIds.a, currency: "USD", amount: "50.00" },
    ]);
  });

  it("beneficiaryBalances: saldo de toda la historia, con el dinero como texto", async () => {
    const balances = await beneficiaryBalances(user.client);
    expect(balances).toEqual(
      expect.arrayContaining([
        // 121 cobros USD × 45,15 − 150,00 liquidados.
        { beneficiaryId: b.beneficiaryIds.a, currency: "USD", assigned: "5463.15", settled: "150.00", balance: "5313.15" },
        { beneficiaryId: b.beneficiaryIds.c, currency: "EUR", assigned: "18.06", settled: "30.00", balance: "-11.94" },
      ]),
    );
    expect(balances).toHaveLength(6);
  });
});

describe("loadSummary", () => {
  it("arma el Resumen del período en la moneda de más bruto, sin mezclar monedas", async () => {
    const cfg = await loadPayConfig(user.client);
    const view = await loadSummary(user.client, {}, TODAY, cfg);

    expect(view.period).toEqual(NOV);
    expect(view.currencies).toEqual(["EUR", "USD"]);
    expect(view.currency).toBe("USD");
    expect(view.defaultCurrency).toBe("USD");
    expect(view.summary?.totals).toMatchObject({ count: USD_COUNT, gross: "12000.00", net: "10836.00" });
    expect(view.months).toEqual([
      { month: "2026-11", label: "nov 2026", gross: "12000.00", fees: "1164.00", net: "10836.00", count: USD_COUNT },
    ]);

    // Los depósitos: todo lo por caer, sin período (el de octubre también), solo en USD. El de la disputa no.
    expect(view.deposits).toEqual([
      {
        date: "2026-10-22",
        bankAccountId: b.bankAccountId,
        currency: "USD",
        net: "90.30",
        count: 1,
        ids: expect.any(Array),
        overdue: true,
      },
      {
        date: "2026-11-13",
        bankAccountId: b.bankAccountId,
        currency: "USD",
        net: "10745.70",
        count: USD_COUNT - 1,
        ids: expect.any(Array),
        overdue: true,
      },
    ]);
    expect(view.depositWindow).toEqual({ from: TODAY, to: "2026-12-03" });

    expect(view.splits).toEqual([
      { beneficiaryId: b.beneficiaryIds.a, assigned: "5418.00", settled: "100.00", balance: "5313.15" },
      { beneficiaryId: b.beneficiaryIds.b, assigned: "3250.80", settled: "0.00", balance: "3277.89" },
      { beneficiaryId: b.beneficiaryIds.c, assigned: "2167.20", settled: "0.00", balance: "2185.26" },
    ]);

    expect(view.links.pending).toBe("/pasarelas/cobros?estado=por_caer&moneda=USD");
    expect(view.notices).toEqual({
      // Los 121 del período, en cualquier moneda: el aviso cuenta cobros, no suma dinero.
      withoutReceipt: { count: USD_COUNT + 1, href: "/pasarelas/cobros?comprobante=sin" },
      // Toda la historia: los 119 de noviembre sin disputa, el de EUR y el de octubre.
      overdue: {
        count: USD_COUNT + 1,
        href: "/pasarelas/cobros?periodo=personalizado&desde=2026-10-20&hasta=2026-11-13&estado=atrasado",
      },
      disputes: {
        count: 1,
        href: "/pasarelas/cobros?periodo=personalizado&desde=2026-11-13&hasta=2026-11-13&estado=en_disputa",
      },
      companiesWithoutScheme: [{ id: shopId, name: "Tienda Demo" }],
      yearsWithoutHolidays: [2026, 2027],
    });
  });

  it("con otra moneda pedida, todo va en ella; los filtros pasan a los enlaces", async () => {
    await ensureHolidays(user.client);
    const cfg = await loadPayConfig(user.client);
    const view = await loadSummary(
      user.client,
      { moneda: "EUR", empresa: b.companyId, estado: "fallido" },
      TODAY,
      cfg,
    );

    expect(view.currency).toBe("EUR");
    expect(view.defaultCurrency).toBe("USD");
    expect(view.summary?.totals).toMatchObject({ count: 1, gross: "100.00", net: "90.30" });
    expect(view.deposits.map((group) => [group.currency, group.net])).toEqual([["EUR", "90.30"]]);
    expect(view.splits).toEqual([
      { beneficiaryId: b.beneficiaryIds.a, assigned: "45.15", settled: "0.00", balance: "45.15" },
      { beneficiaryId: b.beneficiaryIds.b, assigned: "27.09", settled: "0.00", balance: "27.09" },
      { beneficiaryId: b.beneficiaryIds.c, assigned: "18.06", settled: "30.00", balance: "-11.94" },
    ]);
    expect(view.links.pending).toBe(`/pasarelas/cobros?empresa=${b.companyId}&estado=por_caer&moneda=EUR`);
    expect(view.notices.withoutReceipt?.href).toBe(`/pasarelas/cobros?empresa=${b.companyId}&comprobante=sin`);
    expect(view.notices.yearsWithoutHolidays).toEqual([]);
  });

  it("sin cobros: nada que pintar y ningún aviso de cobros", async () => {
    const empty = await createUser();
    const cfg = await loadPayConfig(empty.client);
    const view = await loadSummary(empty.client, {}, TODAY, cfg);
    expect(view).toMatchObject({
      currencies: [],
      currency: null,
      summary: null,
      months: [{ month: "2026-11", count: 0 }],
      deposits: [],
      splits: [],
      notices: { withoutReceipt: null, overdue: null, disputes: null, companiesWithoutScheme: [] },
    });
  });
});
