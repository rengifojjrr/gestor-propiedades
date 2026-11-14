import { describe, expect, test } from "vitest";
import type { Db } from "../dto";
import { cleanSearch, leanTx, listTx, parseTxFilters } from "./transactions";

/** Viernes 13 de noviembre de 2026. */
const TODAY = "2026-11-13";
const THIS_MONTH = { from: "2026-11-01", to: "2026-11-13" };
const ID = "3f2b8c1e-9d4a-4e7b-8a6f-0c1d2e3f4a5b";

const filtersOf = (sp: Record<string, string | string[] | undefined>) => parseTxFilters(sp, TODAY).filters;

describe("parseTxFilters", () => {
  test("sin parámetros: este mes, del más reciente al más antiguo, primera página", () => {
    expect(parseTxFilters({}, TODAY)).toEqual({ filters: THIS_MONTH, sort: "fecha_desc", page: 1 });
  });

  describe("período", () => {
    test("cada período fijo da el rango de `periodRange`", () => {
      expect(filtersOf({ periodo: "este_mes" })).toEqual(THIS_MONTH);
      expect(filtersOf({ periodo: "mes_anterior" })).toEqual({ from: "2026-10-01", to: "2026-10-31" });
      expect(filtersOf({ periodo: "30d" })).toEqual({ from: "2026-10-15", to: TODAY });
      expect(filtersOf({ periodo: "90d" })).toEqual({ from: "2026-08-16", to: TODAY });
      expect(filtersOf({ periodo: "365d" })).toEqual({ from: "2025-11-14", to: TODAY });
      expect(filtersOf({ periodo: "este_anio" })).toEqual({ from: "2026-01-01", to: TODAY });
    });

    test("un período desconocido es «este mes»", () => {
      expect(filtersOf({ periodo: "siempre" })).toEqual(THIS_MONTH);
      expect(filtersOf({ periodo: "" })).toEqual(THIS_MONTH);
    });

    test("con un período fijo, las fechas sueltas de la URL no cuentan", () => {
      expect(filtersOf({ periodo: "30d", desde: "2020-01-01", hasta: "2020-12-31" })).toEqual({
        from: "2026-10-15",
        to: TODAY,
      });
      expect(filtersOf({ desde: "2020-01-01", hasta: "2020-12-31" })).toEqual(THIS_MONTH);
    });

    test("fechas a elegir: las dos, una sola o ninguna", () => {
      const custom = { periodo: "personalizado" };
      expect(filtersOf({ ...custom, desde: "2026-03-05", hasta: "2026-04-10" })).toEqual({
        from: "2026-03-05",
        to: "2026-04-10",
      });
      // Al revés: se ordenan.
      expect(filtersOf({ ...custom, desde: "2026-04-10", hasta: "2026-03-05" })).toEqual({
        from: "2026-03-05",
        to: "2026-04-10",
      });
      expect(filtersOf({ ...custom, desde: "2026-03-05" })).toEqual({ from: "2026-03-05", to: TODAY });
      expect(filtersOf({ ...custom, hasta: "2026-03-05" })).toEqual({ from: "2026-03-01", to: "2026-03-05" });
      expect(filtersOf(custom)).toEqual(THIS_MONTH);
    });

    test("una fecha mal formada o que no existe se ignora, no lanza", () => {
      const custom = { periodo: "personalizado" };
      expect(filtersOf({ ...custom, desde: "05/03/2026", hasta: "2026-02-30" })).toEqual(THIS_MONTH);
      expect(filtersOf({ ...custom, desde: "2026-03-05", hasta: "mañana" })).toEqual({ from: "2026-03-05", to: TODAY });
      expect(filtersOf({ ...custom, desde: "'; drop table pay_transactions; --" })).toEqual(THIS_MONTH);
    });
  });

  describe("filtros por id", () => {
    test("empresa, canal, pasarela y cuenta", () => {
      const other = "11111111-1111-1111-1111-111111111111";
      expect(filtersOf({ empresa: ID, canal: other, pasarela: ID, cuenta: other })).toEqual({
        ...THIS_MONTH,
        companyId: ID,
        channelId: other,
        gatewayId: ID,
        bankAccountId: other,
      });
    });

    test("un uuid en mayúsculas se pasa a minúsculas, como lo devuelve la base", () => {
      expect(filtersOf({ empresa: ID.toUpperCase() })).toEqual({ ...THIS_MONTH, companyId: ID });
    });

    test("lo que no es un uuid se ignora", () => {
      expect(
        filtersOf({ empresa: "1", canal: "todas", pasarela: `${ID})`, cuenta: `${ID},gateway_id.neq.${ID}` }),
      ).toEqual(THIS_MONTH);
    });
  });

  test("moneda: tres letras, a mayúsculas; otra cosa se ignora", () => {
    expect(filtersOf({ moneda: "usd" })).toEqual({ ...THIS_MONTH, currency: "USD" });
    expect(filtersOf({ moneda: "EUR" })).toEqual({ ...THIS_MONTH, currency: "EUR" });
    for (const moneda of ["US", "USDT", "U$D", "123", ""]) expect(filtersOf({ moneda })).toEqual(THIS_MONTH);
  });

  test("estado: los seis visibles, «por caer» y «atrasado»; otro se ignora", () => {
    const known = [
      "fallido",
      "en_disputa",
      "reembolsado",
      "depositado",
      "en_transito",
      "registrado",
      "por_caer",
      "atrasado",
    ];
    for (const estado of known) expect(filtersOf({ estado })).toEqual({ ...THIS_MONTH, status: estado });
    for (const estado of ["pagado", "Depositado", "", "depositado,fallido"]) {
      expect(filtersOf({ estado })).toEqual(THIS_MONTH);
    }
  });

  test("comprobante: con o sin; otro se ignora", () => {
    expect(filtersOf({ comprobante: "con" })).toEqual({ ...THIS_MONTH, receipt: "con" });
    expect(filtersOf({ comprobante: "sin" })).toEqual({ ...THIS_MONTH, receipt: "sin" });
    expect(filtersOf({ comprobante: "si" })).toEqual(THIS_MONTH);
  });

  test("estimada: una fecha; mal formada se ignora", () => {
    expect(filtersOf({ estimada: "2026-11-17" })).toEqual({ ...THIS_MONTH, estimatedOn: "2026-11-17" });
    expect(filtersOf({ estimada: "17/11/2026" })).toEqual(THIS_MONTH);
    expect(filtersOf({ estimada: "2026-11-31" })).toEqual(THIS_MONTH);
  });

  describe("búsqueda", () => {
    test("se recorta; vacía no es un filtro", () => {
      expect(filtersOf({ q: "  ch_demo  " })).toEqual({ ...THIS_MONTH, q: "ch_demo" });
      expect(filtersOf({ q: "   " })).toEqual(THIS_MONTH);
      expect(filtersOf({ q: "" })).toEqual(THIS_MONTH);
    });

    test("conserva lo escrito (un monto con coma se sigue leyendo como monto), hasta 80 caracteres", () => {
      expect(filtersOf({ q: "$1.234,56" })).toEqual({ ...THIS_MONTH, q: "$1.234,56" });
      expect(filtersOf({ q: "a".repeat(200) }).q).toHaveLength(80);
    });

    test("si no queda nada que buscar (solo signos), no es un filtro", () => {
      expect(filtersOf({ q: "%%%" })).toEqual(THIS_MONTH);
      expect(filtersOf({ q: "(),\"'*" })).toEqual(THIS_MONTH);
    });
  });

  test("orden: los cinco conocidos; otro es el de siempre", () => {
    for (const orden of ["fecha_desc", "fecha_asc", "monto_desc", "monto_asc", "estimada_asc"]) {
      expect(parseTxFilters({ orden }, TODAY).sort).toBe(orden);
    }
    for (const orden of ["", "monto", "id.desc", "estimada_desc"]) {
      expect(parseTxFilters({ orden }, TODAY).sort).toBe("fecha_desc");
    }
  });

  test("página: un entero desde 1; otra cosa es la primera", () => {
    expect(parseTxFilters({ pagina: "3" }, TODAY).page).toBe(3);
    expect(parseTxFilters({ pagina: "250" }, TODAY).page).toBe(250);
    for (const pagina of ["0", "-1", "1.5", "1e3", "dos", "", " 2", "99999999999999999999"]) {
      expect(parseTxFilters({ pagina }, TODAY).page).toBe(1);
    }
  });

  test("un parámetro repetido en la URL llega como lista: vale el primero", () => {
    const parsed = parseTxFilters(
      { empresa: [ID, "otra"], estado: ["depositado", "fallido"], pagina: ["2", "9"], q: ["uno", "dos"] },
      TODAY,
    );
    expect(parsed).toEqual({
      filters: { ...THIS_MONTH, companyId: ID, status: "depositado", q: "uno" },
      sort: "fecha_desc",
      page: 2,
    });
    expect(parseTxFilters({ empresa: [], periodo: [] }, TODAY).filters).toEqual(THIS_MONTH);
  });

  test("todo junto", () => {
    expect(
      parseTxFilters(
        {
          periodo: "personalizado",
          desde: "2026-01-01",
          hasta: "2026-06-30",
          empresa: ID,
          moneda: "usd",
          estado: "atrasado",
          comprobante: "sin",
          estimada: "2026-06-15",
          q: "Stripe",
          orden: "monto_desc",
          pagina: "4",
          otra: "cosa",
        },
        TODAY,
      ),
    ).toEqual({
      filters: {
        from: "2026-01-01",
        to: "2026-06-30",
        companyId: ID,
        currency: "USD",
        status: "atrasado",
        receipt: "sin",
        estimatedOn: "2026-06-15",
        q: "Stripe",
      },
      sort: "monto_desc",
      page: 4,
    });
  });

  test("nunca filtra por la papelera: eso lo decide la pantalla, no la URL", () => {
    expect("trashed" in filtersOf({ trashed: "true", papelera: "1" })).toBe(false);
  });
});

describe("cleanSearch", () => {
  test("deja letras (también con tilde), dígitos, espacio y -_.@#/:", () => {
    expect(cleanSearch("ch_demo-0001.a@b#c/d:e")).toBe("ch_demo-0001.a@b#c/d:e");
    expect(cleanSearch("Inscripción Ñandú 2026")).toBe("Inscripción Ñandú 2026");
  });

  test("quita lo demás: lo que rompería el filtro de PostgREST o haría de comodín", () => {
    expect(cleanSearch("a,b(c)d\"e'f*g%h\\i")).toBe("abcdefghi");
    expect(cleanSearch("$1.234,56")).toBe("1.23456");
    expect(cleanSearch("%%%")).toBe("");
  });

  test("junta los espacios, recorta y corta en 80", () => {
    expect(cleanSearch("  pago \t  de\nmarzo  ")).toBe("pago de marzo");
    expect(cleanSearch("x".repeat(200))).toHaveLength(80);
    expect(cleanSearch(`${"x".repeat(79)} y`)).toBe("x".repeat(79));
  });
});

describe("una lectura que llega sin el total de filas (`count`) no se da por completa", () => {
  /**
   * Un cliente falso mínimo: cualquier consulta, con los filtros que sean, responde lo siguiente de `responses`
   * (la última se repite).
   */
  function clientAnswering(...responses: readonly object[]): Db {
    let asked = 0;
    const query: object = new Proxy(
      {},
      {
        get: (_target, method) =>
          method === "then"
            ? (resolve: (response: unknown) => void) => {
                resolve(responses[Math.min(asked, responses.length - 1)]);
                asked += 1;
              }
            : () => query,
      },
    );
    return { from: () => query } as unknown as Db;
  }

  const row = {
    id: ID,
    occurred_on: TODAY,
    company_id: ID,
    channel_id: null,
    gateway_id: ID,
    bank_account_id: null,
    currency: "USD",
    gross_original: "1.00",
    refunded_amount: "0.00",
    gross_amount: "1.00",
    fees_total: "0.00",
    net_amount: "1.00",
    status: "registrado",
    dispute_state: null,
    estimated_deposit_on: null,
    deposited_on: null,
    receipts_count: 0,
    fees_paid_by: "nosotros",
    buyer_fees: "0.00",
    retention_amount: "0.00",
  };
  /** Una página llena (el tope de la API) que no dice cuántas filas tiene el filtro: puede haber más. */
  const FULL_PAGE_NO_COUNT = { data: Array.from({ length: 1000 }, () => row), count: null, error: null };
  const NO_COUNT = { data: [], count: null, error: null };
  const PAST_THE_END = { data: null, count: null, error: { code: "PGRST103", message: "", details: "", hint: "" } };
  const WITHOUT_TOTAL = /sin el total de filas/;

  test("leanTx lanza en vez de sumar solo la primera página", async () => {
    await expect(leanTx(clientAnswering(FULL_PAGE_NO_COUNT), {}, TODAY)).rejects.toThrow(WITHOUT_TOTAL);
    await expect(leanTx(clientAnswering(NO_COUNT), {}, TODAY)).rejects.toThrow(WITHOUT_TOTAL);
  });

  test("listTx lanza en vez de dar por total las filas de la página", async () => {
    await expect(listTx(clientAnswering(NO_COUNT), {}, "fecha_desc", 1, TODAY)).rejects.toThrow(WITHOUT_TOTAL);
  });

  test("listTx, más allá de la última página: lanza en vez de decir que el filtro no tiene cobros", async () => {
    const client = clientAnswering(PAST_THE_END, NO_COUNT);
    await expect(listTx(client, {}, "fecha_desc", 99, TODAY)).rejects.toThrow(WITHOUT_TOTAL);
  });

  test("con su total, las mismas lecturas responden", async () => {
    expect(await leanTx(clientAnswering({ data: [row], count: 1, error: null }), {}, TODAY)).toHaveLength(1);
    const client = clientAnswering(PAST_THE_END, { data: null, count: 7, error: null });
    expect(await listTx(client, {}, "fecha_desc", 99, TODAY)).toEqual({ rows: [], total: 7 });
  });
});
