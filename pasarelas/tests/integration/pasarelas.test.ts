import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type { NewTxInput } from "@/lib/pasarelas";
import { errorMessage, UserError } from "@/server/pasarelas/errors";
import {
  addFeeVersion,
  createGateway,
  deleteExtra,
  deleteFeeVersion,
  deleteGateway,
  removeInternational,
  saveExtra,
  saveInternational,
  setGatewayActive,
  updateGateway,
  type NewGateway,
} from "@/server/pasarelas/ops/gateways";
import { createTx, trashTx } from "@/server/pasarelas/ops/transactions";
import { loadPayConfig } from "@/server/pasarelas/queries/config";
import { getGateway, listGatewayTotals } from "@/server/pasarelas/queries/gateways";
import { getSnapshots } from "@/server/pasarelas/queries/transactions";
import {
  createUser,
  expectRejected,
  seedBasics,
  unwrap,
  type Basics,
  type Db,
  type TestUser,
} from "./helpers";

/**
 * Las escrituras de la pantalla Pasarelas (`ops/gateways.ts`) y sus lecturas (`queries/gateways.ts`), con la sesión
 * de usuarios reales del stack local (RLS). Cada bloque usa lo suyo: no depende del orden.
 */

const IN_USE = "Tiene cobros: desactívala en su lugar";
const FEE_IN_USE = "Esta tarifa ya se usó en cobros: agrega una nueva con otra fecha";
const FEE_DATE_TAKEN = "Ya hay una tarifa con esa fecha";

let user: TestUser;
let other: TestUser;
let b: Basics;

/** El recargo internacional sin días propios: tarda lo mismo que un pago nacional. */
const SAME_DAYS = { payoutDaysOverride: null, payoutDaysOverrideMax: null } as const;

beforeAll(async () => {
  [user, other] = await Promise.all([createUser(), createUser()]);
  b = await seedBasics(user.client);
});

/** PayPal Demo 3,49 % + 0,49, con la opción «Transferencia inmediata» 1,75 %. */
const paypal = (name = `PayPal Demo ${randomUUID().slice(0, 8)}`): NewGateway => ({
  name,
  payoutDays: 3,
  payoutDaysMax: null,
  payoutDayType: "corridos",
  refundsReturnFee: true,
  disputeFee: "20.00",
  notes: "Cuenta de prueba",
  pct: "3.49",
  fixed: "0.49",
  extras: [
    {
      name: "Transferencia inmediata",
      pct: "1.75",
      fixed: "0.00",
      base: "despues_de_comision",
      defaultOn: true,
      payoutDaysOverride: 0,
      payoutDaysOverrideMax: null,
    },
    {
      name: "Seguro",
      pct: "0",
      fixed: "1.00",
      base: "bruto",
      defaultOn: false,
      payoutDaysOverride: null,
      payoutDaysOverrideMax: null,
    },
  ],
});

/** Un cobro de 100,00 USD con Stripe (sin canal ni esquema) registrado con `createTx`, el día `on` al mediodía. */
async function charge(client: Db, on: string, extraIds: string[] = []): Promise<string> {
  const input: NewTxInput = {
    id: randomUUID(),
    companyId: b.companyId,
    channelId: null,
    gatewayId: b.gatewayId,
    extraIds,
    schemeId: null,
    occurredOn: on,
    occurredAt: `${on}T17:00:00Z`,
    currency: "USD",
    grossOriginal: "100.00",
    reference: null,
    note: null,
  };
  const { id } = await createTx(client, input);
  return id;
}

/** La línea «pasarela» del desglose congelado de un cobro. */
async function gatewayLine(client: Db, id: string): Promise<string | undefined> {
  const [tx] = await getSnapshots(client, [id]);
  return tx?.breakdown.lines.find((line) => line.kind === "pasarela")?.amount;
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

describe("createGateway", () => {
  it("crea la pasarela, su primera tarifa «desde el inicio» y sus opciones en orden, de una vez", async () => {
    const input = paypal();
    const { id } = await createGateway(user.client, input);

    const gateway = await getGateway(user.client, id);
    expect(gateway).toEqual({
      id,
      name: input.name,
      payoutDays: 3,
      payoutDaysMax: null,
      payoutDayType: "corridos",
      refundsReturnFee: true,
      disputeFee: "20.00",
      notes: "Cuenta de prueba",
      active: true,
      feeVersions: [{ id: expect.any(String), pct: "3.49", fixed: "0.49", effectiveFrom: "2000-01-01", note: null }],
      extras: [
        {
          id: expect.any(String),
          name: "Transferencia inmediata",
          pct: "1.75",
          fixed: "0.00",
          base: "despues_de_comision",
          payoutDaysOverride: 0,
          payoutDaysOverrideMax: null,
          defaultOn: true,
          active: true,
          sort: 0,
          kind: "opcion",
        },
        {
          id: expect.any(String),
          name: "Seguro",
          pct: "0",
          fixed: "1.00",
          base: "bruto",
          payoutDaysOverride: null,
          payoutDaysOverrideMax: null,
          defaultOn: false,
          active: true,
          sort: 1,
          kind: "opcion",
        },
      ],
    });
  });

  it("con recargo internacional lo guarda como «Pago internacional»: sobre el bruto, apagado, sin días, al final", async () => {
    const { id } = await createGateway(user.client, { ...paypal(), international: { pct: "1.5", fixed: "0.10" } });
    const gateway = await getGateway(user.client, id);
    expect(gateway?.extras.map((extra) => [extra.name, extra.kind])).toEqual([
      ["Transferencia inmediata", "opcion"],
      ["Seguro", "opcion"],
      ["Pago internacional", "internacional"],
    ]);
    expect(gateway?.extras[2]).toEqual({
      id: expect.any(String),
      name: "Pago internacional",
      pct: "1.5",
      fixed: "0.10",
      base: "bruto",
      payoutDaysOverride: null,
      payoutDaysOverrideMax: null,
      defaultOn: false,
      active: true,
      sort: 2,
      kind: "internacional",
    });
  });

  it("sin opciones también crea la pasarela con su tarifa", async () => {
    const { id } = await createGateway(user.client, { ...paypal(), extras: [] });
    const gateway = await getGateway(user.client, id);
    expect(gateway?.extras).toEqual([]);
    expect(gateway?.feeVersions).toHaveLength(1);
  });

  it("un nombre repetido (sin distinguir mayúsculas ni espacios) no crea nada y dice por qué", async () => {
    const name = `PayPal Demo ${randomUUID().slice(0, 8)}`;
    await createGateway(user.client, paypal(name));
    const error: unknown = await createGateway(user.client, paypal(`  ${name.toUpperCase()} `)).catch((e: unknown) => e);
    expect(errorMessage(error)).toBe("Ya hay una pasarela con ese nombre.");
  });
});

describe("updateGateway y setGatewayActive", () => {
  it("cambia los datos de la pasarela sin tocar sus tarifas", async () => {
    const { id } = await createGateway(user.client, paypal());
    const before = await getGateway(user.client, id);
    await updateGateway(user.client, id, {
      name: `Otro nombre ${randomUUID().slice(0, 8)}`,
      payoutDays: 5,
      payoutDaysMax: null,
      payoutDayType: "habiles",
      refundsReturnFee: false,
      disputeFee: "15.00",
      notes: null,
    });
    const after = await getGateway(user.client, id);
    expect(after).toMatchObject({
      payoutDays: 5,
      payoutDaysMax: null,
      payoutDayType: "habiles",
      refundsReturnFee: false,
      disputeFee: "15.00",
      notes: null,
    });
    expect(after?.feeVersions).toEqual(before?.feeVersions);
  });

  it("desactiva y vuelve a activar", async () => {
    const { id } = await createGateway(user.client, paypal());
    await setGatewayActive(user.client, id, false);
    expect((await getGateway(user.client, id))?.active).toBe(false);
    await setGatewayActive(user.client, id, true);
    expect((await getGateway(user.client, id))?.active).toBe(true);
  });

  it("la pasarela de otro usuario no existe para él", async () => {
    const { id } = await createGateway(user.client, paypal());
    expect(await getGateway(other.client, id)).toBeNull();
    expect(await userErrorOf(setGatewayActive(other.client, id, false))).toBe("Esa pasarela ya no existe.");
    expect(
      await userErrorOf(
        updateGateway(other.client, id, {
          name: "Ajena",
          payoutDays: 1,
          payoutDaysMax: null,
          payoutDayType: "habiles",
          refundsReturnFee: false,
          disputeFee: "0.00",
          notes: null,
        }),
      ),
    ).toBe("Esa pasarela ya no existe.");
    expect(await userErrorOf(deleteGateway(other.client, id))).toBe("Esa pasarela ya no existe.");
    expect((await getGateway(user.client, id))?.active).toBe(true);
  });
});

describe("deleteGateway (Foco 5)", () => {
  it("sin cobros la borra con sus tarifas y sus opciones", async () => {
    const { id } = await createGateway(user.client, paypal());
    await deleteGateway(user.client, id);
    expect(await getGateway(user.client, id)).toBeNull();
    const cfg = await loadPayConfig(user.client);
    expect(cfg.gateways.some((g) => g.id === id)).toBe(false);
  });

  it("con cobros no la borra: «Tiene cobros: desactívala en su lugar»", async () => {
    const solo = await createUser();
    const basics = await seedBasics(solo.client);
    await createTx(solo.client, {
      id: randomUUID(),
      companyId: basics.companyId,
      channelId: null,
      gatewayId: basics.gatewayId,
      extraIds: [],
      schemeId: null,
      occurredOn: "2026-11-13",
      occurredAt: "2026-11-13T17:00:00Z",
      currency: "USD",
      grossOriginal: "100.00",
      reference: null,
      note: null,
    });
    expect(await userErrorOf(deleteGateway(solo.client, basics.gatewayId))).toBe(IN_USE);
    expect(await getGateway(solo.client, basics.gatewayId)).not.toBeNull();
  });
});

describe("tarifas: addFeeVersion y deleteFeeVersion", () => {
  it("una tarifa «vigente desde» mañana no cambia el cobro ya registrado; uno de mañana la usa (Listo cuando n.º 3)", async () => {
    const old = await charge(user.client, "2026-11-13");
    expect(await gatewayLine(user.client, old)).toBe("3.20");

    await addFeeVersion(user.client, {
      gatewayId: b.gatewayId,
      pct: "3.5",
      fixed: "0.30",
      effectiveFrom: "2026-11-14",
      note: "Sube la tarifa",
    });

    expect(await gatewayLine(user.client, old)).toBe("3.20");
    const fresh = await charge(user.client, "2026-11-14");
    expect(await gatewayLine(user.client, fresh)).toBe("3.80");

    const versions = (await getGateway(user.client, b.gatewayId))?.feeVersions;
    expect(versions?.map((v) => [v.effectiveFrom, v.pct, v.fixed, v.note])).toEqual([
      ["2000-01-01", "2.9", "0.30", null],
      ["2026-11-14", "3.5", "0.30", "Sube la tarifa"],
    ]);
  });

  it("otra tarifa con la misma fecha: «Ya hay una tarifa con esa fecha»", async () => {
    const { id } = await createGateway(user.client, paypal());
    await addFeeVersion(user.client, { gatewayId: id, pct: "4", fixed: "0.49", effectiveFrom: "2027-01-01" });
    expect(
      await userErrorOf(addFeeVersion(user.client, { gatewayId: id, pct: "5", fixed: "0", effectiveFrom: "2027-01-01" })),
    ).toBe(FEE_DATE_TAKEN);
  });

  it("no agrega tarifas a la pasarela de otro usuario", async () => {
    const { id } = await createGateway(user.client, paypal());
    expect(
      await userErrorOf(addFeeVersion(other.client, { gatewayId: id, pct: "1", fixed: "0", effectiveFrom: "2027-02-01" })),
    ).toBe("Esa pasarela ya no existe.");
    expect((await getGateway(user.client, id))?.feeVersions).toHaveLength(1);
  });

  it("borra una tarifa que ningún cobro usa", async () => {
    const { id } = await createGateway(user.client, paypal());
    const added = await addFeeVersion(user.client, { gatewayId: id, pct: "4", fixed: "0.49", effectiveFrom: "2027-03-01" });
    await deleteFeeVersion(user.client, added.id);
    expect((await getGateway(user.client, id))?.feeVersions.map((v) => v.effectiveFrom)).toEqual(["2000-01-01"]);
    expect(await userErrorOf(deleteFeeVersion(user.client, added.id))).toBe("Esa tarifa ya no existe.");
  });

  it("no borra una tarifa que ya se usó en cobros", async () => {
    await charge(user.client, "2026-11-10");
    expect(await userErrorOf(deleteFeeVersion(user.client, b.feeVersionId))).toBe(FEE_IN_USE);
    const versions = (await getGateway(user.client, b.gatewayId))?.feeVersions;
    expect(versions?.some((v) => v.id === b.feeVersionId)).toBe(true);
  });
});

describe("opciones: saveExtra y deleteExtra", () => {
  it("agrega una opción al final y la edita (incluido «encendida por defecto» y activa)", async () => {
    const { id: gatewayId } = await createGateway(user.client, paypal());
    const { id } = await saveExtra(user.client, {
      gatewayId,
      name: "Pago en cuotas",
      pct: "2",
      fixed: "0.10",
      base: "bruto",
      defaultOn: false,
      payoutDaysOverride: 5,
      payoutDaysOverrideMax: null,
      active: true,
    });
    let extra = (await getGateway(user.client, gatewayId))?.extras.find((e) => e.id === id);
    expect(extra).toMatchObject({ name: "Pago en cuotas", pct: "2", fixed: "0.10", sort: 2, payoutDaysOverride: 5 });

    await saveExtra(user.client, {
      id,
      gatewayId,
      name: "Cuotas",
      pct: "2.25",
      fixed: "0.00",
      base: "despues_de_comision",
      defaultOn: true,
      payoutDaysOverride: null,
      payoutDaysOverrideMax: null,
      active: false,
    });
    extra = (await getGateway(user.client, gatewayId))?.extras.find((e) => e.id === id);
    expect(extra).toMatchObject({
      name: "Cuotas",
      pct: "2.25",
      fixed: "0.00",
      base: "despues_de_comision",
      defaultOn: true,
      payoutDaysOverride: null,
      payoutDaysOverrideMax: null,
      active: false,
      sort: 2,
    });
  });

  it("no toca la opción de otro usuario ni agrega opciones a su pasarela", async () => {
    const { id: gatewayId } = await createGateway(user.client, paypal());
    const extraId = (await getGateway(user.client, gatewayId))?.extras[0]?.id ?? "";
    const fields = {
      name: "Ajena",
      pct: "1",
      fixed: "0.00",
      base: "bruto" as const,
      defaultOn: false,
      payoutDaysOverride: null,
      payoutDaysOverrideMax: null,
      active: true,
    };
    expect(await userErrorOf(saveExtra(other.client, { ...fields, id: extraId, gatewayId }))).toBe(
      "Esa opción ya no existe.",
    );
    expect(await userErrorOf(saveExtra(other.client, { ...fields, gatewayId }))).toBe("Esa pasarela ya no existe.");
    expect(await userErrorOf(deleteExtra(other.client, extraId))).toBe("Esa opción ya no existe.");
    expect((await getGateway(user.client, gatewayId))?.extras.map((e) => e.name)).toEqual([
      "Transferencia inmediata",
      "Seguro",
    ]);
  });

  it("borra una opción que ningún cobro usa", async () => {
    const { id: gatewayId } = await createGateway(user.client, paypal());
    const extraId = (await getGateway(user.client, gatewayId))?.extras[1]?.id ?? "";
    await deleteExtra(user.client, extraId);
    expect((await getGateway(user.client, gatewayId))?.extras.map((e) => e.name)).toEqual(["Transferencia inmediata"]);
  });

  it("no borra una opción que algún cobro usa (aunque el cobro esté en la papelera)", async () => {
    const id = await charge(user.client, "2026-11-11", [b.extraId]);
    expect(await trashTx(user.client, [id])).toBe(1);
    expect(await userErrorOf(deleteExtra(user.client, b.extraId))).toBe(IN_USE);
    expect((await getGateway(user.client, b.gatewayId))?.extras.some((e) => e.id === b.extraId)).toBe(true);
  });
});

describe("pagos internacionales: la opción de tipo «internacional»", () => {
  const INTERNATIONAL_TAKEN = "Esta pasarela ya tiene un recargo internacional.";
  const INTERNATIONAL_GONE = "Ese recargo internacional ya no existe.";

  /** Las opciones de la pasarela con su tipo, en su orden, leídas tal cual de la tabla. */
  async function kinds(client: Db, gatewayId: string) {
    const { data } = await client
      .from("pay_gateway_extras")
      .select("name, kind, active")
      .eq("gateway_id", gatewayId)
      .order("sort")
      .order("created_at")
      .throwOnError();
    return data;
  }

  /** Una pasarela nueva, creada directo con `pay_create_gateway` (como la llamaría cualquiera por la API). */
  async function rpcGateway(client: Db, extras: Record<string, string>[]): Promise<string> {
    return unwrap(
      await client.rpc("pay_create_gateway", {
        p: { name: `Stripe Demo ${randomUUID().slice(0, 8)}`, fee: { pct: "2.9", fixed: "0.30" }, extras },
      }),
      "pasarela",
    );
  }

  it("la columna nace en «opcion»: las opciones de antes y las que se agregan sin decir de qué tipo son", async () => {
    // seedBasics crea Stripe con «Pago rápido» por pay_create_gateway, sin decir el tipo.
    expect(await kinds(user.client, b.gatewayId)).toEqual([{ name: "Pago rápido", kind: "opcion", active: true }]);
    const { id: gatewayId } = await createGateway(user.client, paypal());
    await user.client
      .from("pay_gateway_extras")
      .insert({ gateway_id: gatewayId, name: "Cuotas", pct: "2", sort: 5 })
      .throwOnError();
    expect(await kinds(user.client, gatewayId)).toEqual([
      { name: "Transferencia inmediata", kind: "opcion", active: true },
      { name: "Seguro", kind: "opcion", active: true },
      { name: "Cuotas", kind: "opcion", active: true },
    ]);
  });

  it("pay_create_gateway guarda el tipo de cada opción (por defecto «opcion»)", async () => {
    const gatewayId = await rpcGateway(user.client, [
      { name: "Pago rápido", pct: "1.5" },
      { name: "Pago internacional", pct: "1.5", kind: "internacional" },
    ]);
    expect(await kinds(user.client, gatewayId)).toEqual([
      { name: "Pago rápido", kind: "opcion", active: true },
      { name: "Pago internacional", kind: "internacional", active: true },
    ]);
  });

  it("un tipo que no es «opcion» ni «internacional» no se guarda", async () => {
    expectRejected(
      await user.client.from("pay_gateway_extras").insert({ gateway_id: b.gatewayId, name: "Rara", kind: "otra" }),
      "23514",
      "pay_gateway_extras_kind_check",
    );
  });

  it("no se pueden tener dos internacionales activas en una pasarela; una inactiva no cuenta, ni la de otra pasarela", async () => {
    const gatewayId = await rpcGateway(user.client, [{ name: "Pago internacional", pct: "1.5", kind: "internacional" }]);
    const second = { gateway_id: gatewayId, name: "Pago internacional", pct: "2", kind: "internacional" };
    const repeated = await user.client.from("pay_gateway_extras").insert(second);
    expectRejected(repeated, "23505", "pay_gateway_extras_internacional_uq");
    expect(errorMessage(repeated.error)).toBe(INTERNATIONAL_TAKEN);
    // Dos a la vez en la misma llamada tampoco.
    expectRejected(
      await user.client.rpc("pay_create_gateway", {
        p: {
          name: `Stripe Demo ${randomUUID().slice(0, 8)}`,
          fee: { pct: "2.9", fixed: "0.30" },
          extras: [
            { name: "Pago internacional", pct: "1.5", kind: "internacional" },
            { name: "Pago internacional", pct: "2", kind: "internacional" },
          ],
        },
      }),
      "23505",
      "pay_gateway_extras_internacional_uq",
    );

    // Apagada la primera, ya puede haber otra; volver a encender la primera chocaría con ella.
    await user.client
      .from("pay_gateway_extras")
      .update({ active: false })
      .eq("gateway_id", gatewayId)
      .throwOnError();
    await user.client.from("pay_gateway_extras").insert(second).throwOnError();
    expectRejected(
      await user.client
        .from("pay_gateway_extras")
        .update({ active: true })
        .eq("gateway_id", gatewayId)
        .eq("active", false),
      "23505",
      "pay_gateway_extras_internacional_uq",
    );
    expect(await kinds(user.client, gatewayId)).toEqual([
      { name: "Pago internacional", kind: "internacional", active: false },
      { name: "Pago internacional", kind: "internacional", active: true },
    ]);

    // Otra pasarela tiene la suya.
    await rpcGateway(user.client, [{ name: "Pago internacional", pct: "1", kind: "internacional" }]);
  });

  it("saveInternational agrega el recargo y lo cambia; removeInternational lo apaga; agregarlo otra vez crea otro", async () => {
    const { id: gatewayId } = await createGateway(user.client, paypal());
    const { id } = await saveInternational(user.client, { ...SAME_DAYS, gatewayId, pct: "1.5", fixed: "0.00" });
    let gateway = await getGateway(user.client, gatewayId);
    expect(gateway?.extras.find((extra) => extra.id === id)).toEqual({
      id,
      name: "Pago internacional",
      pct: "1.5",
      fixed: "0.00",
      base: "bruto",
      payoutDaysOverride: null,
      payoutDaysOverrideMax: null,
      defaultOn: false,
      active: true,
      sort: 2,
      kind: "internacional",
    });

    expect(await saveInternational(user.client, { ...SAME_DAYS, id, gatewayId, pct: "2.25", fixed: "0.30" })).toEqual({ id });
    gateway = await getGateway(user.client, gatewayId);
    expect(gateway?.extras.find((extra) => extra.id === id)).toMatchObject({ pct: "2.25", fixed: "0.30", active: true });

    // Sin id, con uno ya activo (otra pestaña lo agregó): no se crea otro.
    const taken: unknown = await saveInternational(user.client, { ...SAME_DAYS, gatewayId, pct: "1", fixed: "0.00" }).catch(
      (e: unknown) => e,
    );
    expect(errorMessage(taken)).toBe(INTERNATIONAL_TAKEN);

    await removeInternational(user.client, id);
    gateway = await getGateway(user.client, gatewayId);
    expect(gateway?.extras.find((extra) => extra.id === id)?.active).toBe(false);
    // Ya apagado, cambiarlo o quitarlo otra vez dice que no está.
    expect(await userErrorOf(saveInternational(user.client, { ...SAME_DAYS, id, gatewayId, pct: "3", fixed: "0.00" }))).toBe(
      INTERNATIONAL_GONE,
    );
    expect(await userErrorOf(removeInternational(user.client, id))).toBe(INTERNATIONAL_GONE);

    const again = await saveInternational(user.client, { ...SAME_DAYS, gatewayId, pct: "1", fixed: "0.00" });
    expect(again.id).not.toBe(id);
    expect(await kinds(user.client, gatewayId)).toEqual([
      { name: "Transferencia inmediata", kind: "opcion", active: true },
      { name: "Seguro", kind: "opcion", active: true },
      { name: "Pago internacional", kind: "internacional", active: false },
      { name: "Pago internacional", kind: "internacional", active: true },
    ]);
  });

  it("la internacional no se edita como una opción más, y una opción no se cambia como internacional", async () => {
    const { id: gatewayId } = await createGateway(user.client, { ...paypal(), international: { pct: "1.5", fixed: "0.00" } });
    const extras = (await getGateway(user.client, gatewayId))?.extras ?? [];
    const international = extras.find((extra) => extra.kind === "internacional");
    const option = extras.find((extra) => extra.kind === "opcion");
    const fields = {
      gatewayId,
      name: "Otra cosa",
      pct: "9",
      fixed: "0.00",
      base: "despues_de_comision" as const,
      defaultOn: true,
      payoutDaysOverride: 0,
      payoutDaysOverrideMax: null,
      active: true,
    };
    expect(await userErrorOf(saveExtra(user.client, { ...fields, id: international?.id }))).toBe(
      "Esa opción ya no existe.",
    );
    expect(
      await userErrorOf(saveInternational(user.client, { ...SAME_DAYS, id: option?.id, gatewayId, pct: "9", fixed: "0.00" })),
    ).toBe(INTERNATIONAL_GONE);
    expect(await userErrorOf(removeInternational(user.client, option?.id ?? ""))).toBe(INTERNATIONAL_GONE);
    expect(await getGateway(user.client, gatewayId)).toMatchObject({ extras });
  });

  it("otro usuario no ve ni cambia la opción internacional, ni agrega una a la pasarela ajena", async () => {
    const { id: gatewayId } = await createGateway(user.client, { ...paypal(), international: { pct: "1.5", fixed: "0.00" } });
    const id = (await getGateway(user.client, gatewayId))?.extras.find((extra) => extra.kind === "internacional")?.id;
    if (id === undefined) throw new Error("Falta la opción internacional");

    const { data: seen } = await other.client.from("pay_gateway_extras").select("id").eq("id", id).throwOnError();
    expect(seen).toEqual([]);
    const { data: changed } = await other.client
      .from("pay_gateway_extras")
      .update({ pct: "9", active: false })
      .eq("id", id)
      .select("id")
      .throwOnError();
    expect(changed).toEqual([]);
    expect(await userErrorOf(saveInternational(other.client, { ...SAME_DAYS, id, gatewayId, pct: "9", fixed: "0.00" }))).toBe(
      INTERNATIONAL_GONE,
    );
    expect(await userErrorOf(removeInternational(other.client, id))).toBe(INTERNATIONAL_GONE);
    const { id: bare } = await createGateway(user.client, paypal());
    expect(await userErrorOf(saveInternational(other.client, { ...SAME_DAYS, gatewayId: bare, pct: "9", fixed: "0.00" }))).toBe(
      "Esa pasarela ya no existe.",
    );
    expect((await getGateway(user.client, bare))?.extras.some((extra) => extra.kind === "internacional")).toBe(false);

    expect((await getGateway(user.client, gatewayId))?.extras.find((extra) => extra.id === id)).toMatchObject({
      pct: "1.5",
      active: true,
    });
  });
});

describe("listGatewayTotals", () => {
  it("da por pasarela y moneda los totales y el tiempo real de depósito (promedio y mediana), como texto", async () => {
    const solo = await createUser();
    const basics = await seedBasics(solo.client);
    const ids = await Promise.all(
      ["2026-11-02", "2026-11-03", "2026-11-04"].map(async (on) => {
        const id = randomUUID();
        await createTx(solo.client, {
          id,
          companyId: basics.companyId,
          channelId: null,
          gatewayId: basics.gatewayId,
          extraIds: [],
          schemeId: null,
          occurredOn: on,
          occurredAt: `${on}T17:00:00Z`,
          currency: "USD",
          grossOriginal: "100.00",
          reference: null,
          note: null,
          status: "depositado",
          // 2, 3 y 6 días de calendario después del cobro.
          depositedOn: { "2026-11-02": "2026-11-04", "2026-11-03": "2026-11-06", "2026-11-04": "2026-11-10" }[on],
        });
        return id;
      }),
    );
    expect(ids).toHaveLength(3);

    expect(await listGatewayTotals(solo.client)).toEqual([
      {
        gatewayId: basics.gatewayId,
        currency: "USD",
        txCount: 3,
        gross: "300.00",
        fees: "9.60",
        net: "290.40",
        depositedCount: 3,
        avgDays: "3.67",
        medianDays: "3.00",
      },
    ]);
  });

  it("sin cobros no hay filas, y sin depósitos el tiempo real queda vacío", async () => {
    const solo = await createUser();
    const basics = await seedBasics(solo.client);
    expect(await listGatewayTotals(solo.client)).toEqual([]);
    await createTx(solo.client, {
      id: randomUUID(),
      companyId: basics.companyId,
      channelId: null,
      gatewayId: basics.gatewayId,
      extraIds: [],
      schemeId: null,
      occurredOn: "2026-11-02",
      occurredAt: "2026-11-02T17:00:00Z",
      currency: "USD",
      grossOriginal: "50.00",
      reference: null,
      note: null,
    });
    expect(await listGatewayTotals(solo.client)).toEqual([
      expect.objectContaining({ txCount: 1, depositedCount: 0, avgDays: null, medianDays: null }),
    ]);
  });
});
