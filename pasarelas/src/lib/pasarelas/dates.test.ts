import { afterEach, describe, expect, test, vi } from "vitest";
import {
  addDays,
  daysBetween,
  depositWindowOf,
  estimateDepositDate,
  estimateDepositWindow,
  formatDate,
  formatDateTime,
  formatWindowShort,
  instantToLocalInput,
  isBusinessDay,
  isISODate,
  localInputToInstant,
  monthKey,
  monthLabel,
  nyDate,
  periodRange,
  todayNY,
  wallTimeToInstant,
  windowDayLabels,
  ZONE,
  type PeriodPreset,
} from "./dates";
import { usBankHolidays } from "./holidays";

const H = new Set(usBankHolidays(2026).map((h) => h.day));

describe("cuándo cae el dinero (spec §5.4)", () => {
  test("F1", () =>
    expect(estimateDepositDate({ occurredOn: "2026-11-13", days: 2, dayType: "habiles", holidays: H })).toBe(
      "2026-11-17",
    ));
  test("F2", () =>
    expect(estimateDepositDate({ occurredOn: "2026-11-25", days: 2, dayType: "habiles", holidays: H })).toBe(
      "2026-11-30",
    ));
  test("F3", () =>
    expect(estimateDepositDate({ occurredOn: "2026-12-24", days: 2, dayType: "habiles", holidays: H })).toBe(
      "2026-12-29",
    ));
  test("pago rápido: 0 días es el mismo día aunque sea sábado", () =>
    expect(estimateDepositDate({ occurredOn: "2026-11-14", days: 0, dayType: "habiles", holidays: H })).toBe(
      "2026-11-14",
    ));
  test("corridos no saltan el fin de semana", () =>
    expect(estimateDepositDate({ occurredOn: "2026-11-13", days: 1, dayType: "corridos", holidays: H })).toBe(
      "2026-11-14",
    ));
  test("el día es el de Nueva York", () => {
    expect(nyDate("2026-11-14T03:30:00Z")).toBe("2026-11-13");
    expect(localInputToInstant("2026-11-13T22:30")).toBe("2026-11-14T03:30:00.000Z");
  });
  test("el cambio de horario no corre el día", () => {
    expect(addDays("2026-03-07", 1)).toBe("2026-03-08");
    expect(addDays("2026-03-08", 1)).toBe("2026-03-09");
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-11-01", 1)).toBe("2026-11-02");
    expect(daysBetween("2026-03-07", "2026-03-09")).toBe(2);
  });
});

describe("ventanas de depósito: estimateDepositWindow", () => {
  const H2 = new Set([...H, ...usBankHolidays(2027).map((h) => h.day)]);
  type Kind = "habiles" | "corridos";
  const window = (occurredOn: string, days: number, daysMax: number | null, dayType: Kind = "habiles") =>
    estimateDepositWindow({ occurredOn, days, daysMax, dayType, holidays: H2 });

  test("F1–F3 con un solo valor: la ventana es de un día, el de siempre", () => {
    expect(window("2026-11-13", 2, null)).toEqual({ from: "2026-11-17", to: "2026-11-17" });
    expect(window("2026-11-25", 2, null)).toEqual({ from: "2026-11-30", to: "2026-11-30" });
    expect(window("2026-12-24", 2, null)).toEqual({ from: "2026-12-29", to: "2026-12-29" });
    // El máximo igual al mínimo es lo mismo que no tenerlo.
    expect(window("2026-11-13", 2, 2)).toEqual({ from: "2026-11-17", to: "2026-11-17" });
  });

  test("de 3 a 5 hábiles desde el mar 10 nov, con el feriado del 11 y el fin de semana: del lun 16 al mié 18", () => {
    expect(window("2026-11-10", 3, 5)).toEqual({ from: "2026-11-16", to: "2026-11-18" });
  });

  test("F2 como ventana: de 2 a 4 hábiles cruza Acción de Gracias y el fin de semana", () => {
    expect(window("2026-11-25", 2, 4)).toEqual({ from: "2026-11-30", to: "2026-12-02" });
  });

  test("F3 como ventana: de 2 a 5 hábiles cruza Navidad, el fin de semana, Año Nuevo y el año", () => {
    expect(window("2026-12-24", 2, 5)).toEqual({ from: "2026-12-29", to: "2027-01-04" });
  });

  test("de 0 a 2 hábiles desde un sábado: desde el mismo sábado hasta el martes", () => {
    expect(window("2026-11-14", 0, 2)).toEqual({ from: "2026-11-14", to: "2026-11-17" });
  });

  test("corridos: de 7 a 10 días de calendario, sin saltar feriados ni fines de semana", () => {
    expect(window("2026-11-10", 7, 10, "corridos")).toEqual({ from: "2026-11-17", to: "2026-11-20" });
  });

  test("un máximo menor que el mínimo, o que no es entero, es un error", () => {
    for (const daysMax of [2, 2.5, Number.NaN]) expect(() => window("2026-11-10", 3, daysMax)).toThrow(RangeError);
    expect(() => window("2026-11-10", -1, null)).toThrow(RangeError);
  });
});

describe("la ventana de un cobro guardado: depositWindowOf", () => {
  test("sin «desde», la ventana es de un solo día: la fecha estimada", () => {
    expect(depositWindowOf({ estimatedDepositFrom: null, estimatedDepositOn: "2026-11-18" })).toEqual({
      from: "2026-11-18",
      to: "2026-11-18",
    });
  });

  test("con «desde», de ahí a la fecha estimada (la más tardía)", () => {
    expect(depositWindowOf({ estimatedDepositFrom: "2026-11-16", estimatedDepositOn: "2026-11-18" })).toEqual({
      from: "2026-11-16",
      to: "2026-11-18",
    });
  });

  test("sin fecha estimada no hay ventana", () => {
    expect(depositWindowOf({ estimatedDepositFrom: null, estimatedDepositOn: null })).toBeNull();
  });
});

describe("textos de una ventana", () => {
  test("windowDayLabels: las dos puntas sin repetir lo que comparten, o un solo día", () => {
    expect(windowDayLabels({ from: "2026-11-16", to: "2026-11-18" })).toEqual(["lun 16", "mié 18 nov"]);
    expect(windowDayLabels({ from: "2026-11-18", to: "2026-11-18" })).toEqual(["mié 18 nov"]);
    expect(windowDayLabels({ from: "2026-11-30", to: "2026-12-02" })).toEqual(["lun 30 nov", "mié 2 dic"]);
    expect(windowDayLabels({ from: "2026-12-29", to: "2027-01-04" })).toEqual(["mar 29 dic 2026", "lun 4 ene 2027"]);
  });

  test("formatWindowShort: la ventana corta para listas", () => {
    expect(formatWindowShort({ from: "2026-11-16", to: "2026-11-18" })).toBe("16–18 nov");
    expect(formatWindowShort({ from: "2026-11-18", to: "2026-11-18" })).toBe("18 nov");
    expect(formatWindowShort({ from: "2026-11-30", to: "2026-12-02" })).toBe("30 nov – 2 dic");
    expect(formatWindowShort({ from: "2026-12-29", to: "2027-01-04" })).toBe("29 dic 2026 – 4 ene 2027");
  });

  test("una ventana al revés o con una fecha que no existe es un error", () => {
    for (const format of [windowDayLabels, formatWindowShort]) {
      expect(() => format({ from: "2026-11-18", to: "2026-11-16" })).toThrow(RangeError);
      expect(() => format({ from: "2026-02-30", to: "2026-03-02" })).toThrow(RangeError);
      expect(() => format({ from: "2026-11-16", to: "2026-11-31" })).toThrow(RangeError);
    }
  });
});

describe("estimateDepositDate", () => {
  test("0 días es el mismo día aunque sea feriado, hábiles o corridos", () => {
    expect(estimateDepositDate({ occurredOn: "2026-11-26", days: 0, dayType: "habiles", holidays: H })).toBe(
      "2026-11-26",
    );
    expect(estimateDepositDate({ occurredOn: "2026-11-26", days: 0, dayType: "corridos", holidays: H })).toBe(
      "2026-11-26",
    );
  });

  test("hábiles: desde un sábado, el primer día hábil es el lunes", () => {
    expect(estimateDepositDate({ occurredOn: "2026-11-14", days: 1, dayType: "habiles", holidays: H })).toBe(
      "2026-11-16",
    );
  });

  test("hábiles: el viernes anterior a un feriado en sábado sí cuenta", () => {
    expect(estimateDepositDate({ occurredOn: "2026-07-02", days: 1, dayType: "habiles", holidays: H })).toBe(
      "2026-07-03",
    );
  });

  test("hábiles: salta feriados y fines de semana seguidos, también al cruzar el año", () => {
    const dosAnios = new Set([...H, ...usBankHolidays(2027).map((h) => h.day)]);
    expect(estimateDepositDate({ occurredOn: "2026-12-24", days: 5, dayType: "habiles", holidays: dosAnios })).toBe(
      "2027-01-04",
    );
  });

  test("hábiles: sin feriados cargados solo se saltan sábados y domingos", () => {
    expect(estimateDepositDate({ occurredOn: "2026-11-25", days: 2, dayType: "habiles", holidays: new Set() })).toBe(
      "2026-11-27",
    );
  });

  test("corridos: es suma de calendario y puede caer en feriado o domingo", () => {
    expect(estimateDepositDate({ occurredOn: "2026-11-25", days: 1, dayType: "corridos", holidays: H })).toBe(
      "2026-11-26",
    );
    expect(estimateDepositDate({ occurredOn: "2026-11-13", days: 2, dayType: "corridos", holidays: H })).toBe(
      "2026-11-15",
    );
  });

  test("los días tienen que ser un entero mayor o igual que cero", () => {
    for (const days of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      for (const dayType of ["habiles", "corridos"] as const) {
        expect(() => estimateDepositDate({ occurredOn: "2026-11-13", days, dayType, holidays: H })).toThrow(RangeError);
      }
    }
  });

  test("una fecha de partida que no existe es un error, también con 0 días", () => {
    for (const days of [0, 2]) {
      for (const dayType of ["habiles", "corridos"] as const) {
        expect(() => estimateDepositDate({ occurredOn: "2026-02-30", days, dayType, holidays: H })).toThrow(RangeError);
      }
    }
  });
});

describe("isISODate", () => {
  test("acepta fechas de calendario AAAA-MM-DD que existen", () => {
    expect(isISODate("2026-11-13")).toBe(true);
    expect(isISODate("2028-02-29")).toBe(true);
    expect(isISODate("2000-01-01")).toBe(true);
  });

  test("rechaza lo que no es texto, otros formatos y días que no existen", () => {
    for (const x of [
      null,
      undefined,
      20261113,
      new Date(0),
      "",
      "2026-11-13T10:30",
      "2026-1-3",
      "13/11/2026",
      " 2026-11-13",
      "2026-11-13\n",
      "2026-02-29",
      "2026-02-30",
      "2026-13-01",
      "2026-00-10",
      "2026-11-00",
      "2026-11-31",
    ]) {
      expect(isISODate(x)).toBe(false);
    }
  });
});

describe("nyDate y todayNY", () => {
  test("la zona es America/New_York", () => expect(ZONE).toBe("America/New_York"));

  test("acepta un instante como texto ISO con zona o como Date", () => {
    expect(nyDate("2026-11-14T05:00:00.000Z")).toBe("2026-11-14");
    expect(nyDate("2026-11-14T04:59:59.999Z")).toBe("2026-11-13");
    expect(nyDate("2026-11-14T03:30:00+00:00")).toBe("2026-11-13");
    expect(nyDate("2026-11-13T23:30:00-05:00")).toBe("2026-11-13");
    expect(nyDate("2026-11-14T05:30:00+02")).toBe("2026-11-13");
    expect(nyDate(new Date("2026-11-14T03:30:00Z"))).toBe("2026-11-13");
  });

  test("en verano Nueva York va cuatro horas detrás de UTC", () => {
    expect(nyDate("2026-07-04T03:59:59Z")).toBe("2026-07-03");
    expect(nyDate("2026-07-04T04:00:00Z")).toBe("2026-07-04");
  });

  test("un texto sin zona no es un instante: es un error (no se adivina la zona)", () => {
    for (const x of ["2026-11-13", "2026-11-13T22:30", "2026-11-13T22:30:00", "ayer", "", "2026-13-40T10:00:00Z"]) {
      expect(() => nyDate(x)).toThrow(RangeError);
    }
    expect(() => nyDate(new Date(Number.NaN))).toThrow(RangeError);
  });

  test("todayNY: «hoy» sale del reloj que le pasan", () => {
    expect(todayNY(new Date("2026-11-10T04:30:00Z"))).toBe("2026-11-09");
    expect(todayNY(new Date("2026-11-10T05:00:00Z"))).toBe("2026-11-10");
  });
});

describe("addDays y daysBetween", () => {
  test("suma y resta cruzando meses, años y bisiestos", () => {
    expect(addDays("2026-11-13", 0)).toBe("2026-11-13");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2027-01-01", -1)).toBe("2026-12-31");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(addDays("2026-11-09", -364)).toBe("2025-11-10");
  });

  test("addDays: solo días enteros sobre una fecha que existe", () => {
    expect(() => addDays("2026-11-13", 0.5)).toThrow(RangeError);
    expect(() => addDays("2026-11-13", Number.NaN)).toThrow(RangeError);
    expect(() => addDays("2026-02-30", 1)).toThrow(RangeError);
    expect(() => addDays("2026-11-13T10:30", 1)).toThrow(RangeError);
  });

  test("daysBetween: días de calendario, con signo", () => {
    expect(daysBetween("2026-11-13", "2026-11-13")).toBe(0);
    expect(daysBetween("2026-11-13", "2026-11-17")).toBe(4);
    expect(daysBetween("2026-11-17", "2026-11-13")).toBe(-4);
    expect(daysBetween("2026-10-31", "2026-11-02")).toBe(2);
    expect(daysBetween("2026-01-01", "2027-01-01")).toBe(365);
    expect(daysBetween("2028-01-01", "2029-01-01")).toBe(366);
  });

  test("daysBetween: las dos fechas tienen que existir", () => {
    expect(() => daysBetween("2026-02-30", "2026-03-01")).toThrow(RangeError);
    expect(() => daysBetween("2026-03-01", "mañana")).toThrow(RangeError);
  });
});

describe("isBusinessDay", () => {
  test("de lunes a viernes sí; sábado, domingo y feriado no", () => {
    expect(isBusinessDay("2026-11-09", H)).toBe(true); // lunes
    expect(isBusinessDay("2026-11-13", H)).toBe(true); // viernes
    expect(isBusinessDay("2026-11-14", H)).toBe(false); // sábado
    expect(isBusinessDay("2026-11-15", H)).toBe(false); // domingo
    expect(isBusinessDay("2026-11-26", H)).toBe(false); // Acción de Gracias (jueves)
    expect(isBusinessDay("2026-11-26", new Set())).toBe(true);
  });

  test("el viernes anterior a un feriado en sábado es hábil", () => {
    expect(isBusinessDay("2026-07-03", H)).toBe(true);
    expect(isBusinessDay("2026-07-04", H)).toBe(false);
  });

  test("una fecha que no existe es un error", () => {
    expect(() => isBusinessDay("2026-02-30", H)).toThrow(RangeError);
  });
});

describe("localInputToInstant e instantToLocalInput", () => {
  test("la hora del formulario es la de Nueva York, en invierno y en verano", () => {
    expect(localInputToInstant("2026-11-13T10:30")).toBe("2026-11-13T15:30:00.000Z");
    expect(localInputToInstant("2026-07-01T12:05")).toBe("2026-07-01T16:05:00.000Z");
    expect(localInputToInstant("2026-12-31T23:59")).toBe("2027-01-01T04:59:00.000Z");
  });

  test("una hora que no existe por el cambio de horario se resuelve hacia adelante", () => {
    // El 8/3/2026 a las 02:00 el reloj salta a las 03:00: las 02:30 son las 03:30 EDT.
    expect(localInputToInstant("2026-03-08T02:30")).toBe("2026-03-08T07:30:00.000Z");
    expect(instantToLocalInput("2026-03-08T07:30:00.000Z")).toBe("2026-03-08T03:30");
  });

  test("una hora ambigua por el cambio de horario toma la primera (EDT)", () => {
    // El 1/11/2026 la 01:30 ocurre dos veces: primero en EDT (05:30Z) y una hora después en EST (06:30Z).
    expect(localInputToInstant("2026-11-01T01:30")).toBe("2026-11-01T05:30:00.000Z");
    expect(instantToLocalInput("2026-11-01T05:30:00.000Z")).toBe("2026-11-01T01:30");
    expect(instantToLocalInput("2026-11-01T06:30:00.000Z")).toBe("2026-11-01T01:30");
  });

  describe("no depende del reloj de la máquina", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    // Luxon, al leer una hora local ambigua, elige según el horario que rija «ahora»: en verano la primera y en
    // invierno la segunda. El motor no puede dar un instante distinto según el día en que se ejecute.
    test.each(["2026-07-01T12:00:00Z", "2026-12-01T12:00:00Z"])("con el reloj en %s", (now) => {
      vi.useFakeTimers({ now: new Date(now) });
      expect(localInputToInstant("2026-11-01T01:30")).toBe("2026-11-01T05:30:00.000Z");
      expect(localInputToInstant("2026-03-08T02:30")).toBe("2026-03-08T07:30:00.000Z");
      expect(localInputToInstant("2026-11-13T22:30")).toBe("2026-11-14T03:30:00.000Z");
      expect(localInputToInstant("2026-07-01T12:05")).toBe("2026-07-01T16:05:00.000Z");
    });
  });

  test("alrededor de los dos cambios de horario, minuto a minuto", () => {
    // Marzo: 01:59 EST → (02:00–02:59 no existen) → 03:00 EDT.
    expect(localInputToInstant("2026-03-08T01:59")).toBe("2026-03-08T06:59:00.000Z");
    expect(localInputToInstant("2026-03-08T02:00")).toBe("2026-03-08T07:00:00.000Z");
    expect(localInputToInstant("2026-03-08T02:59")).toBe("2026-03-08T07:59:00.000Z");
    expect(localInputToInstant("2026-03-08T03:00")).toBe("2026-03-08T07:00:00.000Z");
    // Noviembre: 00:59 EDT → 01:00–01:59 ocurren dos veces (gana EDT) → 02:00 EST.
    expect(localInputToInstant("2026-11-01T00:59")).toBe("2026-11-01T04:59:00.000Z");
    expect(localInputToInstant("2026-11-01T01:00")).toBe("2026-11-01T05:00:00.000Z");
    expect(localInputToInstant("2026-11-01T01:59")).toBe("2026-11-01T05:59:00.000Z");
    expect(localInputToInstant("2026-11-01T02:00")).toBe("2026-11-01T07:00:00.000Z");
  });

  test("ida y vuelta de cada media hora de 2026: solo la hora repetida de noviembre vuelve a su primera vez", () => {
    const HALF_HOUR = 30 * 60_000;
    const repeatedFrom = Date.parse("2026-11-01T06:00:00Z"); // la segunda 01:00 (EST)
    const repeatedTo = Date.parse("2026-11-01T07:00:00Z");
    const wrong: string[] = [];
    for (let ms = Date.parse("2026-01-01T00:00:00Z"); ms < Date.parse("2027-01-01T00:00:00Z"); ms += HALF_HOUR) {
      const expected = ms >= repeatedFrom && ms < repeatedTo ? ms - 2 * HALF_HOUR : ms;
      const instant = new Date(ms).toISOString();
      const back = localInputToInstant(instantToLocalInput(instant));
      if (back !== new Date(expected).toISOString()) wrong.push(`${instant} → ${back}`);
    }
    expect(wrong).toEqual([]);
  });

  test("instantToLocalInput es la inversa", () => {
    expect(instantToLocalInput("2026-11-14T03:30:00.000Z")).toBe("2026-11-13T22:30");
    expect(instantToLocalInput("2026-07-01T16:05:00+00:00")).toBe("2026-07-01T12:05");
    const locals = ["2026-01-01T00:00", "2026-03-08T01:59", "2026-03-08T03:00", "2026-07-04T09:05", "2026-11-01T02:00"];
    for (const local of locals) {
      expect(instantToLocalInput(localInputToInstant(local))).toBe(local);
    }
  });

  test("localInputToInstant: una entrada mal formada es un error", () => {
    for (const x of [
      "",
      "2026-11-13",
      "2026-11-13 10:30",
      "2026-11-13T10:30:00",
      "2026-11-13T10:30Z",
      "2026-11-13T24:00",
      "2026-11-13T10:60",
      "2026-02-30T10:30",
      "2026-13-01T10:30",
      "12026-11-13T10:30",
      "hoy",
    ]) {
      expect(() => localInputToInstant(x)).toThrow(RangeError);
    }
  });

  test("instantToLocalInput: lo que no es un instante es un error", () => {
    for (const x of ["", "2026-11-13T22:30", "no es una fecha"]) {
      expect(() => instantToLocalInput(x)).toThrow(RangeError);
    }
  });
});

describe("periodRange", () => {
  const HOY = "2026-11-09";

  test("este_mes: del día 1 a hoy", () => {
    expect(periodRange("este_mes", HOY)).toEqual({ from: "2026-11-01", to: "2026-11-09" });
    expect(periodRange("este_mes", "2026-11-01")).toEqual({ from: "2026-11-01", to: "2026-11-01" });
  });

  test("mes_anterior: el mes anterior completo", () => {
    expect(periodRange("mes_anterior", HOY)).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(periodRange("mes_anterior", "2026-01-15")).toEqual({ from: "2025-12-01", to: "2025-12-31" });
    expect(periodRange("mes_anterior", "2028-03-31")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
  });

  test("30d, 90d y 365d cuentan a hoy", () => {
    expect(periodRange("30d", HOY)).toEqual({ from: "2026-10-11", to: HOY });
    expect(daysBetween(periodRange("30d", HOY).from, HOY)).toBe(29);
    expect(periodRange("90d", HOY)).toEqual({ from: "2026-08-12", to: HOY });
    expect(periodRange("365d", HOY)).toEqual({ from: "2025-11-10", to: HOY });
  });

  test("este_anio: del 1 de enero a hoy", () => {
    expect(periodRange("este_anio", HOY)).toEqual({ from: "2026-01-01", to: HOY });
  });

  test("personalizado con las dos fechas: esas, intercambiadas si vienen al revés", () => {
    expect(periodRange("personalizado", HOY, { from: "2026-02-01", to: "2026-03-15" })).toEqual({
      from: "2026-02-01",
      to: "2026-03-15",
    });
    expect(periodRange("personalizado", HOY, { from: "2026-03-15", to: "2026-02-01" })).toEqual({
      from: "2026-02-01",
      to: "2026-03-15",
    });
    expect(periodRange("personalizado", HOY, { from: "2027-05-05", to: "2027-05-05" })).toEqual({
      from: "2027-05-05",
      to: "2027-05-05",
    });
  });

  test("personalizado solo con «desde»: hasta hoy (o ese mismo día si es posterior a hoy)", () => {
    expect(periodRange("personalizado", HOY, { from: "2026-09-15" })).toEqual({ from: "2026-09-15", to: HOY });
    expect(periodRange("personalizado", HOY, { from: HOY, to: null })).toEqual({ from: HOY, to: HOY });
    expect(periodRange("personalizado", HOY, { from: "2026-12-01", to: null })).toEqual({
      from: "2026-12-01",
      to: "2026-12-01",
    });
  });

  test("personalizado solo con «hasta»: desde el día 1 de ese mes", () => {
    expect(periodRange("personalizado", HOY, { to: "2026-08-20" })).toEqual({ from: "2026-08-01", to: "2026-08-20" });
    expect(periodRange("personalizado", HOY, { from: null, to: "2027-02-10" })).toEqual({
      from: "2027-02-01",
      to: "2027-02-10",
    });
  });

  test("personalizado sin fechas es este_mes", () => {
    const esteMes = periodRange("este_mes", HOY);
    expect(periodRange("personalizado", HOY)).toEqual(esteMes);
    expect(periodRange("personalizado", HOY, {})).toEqual(esteMes);
    expect(periodRange("personalizado", HOY, { from: null, to: null })).toEqual(esteMes);
  });

  test("las fechas personalizadas solo cuentan en «personalizado»", () => {
    expect(periodRange("30d", HOY, { from: "2020-01-01", to: "2020-12-31" })).toEqual({ from: "2026-10-11", to: HOY });
  });

  test("fechas que no existen o un período desconocido son un error", () => {
    expect(() => periodRange("este_mes", "2026-02-30")).toThrow(RangeError);
    expect(() => periodRange("personalizado", HOY, { from: "2026-02-30" })).toThrow(RangeError);
    expect(() => periodRange("personalizado", HOY, { to: "ayer" })).toThrow(RangeError);
    expect(() => periodRange("siempre" as PeriodPreset, HOY)).toThrow(RangeError);
  });
});

describe("textos en español con tablas propias", () => {
  test("monthKey", () => {
    expect(monthKey("2026-11-13")).toBe("2026-11");
    expect(monthKey("2027-01-01")).toBe("2027-01");
    expect(() => monthKey("2026-11")).toThrow(RangeError);
  });

  test("monthLabel: los doce meses", () => {
    expect(monthLabel("2026-11")).toBe("nov 2026");
    const year = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"];
    expect(year.map((month) => monthLabel(`2027-${month}`))).toEqual([
      "ene 2027",
      "feb 2027",
      "mar 2027",
      "abr 2027",
      "may 2027",
      "jun 2027",
      "jul 2027",
      "ago 2027",
      "sep 2027",
      "oct 2027",
      "nov 2027",
      "dic 2027",
    ]);
  });

  test("monthLabel: una clave que no es AAAA-MM es un error", () => {
    for (const key of ["2026-13", "2026-00", "2026-1", "2026-11-13", "nov 2026", ""]) {
      expect(() => monthLabel(key)).toThrow(RangeError);
    }
  });

  test("formatDate: los siete días de la semana", () => {
    expect(formatDate("2026-11-13")).toBe("vie 13 nov 2026");
    expect(
      ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"].map(formatDate),
    ).toEqual([
      "lun 9 nov 2026",
      "mar 10 nov 2026",
      "mié 11 nov 2026",
      "jue 12 nov 2026",
      "vie 13 nov 2026",
      "sáb 14 nov 2026",
      "dom 15 nov 2026",
    ]);
    expect(formatDate("2027-01-01")).toBe("vie 1 ene 2027");
    expect(() => formatDate("2026-02-30")).toThrow(RangeError);
  });

  test("formatDateTime: fecha y hora de Nueva York, en 24 horas", () => {
    expect(formatDateTime("2026-11-13T15:30:00Z")).toBe("vie 13 nov 2026, 10:30");
    expect(formatDateTime("2026-11-14T03:30:00Z")).toBe("vie 13 nov 2026, 22:30");
    expect(formatDateTime("2026-07-04T04:05:00Z")).toBe("sáb 4 jul 2026, 00:05");
    expect(formatDateTime("2026-07-04T13:07:00+00:00")).toBe("sáb 4 jul 2026, 09:07");
    expect(() => formatDateTime("2026-11-13 15:30")).toThrow(RangeError);
  });
});

describe("wallTimeToInstant: la hora de pared de cualquier zona IANA, con o sin segundos", () => {
  test("Los Ángeles en invierno y en verano; los segundos se conservan", () => {
    expect(wallTimeToInstant("2026-11-13T22:30:15", "America/Los_Angeles")).toBe("2026-11-14T06:30:15.000Z");
    expect(wallTimeToInstant("2026-07-01T12:00", "America/Los_Angeles")).toBe("2026-07-01T19:00:00.000Z");
  });

  test("otras zonas: UTC y Madrid (que cambia de horario en otras fechas)", () => {
    expect(wallTimeToInstant("2026-11-13T10:30:00", "UTC")).toBe("2026-11-13T10:30:00.000Z");
    expect(wallTimeToInstant("2026-07-01T12:00:00", "Europe/Madrid")).toBe("2026-07-01T10:00:00.000Z");
    expect(wallTimeToInstant("2026-03-29T02:30:00", "Europe/Madrid")).toBe("2026-03-29T01:30:00.000Z");
  });

  test("los dos cambios de horario de 2026 en Los Ángeles: hacia adelante y la primera vez", () => {
    // 8 de marzo: 02:00–02:59 no existen (02:30 → 03:30 PDT). 1 de noviembre: 01:00–01:59 ocurren dos veces (PDT).
    expect(wallTimeToInstant("2026-03-08T02:30:00", "America/Los_Angeles")).toBe("2026-03-08T10:30:00.000Z");
    expect(wallTimeToInstant("2026-11-01T01:30:00", "America/Los_Angeles")).toBe("2026-11-01T08:30:00.000Z");
    expect(wallTimeToInstant("2026-11-01T02:00:00", "America/Los_Angeles")).toBe("2026-11-01T10:00:00.000Z");
  });

  test("con Nueva York da lo mismo que localInputToInstant", () => {
    for (const local of ["2026-03-08T02:30", "2026-11-01T01:30", "2026-11-13T22:30", "2026-07-01T12:05"]) {
      expect(wallTimeToInstant(local, ZONE)).toBe(localInputToInstant(local));
    }
  });

  describe("no depende del reloj de la máquina", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    test.each(["2026-07-01T12:00:00Z", "2026-12-01T12:00:00Z"])("con el reloj en %s", (now) => {
      vi.useFakeTimers({ now: new Date(now) });
      expect(wallTimeToInstant("2026-11-01T01:30:00", "America/Los_Angeles")).toBe("2026-11-01T08:30:00.000Z");
      expect(wallTimeToInstant("2026-03-08T02:30:00", "America/Los_Angeles")).toBe("2026-03-08T10:30:00.000Z");
    });
  });

  test("una hora mal formada o una zona que no existe es un error", () => {
    for (const x of ["", "2026-11-13", "2026-11-13 10:30", "2026-11-13T10:30Z", "2026-11-13T10:30:60", "2026-02-30T10:30"]) {
      expect(() => wallTimeToInstant(x, "UTC")).toThrow(RangeError);
    }
    expect(() => wallTimeToInstant("2026-11-13T10:30", "Marte/Olympus")).toThrow(RangeError);
    expect(() => wallTimeToInstant("2026-11-13T10:30", "")).toThrow(RangeError);
  });
});
