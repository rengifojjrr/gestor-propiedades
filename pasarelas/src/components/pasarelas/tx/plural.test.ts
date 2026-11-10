import { describe, expect, it } from "vitest";
import { batchDone, cobros } from "./plural";

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
