import { describe, expect, test, vi } from "vitest";
import { refreshQuietly } from "./refresh";

describe("refresh", () => {
  test("refreshQuietly refresca", () => {
    const refresh = vi.fn();
    refreshQuietly(refresh);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test("si refrescar falla, no lanza: el aviso sigue y se puede volver a intentar", () => {
    expect(() =>
      refreshQuietly(() => {
        throw new Error("sin red");
      }),
    ).not.toThrow();
  });
});
