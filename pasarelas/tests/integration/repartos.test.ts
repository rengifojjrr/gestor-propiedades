import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { SCHEME_ISSUE_TEXT } from "@/lib/pasarelas";
import { errorMessage } from "@/server/pasarelas/errors";
import { deleteSettlement, saveSettlement, settlementReceiptUrl } from "@/server/pasarelas/ops/settlements";
import {
  deleteBeneficiary,
  deleteScheme,
  saveBeneficiary,
  saveScheme,
  setBeneficiaryActive,
  setSchemeActive,
} from "@/server/pasarelas/ops/splits";
import { listSettlements } from "@/server/pasarelas/queries/settlements";
import { getBeneficiary, listBalances, listBeneficiaryAllocations } from "@/server/pasarelas/queries/splits";
import {
  adminClient,
  createUser,
  e1Item,
  saveTransactions,
  seedBasics,
  unwrap,
  type Basics,
  type TestUser,
} from "./helpers";

/**
 * Repartos con la sesión real de usuarios de prueba: beneficiarios, esquemas con sus versiones y liquidaciones
 * con su comprobante (lo que dejan en la base las `ops`), y lo que leen las consultas del libro y de la ficha.
 * Cada usuario solo toca lo suyo.
 */

const admin = adminClient();
const BUCKET = "comprobantes";
const IN_USE = "Tiene movimientos: desactívalo en su lugar";

/** Lo que lanzó la promesa, para mirar su mensaje para la persona. */
async function failure(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("debió fallar");
}

/** Un PNG mínimo (solo la firma y algo de relleno): para Storage basta con el tipo declarado. */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

async function upload(user: TestUser, folder: string): Promise<string> {
  const path = `${user.id}/${folder}/${randomUUID()}.png`;
  const { error } = await user.client.storage.from(BUCKET).upload(path, PNG, { contentType: "image/png" });
  if (error) throw new Error(`No se pudo subir ${path}: ${error.message}`);
  return path;
}

async function filesIn(folder: string): Promise<string[]> {
  const { data, error } = await admin.storage.from(BUCKET).list(folder, { limit: 1000 });
  if (error) throw new Error(`No se pudo listar ${folder}: ${error.message}`);
  return data.map((file) => file.name);
}

describe("beneficiarios", () => {
  let user: TestUser;
  let other: TestUser;
  let basics: Basics;

  beforeAll(async () => {
    [user, other] = await Promise.all([createUser(), createUser()]);
    basics = await seedBasics(user.client);
  });

  it("saveBeneficiary crea uno y, con su id, lo edita; getBeneficiary lo lee", async () => {
    const id = await saveBeneficiary(user.client, {
      id: null,
      name: "Socio Demo",
      kind: "persona",
      accountAlias: "Cuenta de Socio",
      notes: null,
    });
    expect(await getBeneficiary(user.client, id)).toEqual({
      id,
      name: "Socio Demo",
      kind: "persona",
      accountAlias: "Cuenta de Socio",
      notes: null,
      active: true,
    });

    expect(
      await saveBeneficiary(user.client, {
        id,
        name: "Cartera Demo",
        kind: "cartera",
        accountAlias: null,
        notes: "Ahorro común",
      }),
    ).toBe(id);
    expect(await getBeneficiary(user.client, id)).toMatchObject({
      name: "Cartera Demo",
      kind: "cartera",
      accountAlias: null,
      notes: "Ahorro común",
    });
    // Lo de otro usuario no se ve.
    expect(await getBeneficiary(other.client, id)).toBeNull();
  });

  it("un nombre repetido (sin distinguir mayúsculas) se rechaza con su mensaje", async () => {
    const error = await failure(
      saveBeneficiary(user.client, { id: null, name: " grupo a ", kind: "persona", accountAlias: null, notes: null }),
    );
    expect(errorMessage(error)).toBe("Ya hay un beneficiario con ese nombre.");
  });

  it("no toca los beneficiarios de otro usuario y lo dice", async () => {
    const values = { id: basics.beneficiaryIds.a, name: "Ajeno", kind: "persona" as const, accountAlias: null, notes: null };
    await expect(saveBeneficiary(other.client, values)).rejects.toThrow("Ese beneficiario ya no existe.");
    await expect(setBeneficiaryActive(other.client, basics.beneficiaryIds.a, false)).rejects.toThrow(
      "Ese beneficiario ya no existe.",
    );
    await expect(deleteBeneficiary(other.client, basics.beneficiaryIds.a)).rejects.toThrow(
      "Ese beneficiario ya no existe.",
    );
    const row = unwrap(
      await admin.from("pay_beneficiaries").select("name, active").eq("id", basics.beneficiaryIds.a).single(),
      "beneficiario",
    );
    expect(row).toEqual({ name: "Grupo A", active: true });
  });

  it("setBeneficiaryActive lo desactiva y lo vuelve a activar", async () => {
    const id = await saveBeneficiary(user.client, {
      id: null,
      name: "Temporal",
      kind: "empresa",
      accountAlias: null,
      notes: null,
    });
    await setBeneficiaryActive(user.client, id, false);
    expect((await getBeneficiary(user.client, id))?.active).toBe(false);
    await setBeneficiaryActive(user.client, id, true);
    expect((await getBeneficiary(user.client, id))?.active).toBe(true);
  });

  it("deleteBeneficiary borra uno sin historia; con repartos, liquidaciones o en un esquema dice qué hacer", async () => {
    const free = await saveBeneficiary(user.client, {
      id: null,
      name: "Sin historia",
      kind: "persona",
      accountAlias: null,
      notes: null,
    });
    await deleteBeneficiary(user.client, free);
    expect(await getBeneficiary(user.client, free)).toBeNull();

    // Con repartos (además está en el esquema 50/30/20): no se borra.
    await saveTransactions(user.client, [e1Item(basics, { reference: "pi_repartos_borrar" })]);
    await expect(deleteBeneficiary(user.client, basics.beneficiaryIds.a)).rejects.toThrow(/desactívalo en su lugar/);

    // Solo con una liquidación.
    const paid = await saveBeneficiary(user.client, {
      id: null,
      name: "Con liquidación",
      kind: "persona",
      accountAlias: null,
      notes: null,
    });
    await saveSettlement(user.client, {
      id: randomUUID(),
      beneficiaryId: paid,
      paidOn: "2026-11-10",
      currency: "USD",
      amount: "10.00",
      method: null,
      note: null,
      receipt: null,
    });
    await expect(deleteBeneficiary(user.client, paid)).rejects.toThrow(IN_USE);

    // Solo en un esquema (como «Resto»): tampoco, y el mensaje lo dice.
    const rest = await saveBeneficiary(user.client, {
      id: null,
      name: "Resto Demo",
      kind: "cartera",
      accountAlias: null,
      notes: null,
    });
    await saveScheme(user.client, {
      schemeId: null,
      name: "Con resto",
      base: "neto",
      remainderBeneficiaryId: rest,
      effectiveFrom: "2000-01-01",
      lines: [{ beneficiaryId: basics.beneficiaryIds.b, pct: "60" }],
    });
    await expect(deleteBeneficiary(user.client, rest)).rejects.toThrow(
      "Está en un esquema de reparto: desactívalo en su lugar",
    );
    expect(await getBeneficiary(user.client, rest)).not.toBeNull();
  });
});

describe("esquemas", () => {
  let user: TestUser;
  let other: TestUser;
  let basics: Basics;

  beforeAll(async () => {
    [user, other] = await Promise.all([createUser(), createUser()]);
    basics = await seedBasics(user.client);
  });

  /** Las versiones de un esquema con sus líneas, como las dejó la base. */
  async function versionsOf(schemeId: string) {
    const versions = unwrap(
      await admin
        .from("pay_scheme_versions")
        .select("id, version, base, remainder_beneficiary_id, effective_from")
        .eq("scheme_id", schemeId)
        .order("version"),
      "versiones",
    );
    return Promise.all(
      versions.map(async (version) => ({
        ...version,
        lines: unwrap(
          await admin
            .from("pay_scheme_lines")
            .select("beneficiary_id, pct::text, sort")
            .eq("scheme_version_id", version.id)
            .order("sort"),
          "líneas",
        ),
      })),
    );
  }

  it("saveScheme arma un esquema nuevo 50/30/20 que rige desde el inicio", async () => {
    const { a, b, c } = basics.beneficiaryIds;
    const saved = await saveScheme(user.client, {
      schemeId: null,
      name: "Socios 50/30/20",
      base: "bruto",
      remainderBeneficiaryId: null,
      effectiveFrom: "2000-01-01",
      lines: [
        { beneficiaryId: a, pct: "50" },
        { beneficiaryId: b, pct: "30" },
        { beneficiaryId: c, pct: "20" },
      ],
    });
    expect(saved.version).toBe(1);
    const scheme = unwrap(
      await admin.from("pay_schemes").select("user_id, name, active").eq("id", saved.schemeId).single(),
      "esquema",
    );
    expect(scheme).toEqual({ user_id: user.id, name: "Socios 50/30/20", active: true });
    expect(await versionsOf(saved.schemeId)).toEqual([
      {
        id: saved.versionId,
        version: 1,
        base: "bruto",
        remainder_beneficiary_id: null,
        effective_from: "2000-01-01",
        lines: [
          { beneficiary_id: a, pct: "50.0000", sort: 0 },
          { beneficiary_id: b, pct: "30.0000", sort: 1 },
          { beneficiary_id: c, pct: "20.0000", sort: 2 },
        ],
      },
    ]);
  });

  it("un esquema inválido no se guarda y dice por qué, con el mismo texto que la pantalla", async () => {
    const { a, b } = basics.beneficiaryIds;
    const attempt = (remainderBeneficiaryId: string | null, lines: { beneficiaryId: string; pct: string }[]) =>
      saveScheme(user.client, {
        schemeId: null,
        name: "Inválido",
        base: "neto",
        remainderBeneficiaryId,
        effectiveFrom: "2000-01-01",
        lines,
      });

    await expect(
      attempt(null, [
        { beneficiaryId: a, pct: "50" },
        { beneficiaryId: b, pct: "30" },
      ]),
    ).rejects.toThrow(SCHEME_ISSUE_TEXT.suma_menor_sin_resto);
    await expect(
      attempt(null, [
        { beneficiaryId: a, pct: "70" },
        { beneficiaryId: b, pct: "40" },
      ]),
    ).rejects.toThrow(SCHEME_ISSUE_TEXT.suma_mayor_100);
    await expect(attempt(a, [{ beneficiaryId: a, pct: "50" }])).rejects.toThrow(SCHEME_ISSUE_TEXT.resto_en_lineas);
    await expect(attempt(null, [])).rejects.toThrow(SCHEME_ISSUE_TEXT.sin_lineas);

    const { count } = await admin
      .from("pay_schemes")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("name", "Inválido");
    expect(count).toBe(0);
  });

  it("50/30 con «Resto» sí se guarda", async () => {
    const { a, b, c } = basics.beneficiaryIds;
    const saved = await saveScheme(user.client, {
      schemeId: null,
      name: "Con resto para C",
      base: "neto",
      remainderBeneficiaryId: c,
      effectiveFrom: "2000-01-01",
      lines: [
        { beneficiaryId: a, pct: "50" },
        { beneficiaryId: b, pct: "30" },
      ],
    });
    const [version] = await versionsOf(saved.schemeId);
    expect(version?.remainder_beneficiary_id).toBe(c);
    expect(version?.lines.map((line) => line.pct)).toEqual(["50.0000", "30.0000"]);
  });

  it("una versión nueva de un esquema que ya existe se agrega y la anterior queda", async () => {
    const { a, b } = basics.beneficiaryIds;
    const saved = await saveScheme(user.client, {
      schemeId: basics.schemeId,
      name: "Reparto 50/30/20",
      base: "neto",
      remainderBeneficiaryId: null,
      effectiveFrom: "2026-12-01",
      lines: [
        { beneficiaryId: a, pct: "60" },
        { beneficiaryId: b, pct: "40" },
      ],
    });
    expect(saved).toMatchObject({ schemeId: basics.schemeId, version: 2 });
    const versions = await versionsOf(basics.schemeId);
    expect(versions.map((version) => [version.version, version.effective_from, version.lines.length])).toEqual([
      [1, "2000-01-01", 3],
      [2, "2026-12-01", 2],
    ]);
  });

  it("la misma «vigente desde» que una versión con cobros no se pisa", async () => {
    const { a, b } = basics.beneficiaryIds;
    await saveTransactions(user.client, [e1Item(basics, { reference: "pi_repartos_version" })]);
    const error = await failure(
      saveScheme(user.client, {
        schemeId: basics.schemeId,
        name: "Reparto 50/30/20",
        base: "neto",
        remainderBeneficiaryId: null,
        effectiveFrom: "2000-01-01",
        lines: [
          { beneficiaryId: a, pct: "50" },
          { beneficiaryId: b, pct: "50" },
        ],
      }),
    );
    expect(errorMessage(error)).toBe(
      "Ya hay cobros con la versión del esquema vigente desde esa fecha: elige otra fecha.",
    );
  });

  it("un nombre repetido se rechaza con su mensaje", async () => {
    const error = await failure(
      saveScheme(user.client, {
        schemeId: null,
        name: "reparto 50/30/20",
        base: "neto",
        remainderBeneficiaryId: null,
        effectiveFrom: "2000-01-01",
        lines: [{ beneficiaryId: basics.beneficiaryIds.a, pct: "100" }],
      }),
    );
    expect(errorMessage(error)).toBe("Ya hay un esquema de reparto con ese nombre.");
  });

  it("no toca los esquemas de otro usuario", async () => {
    const otherBasics = await seedBasics(other.client);
    const error = await failure(
      saveScheme(other.client, {
        schemeId: basics.schemeId,
        name: "Ajeno",
        base: "neto",
        remainderBeneficiaryId: null,
        effectiveFrom: "2027-01-01",
        lines: [{ beneficiaryId: otherBasics.beneficiaryIds.a, pct: "100" }],
      }),
    );
    expect(errorMessage(error)).toBe("Ese esquema de reparto ya no existe.");
    await expect(setSchemeActive(other.client, basics.schemeId, false)).rejects.toThrow(
      "Ese esquema de reparto ya no existe.",
    );
    await expect(deleteScheme(other.client, basics.schemeId)).rejects.toThrow("Ese esquema de reparto ya no existe.");
  });

  it("setSchemeActive lo desactiva y lo activa; deleteScheme borra uno sin cobros y no uno con cobros", async () => {
    await setSchemeActive(user.client, basics.schemeId, false);
    const active = async () =>
      unwrap(await admin.from("pay_schemes").select("active").eq("id", basics.schemeId).single(), "esquema").active;
    expect(await active()).toBe(false);
    await setSchemeActive(user.client, basics.schemeId, true);
    expect(await active()).toBe(true);

    // Tiene cobros (de la prueba anterior).
    await expect(deleteScheme(user.client, basics.schemeId)).rejects.toThrow(IN_USE);

    const unused = await saveScheme(user.client, {
      schemeId: null,
      name: "Sin cobros",
      base: "neto",
      remainderBeneficiaryId: null,
      effectiveFrom: "2000-01-01",
      lines: [{ beneficiaryId: basics.beneficiaryIds.a, pct: "100" }],
    });
    await deleteScheme(user.client, unused.schemeId);
    const { count } = await admin
      .from("pay_scheme_versions")
      .select("id", { count: "exact", head: true })
      .eq("scheme_id", unused.schemeId);
    expect(count).toBe(0);
  });
});

describe("liquidaciones y saldos", () => {
  let user: TestUser;
  let other: TestUser;
  let basics: Basics;

  beforeAll(async () => {
    [user, other] = await Promise.all([createUser(), createUser()]);
    basics = await seedBasics(user.client);
  });

  it("E4: con lo de E1 liquidado y el cobro reembolsado del todo, los saldos quedan a favor de la empresa", async () => {
    const { a, b, c } = basics.beneficiaryIds;
    // El cobro E1 ya reembolsado del todo: bruto 0, costo del reembolso 3,20, neto −3,20 y su reparto.
    const e4 = e1Item(basics, {
      reference: "pi_repartos_e4",
      refunded_amount: "100.00",
      gross_amount: "0.00",
      fees_total: "3.20",
      net_amount: "-3.20",
      alloc_base_amount: "-3.20",
    });
    e4.allocations = [
      { beneficiary_id: a, amount: "-1.60", base: "neto", pct: "50", is_remainder: false },
      { beneficiary_id: b, amount: "-0.96", base: "neto", pct: "30", is_remainder: false },
      { beneficiary_id: c, amount: "-0.64", base: "neto", pct: "20", is_remainder: false },
    ];
    await saveTransactions(user.client, [e4]);
    for (const [beneficiaryId, amount] of [
      [a, "45.15"],
      [b, "27.09"],
      [c, "18.06"],
    ] as const) {
      await saveSettlement(user.client, {
        id: randomUUID(),
        beneficiaryId,
        paidOn: "2026-11-14",
        currency: "USD",
        amount,
        method: "Transferencia",
        note: null,
        receipt: null,
      });
    }

    const balances = await listBalances(user.client);
    const of = (id: string) => balances.find((row) => row.beneficiaryId === id);
    expect(of(a)).toEqual({ beneficiaryId: a, currency: "USD", assigned: "-1.60", settled: "45.15", balance: "-46.75" });
    expect(of(b)?.balance).toBe("-28.05");
    expect(of(c)?.balance).toBe("-18.70");
    // Otro usuario no ve nada de esto.
    expect(await listBalances(other.client)).toEqual([]);
  });

  it("una devolución es una liquidación negativa y nunca se mezcla con otra moneda", async () => {
    const { a } = basics.beneficiaryIds;
    await saveSettlement(user.client, {
      id: randomUUID(),
      beneficiaryId: a,
      paidOn: "2026-11-15",
      currency: "USD",
      amount: "-46.75",
      method: null,
      note: "Devolvió lo de E4",
      receipt: null,
    });
    await saveSettlement(user.client, {
      id: randomUUID(),
      beneficiaryId: a,
      paidOn: "2026-11-15",
      currency: "EUR",
      amount: "12.00",
      method: null,
      note: null,
      receipt: null,
    });
    expect(await listBalances(user.client, a)).toEqual([
      { beneficiaryId: a, currency: "EUR", assigned: "0.00", settled: "12.00", balance: "-12.00" },
      { beneficiaryId: a, currency: "USD", assigned: "-1.60", settled: "-1.60", balance: "0.00" },
    ]);
  });

  it("saveSettlement guarda el comprobante de su carpeta; deleteSettlement borra primero el archivo", async () => {
    const id = randomUUID();
    const path = await upload(user, id);
    await saveSettlement(user.client, {
      id,
      beneficiaryId: basics.beneficiaryIds.b,
      paidOn: "2026-11-16",
      currency: "USD",
      amount: "5.00",
      method: "Efectivo",
      note: "Adelanto",
      receipt: { path, mime: "image/png", sizeBytes: PNG.length },
    });
    const row = unwrap(
      await admin
        .from("pay_settlements")
        .select("user_id, amount::text, method, note, receipt_path, receipt_mime, receipt_size")
        .eq("id", id)
        .single(),
      "liquidación",
    );
    expect(row).toEqual({
      user_id: user.id,
      amount: "5.00",
      method: "Efectivo",
      note: "Adelanto",
      receipt_path: path,
      receipt_mime: "image/png",
      receipt_size: PNG.length,
    });
    expect(await settlementReceiptUrl(user.client, id)).toContain("/storage/v1/object/sign/");

    // Otro usuario no la borra ni ve su comprobante.
    await expect(deleteSettlement(other.client, id)).rejects.toThrow("Esa liquidación ya no existe.");
    await expect(settlementReceiptUrl(other.client, id)).rejects.toThrow("Esa liquidación ya no existe.");
    expect(await filesIn(`${user.id}/${id}`)).toHaveLength(1);

    await deleteSettlement(user.client, id);
    expect(await filesIn(`${user.id}/${id}`)).toEqual([]);
    const { count } = await admin.from("pay_settlements").select("id", { count: "exact", head: true }).eq("id", id);
    expect(count).toBe(0);
  });

  it("un comprobante de otra carpeta no se acepta", async () => {
    const id = randomUUID();
    const path = await upload(user, randomUUID());
    await expect(
      saveSettlement(user.client, {
        id,
        beneficiaryId: basics.beneficiaryIds.b,
        paidOn: "2026-11-16",
        currency: "USD",
        amount: "5.00",
        method: null,
        note: null,
        receipt: { path, mime: "image/png", sizeBytes: PNG.length },
      }),
    ).rejects.toThrow("El comprobante no corresponde a esta liquidación.");
  });

  it("una liquidación para un beneficiario ajeno (o que no existe) no se guarda", async () => {
    await expect(
      saveSettlement(other.client, {
        id: randomUUID(),
        beneficiaryId: basics.beneficiaryIds.c,
        paidOn: "2026-11-16",
        currency: "USD",
        amount: "5.00",
        method: null,
        note: null,
        receipt: null,
      }),
    ).rejects.toThrow("Ese beneficiario ya no existe.");
  });

  it("los movimientos de la ficha: cada reparto con su cobro y cada liquidación, por páginas", async () => {
    const { c } = basics.beneficiaryIds;
    const [, trashed] = await saveTransactions(user.client, [
      e1Item(basics, { reference: "pi_repartos_mov_1", occurred_on: "2026-11-20", occurred_at: "2026-11-20T15:00:00+00:00" }),
      e1Item(basics, { reference: "pi_repartos_mov_2" }),
    ]);
    // En la papelera: no cuenta, igual que en el saldo.
    await user.client
      .from("pay_transactions")
      .update({ deleted_at: "2026-11-21T10:00:00+00:00" })
      .eq("id", trashed?.id ?? "")
      .throwOnError();
    const first = await listBeneficiaryAllocations(user.client, c, 1);
    expect(first.total).toBe(2);
    expect(first.rows[0]).toMatchObject({
      occurredOn: "2026-11-20",
      companyId: basics.companyId,
      currency: "USD",
      txGross: "100.00",
      amount: "18.06",
      pct: "20",
      isRemainder: false,
    });
    expect(first.rows[1]).toMatchObject({ occurredOn: "2026-11-13", txGross: "0.00", amount: "-0.64" });

    const settlements = await listSettlements(user.client, c, 1);
    expect(settlements.total).toBe(1);
    expect(settlements.rows[0]).toMatchObject({ beneficiaryId: c, amount: "18.06", method: "Transferencia" });
    expect(await listSettlements(other.client, c, 1)).toEqual({ rows: [], total: 0 });

    // Una página más allá de la última viene vacía, con el total.
    expect(await listBeneficiaryAllocations(user.client, c, 9)).toEqual({ rows: [], total: 2 });
  });
});
