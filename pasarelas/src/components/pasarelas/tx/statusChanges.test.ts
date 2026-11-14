import { describe, expect, test } from "vitest";
import { allowedActions, type AllowedInput } from "./allowed";
import { STATUS_CHANGE_LABEL, statusChanges, txName, type StatusChange } from "./statusChanges";

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
  "en tránsito y reembolsado del todo": { ...registrado, status: "en_transito", refunded: "100.00" },
  "depositado y reembolsado del todo": { ...registrado, status: "depositado", refunded: "100.00" },
  "en la papelera": { ...registrado, deletedAt: "2026-11-20T12:00:00Z" },
};

describe("statusChanges: qué opciones salen en cada estado", () => {
  test.each<[string, StatusChange[]]>([
    ["registrado", ["en_transito", "depositado", "fallido"]],
    ["en tránsito", ["depositado", "fallido"]],
    // Ya depositado, «Marcar depositado» solo cambiaría la fecha: eso no es un cambio de estado (va en el detalle).
    ["depositado", ["revertir_deposito"]],
    ["fallido", ["reabrir"]],
    // Con una disputa, el motor no lo deja marcar fallido (`planFail`); depositarlo, sí.
    ["con la disputa abierta", ["en_transito", "depositado"]],
    // Reembolsado del todo (bruto vigente 0) no hay depósito que esperar: ni en tránsito ni depositado.
    ["reembolsado del todo", []],
    ["en tránsito y reembolsado del todo", []],
    // Lo ya depositado antes del reembolso se conserva y se puede revertir.
    ["depositado y reembolsado del todo", ["revertir_deposito"]],
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

describe("txName: cómo se nombra un cobro en la lista (enlace, casilla y menú de estado)", () => {
  /** Un cobro de 675,00 del 12 nov sin reembolso, como lo trae la lista. */
  const listed = {
    reference: null,
    grossOriginal: "675.00",
    gross: "675.00",
    currency: "USD",
    occurredOn: "2026-11-12",
  } as const;

  test("con referencia, la referencia: es única en la pasarela y es lo que enseña la fila", () => {
    expect(txName({ ...listed, reference: "pi_123" })).toBe("pi_123");
    // Dos cobros del mismo monto y del mismo día se distinguen por su referencia.
    expect(txName({ ...listed, reference: "pi_124" })).not.toBe(txName({ ...listed, reference: "pi_123" }));
  });

  test("sin referencia, su fecha y su bruto, como el enlace «Ver cobro»", () => {
    expect(txName(listed)).toBe("del jue 12 nov 2026 por $675,00");
    expect(`Cambiar estado del cobro ${txName(listed)}`).toBe("Cambiar estado del cobro del jue 12 nov 2026 por $675,00");
  });

  test("con un reembolso, el bruto vigente (el de la columna Bruto), no lo cobrado al principio", () => {
    // Se cobraron 675,00 (`grossOriginal`) y se reembolsaron 400,00.
    expect(txName({ ...listed, gross: "275.00" })).toBe("del jue 12 nov 2026 por $275,00");
  });

  test("en otra moneda, con su código", () => {
    const mxn = { ...listed, gross: "1234.50", grossOriginal: "1234.50", currency: "MXN", occurredOn: "2027-01-05" } as const;
    expect(txName(mxn)).toBe("del mar 5 ene 2027 por 1.234,50 MXN");
  });
});
