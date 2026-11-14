import { describe, expect, test } from "vitest";
import type { PayConfig } from "@/lib/pasarelas/types";
import { parseTxFilters, type TxFilters } from "../queries/transactions";
import { PDF_MAX, pdfFileName, pdfRequestOf, scopeText, tooManyText, type PdfRequest } from "./scope";

/** Qué cobros entran en el PDF (la URL), cómo se dice lo que abarca, cómo se llama el archivo y el tope. */

/** Sábado 14 de noviembre de 2026, en Nueva York. */
const TODAY = "2026-11-14";

const IDS = {
  a: "11111111-1111-4111-8111-111111111111",
  b: "22222222-2222-4222-8222-222222222222",
  company: "33333333-3333-4333-8333-333333333333",
  channel: "44444444-4444-4444-8444-444444444444",
  gateway: "55555555-5555-4555-8555-555555555555",
  account: "66666666-6666-4666-8666-666666666666",
};

const CFG: PayConfig = {
  companies: [{ id: IDS.company, name: "Tienda Demo", currency: "USD", defaultSchemeId: null, active: true }],
  channels: [
    {
      id: IDS.channel,
      companyId: IDS.company,
      name: "Señales «en línea»",
      platformFeePct: "0",
      platformFeeFixed: "0.00",
      active: true,
    },
  ],
  gateways: [
    {
      id: IDS.gateway,
      name: "OTF Demo",
      payoutDays: 2,
      payoutDaysMax: null,
      payoutDayType: "habiles",
      refundsReturnFee: false,
      disputeFee: "0.00",
      active: true,
      feeVersions: [],
      extras: [],
      retention: { pct: "0", days: 0, recipients: [] },
    },
  ],
  companyGateways: [],
  bankAccounts: [{ id: IDS.account, alias: "Cuenta principal", last4: "4321", currency: "USD", active: true }],
  beneficiaries: [],
  schemes: [],
  holidays: [],
};

const params = (query: string) => new URLSearchParams(query);
const filtro = (filters: TxFilters): PdfRequest => ({ kind: "filtro", filters, sort: "fecha_desc" });

describe("pdfRequestOf: qué cobros pide la URL", () => {
  test("los elegidos: cada `id` válido una vez, en su orden; lo que no es un id se ignora sin error", () => {
    expect(pdfRequestOf(params(`id=${IDS.b}&id=no-es-un-id&id=${IDS.a}&id=${IDS.b}&periodo=30d`), TODAY)).toEqual({
      kind: "elegidos",
      ids: [IDS.b, IDS.a],
    });
    expect(pdfRequestOf(params("id=no-es-un-id"), TODAY)).toEqual({ kind: "elegidos", ids: [] });
  });

  test("sin `id`, el filtro de la lista con las mismas claves que el CSV (la página no cuenta)", () => {
    const query =
      `periodo=30d&empresa=${IDS.company}&estado=depositado&estado=fallido&q=pi_1&orden=monto_desc&pagina=3`;
    const { filters, sort } = parseTxFilters(
      {
        periodo: "30d",
        empresa: IDS.company,
        estado: ["depositado", "fallido"],
        q: "pi_1",
        orden: "monto_desc",
        pagina: "3",
      },
      TODAY,
    );
    expect(pdfRequestOf(params(query), TODAY)).toEqual({ kind: "filtro", filters, sort });
    expect(filters).toMatchObject({ from: "2026-10-16", to: TODAY, status: "depositado" });
    expect(pdfRequestOf(params(""), TODAY)).toEqual(filtro({ from: "2026-11-01", to: TODAY }));
  });

  test("«hoy» es el día de hoy en Nueva York, con lo demás del filtro y sin mirar `desde` ni `hasta`", () => {
    expect(pdfRequestOf(params("periodo=hoy&desde=2026-01-01&hasta=2026-01-31&estado=depositado"), TODAY)).toEqual(
      filtro({ from: TODAY, to: TODAY, status: "depositado" }),
    );
  });
});

describe("scopeText: qué abarca, en palabras", () => {
  test("los elegidos dicen cuántos salen", () => {
    expect(scopeText({ kind: "elegidos", ids: [IDS.a, IDS.b] }, 1, CFG, TODAY)).toBe("Seleccionados (1)");
    expect(scopeText({ kind: "elegidos", ids: [] }, 12, CFG, TODAY)).toBe("Seleccionados (12)");
  });

  test("el período: hoy, un día o un rango", () => {
    expect(scopeText(filtro({ from: TODAY, to: TODAY }), 3, CFG, TODAY)).toBe("Hoy, sáb 14 nov 2026");
    expect(scopeText(filtro({ from: "2026-11-13", to: "2026-11-13" }), 3, CFG, TODAY)).toBe("El vie 13 nov 2026");
    expect(scopeText(filtro({ from: "2026-11-01", to: TODAY }), 3, CFG, TODAY)).toBe(
      "Del dom 1 nov 2026 al sáb 14 nov 2026",
    );
    // `parseTxFilters` siempre pone las dos fechas; si faltaran, la que falta es hoy.
    expect(scopeText(filtro({}), 3, CFG, TODAY)).toBe("Hoy, sáb 14 nov 2026");
  });

  test("cada filtro con su nombre", () => {
    const filters: TxFilters = {
      from: "2026-11-01",
      to: TODAY,
      companyId: IDS.company,
      channelId: IDS.channel,
      gatewayId: IDS.gateway,
      bankAccountId: IDS.account,
      currency: "MXN",
      status: "depositado",
      receipt: "sin",
      payout: "pendiente",
      estimatedOn: "2026-11-16",
      q: "pi_1",
    };
    expect(scopeText(filtro(filters), 3, CFG, TODAY)).toBe(
      "Del dom 1 nov 2026 al sáb 14 nov 2026 · Empresa: Tienda Demo · Canal: Señales «en línea» · " +
        "Pasarela: OTF Demo · Cuenta destino: Cuenta principal ··4321 · Moneda: MXN · Estado: Depositado · " +
        "Sin comprobante · Reparto pendiente · Caen el lun 16 nov 2026 · Búsqueda: «pi_1»",
    );
  });

  test("«Reparto pendiente» se nombra, también si llega por la URL como en la lista", () => {
    const query = "periodo=personalizado&desde=2026-11-14&hasta=2026-11-14&reparto=pendiente";
    const request = pdfRequestOf(params(query), TODAY);
    expect(request).toEqual(filtro({ from: TODAY, to: TODAY, payout: "pendiente" }));
    expect(scopeText(request, 2, CFG, TODAY)).toBe("Hoy, sáb 14 nov 2026 · Reparto pendiente");
  });

  test("por caer, atrasados y con comprobante; lo que ya no existe se dice así", () => {
    const gone = "77777777-7777-4777-8777-777777777777";
    const account = CFG.bankAccounts[0] as PayConfig["bankAccounts"][number];
    const noLast4: PayConfig = { ...CFG, bankAccounts: [{ ...account, last4: null }] };
    const day = { from: TODAY, to: TODAY };
    const allGone = { ...day, companyId: gone, channelId: gone, gatewayId: gone, bankAccountId: gone };
    expect(scopeText(filtro({ ...day, status: "por_caer", receipt: "con" }), 1, CFG, TODAY)).toBe(
      "Hoy, sáb 14 nov 2026 · Estado: Por caer · Con comprobante",
    );
    expect(scopeText(filtro({ ...day, status: "atrasado", bankAccountId: IDS.account }), 1, noLast4, TODAY)).toBe(
      "Hoy, sáb 14 nov 2026 · Cuenta destino: Cuenta principal · Estado: Atrasados",
    );
    expect(scopeText(filtro(allGone), 1, CFG, TODAY)).toBe(
      "Hoy, sáb 14 nov 2026 · Empresa que ya no existe · Canal que ya no existe · Pasarela que ya no existe · " +
        "Cuenta que ya no existe",
    );
  });
});

describe("el archivo y el tope", () => {
  test("cobros-AAAA-MM-DD.pdf, o cobros-elegidos-AAAA-MM-DD.pdf, con la fecha de hoy en Nueva York", () => {
    expect(pdfFileName(filtro({}), TODAY)).toBe("cobros-2026-11-14.pdf");
    expect(pdfFileName({ kind: "elegidos", ids: [] }, TODAY)).toBe("cobros-elegidos-2026-11-14.pdf");
  });

  test("el PDF admite hasta 300 cobros; si son más, se dice cuántos y qué hacer", () => {
    expect(PDF_MAX).toBe(300);
    expect(tooManyText(filtro({}), 412)).toBe("Son 412 cobros; el PDF admite hasta 300. Acota el filtro.");
    expect(tooManyText({ kind: "elegidos", ids: [] }, 301)).toBe(
      "Son 301 cobros; el PDF admite hasta 300. Elige menos.",
    );
  });
});
