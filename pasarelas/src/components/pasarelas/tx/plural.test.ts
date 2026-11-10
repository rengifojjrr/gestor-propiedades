import { describe, expect, it } from "vitest";
import { REFRESH_FAILED_TEXT, batchDone, cobros, depositDone, savedWithRefresh } from "./plural";

const DEPOSITED = { one: "marcado como depositado", many: "marcados como depositados" };

describe("cobros", () => {
  it("singular y plural", () => {
    expect(cobros(1)).toBe("1 cobro");
    expect(cobros(0)).toBe("0 cobros");
    expect(cobros(51)).toBe("51 cobros");
  });
});

describe("batchDone", () => {
  it("dice cuántos cambiaron, con el participio que corresponde", () => {
    expect(batchDone(3, 3, DEPOSITED)).toBe("3 cobros marcados como depositados.");
    expect(batchDone(1, 1, DEPOSITED)).toBe("1 cobro marcado como depositado.");
  });

  it("y cuántos de los elegidos no admitían el cambio", () => {
    expect(batchDone(2, 3, DEPOSITED)).toBe("2 cobros marcados como depositados. 1 no admitía el cambio.");
    expect(batchDone(0, 4, DEPOSITED)).toBe("0 cobros marcados como depositados. 4 no admitían el cambio.");
  });
});

describe("depositDone", () => {
  const none = { deposited: 0, notPending: 0, other: 0 };

  it("sin saltados, como batchDone", () => {
    expect(depositDone({ count: 3, skipped: none })).toBe("3 cobros marcados como depositados.");
  });

  it("dice cuántos se saltaron y por qué, en singular y en plural", () => {
    expect(depositDone({ count: 2, skipped: { deposited: 1, notPending: 1, other: 1 } })).toBe(
      "2 cobros marcados como depositados. Se saltaron 3: 1 ya estaba depositado (conserva su fecha), " +
        "1 no está por caer (disputa abierta o reembolso total) y 1 no admitía el cambio.",
    );
    expect(depositDone({ count: 0, skipped: { deposited: 40, notPending: 0, other: 0 } })).toBe(
      "0 cobros marcados como depositados. Se saltaron 40: 40 ya estaban depositados (conservan su fecha).",
    );
    expect(depositDone({ count: 1, skipped: { deposited: 0, notPending: 2, other: 3 } })).toBe(
      "1 cobro marcado como depositado. Se saltaron 5: 2 no están por caer (disputa abierta o reembolso total) " +
        "y 3 no admitían el cambio.",
    );
    expect(depositDone({ count: 1, skipped: { deposited: 0, notPending: 0, other: 1 } })).toBe(
      "1 cobro marcado como depositado. Se saltó 1: 1 no admitía el cambio.",
    );
  });
});

describe("savedWithRefresh", () => {
  it("dice cuántas fechas estimadas de lo que está por caer cambiaron", () => {
    expect(savedWithRefresh("Feriado agregado.", 1)).toEqual({
      success: "Feriado agregado. Se actualizó la fecha estimada de 1 cobro por caer.",
      error: null,
    });
    expect(savedWithRefresh("Feriado agregado.", 3)).toEqual({
      success: "Feriado agregado. Se actualizó la fecha estimada de 3 cobros por caer.",
      error: null,
    });
  });

  it("si no cambió ninguna, no dice nada de las fechas", () => {
    expect(savedWithRefresh("Feriado quitado.", 0)).toEqual({ success: "Feriado quitado.", error: null });
  });

  it("si no se pudieron recalcular, lo guardado sigue guardado y se dice aparte que las fechas no se actualizaron", () => {
    expect(savedWithRefresh("Pasarela guardada.", null)).toEqual({
      success: "Pasarela guardada.",
      error: REFRESH_FAILED_TEXT,
    });
    expect(REFRESH_FAILED_TEXT).toMatch(/^No se pudieron actualizar las fechas estimadas: /);
  });
});
