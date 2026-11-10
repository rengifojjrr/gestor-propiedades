import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import {
  addDays,
  localInputToInstant,
  nyDate,
  presetFor,
  todayNY,
  type ColumnMapping,
  type ImportRow,
} from "@/lib/pasarelas";
import { UserError } from "@/server/pasarelas/errors";
import { importTransactions, previewImport, saveImportMapping } from "@/server/pasarelas/ops/import";
import { createTx, trashTx } from "@/server/pasarelas/ops/transactions";
import { getImportMappings } from "@/server/pasarelas/queries/import";
import { createUser, seedBasics, type Basics, type Db, type TestUser } from "./helpers";

/**
 * La importación de un archivo (`ops/import.ts`), con la sesión real de usuarios del stack local: cada fila se
 * vuelve a validar en el servidor, cada cobro se calcula con el motor y se guarda sin repetir referencias, y una
 * fila mala no deja el lote a medias. Cada prueba usa referencias propias: no depende del orden.
 */

let user: TestUser;
let other: TestUser;
let b: Basics;

beforeAll(async () => {
  [user, other] = await Promise.all([createUser(), createUser()]);
  b = await seedBasics(user.client);
});

/** Una fila ya convertida, como la manda el navegador: 100,00 USD el 13/11/2026 a las 10:30 de Nueva York. */
function row(reference: string, extra: Partial<ImportRow> = {}): ImportRow {
  return {
    line: 2,
    reference,
    occurredAt: "2026-11-13T15:30:00.000Z",
    occurredOn: "2026-11-13",
    grossOriginal: "100.00",
    currency: "USD",
    reportedFee: "3.50",
    note: null,
    ...extra,
  };
}

/** Referencias únicas para una prueba: `ref(1)`, `ref(2)`… */
function refs(): (n: number) => string {
  const prefix = `txn_${randomUUID().slice(0, 8)}`;
  return (n) => `${prefix}_${n}`;
}

/** Lo elegido en la pantalla para todos los cobros del archivo: Escuela Demo, Stripe, sin canal ni opciones. */
const choice = (rows: unknown[], useReportedFee = false, alreadyDeposited = false) => ({
  companyId: b.companyId,
  gatewayId: b.gatewayId,
  channelId: null,
  extraIds: [],
  useReportedFee,
  alreadyDeposited,
  rows,
});

/** Los cobros guardados con esas referencias, por referencia. */
async function saved(client: Db, references: string[]) {
  const { data } = await client
    .from("pay_transactions")
    .select(
      "id, reference, occurred_at, occurred_on, currency, gross_original::text, fees_total::text, net_amount::text, scheme_id, status, estimated_deposit_on, deposited_on, bank_account_id, note, breakdown",
    )
    .in("reference", references)
    .throwOnError();
  return new Map(data.map((tx) => [tx.reference, tx]));
}

/** Lo que pasa al esperar que la operación falle con un `UserError`: su mensaje. */
async function userErrorOf(promise: Promise<unknown>): Promise<string> {
  const error: unknown = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(UserError);
  return (error as UserError).message;
}

describe("importTransactions", () => {
  it("crea cada cobro calculado con el motor, con el esquema de la empresa y el evento «importado»", async () => {
    const ref = refs();
    const result = await importTransactions(
      user.client,
      choice([row(ref(1), { note: "Pedido demo" }), row(ref(2), { line: 3, grossOriginal: "33.33", reportedFee: null })]),
    );
    expect(result).toEqual({ created: 2, duplicates: 0, trashed: 0 });

    const txs = await saved(user.client, [ref(1), ref(2)]);
    const first = txs.get(ref(1));
    expect(first).toMatchObject({
      occurred_on: "2026-11-13",
      currency: "USD",
      gross_original: "100.00",
      // La comisión calculada (2,9 % + 0,30), no la del archivo: no se pidió usarla.
      fees_total: "3.20",
      net_amount: "96.80",
      scheme_id: b.schemeId,
      status: "registrado",
      estimated_deposit_on: "2026-11-17",
      bank_account_id: b.bankAccountId,
      note: "Pedido demo",
    });
    expect(Date.parse(first!.occurred_at)).toBe(Date.parse("2026-11-13T15:30:00.000Z"));
    expect(txs.get(ref(2))).toMatchObject({ gross_original: "33.33", fees_total: "1.27", net_amount: "32.06" });

    const { data: events } = await user.client
      .from("pay_transaction_events")
      .select("kind")
      .eq("transaction_id", first!.id)
      .throwOnError();
    expect(events).toEqual([{ kind: "importado" }]);
    const { data: allocations } = await user.client
      .from("pay_allocations")
      .select("amount::text")
      .eq("transaction_id", first!.id)
      .order("amount", { ascending: false })
      .throwOnError();
    expect(allocations.map((line) => line.amount)).toEqual(["48.40", "29.04", "19.36"]);
  });

  it("con «usar la comisión del archivo» congela la comisión informada; sin ella en la fila, la calcula", async () => {
    const ref = refs();
    const result = await importTransactions(
      user.client,
      choice([row(ref(1)), row(ref(2), { line: 3, reportedFee: null })], true),
    );
    expect(result).toEqual({ created: 2, duplicates: 0, trashed: 0 });

    const txs = await saved(user.client, [ref(1), ref(2)]);
    expect(txs.get(ref(1))).toMatchObject({ fees_total: "3.50", net_amount: "96.50" });
    expect(txs.get(ref(1))!.breakdown).toMatchObject({
      rules: { gateway: { feeOverride: "3.50" } },
      lines: [{ kind: "pasarela", baseKind: "informado", amount: "3.50" }],
    });
    expect(txs.get(ref(2))).toMatchObject({ fees_total: "3.20", net_amount: "96.80" });
    expect(txs.get(ref(2))!.breakdown).not.toHaveProperty("rules.gateway.feeOverride");
  });

  it("importar dos veces el mismo archivo no duplica nada: lo repetido se cuenta y no se toca", async () => {
    const ref = refs();
    const rows = [row(ref(1)), row(ref(2), { line: 3, grossOriginal: "50.00" })];
    expect(await importTransactions(user.client, choice(rows))).toEqual({ created: 2, duplicates: 0, trashed: 0 });
    const before = await saved(user.client, [ref(1), ref(2)]);

    // Otra vez, ahora con la comisión del archivo: lo que ya estaba no cambia.
    expect(await importTransactions(user.client, choice(rows, true))).toEqual({ created: 0, duplicates: 2, trashed: 0 });
    // Un archivo que trae uno viejo y uno nuevo.
    expect(await importTransactions(user.client, choice([rows[0]!, row(ref(3), { line: 4 })]))).toEqual({
      created: 1,
      duplicates: 1,
      trashed: 0,
    });

    const after = await saved(user.client, [ref(1), ref(2), ref(3)]);
    expect(after.size).toBe(3);
    expect(after.get(ref(1))).toEqual(before.get(ref(1)));
    expect(after.get(ref(2))).toEqual(before.get(ref(2)));
  });

  it("la misma referencia dos veces en un lote crea un solo cobro", async () => {
    const ref = refs();
    const result = await importTransactions(user.client, choice([row(ref(1)), row(ref(1), { line: 3 })]));
    expect(result).toEqual({ created: 1, duplicates: 1, trashed: 0 });
    expect((await saved(user.client, [ref(1)])).size).toBe(1);
  });

  const invalid: [string, Record<string, unknown>][] = [
    ["sin referencia", { reference: "  " }],
    ["con una referencia de más de 120 caracteres", { reference: "x".repeat(121) }],
    ["con una referencia que parece un número de tarjeta", { reference: "4111111111111111" }],
    ["con un instante sin zona", { occurredAt: "2026-11-13T15:30:00" }],
    ["con una fecha que no es la de Nueva York", { occurredOn: "2026-11-14" }],
    ["con un monto que no es canónico", { grossOriginal: "100.5" }],
    ["con un monto en cero", { grossOriginal: "0.00" }],
    ["con un monto negativo", { grossOriginal: "-10.00" }],
    ["con una moneda en minúsculas", { currency: "usd" }],
    ["con una comisión negativa", { reportedFee: "-3.50" }],
    ["con una nota con un número de tarjeta", { note: "4111 1111 1111 1111" }],
    ["sin número de línea", { line: 0 }],
  ];

  it.each(invalid)("una fila %s no deja el lote a medias y se dice cuál es", async (_what, bad) => {
    const ref = refs();
    const rows = [row(ref(1)), { ...row(ref(2)), line: 7, ...bad }, row(ref(3), { line: 9 })];
    const message = await userErrorOf(importTransactions(user.client, choice(rows, true)));
    expect(message).toMatch(bad.line === 0 ? /^La fila 2 del lote/ : /^La línea 7 /);
    expect(message).toContain("No se guardó nada de este lote.");
    expect((await saved(user.client, [ref(1), ref(2), ref(3)])).size).toBe(0);
  });

  it("una fila que no es un objeto tampoco pasa", async () => {
    const ref = refs();
    const message = await userErrorOf(importTransactions(user.client, choice([row(ref(1)), "txn_suelta"])));
    expect(message).toMatch(/^La fila 2 del lote/);
    expect((await saved(user.client, [ref(1)])).size).toBe(0);
  });

  it("un lote vacío o de más de 500 filas no se acepta", async () => {
    const ref = refs();
    expect(await userErrorOf(importTransactions(user.client, choice([])))).toBe("El archivo no trae cobros para importar.");
    const many = Array.from({ length: 501 }, (_, i) => row(ref(i), { line: i + 2 }));
    expect(await userErrorOf(importTransactions(user.client, choice(many)))).toBe(
      "Se importan como máximo 500 filas por envío.",
    );
    expect((await saved(user.client, [ref(0), ref(500)])).size).toBe(0);
  });

  it("otro usuario no puede importar a la empresa ni a la pasarela de este", async () => {
    const ref = refs();
    await expect(importTransactions(other.client, choice([row(ref(1))]))).rejects.toThrow("La empresa ya no existe.");
    expect((await saved(user.client, [ref(1)])).size).toBe(0);
  });
});

/** Una fila de hace `days` días (negativo) o dentro de `days` días, a las 10:30 de Nueva York. */
function rowOn(reference: string, line: number, days: number): ImportRow {
  const day = addDays(todayNY(new Date()), days);
  const occurredAt = localInputToInstant(`${day}T10:30`);
  return row(reference, { line, occurredAt, occurredOn: nyDate(occurredAt) });
}

/** Un usuario aparte, con su propia configuración, para lo que cambia la configuración. */
async function ownUser() {
  const third = await createUser();
  const own = await seedBasics(third.client);
  const ownChoice = (rows: ImportRow[]) => ({ ...choice(rows), companyId: own.companyId, gatewayId: own.gatewayId });
  return { client: third.client, own, ownChoice };
}

describe("importTransactions: estado inicial, papelera y esquema", () => {
  it("con «ya se depositaron», lo que ya debió caer entra depositado en su fecha estimada; lo futuro, por caer", async () => {
    const ref = refs();
    const today = todayNY(new Date());
    const rows = [rowOn(ref(1), 2, -30), rowOn(ref(2), 3, -10), rowOn(ref(3), 4, 20)];
    expect(await importTransactions(user.client, choice(rows, false, true))).toEqual({
      created: 3,
      duplicates: 0,
      trashed: 0,
    });

    const txs = await saved(user.client, [ref(1), ref(2), ref(3)]);
    for (const past of [ref(1), ref(2)]) {
      // Dos días hábiles después del cobro: lo de hace 10 o 30 días ya cayó.
      const tx = txs.get(past)!;
      expect(tx.estimated_deposit_on! <= today).toBe(true);
      expect(tx).toMatchObject({ status: "depositado", deposited_on: tx.estimated_deposit_on });
    }
    expect(txs.get(ref(3))).toMatchObject({ status: "registrado", deposited_on: null });
    expect(txs.get(ref(3))!.estimated_deposit_on! > today).toBe(true);
  });

  it("sin la opción, todo entra por caer aunque la fecha estimada ya haya pasado", async () => {
    const ref = refs();
    await importTransactions(user.client, choice([rowOn(ref(1), 2, -30)]));
    expect((await saved(user.client, [ref(1)])).get(ref(1))).toMatchObject({ status: "registrado", deposited_on: null });
  });

  it("lo que choca con un cobro de la papelera no se crea y se cuenta aparte", async () => {
    const ref = refs();
    await importTransactions(user.client, choice([row(ref(1)), row(ref(2), { line: 3 })]));
    expect(await trashTx(user.client, [(await saved(user.client, [ref(1)])).get(ref(1))!.id])).toBe(1);

    const again = [row(ref(1)), row(ref(2), { line: 3 }), row(ref(3), { line: 4 })];
    expect(await importTransactions(user.client, choice(again))).toEqual({ created: 1, duplicates: 1, trashed: 1 });
  });

  it("el esquema por defecto solo se aplica si está activo", async () => {
    const { client, own, ownChoice } = await ownUser();
    await client.from("pay_schemes").update({ active: false }).eq("id", own.schemeId).throwOnError();
    const ref = refs();
    await importTransactions(client, ownChoice([row(ref(1))]));
    expect((await saved(client, [ref(1)])).get(ref(1))).toMatchObject({ scheme_id: null });
  });
});

describe("previewImport", () => {
  it("dice la fecha estimada de cada fila, lo que ya existe (también en la papelera) y el esquema", async () => {
    const ref = refs();
    await importTransactions(user.client, choice([row(ref(1)), row(ref(2), { line: 3 })]));
    await trashTx(user.client, [(await saved(user.client, [ref(2)])).get(ref(2))!.id]);

    const wednesday = { line: 4, occurredAt: "2026-11-18T15:30:00.000Z", occurredOn: "2026-11-18" };
    const preview = await previewImport(user.client, choice([row(ref(1)), row(ref(2), { line: 3 }), row(ref(3), wednesday)]));
    expect(preview.today).toBe(todayNY(new Date()));
    // Dos hábiles (este usuario no tiene feriados): viernes 13 → martes 17; miércoles 18 → viernes 20.
    expect(preview.estimates).toEqual([
      { line: 2, estimatedDepositOn: "2026-11-17" },
      { line: 3, estimatedDepositOn: "2026-11-17" },
      { line: 4, estimatedDepositOn: "2026-11-20" },
    ]);
    expect(preview.existing).toHaveLength(2);
    expect(preview.existing).toEqual(
      expect.arrayContaining([
        { reference: ref(1), trashed: false },
        { reference: ref(2), trashed: true },
      ]),
    );
    expect(preview.scheme).toEqual({ kind: "activo", name: "Reparto 50/30/20" });
    // Solo leyó: el tercero sigue sin existir.
    expect((await saved(user.client, [ref(3)])).size).toBe(0);
  });

  it("trae los cobros registrados a mano que pueden ser los mismos; no los importados ni los de la papelera", async () => {
    const { client, own, ownChoice } = await ownUser();
    const manual = (reference: string | null, occurredAt: string, grossOriginal = "100.00") => {
      const id = randomUUID();
      return createTx(client, {
        id,
        companyId: own.companyId,
        channelId: null,
        gatewayId: own.gatewayId,
        extraIds: [],
        schemeId: null,
        occurredAt,
        occurredOn: nyDate(occurredAt),
        currency: "USD",
        grossOriginal,
        reference,
        note: null,
      }).then(() => id);
    };
    const sinRef = await manual(null, "2026-11-13T15:00:00.000Z");
    const conRef = await manual("ch_mano_1", "2026-11-14T15:00:00.000Z");
    await manual(null, "2026-11-20T15:00:00.000Z"); // a más de un día
    await manual(null, "2026-11-13T16:00:00.000Z", "99.99"); // otro monto
    await trashTx(client, [await manual(null, "2026-11-13T17:00:00.000Z")]);
    const ref = refs();
    // Uno importado con el mismo monto y el mismo día: no se registró a mano.
    await importTransactions(client, ownChoice([row(ref(9))]));

    const preview = await previewImport(client, ownChoice([row(ref(1)), row(ref(2), { line: 3, grossOriginal: "50.00" })]));
    expect(preview.manual.map((tx) => tx.id).sort()).toEqual([sinRef, conRef].sort());
    expect(preview.manual.find((tx) => tx.id === conRef)).toEqual({
      id: conRef,
      reference: "ch_mano_1",
      currency: "USD",
      grossOriginal: "100.00",
      occurredOn: "2026-11-14",
    });

    // Otro usuario no ve nada de esto: ni la empresa.
    await expect(previewImport(other.client, ownChoice([row(ref(1))]))).rejects.toThrow("La empresa ya no existe.");
  });

  it("dice si el esquema por defecto está desactivado o si no hay", async () => {
    const { client, own, ownChoice } = await ownUser();
    const input = ownChoice([row(refs()(1))]);
    await client.from("pay_schemes").update({ active: false }).eq("id", own.schemeId).throwOnError();
    expect((await previewImport(client, input)).scheme).toEqual({ kind: "desactivado", name: "Reparto 50/30/20" });
    await client.from("pay_companies").update({ default_scheme_id: null }).eq("id", own.companyId).throwOnError();
    expect((await previewImport(client, input)).scheme).toEqual({ kind: "ninguno" });
  });

  it("una fila que no pasa se dice antes de importar", async () => {
    const bad = row(refs()(1), { line: 7, currency: "usd" });
    expect(await userErrorOf(previewImport(user.client, choice([bad])))).toMatch(/^La línea 7 no se puede importar/);
  });
});

describe("saveImportMapping", () => {
  const saldo = presetFor("stripe_saldo")!;

  it("guarda el mapeo con su formato y la pantalla lo vuelve a leer", async () => {
    const mapping: ColumnMapping = { ...saldo, fixedZone: "America/New_York" };
    await saveImportMapping(user.client, { gatewayId: b.gatewayId, format: "stripe_saldo", mapping });
    expect((await getImportMappings(user.client))[b.gatewayId]).toEqual({ format: "stripe_saldo", mapping });

    // Se reemplaza: el último que se usó.
    const otro: ColumnMapping = { ...saldo, reference: "Referencia", date: "Fecha", gross: "Importe", type: null };
    await saveImportMapping(user.client, { gatewayId: b.gatewayId, format: "otro", mapping: otro });
    expect((await getImportMappings(user.client))[b.gatewayId]).toEqual({ format: "otro", mapping: otro });
  });

  it("no guarda un mapeo que no sirve: la referencia o la nota no pueden ser datos del comprador", async () => {
    const message = await userErrorOf(
      saveImportMapping(user.client, {
        gatewayId: b.gatewayId,
        format: "stripe_saldo",
        mapping: { ...saldo, note: "customer_email" },
      }),
    );
    expect(message).toContain("La columna «customer_email» tiene datos del comprador");
    expect(
      await userErrorOf(
        saveImportMapping(user.client, {
          gatewayId: b.gatewayId,
          format: "stripe_saldo",
          mapping: { ...saldo, fixedZone: "Hora de Marte" },
        }),
      ),
    ).toContain("Zona horaria fija desconocida");
  });

  it("otro usuario no puede guardar el mapeo de una pasarela ajena", async () => {
    expect(
      await userErrorOf(
        saveImportMapping(other.client, { gatewayId: b.gatewayId, format: "stripe_saldo", mapping: saldo }),
      ),
    ).toBe("Esa pasarela ya no existe.");
  });

  it("un mapeo guardado que ya no se entiende se ignora al leer", async () => {
    const { gatewayId } = await seedBasics(other.client).then((basics) => ({ gatewayId: basics.gatewayId }));
    await other.client
      .from("pay_gateways")
      .update({ import_mapping: { format: "stripe_saldo", mapping: { reference: 42 } } })
      .eq("id", gatewayId)
      .throwOnError();
    expect(await getImportMappings(other.client)).toEqual({});
  });
});
