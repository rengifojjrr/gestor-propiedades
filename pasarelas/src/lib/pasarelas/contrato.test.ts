import { describe, expect, it } from "vitest";
import type { Breakdown, Money } from "./types";

// Prueba mínima del arranque: confirma que Vitest corre y que el contrato de tipos compila.
// Las tareas 3 a 6 traen las pruebas reales del motor.
describe("contrato del motor", () => {
  it("el desglose congelado es la versión 1 y el dinero viaja como texto", () => {
    const cero: Money = "0.00";
    const version: Breakdown["v"] = 1;
    expect(typeof cero).toBe("string");
    expect(version).toBe(1);
  });
});
