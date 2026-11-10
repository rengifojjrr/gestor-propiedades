import { describe, expect, test } from "vitest";
import { compute } from "./breakdown";
import { DEMO, cfgDemo } from "./demo.fixture";
import { PAY_RULE_TEXT, PayRuleError, defaultExtraIds, reResolve, resolvePayout, resolveRules } from "./rules";
import type { PayRuleCode } from "./rules";
import type { ExtraCfg, ExtraRule, GatewayCfg, PayConfig, Rules, Selection } from "./types";

// ─── Datos de ejemplo (inventados) ──────────────────────────────────────────────────────────────────────────

const VIERNES = "2026-11-13";

/** Lo que se elige al registrar E1: Escuela Demo, su canal, Stripe con «Pago rápido» y el reparto 50/30/20. */
function selE1(patch: Partial<Selection> = {}): Selection {
  return {
    companyId: DEMO.companyId,
    channelId: DEMO.channelId,
    gatewayId: DEMO.gatewayId,
    extraIds: [DEMO.extraId],
    schemeId: DEMO.schemeId,
    occurredOn: VIERNES,
    ...patch,
  };
}

/** Las reglas de E1 tal como deben quedar congeladas. */
function rulesE1(): Rules {
  return {
    gateway: {
      id: DEMO.gatewayId,
      name: "Stripe",
      feeVersionId: DEMO.feeVersionId,
      pct: "2.9",
      fixed: "0.30",
      refundsReturnFee: false,
      disputeFee: "15.00",
    },
    extras: [
      { id: DEMO.extraId, name: "Pago rápido", pct: "1.5", fixed: "0.00", base: "bruto", payoutDaysOverride: 0 },
    ],
    platform: { channelId: DEMO.channelId, name: "Escuela de marketing", pct: "5", fixed: "0.00" },
    scheme: {
      schemeId: DEMO.schemeId,
      versionId: DEMO.schemeVersionId,
      name: "Reparto 50/30/20",
      base: "neto",
      lines: [
        { beneficiaryId: DEMO.beneficiaryIds.a, name: "Grupo A", pct: "50" },
        { beneficiaryId: DEMO.beneficiaryIds.b, name: "Grupo B", pct: "30" },
        { beneficiaryId: DEMO.beneficiaryIds.c, name: "Grupo C", pct: "20" },
      ],
      remainder: null,
    },
  };
}

function only<T>(items: readonly T[]): T {
  const [item] = items;
  if (item === undefined || items.length !== 1) throw new Error("Se esperaba exactamente un elemento");
  return item;
}

const stripe = (cfg: PayConfig): GatewayCfg => only(cfg.gateways);

function extra(id: string, patch: Partial<ExtraCfg> = {}): ExtraCfg {
  return {
    id,
    name: id,
    pct: "1",
    fixed: "0.00",
    base: "bruto",
    payoutDaysOverride: null,
    defaultOn: false,
    active: true,
    sort: 0,
    kind: "opcion",
    ...patch,
  };
}

/** Una segunda pasarela, PayPal (3,49 % + 0,49; un día corrido; devuelve la comisión), con una opción propia. */
function withPayPal(cfg: PayConfig): PayConfig {
  cfg.gateways.push({
    id: "gw-paypal",
    name: "PayPal",
    payoutDays: 1,
    payoutDayType: "corridos",
    refundsReturnFee: true,
    disputeFee: "20.00",
    active: true,
    feeVersions: [{ id: "fv-paypal-1", pct: "3.49", fixed: "0.49", effectiveFrom: "2000-01-01", note: null }],
    extras: [extra("ex-paypal-divisa", { name: "Cambio de divisa", pct: "4", sort: 0 })],
  });
  return cfg;
}

/** La tarifa nueva de Stripe (3,5 % + 0,30) que rige desde el sábado 14. */
function withTomorrowFee(cfg: PayConfig): PayConfig {
  stripe(cfg).feeVersions.push({
    id: "fv-stripe-2",
    pct: "3.5",
    fixed: "0.30",
    effectiveFrom: "2026-11-14",
    note: null,
  });
  return cfg;
}

/** Una segunda versión del esquema (sobre el bruto, 60 % para A y el resto para C) que rige desde el sábado 14. */
function withTomorrowScheme(cfg: PayConfig): PayConfig {
  only(cfg.schemes).versions.push({
    id: "sv-socios-2",
    version: 2,
    base: "bruto",
    remainderBeneficiaryId: DEMO.beneficiaryIds.c,
    effectiveFrom: "2026-11-14",
    lines: [{ beneficiaryId: DEMO.beneficiaryIds.a, pct: "60" }],
  });
  return cfg;
}

const NOTHING = { gateway: false, channel: false, extras: false, scheme: false, date: false };

/** Comprueba que `fn` lanza un PayRuleError con ese código. */
function expectRuleError(fn: () => unknown, code: PayRuleCode): void {
  let caught: unknown;
  try {
    fn();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(PayRuleError);
  expect((caught as PayRuleError).code).toBe(code);
}

// ─── PayRuleError ───────────────────────────────────────────────────────────────────────────────────────────

describe("PayRuleError", () => {
  test("es un Error con su código y el mensaje en español de ese código", () => {
    const error = new PayRuleError("sin_tarifa");
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("PayRuleError");
    expect(error.code).toBe("sin_tarifa");
    expect(error.message).toBe(PAY_RULE_TEXT.sin_tarifa);
  });

  test("cada código tiene su texto, y ninguno se repite", () => {
    const codes: PayRuleCode[] = ["empresa", "pasarela", "canal", "opcion", "esquema", "sin_tarifa", "sin_version"];
    expect(Object.keys(PAY_RULE_TEXT).sort()).toEqual([...codes].sort());
    const texts = codes.map((code) => PAY_RULE_TEXT[code]);
    expect(texts.every((text) => text.length > 10)).toBe(true);
    expect(new Set(texts).size).toBe(codes.length);
  });
});

// ─── defaultExtraIds ────────────────────────────────────────────────────────────────────────────────────────

describe("defaultExtraIds", () => {
  /** Stripe con cuatro opciones desordenadas: dos encendidas por defecto, una apagada y una inactiva. */
  function cfgWithOptions(): PayConfig {
    const cfg = cfgDemo();
    stripe(cfg).extras = [
      extra("ex-c", { sort: 3, defaultOn: true }),
      extra("ex-a", { sort: 1, defaultOn: true }),
      extra("ex-inactiva", { sort: 0, defaultOn: true, active: false }),
      extra("ex-b", { sort: 2 }),
    ];
    return cfg;
  }

  test("sin lista propia en la cuenta: las opciones activas «encendidas por defecto», en su orden", () => {
    expect(defaultExtraIds(cfgDemo(), DEMO.companyId, DEMO.gatewayId)).toEqual([DEMO.extraId]);
    expect(defaultExtraIds(cfgWithOptions(), DEMO.companyId, DEMO.gatewayId)).toEqual(["ex-a", "ex-c"]);
  });

  test("la lista de la cuenta de esa empresa manda: en orden y solo las que existen y están activas", () => {
    const cfg = cfgWithOptions();
    only(cfg.companyGateways).defaultExtraIds = ["ex-c", "ex-b", "ex-inactiva", "ex-borrada"];
    expect(defaultExtraIds(cfg, DEMO.companyId, DEMO.gatewayId)).toEqual(["ex-b", "ex-c"]);
  });

  test("una lista vacía en la cuenta es «ninguna», no «las de siempre»", () => {
    const cfg = cfgWithOptions();
    only(cfg.companyGateways).defaultExtraIds = [];
    expect(defaultExtraIds(cfg, DEMO.companyId, DEMO.gatewayId)).toEqual([]);
  });

  test("la cuenta de otra empresa no cuenta", () => {
    const cfg = cfgWithOptions();
    only(cfg.companyGateways).defaultExtraIds = ["ex-b"];
    expect(defaultExtraIds(cfg, "co-otra", DEMO.gatewayId)).toEqual(["ex-a", "ex-c"]);
  });

  test("la cuenta de esa empresa en otra pasarela tampoco", () => {
    const cfg = withPayPal(cfgWithOptions());
    only(cfg.companyGateways).gatewayId = "gw-paypal";
    only(cfg.companyGateways).defaultExtraIds = ["ex-b"];
    expect(defaultExtraIds(cfg, DEMO.companyId, DEMO.gatewayId)).toEqual(["ex-a", "ex-c"]);
  });

  test("pasarela que no existe: error «pasarela»", () => {
    expectRuleError(() => defaultExtraIds(cfgDemo(), DEMO.companyId, "gw-fantasma"), "pasarela");
  });
});

// ─── resolveRules ───────────────────────────────────────────────────────────────────────────────────────────

describe("resolveRules", () => {
  test("E1: tarifa, opción, plataforma y esquema con los nombres de sus beneficiarios", () => {
    const rules = resolveRules(cfgDemo(), selE1());
    expect(rules).toEqual(rulesE1());
    expect("feeOverride" in rules.gateway).toBe(false);
  });

  test("con esas reglas, E1 da 9,70 de comisiones, 90,30 de neto y 45,15 / 27,09 / 18,06", () => {
    const b = compute(
      resolveRules(cfgDemo(), selE1()),
      { grossOriginal: "100.00", refunded: "0.00", dispute: null, failed: false },
      "USD",
    );
    expect([b.feesTotal, b.net]).toEqual(["9.70", "90.30"]);
    expect(b.alloc.lines.map((line) => line.amount)).toEqual(["45.15", "27.09", "18.06"]);
  });

  test("normaliza montos y porcentajes, vengan como vengan en la configuración", () => {
    const cfg = cfgDemo();
    const gateway = stripe(cfg);
    gateway.disputeFee = "15";
    only(gateway.feeVersions).pct = "2.90";
    only(gateway.feeVersions).fixed = "0.3";
    only(gateway.extras).pct = "1.5000";
    only(gateway.extras).fixed = "0";
    only(cfg.channels).platformFeePct = "5.0000";
    only(cfg.channels).platformFeeFixed = "0";
    only(only(cfg.schemes).versions).lines = [
      { beneficiaryId: DEMO.beneficiaryIds.a, pct: "50.0000" },
      { beneficiaryId: DEMO.beneficiaryIds.b, pct: "30.00" },
      { beneficiaryId: DEMO.beneficiaryIds.c, pct: "20.0" },
    ];

    const rules = resolveRules(cfg, selE1({ feeOverride: "3.2" }));
    expect(rules).toEqual({ ...rulesE1(), gateway: { ...rulesE1().gateway, feeOverride: "3.20" } });
    // compute exige montos canónicos: con reglas sin normalizar lanzaría RangeError.
    const state = { grossOriginal: "100.00", refunded: "0.00", dispute: "abierta", failed: false } as const;
    expect(compute(rules, state, "USD").feesTotal).toBe("24.70");
  });

  test("la comisión informada de la selección pasa a la regla de la pasarela", () => {
    expect(resolveRules(cfgDemo(), selE1({ feeOverride: "3.41" })).gateway.feeOverride).toBe("3.41");
  });

  test("sin canal no hay plataforma", () => {
    expect(resolveRules(cfgDemo(), selE1({ channelId: null })).platform).toBeNull();
  });

  test("sin esquema no hay reparto", () => {
    expect(resolveRules(cfgDemo(), selE1({ schemeId: null })).scheme).toBeNull();
  });

  test("sin opciones elegidas, ninguna", () => {
    expect(resolveRules(cfgDemo(), selE1({ extraIds: [] })).extras).toEqual([]);
  });

  test("las opciones van en el orden de la configuración, no en el que se eligieron; una repetida cuenta una vez", () => {
    const cfg = cfgDemo();
    stripe(cfg).extras = [
      extra("ex-tercera", { sort: 30 }),
      extra("ex-primera", { sort: 10, pct: "2", fixed: "0.1", base: "despues_de_comision", payoutDaysOverride: 1 }),
      extra("ex-inactiva", { sort: 20, active: false }),
      extra("ex-no-elegida", { sort: 15 }),
    ];
    const rules = resolveRules(cfg, selE1({ extraIds: ["ex-tercera", "ex-inactiva", "ex-primera", "ex-tercera"] }));
    // Una opción inactiva se respeta si se eligió a propósito (un cobro viejo que se edita).
    expect(rules.extras.map((option) => option.id)).toEqual(["ex-primera", "ex-inactiva", "ex-tercera"]);
    expect(rules.extras[0]).toEqual({
      id: "ex-primera",
      name: "ex-primera",
      pct: "2",
      fixed: "0.10",
      base: "despues_de_comision",
      payoutDaysOverride: 1,
    });
  });

  describe("versiones según la fecha", () => {
    test("«vigente desde mañana»: el cobro del 13 usa la tarifa vieja y el del 14, la nueva", () => {
      const cfg = withTomorrowFee(cfgDemo());
      const before = resolveRules(cfg, selE1()).gateway;
      expect([before.feeVersionId, before.pct, before.fixed]).toEqual([DEMO.feeVersionId, "2.9", "0.30"]);
      const after = resolveRules(cfg, selE1({ occurredOn: "2026-11-14" })).gateway;
      expect([after.feeVersionId, after.pct, after.fixed]).toEqual(["fv-stripe-2", "3.5", "0.30"]);
    });

    test("con `versionsOn` se eligen las versiones de esa fecha y no las de la fecha del cobro", () => {
      const cfg = withTomorrowScheme(withTomorrowFee(cfgDemo()));
      const rules = resolveRules(cfg, selE1(), "2026-11-20");
      expect(rules.gateway.feeVersionId).toBe("fv-stripe-2");
      expect(rules.scheme?.versionId).toBe("sv-socios-2");
      const old = resolveRules(cfg, selE1({ occurredOn: "2026-11-20" }), VIERNES);
      expect(old.gateway.feeVersionId).toBe(DEMO.feeVersionId);
      expect(old.scheme?.versionId).toBe(DEMO.schemeVersionId);
    });

    test("la versión del esquema trae su base, sus líneas y quién recibe el «Resto», con nombre", () => {
      const cfg = withTomorrowScheme(cfgDemo());
      expect(resolveRules(cfg, selE1()).scheme).toEqual(rulesE1().scheme);
      expect(resolveRules(cfg, selE1({ occurredOn: "2026-11-14" })).scheme).toEqual({
        schemeId: DEMO.schemeId,
        versionId: "sv-socios-2",
        name: "Reparto 50/30/20",
        base: "bruto",
        lines: [{ beneficiaryId: DEMO.beneficiaryIds.a, name: "Grupo A", pct: "60" }],
        remainder: { beneficiaryId: DEMO.beneficiaryIds.c, name: "Grupo C" },
      });
    });
  });

  describe("lo que no existe en la configuración", () => {
    test("empresa", () => {
      expectRuleError(() => resolveRules(cfgDemo(), selE1({ companyId: "co-fantasma" })), "empresa");
      // La empresa se comprueba aunque el cobro no lleve canal.
      expectRuleError(() => resolveRules(cfgDemo(), selE1({ companyId: "co-fantasma", channelId: null })), "empresa");
    });

    test("pasarela", () => {
      expectRuleError(() => resolveRules(cfgDemo(), selE1({ gatewayId: "gw-fantasma" })), "pasarela");
    });

    test("canal que no existe", () => {
      expectRuleError(() => resolveRules(cfgDemo(), selE1({ channelId: "ch-fantasma" })), "canal");
    });

    test("canal de otra empresa", () => {
      const cfg = cfgDemo();
      cfg.companies.push({
        id: "co-tienda",
        name: "Tienda Demo",
        currency: "USD",
        defaultSchemeId: null,
        active: true,
      });
      expectRuleError(() => resolveRules(cfg, selE1({ companyId: "co-tienda" })), "canal");
    });

    test("opción que no es de esa pasarela", () => {
      const cfg = withPayPal(cfgDemo());
      expectRuleError(() => resolveRules(cfg, selE1({ extraIds: ["ex-fantasma"] })), "opcion");
      expectRuleError(() => resolveRules(cfg, selE1({ extraIds: [DEMO.extraId, "ex-paypal-divisa"] })), "opcion");
      expectRuleError(() => resolveRules(cfg, selE1({ gatewayId: "gw-paypal" })), "opcion");
    });

    test("pasarela sin tarifas", () => {
      const cfg = cfgDemo();
      stripe(cfg).feeVersions = [];
      expectRuleError(() => resolveRules(cfg, selE1()), "sin_tarifa");
    });

    test("esquema que no existe", () => {
      expectRuleError(() => resolveRules(cfgDemo(), selE1({ schemeId: "sch-fantasma" })), "esquema");
    });

    test("esquema sin versiones", () => {
      const cfg = cfgDemo();
      only(cfg.schemes).versions = [];
      expectRuleError(() => resolveRules(cfg, selE1()), "sin_version");
    });

    test("esquema con un beneficiario que ya no existe (en una línea o como «Resto»)", () => {
      const cfg = cfgDemo();
      cfg.beneficiaries = cfg.beneficiaries.filter((beneficiary) => beneficiary.id !== DEMO.beneficiaryIds.c);
      expectRuleError(() => resolveRules(cfg, selE1()), "esquema");
      expectRuleError(() => resolveRules(withTomorrowScheme(cfg), selE1({ occurredOn: "2026-11-14" })), "esquema");
    });
  });
});

// ─── reResolve ──────────────────────────────────────────────────────────────────────────────────────────────

describe("reResolve", () => {
  /** Reglas viejas, inconfundibles: nada de esto está ya en la configuración. */
  function frozen(): Rules {
    const rules = rulesE1();
    return {
      gateway: { ...rules.gateway, name: "Stripe (antes)", disputeFee: "9.00", refundsReturnFee: true },
      extras: [
        { id: "ex-borrada", name: "Opción borrada", pct: "9", fixed: "0.09", base: "bruto", payoutDaysOverride: 5 },
      ],
      platform: { channelId: "ch-borrado", name: "Canal borrado", pct: "9", fixed: "0.90" },
      scheme: { ...(rules.scheme as NonNullable<Rules["scheme"]>), name: "Reparto (antes)" },
    };
  }

  test("si no cambió nada, las reglas congeladas quedan idénticas aunque la configuración ya sea otra", () => {
    const empty: PayConfig = {
      ...cfgDemo(),
      companies: [],
      channels: [],
      gateways: [],
      schemes: [],
      beneficiaries: [],
    };
    const prev = frozen();
    expect(reResolve(prev, empty, selE1(), NOTHING)).toEqual(frozen());
  });

  test("fecha: vuelve a elegir la tarifa y la versión del esquema; lo demás se conserva", () => {
    const cfg = withTomorrowScheme(withTomorrowFee(cfgDemo()));
    const prev: Rules = { ...frozen(), gateway: { ...frozen().gateway, feeOverride: "3.33" } };
    const next = reResolve(prev, cfg, selE1({ occurredOn: "2026-11-14" }), { ...NOTHING, date: true });
    // De la pasarela solo cambia la tarifa: el nombre, la disputa y la comisión informada siguen congelados.
    expect(next.gateway).toEqual({ ...prev.gateway, feeVersionId: "fv-stripe-2", pct: "3.5", fixed: "0.30" });
    expect(next.scheme?.versionId).toBe("sv-socios-2");
    expect(next.scheme?.base).toBe("bruto");
    expect(next.extras).toEqual(prev.extras);
    expect(next.platform).toEqual(prev.platform);
  });

  test("fecha, en un cobro sin esquema: sigue sin esquema", () => {
    const prev: Rules = { ...frozen(), scheme: null };
    const sel = selE1({ occurredOn: "2026-11-14", schemeId: null });
    expect(reResolve(prev, withTomorrowFee(cfgDemo()), sel, { ...NOTHING, date: true }).scheme).toBeNull();
  });

  test("fecha: la pasarela tiene que seguir existiendo y tener tarifas", () => {
    const sel = selE1({ occurredOn: "2026-11-14" });
    const gone: PayConfig = { ...cfgDemo(), gateways: [] };
    expectRuleError(() => reResolve(frozen(), gone, sel, { ...NOTHING, date: true }), "pasarela");
    const noFees = cfgDemo();
    stripe(noFees).feeVersions = [];
    expectRuleError(() => reResolve(frozen(), noFees, sel, { ...NOTHING, date: true }), "sin_tarifa");
  });

  test("pasarela: trae su tarifa y sus opciones; plataforma y esquema se conservan", () => {
    const cfg = withPayPal(cfgDemo());
    const prev = frozen();
    const sel = selE1({ gatewayId: "gw-paypal", extraIds: ["ex-paypal-divisa"] });
    const next = reResolve(prev, cfg, sel, { ...NOTHING, gateway: true });
    expect(next.gateway).toEqual({
      id: "gw-paypal",
      name: "PayPal",
      feeVersionId: "fv-paypal-1",
      pct: "3.49",
      fixed: "0.49",
      refundsReturnFee: true,
      disputeFee: "20.00",
    });
    expect(next.extras.map((option) => option.id)).toEqual(["ex-paypal-divisa"]);
    expect(next.platform).toEqual(prev.platform);
    expect(next.scheme).toEqual(prev.scheme);
  });

  test("pasarela: la comisión informada vieja no se arrastra; vale la de la selección nueva", () => {
    const cfg = withPayPal(cfgDemo());
    const prev: Rules = { ...frozen(), gateway: { ...frozen().gateway, feeOverride: "3.33" } };
    const sel = selE1({ gatewayId: "gw-paypal", extraIds: [] });
    expect("feeOverride" in reResolve(prev, cfg, sel, { ...NOTHING, gateway: true }).gateway).toBe(false);
    const informed = reResolve(prev, cfg, { ...sel, feeOverride: "4.1" }, { ...NOTHING, gateway: true });
    expect(informed.gateway.feeOverride).toBe("4.10");
  });

  test("monto: la comisión informada (que era de otro monto) se descarta y queda la tarifa congelada", () => {
    const prev: Rules = { ...frozen(), gateway: { ...frozen().gateway, feeOverride: "3.33" } };
    const next = reResolve(prev, cfgDemo(), selE1(), { ...NOTHING, amount: true });
    expect(next).toEqual(frozen());
    // Sin comisión informada, otro monto no cambia ninguna regla.
    expect(reResolve(frozen(), cfgDemo(), selE1(), { ...NOTHING, amount: true })).toEqual(frozen());
  });

  test("opciones: solo cambian las opciones", () => {
    const prev = frozen();
    const next = reResolve(prev, cfgDemo(), selE1(), { ...NOTHING, extras: true });
    expect(next).toEqual({ ...prev, extras: rulesE1().extras });
    expect(reResolve(prev, cfgDemo(), selE1({ extraIds: [] }), { ...NOTHING, extras: true }).extras).toEqual([]);
  });

  test("canal: solo cambia la plataforma (o deja de haberla)", () => {
    const prev = frozen();
    expect(reResolve(prev, cfgDemo(), selE1(), { ...NOTHING, channel: true })).toEqual({
      ...prev,
      platform: rulesE1().platform,
    });
    expect(reResolve(prev, cfgDemo(), selE1({ channelId: null }), { ...NOTHING, channel: true }).platform).toBeNull();
  });

  test("esquema: solo cambia el esquema (o deja de haberlo)", () => {
    const prev = frozen();
    expect(reResolve(prev, cfgDemo(), selE1(), { ...NOTHING, scheme: true })).toEqual({
      ...prev,
      scheme: rulesE1().scheme,
    });
    expect(reResolve(prev, cfgDemo(), selE1({ schemeId: null }), { ...NOTHING, scheme: true }).scheme).toBeNull();
  });

  test("todo cambió: lo mismo que resolver desde cero", () => {
    const cfg = withTomorrowScheme(withTomorrowFee(cfgDemo()));
    const sel = selE1({ occurredOn: "2026-11-14" });
    const all = { gateway: true, channel: true, extras: true, scheme: true, date: true };
    expect(reResolve(frozen(), cfg, sel, all)).toEqual(resolveRules(cfg, sel));
  });

  test("solo se valida lo que cambió: una opción borrada no impide cambiar de canal", () => {
    const sel = selE1({ extraIds: ["ex-borrada"] });
    expect(reResolve(frozen(), cfgDemo(), sel, { ...NOTHING, channel: true }).extras).toEqual(frozen().extras);
    expectRuleError(() => reResolve(frozen(), cfgDemo(), sel, { ...NOTHING, extras: true }), "opcion");
  });
});

// ─── resolvePayout ──────────────────────────────────────────────────────────────────────────────────────────

describe("resolvePayout", () => {
  const where = { companyId: DEMO.companyId, gatewayId: DEMO.gatewayId };
  const option = (payoutDaysOverride: number | null): ExtraRule => ({
    id: `ex-${payoutDaysOverride}`,
    name: "Opción",
    pct: "0",
    fixed: "0.00",
    base: "bruto",
    payoutDaysOverride,
  });

  test("una opción encendida que cambia los días manda (pago rápido: 0 días)", () => {
    expect(resolvePayout(cfgDemo(), where, rulesE1().extras)).toEqual({
      days: 0,
      dayType: "habiles",
      source: "opcion",
      bankAccountId: DEMO.bankAccountId,
    });
  });

  test("con varias opciones, la de menos días; las que no cambian los días no cuentan", () => {
    const payout = resolvePayout(cfgDemo(), where, [option(5), option(null), option(3), option(4)]);
    expect([payout.days, payout.source]).toEqual([3, "opcion"]);
  });

  test("sin opciones que cambien los días: los de la cuenta de la pasarela de esa empresa", () => {
    const cfg = cfgDemo();
    only(cfg.companyGateways).payoutDaysOverride = 7;
    expect(resolvePayout(cfg, where, [option(null)])).toEqual({
      days: 7,
      dayType: "habiles",
      source: "cuenta",
      bankAccountId: DEMO.bankAccountId,
    });
    // Cero días en la cuenta también manda: es un valor, no «sin dato».
    only(cfg.companyGateways).payoutDaysOverride = 0;
    expect(resolvePayout(cfg, where, []).days).toBe(0);
    expect(resolvePayout(cfg, where, []).source).toBe("cuenta");
  });

  test("si la cuenta no dice nada: los de la pasarela", () => {
    expect(resolvePayout(cfgDemo(), where, [])).toEqual({
      days: 2,
      dayType: "habiles",
      source: "pasarela",
      bankAccountId: DEMO.bankAccountId,
    });
  });

  test("empresa sin cuenta en esa pasarela: los días de la pasarela y sin cuenta destino", () => {
    const cfg = withPayPal(cfgDemo());
    only(cfg.companyGateways).payoutDaysOverride = 7;
    expect(resolvePayout(cfg, { companyId: "co-otra", gatewayId: DEMO.gatewayId }, [])).toEqual({
      days: 2,
      dayType: "habiles",
      source: "pasarela",
      bankAccountId: null,
    });
    // El tipo de día es siempre el de la pasarela.
    expect(resolvePayout(cfg, { companyId: DEMO.companyId, gatewayId: "gw-paypal" }, [])).toEqual({
      days: 1,
      dayType: "corridos",
      source: "pasarela",
      bankAccountId: null,
    });
  });

  test("pasarela que no existe: error «pasarela»", () => {
    expectRuleError(() => resolvePayout(cfgDemo(), { ...where, gatewayId: "gw-fantasma" }, []), "pasarela");
  });
});
