import { describe, expect, test } from "vitest";
import { pickVersion } from "./versions";

const HOY = "2026-11-09";
const MANANA = "2026-11-10";

const inicial = { id: "tarifa-inicial", effectiveFrom: "2000-01-01", pct: "2.9" };
const deManana = { id: "tarifa-de-manana", effectiveFrom: MANANA, pct: "3.4" };

describe("pickVersion", () => {
  test("una tarifa «vigente desde mañana» no se elige para un cobro de hoy", () => {
    expect(pickVersion([inicial, deManana], HOY)).toBe(inicial);
  });

  test("para un cobro de mañana, sí", () => {
    expect(pickVersion([inicial, deManana], MANANA)).toBe(deManana);
    expect(pickVersion([inicial, deManana], "2027-01-01")).toBe(deManana);
  });

  test("el orden de la lista no importa: gana la más reciente que ya rige", () => {
    const intermedia = { id: "tarifa-intermedia", effectiveFrom: "2026-06-01", pct: "3.1" };
    expect(pickVersion([deManana, intermedia, inicial], HOY)).toBe(intermedia);
    expect(pickVersion([intermedia, inicial, deManana], "2026-05-31")).toBe(inicial);
  });

  test("si ninguna rige todavía, la más antigua", () => {
    const a = { effectiveFrom: "2026-03-01" };
    const b = { effectiveFrom: "2026-02-01" };
    const c = { effectiveFrom: "2026-04-01" };
    expect(pickVersion([a, b, c], "2026-01-15")).toBe(b);
  });

  test("lista vacía: null", () => {
    expect(pickVersion([], HOY)).toBeNull();
  });
});
