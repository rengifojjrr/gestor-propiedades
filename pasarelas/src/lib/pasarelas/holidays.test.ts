import { describe, expect, test } from "vitest";
import { usBankHolidays } from "./holidays";

const days = (year: number) => usBankHolidays(year).map((h) => h.day);
const weekday = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay(); // 0 = domingo

describe("usBankHolidays", () => {
  test("2026: los once feriados bancarios, en orden", () => {
    expect(days(2026)).toEqual([
      "2026-01-01",
      "2026-01-19",
      "2026-02-16",
      "2026-05-25",
      "2026-06-19",
      "2026-07-04",
      "2026-09-07",
      "2026-10-12",
      "2026-11-11",
      "2026-11-26",
      "2026-12-25",
    ]);
  });

  test("2027: los once feriados bancarios, en orden", () => {
    expect(days(2027)).toEqual([
      "2027-01-01",
      "2027-01-18",
      "2027-02-15",
      "2027-05-31",
      "2027-06-19",
      "2027-07-05",
      "2027-09-06",
      "2027-10-11",
      "2027-11-11",
      "2027-11-25",
      "2027-12-25",
    ]);
  });

  test("2028: Año Nuevo y Veteranos caen en sábado y se quedan en su fecha", () => {
    expect(days(2028)).toEqual([
      "2028-01-01",
      "2028-01-17",
      "2028-02-21",
      "2028-05-29",
      "2028-06-19",
      "2028-07-04",
      "2028-09-04",
      "2028-10-09",
      "2028-11-11",
      "2028-11-23",
      "2028-12-25",
    ]);
  });

  test("los nombres van en español", () => {
    expect(usBankHolidays(2026).map((h) => h.name)).toEqual([
      "Año Nuevo",
      "Día de Martin Luther King Jr.",
      "Día de los Presidentes",
      "Día de los Caídos",
      "Juneteenth",
      "Día de la Independencia",
      "Día del Trabajo",
      "Día de Colón",
      "Día de los Veteranos",
      "Acción de Gracias",
      "Navidad",
    ]);
  });

  test("en sábado se queda en su fecha y el viernes anterior no es feriado", () => {
    expect(weekday("2026-07-04")).toBe(6);
    expect(usBankHolidays(2026)).toContainEqual({ day: "2026-07-04", name: "Día de la Independencia" });
    expect(days(2026)).not.toContain("2026-07-03");
  });

  test("en domingo pasa al lunes siguiente, con «(observado)» en el nombre", () => {
    expect(usBankHolidays(2027)).toContainEqual({ day: "2027-07-05", name: "Día de la Independencia (observado)" });
    expect(days(2027)).not.toContain("2027-07-04");
    expect(usBankHolidays(2023)).toContainEqual({ day: "2023-01-02", name: "Año Nuevo (observado)" });
    expect(usBankHolidays(2022)).toContainEqual({ day: "2022-06-20", name: "Juneteenth (observado)" });
    expect(usBankHolidays(2018)).toContainEqual({ day: "2018-11-12", name: "Día de los Veteranos (observado)" });
    expect(usBankHolidays(2022)).toContainEqual({ day: "2022-12-26", name: "Navidad (observado)" });
  });

  test("cualquier año: once días distintos, en orden, dentro del año y nunca en domingo", () => {
    for (let year = 1900; year <= 2200; year += 1) {
      const list = days(year);
      expect(list).toHaveLength(11);
      expect([...new Set(list)].sort()).toEqual(list);
      expect(list.every((day) => day.startsWith(`${year}-`))).toBe(true);
      expect(list.some((day) => weekday(day) === 0)).toBe(false);
      // Los feriados «de lunes» caen en lunes y Acción de Gracias en jueves.
      expect([1, 2, 3, 6, 7].map((i) => weekday(list[i] as string))).toEqual([1, 1, 1, 1, 1]);
      expect(weekday(list[9] as string)).toBe(4);
    }
  });

  test("un año fuera de 1900–2200 o no entero es un error", () => {
    for (const year of [1899, 2201, 2026.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => usBankHolidays(year)).toThrow(RangeError);
    }
  });
});
