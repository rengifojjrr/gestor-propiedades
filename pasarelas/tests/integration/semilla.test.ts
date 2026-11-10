import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import {
  addDays,
  displayStatus,
  isOverdue,
  isPartialRefund,
  isPending,
  isZero,
  nyDate,
  totalsOf,
  upcomingDeposits,
  type LeanTx,
} from "@/lib/pasarelas";
import { registerReceipt } from "@/server/pasarelas/ops/receipts";
import { loadPayConfig } from "@/server/pasarelas/queries/config";
import { leanTx } from "@/server/pasarelas/queries/transactions";
import { seedDemo, wipeUserData, type SeedSummary } from "../../scripts/demo-data";
import { adminClient, createUser, unwrap, type Db, type TestUser } from "./helpers";

/**
 * La semilla demo contra la base: lo que siembra pasa por el mismo motor y las mismas funciones que la app, es
 * determinista (dos usuarios sembrados el mismo día quedan con las mismas cuentas) y se puede borrar entera.
 */

/** Martes 10 de noviembre de 2026: los tres meses anteriores traen feriados y un cambio de horario. */
const TODAY = "2026-11-10";
/** Lunes 30 de noviembre de 2026: «ayer» es domingo y el jueves anterior fue Acción de Gracias. */
const AFTER_THANKSGIVING = "2026-11-30";
const BUCKET = "comprobantes";
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
const PAY_TABLES = [
  "pay_bank_accounts",
  "pay_beneficiaries",
  "pay_schemes",
  "pay_scheme_versions",
  "pay_scheme_lines",
  "pay_companies",
  "pay_channels",
  "pay_gateways",
  "pay_gateway_fee_versions",
  "pay_gateway_extras",
  "pay_company_gateways",
  "pay_transactions",
  "pay_allocations",
  "pay_transaction_receipts",
  "pay_transaction_events",
  "pay_settlements",
  "pay_holidays",
] as const;

const admin = adminClient();

let a: TestUser;
let b: TestUser;
let summaryA: SeedSummary;
let summaryB: SeedSummary;

type Balance = { assigned: string; settled: string; balance: string };

/** Asignado, liquidado y saldo de cada beneficiario, por su nombre y moneda («Grupo A · USD»). */
async function balancesByName(client: Db): Promise<Record<string, Balance>> {
  const [balances, beneficiaries] = await Promise.all([
    client
      .from("pay_beneficiary_balances")
      .select("beneficiary_id, currency, assigned::text, settled::text, balance::text"),
    client.from("pay_beneficiaries").select("id, name"),
  ]);
  const names = new Map(unwrap(beneficiaries, "beneficiarios").map((row) => [row.id, row.name]));
  const entries = unwrap(balances, "saldos").map((row) => [
    `${names.get(row.beneficiary_id ?? "")} · ${row.currency}`,
    { assigned: row.assigned, settled: row.settled, balance: row.balance },
  ]);
  return Object.fromEntries(entries.sort(([left], [right]) => String(left).localeCompare(String(right))));
}

/** Cuántas filas tiene ese usuario en cada tabla `pay_*` (contadas con la clave secreta: sin RLS de por medio). */
async function rowCounts(userId: string): Promise<Record<string, number>> {
  const counts = await Promise.all(
    PAY_TABLES.map(async (table) => {
      const { count, error } = await admin
        .from(table)
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId);
      if (error) throw new Error(`${table}: ${error.message}`);
      return [table, count ?? 0] as const;
    }),
  );
  return Object.fromEntries(counts);
}

/** Cuántos elementos de la lista cumplen la condición. */
const count = <T>(items: readonly T[], test: (item: T) => boolean): number => items.filter(test).length;

/** Lo que tiene que haber en un libro sembrado el día `today`, leído de la base; `summary` es lo que dijo la semilla. */
function expectEveryCase(rows: readonly LeanTx[], today: string, summary: SeedSummary): void {
  expect(rows.length).toBeGreaterThanOrEqual(55);
  expect(rows.length).toBeLessThanOrEqual(65);
  expect(summary.transactions).toBe(rows.length);
  for (const row of rows) {
    expect(row.occurredOn >= addDays(today, -90) && row.occurredOn < today, `fecha ${row.occurredOn}`).toBe(true);
  }

  // La mayoría ya cayó, y justo el día en que se estimaba.
  const deposited = rows.filter((row) => row.status === "depositado");
  expect(deposited.length).toBeGreaterThan(rows.length / 2);
  for (const row of deposited) expect(row.depositedOn).toBe(row.estimatedDepositOn);

  expect(count(rows, (row) => row.status === "en_transito")).toBeGreaterThanOrEqual(1);
  const overdue = count(rows, (row) => isOverdue(row, today));
  expect(overdue === 1 || overdue === 2, `${overdue} atrasados`).toBe(true);
  expect(count(rows, isPartialRefund)).toBe(1);
  expect(count(rows, (row) => displayStatus(row) === "reembolsado")).toBe(1);
  expect(count(rows, (row) => row.disputeState === "abierta")).toBe(1);
  expect(count(rows, (row) => row.status === "fallido")).toBe(1);

  // Lo que está por caer (sin lo atrasado) llega a dos cuentas distintas como poco.
  const upcoming = upcomingDeposits(rows, today).filter((group) => !group.overdue);
  expect(new Set(upcoming.map((group) => group.bankAccountId)).size).toBeGreaterThanOrEqual(2);

  // Casi todo en dólares; dos o tres cobros en otra moneda.
  const foreign = count(rows, (row) => row.currency !== "USD");
  expect(foreign === 2 || foreign === 3, `${foreign} cobros en otra moneda`).toBe(true);

  expect(summary).toMatchObject({
    deposited: deposited.length,
    pending: count(rows, isPending),
    inTransit: count(rows, (row) => row.status === "en_transito"),
    overdue,
    partialRefunds: 1,
    fullRefunds: 1,
    disputes: 1,
    failed: 1,
  });
}

beforeAll(async () => {
  [a, b] = await Promise.all([createUser(), createUser()]);
  [summaryA, summaryB] = await Promise.all([
    seedDemo(a.client, { today: TODAY }),
    seedDemo(b.client, { today: TODAY }),
  ]);
});

describe("seedDemo", () => {
  it("deja 3 empresas, 3 pasarelas con sus tarifas y opciones, 3 cuentas, 4 beneficiarios y 2 esquemas", async () => {
    const cfg = await loadPayConfig(a.client);

    expect(cfg.companies.map((company) => company.name)).toEqual(["Escuela Demo", "Estudio Demo", "Tienda Demo"]);
    for (const company of cfg.companies) {
      expect(company.defaultSchemeId, `${company.name} tiene esquema por defecto`).not.toBeNull();
      expect(count(cfg.channels, (channel) => channel.companyId === company.id)).toBeGreaterThan(0);
      expect(count(cfg.companyGateways, (link) => link.companyId === company.id)).toBeGreaterThan(0);
    }

    expect(cfg.gateways.map((gateway) => gateway.name)).toEqual(["PayPal", "Stripe", "Zelle"]);
    const [paypal, stripe, zelle] = cfg.gateways;
    expect(stripe).toMatchObject({
      payoutDays: 2,
      payoutDayType: "habiles",
      refundsReturnFee: false,
      disputeFee: "15.00",
    });
    expect(stripe?.feeVersions).toMatchObject([{ pct: "2.9", fixed: "0.30", effectiveFrom: "2000-01-01" }]);
    expect(stripe?.extras).toMatchObject([{ name: "Pago rápido", pct: "1.5", base: "bruto", payoutDaysOverride: 0 }]);
    expect(paypal).toMatchObject({ payoutDays: 1, payoutDayType: "habiles" });
    expect(paypal?.feeVersions).toMatchObject([{ pct: "3.49", fixed: "0.49", effectiveFrom: "2000-01-01" }]);
    expect(paypal?.extras).toMatchObject([{ name: "Transferencia inmediata", pct: "1.75" }]);
    expect(zelle).toMatchObject({ payoutDays: 0 });
    expect(zelle?.feeVersions).toMatchObject([{ pct: "0", fixed: "0.00", effectiveFrom: "2000-01-01" }]);

    expect(cfg.bankAccounts).toHaveLength(3);
    for (const account of cfg.bankAccounts) expect(account.last4).toMatch(/^\d{4}$/);
    expect(cfg.beneficiaries.map((beneficiary) => beneficiary.name)).toEqual([
      "Fondo de reserva",
      "Grupo A",
      "Grupo B",
      "Grupo C",
    ]);

    expect(cfg.schemes).toHaveLength(2);
    const versions = cfg.schemes.flatMap((scheme) => scheme.versions);
    expect(versions.map((version) => version.effectiveFrom)).toEqual(["2000-01-01", "2000-01-01"]);
    const fixed = versions.find((version) => version.remainderBeneficiaryId === null);
    expect(fixed?.base).toBe("neto");
    expect(fixed?.lines.map((line) => line.pct)).toEqual(["50", "30", "20"]);
    expect(count(versions, (version) => version.remainderBeneficiaryId !== null)).toBe(1);

    expect(cfg.holidays).toContain("2026-11-26");
    expect(summaryA).toMatchObject({ companies: 3, gateways: 3, bankAccounts: 3, beneficiaries: 4, schemes: 2 });
  });

  it("registra unos 60 cobros en los 3 meses anteriores a hoy, con al menos uno de cada caso", async () => {
    expectEveryCase(await leanTx(a.client, {}, TODAY), TODAY, summaryA);
  });

  it("también un lunes después de un feriado largo: los casos no dependen del día en que se siembra", async () => {
    const user = await createUser();

    const summary = await seedDemo(user.client, { today: AFTER_THANKSGIVING });

    expectEveryCase(await leanTx(user.client, {}, AFTER_THANKSGIVING), AFTER_THANKSGIVING, summary);
  });

  it("calcula con el motor de la app: el reembolso parcial es el caso E5 del spec", async () => {
    const rows = await leanTx(a.client, {}, TODAY);

    expect(rows.find(isPartialRefund)).toMatchObject({
      grossOriginal: "100.00",
      refunded: "40.00",
      gross: "60.00",
      fees: "7.10",
      net: "52.90",
    });
  });

  it("guarda cada cobro con su fecha de Nueva York y una referencia inventada, sin repetir", async () => {
    const rows = unwrap(
      await admin.from("pay_transactions").select("occurred_at, occurred_on, reference").eq("user_id", a.id),
      "cobros",
    );

    for (const row of rows) {
      expect(nyDate(new Date(row.occurred_at))).toBe(row.occurred_on);
      expect(row.reference).toMatch(/^[a-z]{2}_demo_\d{4}$/);
    }
    expect(new Set(rows.map((row) => row.reference)).size).toBe(rows.length);
  });

  it("registra liquidaciones con su moneda, que dejan saldos distintos de cero", async () => {
    const settlements = unwrap(
      await a.client.from("pay_settlements").select("currency, amount::text, paid_on"),
      "liquidaciones",
    );
    const balances = await balancesByName(a.client);

    expect(settlements.length).toBe(summaryA.settlements);
    expect(settlements.length).toBeGreaterThan(0);
    for (const settlement of settlements) expect(settlement.paid_on < TODAY).toBe(true);
    expect(new Set(settlements.map((settlement) => settlement.currency))).toEqual(new Set(["USD", "MXN"]));
    for (const name of ["Grupo A · USD", "Grupo B · USD", "Grupo C · USD", "Fondo de reserva · USD"]) {
      expect(isZero(balances[name]?.settled ?? "0.00"), `${name} tiene algo liquidado`).toBe(false);
    }
    for (const [name, row] of Object.entries(balances)) {
      expect(isZero(row.balance ?? "0.00"), `el saldo de ${name} no es cero`).toBe(false);
    }
  });

  it("es determinista: dos usuarios sembrados el mismo día quedan con los mismos totales y saldos", async () => {
    const [rowsA, rowsB] = await Promise.all([leanTx(a.client, {}, TODAY), leanTx(b.client, {}, TODAY)]);
    const totals = totalsOf(rowsA);

    expect(Object.keys(totals).sort()).toEqual(["MXN", "USD"]);
    expect(totalsOf(rowsB)).toEqual(totals);
    expect(await balancesByName(b.client)).toEqual(await balancesByName(a.client));
    expect(summaryB).toEqual(summaryA);
  });

  it("se niega a sembrar sobre un usuario que ya tiene datos, y no le toca nada", async () => {
    const before = await rowCounts(a.id);

    await expect(seedDemo(a.client, { today: TODAY })).rejects.toThrow(/ya tiene datos.*--reset/s);

    expect(await rowCounts(a.id)).toEqual(before);
  });
});

describe("wipeUserData", () => {
  it("borra los archivos del usuario y todas sus filas pay_*, y nada de otro usuario", async () => {
    const [tx] = await leanTx(b.client, {}, TODAY);
    if (!tx) throw new Error("la semilla no dejó cobros");
    // Un comprobante registrado en un cobro y un archivo suelto en otra carpeta (el de una liquidación).
    const receipt = `${b.id}/${tx.id}/recibo.png`;
    const loose = `${b.id}/${randomUUID()}/pago.png`;
    for (const path of [receipt, loose]) {
      const uploaded = await b.client.storage.from(BUCKET).upload(path, PNG, { contentType: "image/png" });
      if (uploaded.error) throw new Error(`no se pudo subir ${path}: ${uploaded.error.message}`);
    }
    await registerReceipt(b.client, b.id, {
      transactionId: tx.id,
      path: receipt,
      mime: "image/png",
      sizeBytes: PNG.length,
      originalName: "recibo.png",
    });
    const othersBefore = await rowCounts(a.id);

    await wipeUserData(b.client, b.id);

    const after = await rowCounts(b.id);
    expect(after).toEqual(Object.fromEntries(PAY_TABLES.map((table) => [table, 0])));
    for (const path of [receipt, loose]) {
      const folder = path.slice(0, path.lastIndexOf("/"));
      const listed = await admin.storage.from(BUCKET).list(folder);
      expect(listed.error).toBeNull();
      expect(listed.data).toEqual([]);
    }
    expect(await rowCounts(a.id)).toEqual(othersBefore);
  });

  it("sin el id de un usuario no borra nada: la carpeta sería el bucket entero", async () => {
    const before = await rowCounts(a.id);

    await expect(wipeUserData(a.client, "")).rejects.toThrow(/no es el id de un usuario/);

    expect(await rowCounts(a.id)).toEqual(before);
  });

  it("deja al usuario listo para sembrar de nuevo, y vuelve a dar lo mismo", async () => {
    const again = await seedDemo(b.client, { today: TODAY });

    expect(again).toEqual(summaryA);
    const [rowsA, rowsB] = await Promise.all([leanTx(a.client, {}, TODAY), leanTx(b.client, {}, TODAY)]);
    expect(totalsOf(rowsB)).toEqual(totalsOf(rowsA));
    expect(await balancesByName(b.client)).toEqual(await balancesByName(a.client));
  });
});
