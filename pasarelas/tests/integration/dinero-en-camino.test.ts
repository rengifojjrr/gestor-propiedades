import { beforeAll, describe, expect, it } from "vitest";
import { compute, type Rules } from "@/lib/pasarelas";
import { trashTx } from "@/server/pasarelas/ops/transactions";
import { loadPayConfig } from "@/server/pasarelas/queries/config";
import { loadSummary, transitRows } from "@/server/pasarelas/queries/summary";
import {
  basicsRules,
  createUser,
  e1Item,
  saveTransactions,
  seedBasics,
  unwrap,
  type Basics,
  type SaveItem,
  type TestUser,
} from "./helpers";

/**
 * «Dinero en camino» con la sesión real de un usuario de prueba: la lectura trae solo sus cobros sin depositar (la
 * RLS deja fuera los del otro usuario; la papelera y lo depositado, fuera), lo depositado en los últimos 30 días y
 * lo retenido con los días de su regla congelada; el Resumen separa lo detenido por disputa y lo retenido, y no
 * depende del período ni de los filtros.
 *
 * Hoy es el vie 20 nov 2026. Todos son E1 de Escuela Demo por Stripe (100,00 → neto 90,30), a la Cuenta principal:
 *  - «atrasado»: del 10 nov, en tránsito, con fecha el mar 17 → debió llegar hace 3 días;
 *  - «hoy»: del 13 nov, con fecha hoy, y Stripe retiene 5 % durante 30 días → llega 85,30; se libera el 13 dic;
 *  - «proximo»: del 18 nov, ventana del lun 23 al mié 25;
 *  - «sin-cuenta»: del 19 nov, sin cuenta destino, con fecha el 15 dic (dentro de 25 días);
 *  - «disputa»: con la disputa abierta: detenido;
 *  - «depositado»: depositado el 18 nov · «viejo»: depositado el 1 oct, hace más de 30 días;
 *  - «retenido-viejo»: del 1 sep, con retención ya liberada el 1 oct, depositado el 5 sep;
 *  - «papelera»: por caer, pero en la papelera.
 */

const TODAY = "2026-11-20";

let user: TestUser;
let other: TestUser;
let b: Basics;
const ids: Record<string, string> = {};

/** Un E1 del día `on` (al mediodía UTC), con su referencia. */
function charge(reference: string, on: string, tx: SaveItem["tx"] = {}): SaveItem {
  return e1Item(b, {
    reference,
    occurred_on: on,
    occurred_at: `${on}T15:00:00+00:00`,
    estimated_deposit_on: on,
    ...tx,
  });
}

/** Un E1 con la regla de retención de Stripe congelada: 5 % durante 30 días, todo para Titular A. */
function retainedCharge(reference: string, on: string, titularId: string, tx: SaveItem["tx"] = {}): SaveItem {
  const base = basicsRules(b);
  const rules: Rules = {
    ...base,
    gateway: {
      ...base.gateway,
      retention: { pct: "5", days: 30, recipients: [{ beneficiaryId: titularId, name: "Titular A", pct: "100" }] },
    },
  };
  const state = { grossOriginal: "100.00", refunded: "0.00", dispute: null, failed: false, feesPaidBy: "nosotros" } as const;
  return {
    ...charge(reference, on, { breakdown: compute(rules, state, "USD") as never, retention_amount: "5.00", ...tx }),
    retention_shares: [{ beneficiary_id: titularId, amount: "5.00" }],
  };
}

beforeAll(async () => {
  [user, other] = await Promise.all([createUser(), createUser()]);
  b = await seedBasics(user.client);
  const titularId = unwrap(
    await user.client.from("pay_beneficiaries").insert({ name: "Titular A" }).select("id").single(),
    "Titular A",
  ).id;

  const items: [string, SaveItem][] = [
    ["atrasado", charge("DC-ATR", "2026-11-10", { status: "en_transito", estimated_deposit_on: "2026-11-17" })],
    ["hoy", retainedCharge("DC-HOY", "2026-11-13", titularId, { estimated_deposit_on: TODAY })],
    [
      "proximo",
      charge("DC-PROX", "2026-11-18", { estimated_deposit_from: "2026-11-23", estimated_deposit_on: "2026-11-25" }),
    ],
    ["sin-cuenta", charge("DC-SC", "2026-11-19", { bank_account_id: null, estimated_deposit_on: "2026-12-15" })],
    [
      "disputa",
      charge("DC-DISP", "2026-11-16", { dispute_state: "abierta", dispute_opened_on: "2026-11-18" }),
    ],
    ["depositado", charge("DC-DEP", "2026-11-14", { status: "depositado", deposited_on: "2026-11-18" })],
    ["viejo", charge("DC-VIEJO", "2026-09-28", { status: "depositado", deposited_on: "2026-10-01" })],
    [
      "retenido-viejo",
      retainedCharge("DC-RV", "2026-09-01", titularId, { status: "depositado", deposited_on: "2026-09-05" }),
    ],
    ["papelera", charge("DC-PAP", "2026-11-19")],
  ];
  const saved = await saveTransactions(
    user.client,
    items.map(([, item]) => item),
  );
  items.forEach(([name], index) => {
    ids[name] = saved[index]?.id ?? "";
  });
  await trashTx(user.client, [ids.papelera ?? ""]);

  // Otro usuario con un cobro por caer: no se cuela.
  const otherBasics = await seedBasics(other.client);
  await saveTransactions(other.client, [e1Item(otherBasics, { estimated_deposit_on: TODAY })]);
});

describe("transitRows", () => {
  it("trae solo lo del usuario: sin depositar y fuera de la papelera, lo depositado reciente y lo retenido", async () => {
    const rows = await transitRows(user.client, TODAY);

    expect(rows.open.map((row) => row.id).toSorted()).toEqual(
      [ids.atrasado, ids.hoy, ids.proximo, ids["sin-cuenta"], ids.disputa].toSorted(),
    );
    expect(rows.open.find((row) => row.id === ids.hoy)).toMatchObject({
      reference: "DC-HOY",
      net: "90.30",
      retention: "5.00",
      estimatedDepositOn: TODAY,
    });
    // Depositado desde hace 29 días: el del 1 oct no se lee.
    expect(rows.deposited.map((row) => row.id)).toEqual([ids.depositado]);
    // Con algo retenido en el último año: los días salen de la regla congelada.
    expect(rows.retained.toSorted((x, y) => x.occurredOn.localeCompare(y.occurredOn))).toEqual([
      { id: ids["retenido-viejo"], occurredOn: "2026-09-01", currency: "USD", retention: "5.00", days: 30 },
      { id: ids.hoy, occurredOn: "2026-11-13", currency: "USD", retention: "5.00", days: 30 },
    ]);
  });
});

describe("loadSummary: «Dinero en camino»", () => {
  it("lo por caer en su fase, lo detenido por disputa y lo retenido aparte, y lo depositado en 30 días", async () => {
    const cfg = await loadPayConfig(user.client);
    const view = await loadSummary(user.client, {}, TODAY, cfg);
    const transit = view.transit;

    expect(view.currency).toBe("USD");
    expect(transit?.buckets).toEqual({
      atrasado: { payout: "90.30", count: 1 },
      // Lo que llega al banco: 90,30 − 5,00 retenido.
      hoy: { payout: "85.30", count: 1 },
      semana: { payout: "90.30", count: 1 },
      despues: { payout: "90.30", count: 1 },
    });
    expect(transit?.total).toEqual({ payout: "356.20", count: 4 });
    expect(transit?.held).toEqual({ payout: "90.30", count: 1 });
    // El del 1 sep ya se liberó (1 oct): solo queda el de hoy, que se libera el 13 dic.
    expect(transit?.retained).toEqual({ amount: "5.00", count: 1, from: "2026-12-13", to: "2026-12-13" });
    expect(transit?.deposited).toEqual({
      total: { payout: "90.30", count: 1 },
      accounts: [{ bankAccountId: b.bankAccountId, payout: "90.30", count: 1 }],
    });
    expect(transit?.accounts).toEqual([
      {
        bankAccountId: b.bankAccountId,
        total: { payout: "265.90", count: 3 },
        overdue: { payout: "90.30", count: 1 },
      },
    ]);
    expect(transit?.unassigned).toEqual({
      bankAccountId: null,
      total: { payout: "90.30", count: 1 },
      overdue: { payout: "0.00", count: 0 },
    });

    // Los grupos, con sus cobros uno por uno; lo de más de 14 días, aparte.
    const shape = (group: NonNullable<typeof transit>["soon"][number]) => ({
      date: group.date,
      overdue: group.overdue,
      payout: group.payout,
      part: group.part,
      items: group.items.map((item) => [item.tx.reference, item.label]),
    });
    expect(transit?.soon.map(shape)).toEqual([
      { date: "2026-11-17", overdue: true, payout: "90.30", part: null, items: [["DC-ATR", "Debió llegar hace 3 días"]] },
      { date: TODAY, overdue: false, payout: "85.30", part: null, items: [["DC-HOY", "Puede llegar hoy"]] },
      { date: "2026-11-25", overdue: false, payout: "90.30", part: null, items: [["DC-PROX", "Llega en 3–5 días"]] },
    ]);
    expect(transit?.later.map(shape)).toEqual([
      { date: "2026-12-15", overdue: false, payout: "90.30", part: null, items: [["DC-SC", "Llega en 25 días"]] },
    ]);

    // Las tarjetas con filtro en la lista llevan a exactamente esos cobros (sin los filtros del Resumen).
    expect(transit?.links).toEqual({
      overdue: "/pasarelas/cobros?periodo=personalizado&desde=2026-11-10&hasta=2026-11-10&estado=atrasado&moneda=USD",
      total: "/pasarelas/cobros?periodo=personalizado&desde=2026-11-10&hasta=2026-11-19&estado=por_caer&moneda=USD",
    });
  });

  it("no depende del período ni de los filtros del Resumen", async () => {
    const cfg = await loadPayConfig(user.client);
    const all = await loadSummary(user.client, {}, TODAY, cfg);
    const filtered = await loadSummary(
      user.client,
      { periodo: "mes_anterior", empresa: b.companyId, canal: b.channelId, pasarela: b.gatewayId, estado: "fallido" },
      TODAY,
      cfg,
    );
    expect(filtered.transit).toEqual(all.transit);
  });

  it("sin nada en camino ni depositado: nada que pintar", async () => {
    const empty = await createUser();
    const cfg = await loadPayConfig(empty.client);
    expect((await loadSummary(empty.client, {}, TODAY, cfg)).transit).toBeNull();
  });
});
