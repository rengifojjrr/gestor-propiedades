import { describe, expect, test } from "vitest";
import { allowedActions, type AllowedInput } from "./allowed";
import { STATUS_CHANGE_LABEL, statusChanges, statusMenuSubject, type StatusChange } from "./statusChanges";

/*
 * El menú de estado de cada cobro de la lista ofrece solo los cambios de estado que el motor admite. La fuente es
 * `allowedActions` (la misma del detalle, que `allowed.test.ts` compara con los planes del motor estado por estado):
 * aquí se comprueba qué opciones salen en cada estado, en qué orden y con qué texto.
 */

/** Un cobro de 100,00 recién registrado: lo que `allowedActions` mira de él. */
const registrado: AllowedInput = {
  status: "registrado",
  disputeState: null,
  refunded: "0.00",
  grossOriginal: "100.00",
  deletedAt: null,
  estimatedIsManual: false,
};

/** Cada estado al que llegan los planes del motor, como lo ve `allowedActions`. */
const STATES: Record<string, AllowedInput> = {
  registrado,
  "en tránsito": { ...registrado, status: "en_transito" },
  depositado: { ...registrado, status: "depositado" },
  fallido: { ...registrado, status: "fallido" },
  "con la disputa abierta": { ...registrado, disputeState: "abierta" },
  "reembolsado del todo": { ...registrado, refunded: "100.00" },
  "en la papelera": { ...registrado, deletedAt: "2026-11-20T12:00:00Z" },
};

describe("statusChanges: qué opciones salen en cada estado", () => {
  test.each<[string, StatusChange[]]>([
    ["registrado", ["en_transito", "depositado", "fallido"]],
    ["en tránsito", ["depositado", "fallido"]],
    // Ya depositado, «Marcar depositado» solo cambiaría la fecha: eso no es un cambio de estado (va en el detalle).
    ["depositado", ["revertir_deposito"]],
    ["fallido", ["reabrir"]],
    // Con una disputa o un reembolso, el motor no lo deja marcar fallido (`planFail`); depositarlo, sí.
    ["con la disputa abierta", ["en_transito", "depositado"]],
    ["reembolsado del todo", ["en_transito", "depositado"]],
    // En la papelera solo se restaura: no hay menú.
    ["en la papelera", []],
  ])("%s", (name, expected) => {
    expect(statusChanges(STATES[name] as AllowedInput)).toEqual(expected);
  });

  test("cada opción es una acción que allowedActions admite para ese cobro, en su mismo orden", () => {
    for (const tx of Object.values(STATES)) {
      const allowed = allowedActions(tx);
      const changes = statusChanges(tx);
      expect(allowed.filter((action) => (changes as string[]).includes(action))).toEqual(changes);
    }
  });

  test("cada opción dice el cambio con las palabras del menú", () => {
    expect(statusChanges(registrado).map((change) => STATUS_CHANGE_LABEL[change])).toEqual([
      "Pasar a en tránsito",
      "Marcar depositado…",
      "Marcar como fallido",
    ]);
    expect(STATUS_CHANGE_LABEL.revertir_deposito).toBe("Revertir el depósito");
    expect(STATUS_CHANGE_LABEL.reabrir).toBe("Reabrir");
  });
});

describe("statusMenuSubject: de qué cobro es el menú", () => {
  test("lo cobrado y el día, sin el año", () => {
    const tx = { grossOriginal: "675.00", currency: "USD", occurredOn: "2026-11-12" } as const;
    expect(`Cambiar estado del ${statusMenuSubject(tx)}`).toBe("Cambiar estado del cobro de $675,00 del 12 nov");
  });

  test("en otra moneda, con su código", () => {
    const tx = { grossOriginal: "1234.50", currency: "MXN", occurredOn: "2027-01-05" } as const;
    expect(statusMenuSubject(tx)).toBe("cobro de 1.234,50 MXN del 5 ene");
  });
});
