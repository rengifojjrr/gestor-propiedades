import { beforeAll, describe, expect, it } from "vitest";
import { addDays, usBankHolidays } from "@/lib/pasarelas";
import { ensureHolidays, loadPayConfig } from "@/server/pasarelas/queries/config";
import { adminClient, createUser, seedBasics, unwrap, type Basics, type TestUser } from "./helpers";

/**
 * La configuración tal como la lee la app: `loadPayConfig` con la sesión del usuario (RLS) y `ensureHolidays`.
 */

let user: TestUser;
let b: Basics;
/** Lo que se agrega a la configuración mínima para ver órdenes, versiones y elementos inactivos. */
let added: {
  feeVersion2: string;
  extraSeguro: string;
  schemeVersion2: string;
  shopId: string;
  shopGatewayId: string;
  paypalId: string;
  paypalFeeId: string;
};

beforeAll(async () => {
  user = await createUser();
  b = await seedBasics(user.client);
  const c = user.client;

  const feeVersion2 = unwrap(
    await c
      .from("pay_gateway_fee_versions")
      .insert({
        gateway_id: b.gatewayId,
        pct: "3.5",
        fixed: "0.3",
        effective_from: "2026-12-01",
        note: "Sube en diciembre",
      })
      .select("id")
      .single(),
    "segunda tarifa",
  );
  // Una opción inactiva que va ANTES que «Pago rápido» por orden (sort −1), aunque se creó después.
  const extraSeguro = unwrap(
    await c
      .from("pay_gateway_extras")
      .insert({
        gateway_id: b.gatewayId,
        name: "Seguro",
        fixed: "1",
        base: "despues_de_comision",
        sort: -1,
        active: false,
      })
      .select("id")
      .single(),
    "opción inactiva",
  );
  // Segunda versión del esquema: sobre el bruto, 33,3333 % para C primero y 10 % para A; el resto, para B.
  const scheme2 = unwrap(
    await c.rpc("pay_save_scheme", {
      p: {
        scheme_id: b.schemeId,
        base: "bruto",
        effective_from: "2026-12-01",
        remainder_beneficiary_id: b.beneficiaryIds.b,
        lines: [
          { beneficiary_id: b.beneficiaryIds.c, pct: "33.3333" },
          { beneficiary_id: b.beneficiaryIds.a, pct: "10" },
        ],
      },
    }),
    "segunda versión del esquema",
  ) as { version_id: string };
  const shop = unwrap(
    await c.from("pay_companies").insert({ name: "Tienda Demo", currency: "EUR", active: false }).select("id").single(),
    "segunda empresa",
  );
  const shopGateway = unwrap(
    await c
      .from("pay_company_gateways")
      .insert({ company_id: shop.id, gateway_id: b.gatewayId, payout_days_override: 5, default_extra_ids: [b.extraId] })
      .select("id")
      .single(),
    "cuenta de Stripe de la tienda",
  );
  const paypalId = unwrap(
    await c.rpc("pay_create_gateway", {
      p: {
        name: "PayPal",
        payout_days: 1,
        payout_day_type: "corridos",
        refunds_return_fee: true,
        dispute_fee: "20",
        fee: { pct: "3.49", fixed: "0.49" },
      },
    }),
    "segunda pasarela",
  );
  const paypalFee = unwrap(
    await c.from("pay_gateway_fee_versions").select("id").eq("gateway_id", paypalId).single(),
    "tarifa de PayPal",
  );
  unwrap(
    await c
      .from("pay_beneficiaries")
      .update({ active: false, kind: "cartera" })
      .eq("id", b.beneficiaryIds.c)
      .select("id")
      .single(),
    "beneficiario inactivo",
  );

  added = {
    feeVersion2: feeVersion2.id,
    extraSeguro: extraSeguro.id,
    schemeVersion2: scheme2.version_id,
    shopId: shop.id,
    shopGatewayId: shopGateway.id,
    paypalId,
    paypalFeeId: paypalFee.id,
  };
});

describe("loadPayConfig", () => {
  it("devuelve la forma exacta de PayConfig, con los montos como cadenas de 2 decimales y lo inactivo incluido", async () => {
    const cfg = await loadPayConfig(user.client);

    expect(cfg).toEqual({
      // Por nombre.
      companies: [
        { id: b.companyId, name: "Escuela Demo", currency: "USD", defaultSchemeId: b.schemeId, active: true },
        { id: added.shopId, name: "Tienda Demo", currency: "EUR", defaultSchemeId: null, active: false },
      ],
      channels: [
        {
          id: b.channelId,
          companyId: b.companyId,
          name: "Inscripciones en línea",
          platformFeePct: "5",
          platformFeeFixed: "0.00",
          active: true,
        },
      ],
      gateways: [
        {
          id: added.paypalId,
          name: "PayPal",
          payoutDays: 1,
          payoutDayType: "corridos",
          refundsReturnFee: true,
          disputeFee: "20.00",
          active: true,
          feeVersions: [{ id: added.paypalFeeId, pct: "3.49", fixed: "0.49", effectiveFrom: "2000-01-01", note: null }],
          extras: [],
        },
        {
          id: b.gatewayId,
          name: "Stripe",
          payoutDays: 2,
          payoutDayType: "habiles",
          refundsReturnFee: false,
          disputeFee: "0.00",
          active: true,
          // De la más antigua a la más nueva.
          feeVersions: [
            { id: b.feeVersionId, pct: "2.9", fixed: "0.30", effectiveFrom: "2000-01-01", note: null },
            {
              id: added.feeVersion2,
              pct: "3.5",
              fixed: "0.30",
              effectiveFrom: "2026-12-01",
              note: "Sube en diciembre",
            },
          ],
          // En su orden (`sort`), no en el de creación.
          extras: [
            {
              id: added.extraSeguro,
              name: "Seguro",
              pct: "0",
              fixed: "1.00",
              base: "despues_de_comision",
              payoutDaysOverride: null,
              defaultOn: false,
              active: false,
              sort: -1,
            },
            {
              id: b.extraId,
              name: "Pago rápido",
              pct: "1.5",
              fixed: "0.00",
              base: "bruto",
              payoutDaysOverride: 0,
              defaultOn: false,
              active: true,
              sort: 0,
            },
          ],
        },
      ],
      companyGateways: [
        {
          id: b.companyGatewayId,
          companyId: b.companyId,
          gatewayId: b.gatewayId,
          bankAccountId: b.bankAccountId,
          payoutDaysOverride: null,
          defaultExtraIds: null,
          active: true,
        },
        {
          id: added.shopGatewayId,
          companyId: added.shopId,
          gatewayId: b.gatewayId,
          bankAccountId: null,
          payoutDaysOverride: 5,
          defaultExtraIds: [b.extraId],
          active: true,
        },
      ],
      bankAccounts: [{ id: b.bankAccountId, alias: "Cuenta principal", last4: "4321", currency: "USD", active: true }],
      beneficiaries: [
        { id: b.beneficiaryIds.a, name: "Grupo A", kind: "persona", active: true },
        { id: b.beneficiaryIds.b, name: "Grupo B", kind: "persona", active: true },
        { id: b.beneficiaryIds.c, name: "Grupo C", kind: "cartera", active: false },
      ],
      schemes: [
        {
          id: b.schemeId,
          name: "Reparto 50/30/20",
          active: true,
          versions: [
            {
              id: b.schemeVersionId,
              version: 1,
              base: "neto",
              remainderBeneficiaryId: null,
              effectiveFrom: "2000-01-01",
              lines: [
                { beneficiaryId: b.beneficiaryIds.a, pct: "50" },
                { beneficiaryId: b.beneficiaryIds.b, pct: "30" },
                { beneficiaryId: b.beneficiaryIds.c, pct: "20" },
              ],
            },
            {
              id: added.schemeVersion2,
              version: 2,
              base: "bruto",
              remainderBeneficiaryId: b.beneficiaryIds.b,
              effectiveFrom: "2026-12-01",
              // En el orden en que se guardaron las líneas.
              lines: [
                { beneficiaryId: b.beneficiaryIds.c, pct: "33.3333" },
                { beneficiaryId: b.beneficiaryIds.a, pct: "10" },
              ],
            },
          ],
        },
      ],
      holidays: [],
    });
  });

  it("todo monto es una cadena con 2 decimales y todo porcentaje una cadena sin ceros de relleno: nunca un number", async () => {
    const cfg = await loadPayConfig(user.client);

    const money = [
      ...cfg.channels.map((channel) => channel.platformFeeFixed),
      ...cfg.gateways.flatMap((gateway) => [
        gateway.disputeFee,
        ...gateway.feeVersions.map((version) => version.fixed),
        ...gateway.extras.map((option) => option.fixed),
      ]),
    ];
    const pcts = [
      ...cfg.channels.map((channel) => channel.platformFeePct),
      ...cfg.gateways.flatMap((gateway) => [
        ...gateway.feeVersions.map((version) => version.pct),
        ...gateway.extras.map((option) => option.pct),
      ]),
      ...cfg.schemes.flatMap((scheme) => scheme.versions.flatMap((version) => version.lines.map((line) => line.pct))),
    ];
    expect(money.length).toBeGreaterThanOrEqual(7);
    expect(pcts.length).toBeGreaterThanOrEqual(10);
    for (const value of money) expect(value).toMatch(/^\d+\.\d{2}$/);
    for (const value of pcts) expect(value).toMatch(/^(0|[1-9]\d*)(\.\d*[1-9])?$/);
  });

  it("una tabla con más de 1000 filas (el tope de la API por petición) se lee entera, y en orden", async () => {
    const many = await createUser();
    const days = Array.from({ length: 1005 }, (_, i) => addDays("2030-01-01", i));
    unwrap(
      await many.client
        .from("pay_holidays")
        // Al revés, para que el orden no sea el de inserción.
        .insert([...days].reverse().map((day) => ({ day, name: "Feriado demo" })))
        .select("id")
        .limit(1),
      "feriados",
    );

    const cfg = await loadPayConfig(many.client);

    expect(cfg.holidays).toHaveLength(1005);
    expect(cfg.holidays).toEqual(days);
  });

  it("solo trae la configuración del usuario de la sesión", async () => {
    const other = await createUser();

    expect(await loadPayConfig(other.client)).toEqual({
      companies: [],
      channels: [],
      gateways: [],
      companyGateways: [],
      bankAccounts: [],
      beneficiaries: [],
      schemes: [],
      holidays: [],
    });
  });
});

describe("ensureHolidays", () => {
  const seeded = [...usBankHolidays(2026), ...usBankHolidays(2027)];

  it("la primera vez siembra los feriados bancarios de 2026 y 2027", async () => {
    await ensureHolidays(user.client);

    const cfg = await loadPayConfig(user.client);
    expect(cfg.holidays).toEqual(seeded.map((holiday) => holiday.day));
    expect(cfg.holidays).toHaveLength(22);
    // Los del spec: Acción de Gracias y Navidad de 2026.
    expect(cfg.holidays).toContain("2026-11-26");
    expect(cfg.holidays).toContain("2026-12-25");
    const rows = unwrap(
      await adminClient().from("pay_holidays").select("day, name").eq("user_id", user.id).order("day"),
      "feriados",
    );
    expect(rows).toEqual(seeded);
  });

  it("llamarla otra vez no hace nada: ni duplica ni repone lo que el usuario quitó", async () => {
    unwrap(
      await user.client.from("pay_holidays").delete().eq("day", "2026-12-25").select("id").single(),
      "quitar un feriado",
    );

    await ensureHolidays(user.client);
    await ensureHolidays(user.client);

    const cfg = await loadPayConfig(user.client);
    expect(cfg.holidays).toHaveLength(21);
    expect(cfg.holidays).not.toContain("2026-12-25");
  });

  it("dos llamadas a la vez para un usuario nuevo siembran una sola vez", async () => {
    const fresh = await createUser();

    await Promise.all([ensureHolidays(fresh.client), ensureHolidays(fresh.client)]);

    expect((await loadPayConfig(fresh.client)).holidays).toEqual(seeded.map((holiday) => holiday.day));
  });
});
