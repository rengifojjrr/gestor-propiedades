import { describe, expect, test } from "vitest";
import { SPLIT_MAX, splitLine, tooManyForSplitText } from "./splitText";

const party = (owed: string) => ({ owed });

describe("la línea de una moneda con el reparto del filtro plegado", () => {
  test("«Falta pagar $X a N partes»: la suma de lo que falta a quienes les falta algo", () => {
    expect(splitLine([party("630.75"), party("504.60"), party("0.00")], "USD")).toBe(
      "Falta pagar $1.135,35 a 2 partes",
    );
    expect(splitLine([party("76.15")], "USD")).toBe("Falta pagar $76,15 a 1 parte");
  });

  test("«Todo pagado» si a nadie le falta nada", () => {
    expect(splitLine([party("0.00"), party("0.00")], "USD")).toBe("Todo pagado");
  });

  test("a quien se le pagó de más no resta de lo que falta a los demás: se dice aparte", () => {
    expect(splitLine([party("100.00"), party("-50.00")], "USD")).toBe(
      "Falta pagar $100,00 a 1 parte · a 1 se le pagó de más",
    );
    expect(splitLine([party("0.00"), party("-50.00"), party("-1.00")], "USD")).toBe(
      "Todo pagado · a 2 se les pagó de más",
    );
  });

  test("sin partes (solo adelantos de la retención)", () => {
    expect(splitLine([], "USD")).toBe("Sin partes del reparto");
  });
});

describe("con demasiados cobros", () => {
  test("dice cuántos son, hasta cuántos se suma (5000) y que hay que acotar el filtro", () => {
    expect(SPLIT_MAX).toBe(5000);
    expect(tooManyForSplitText(6234)).toBe(
      "Son 6234 cobros: el reparto se suma con hasta 5000. Acota el filtro (por ejemplo, por fechas) para verlo.",
    );
  });
});
