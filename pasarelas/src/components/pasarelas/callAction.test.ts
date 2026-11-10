import { afterEach, describe, expect, test, vi } from "vitest";
import { UNSURE_TEXT, callAction } from "./callAction";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("callAction", () => {
  test("lo que responde la acción pasa tal cual, sea bien o mal, y no refresca", async () => {
    const refresh = vi.fn();
    expect(await callAction(async () => ({ ok: true as const, data: 3 }), refresh)).toEqual({ ok: true, data: 3 });
    expect(await callAction(async () => ({ ok: false as const, error: "No" }), refresh)).toEqual({
      ok: false,
      error: "No",
    });
    expect(refresh).not.toHaveBeenCalled();
  });

  test("si la llamada no llega o no vuelve, no lanza: dice que no se sabe si quedó y refresca la pantalla", async () => {
    const refresh = vi.fn();
    const result = await callAction(() => Promise.reject(new TypeError("Failed to fetch")), refresh);
    expect(result).toEqual({ ok: false, error: UNSURE_TEXT });
    expect(UNSURE_TEXT).toMatch(/revisa/i);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test("con otro texto, ese", async () => {
    const result = await callAction(() => Promise.reject(new Error("x")), vi.fn(), "Revisa la lista.");
    expect(result).toEqual({ ok: false, error: "Revisa la lista." });
  });

  test("si refrescar también falla, se queda con el aviso", async () => {
    const refresh = vi.fn(() => {
      throw new Error("sin red");
    });
    expect(await callAction(() => Promise.reject(new Error("x")), refresh)).toEqual({ ok: false, error: UNSURE_TEXT });
  });

  test("si el navegador sabe que no hay conexión, no refresca: la recarga no llegaría y se perdería el aviso", async () => {
    vi.stubGlobal("navigator", { onLine: false });
    const refresh = vi.fn();
    expect(await callAction(() => Promise.reject(new Error("x")), refresh)).toEqual({ ok: false, error: UNSURE_TEXT });
    expect(refresh).not.toHaveBeenCalled();
  });
});
