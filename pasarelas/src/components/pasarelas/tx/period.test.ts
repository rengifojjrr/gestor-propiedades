import { describe, expect, test } from "vitest";
import { looksAhead } from "@/lib/pasarelas/dates";
import { basisChanges, periodChangesOf, periodOptions, shownPeriod } from "./period";

describe("el período de Cobros: de la venta o del depósito", () => {
  test("con la venta: ayer y hoy, y los de siempre; mañana y los próximos 7 días no salen", () => {
    expect(periodOptions(false).map((option) => option.label)).toEqual([
      "Ayer",
      "Hoy",
      "Este mes",
      "El mes anterior",
      "Últimos 30 días",
      "Últimos 90 días",
      "Últimos 365 días",
      "Este año",
      "Elegir fechas",
    ]);
  });

  test("con el depósito salen también mañana y los próximos 7 días, en su orden", () => {
    expect(periodOptions(true).map((option) => [option.value, option.label]).slice(0, 5)).toEqual([
      ["ayer", "Ayer"],
      ["hoy", "Hoy"],
      ["manana", "Mañana"],
      ["proximos_7d", "Próximos 7 días"],
      ["este_mes", "Este mes"],
    ]);
    expect(periodOptions(true)).toHaveLength(11);
  });

  test("los que solo salen con el depósito son los que miran adelante: la regla del motor (`looksAhead`)", () => {
    const withSale = new Set(periodOptions(false).map((option) => option.value));
    const onlyByDeposit = periodOptions(true)
      .map((option) => option.value)
      .filter((value) => !withSale.has(value));
    expect(onlyByDeposit).toEqual(["manana", "proximos_7d"]);
    expect(periodOptions(true).filter((option) => looksAhead(option.value)).map((option) => option.value)).toEqual(
      onlyByDeposit,
    );
  });

  test("el período que se ve: el de la URL si vale con esas fechas; si no, «Este mes», como lo lee el servidor", () => {
    expect(shownPeriod(null, false)).toBe("este_mes");
    expect(shownPeriod("hoy", false)).toBe("hoy");
    expect(shownPeriod("manana", true)).toBe("manana");
    expect(shownPeriod("manana", false)).toBe("este_mes");
    expect(shownPeriod("proximos_7d", false)).toBe("este_mes");
    expect(shownPeriod("siempre", true)).toBe("este_mes");
    expect(shownPeriod("personalizado", false)).toBe("personalizado");
  });

  test("elegir de qué son las fechas: el depósito lo pone en la URL; la venta lo quita", () => {
    expect(basisChanges(true, "este_mes")).toEqual({ fechas: "deposito" });
    expect(basisChanges(false, "hoy")).toEqual({ fechas: null });
    expect(basisChanges(false, "personalizado")).toEqual({ fechas: null });
  });

  test("volver a la venta con mañana o los próximos 7 días deja «Este mes»", () => {
    expect(basisChanges(false, "manana")).toEqual({ fechas: null, periodo: "este_mes" });
    expect(basisChanges(false, "proximos_7d")).toEqual({ fechas: null, periodo: "este_mes" });
  });

  test("elegir un período: los fijos borran las fechas elegidas a mano; «Elegir fechas» las conserva", () => {
    expect(periodChangesOf("manana")).toEqual({ periodo: "manana", desde: null, hasta: null });
    expect(periodChangesOf("personalizado")).toEqual({ periodo: "personalizado" });
  });
});
