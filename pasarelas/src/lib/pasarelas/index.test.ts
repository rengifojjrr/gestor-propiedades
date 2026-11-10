import { describe, expect, test } from "vitest";
import * as allocate from "./allocate";
import * as breakdown from "./breakdown";
import * as csv from "./csv";
import * as dates from "./dates";
import * as decimal from "./decimal";
import * as guards from "./guards";
import * as holidays from "./holidays";
import * as motor from "./index";
import * as money from "./money";
import * as rules from "./rules";
import * as schemes from "./schemes";
import * as stats from "./stats";
import * as status from "./status";
import * as versions from "./versions";
import * as write from "./write";

// `types.ts` solo declara tipos: no deja nada en tiempo de ejecución que comprobar aquí (lo cubre el typecheck).
const MODULOS = {
  allocate, breakdown, csv, dates, decimal, guards, holidays, money, rules, schemes, stats, status, versions, write,
};

describe("index: la puerta única del motor", () => {
  test.each(Object.entries(MODULOS))("reexporta todo lo de %s", (_nombre, modulo) => {
    const exportado: Record<string, unknown> = motor;
    for (const [nombre, valor] of Object.entries(modulo)) {
      expect(exportado[nombre], nombre).toBe(valor);
    }
  });

  test("ningún nombre se repite entre módulos (un nombre repetido desaparecería de la puerta)", () => {
    const nombres = Object.values(MODULOS).flatMap((modulo) => Object.keys(modulo));
    const repetidos = nombres.filter((nombre, i) => nombres.indexOf(nombre) !== i);
    expect(repetidos).toEqual([]);
  });
});
