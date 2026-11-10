import { afterEach, describe, expect, test, vi } from "vitest";
import type { ActionResult } from "@/server/pasarelas/result";
import { OPEN_FAILED_TEXT, openSignedPdf } from "./openPdf";

/**
 * Qué hace el navegador al tocar «Ver» en un comprobante PDF. Solo se simula `window`: la decisión que se prueba es
 * la de `openPdf.ts` (abrir la pestaña en el mismo toque, sin `opener`, y llevarla al PDF o cerrarla).
 */

const URL_FIRMADA = "http://127.0.0.1:54321/storage/v1/object/sign/demo.pdf?token=demo";

type FakeTab = { opener: unknown; location: { href: string }; close: ReturnType<typeof vi.fn> };

function fakeWindow(tab: FakeTab | null) {
  const win = {
    open: vi.fn(() => tab),
    location: { assign: vi.fn() },
  };
  vi.stubGlobal("window", win);
  return win;
}

const fakeTab = (): FakeTab => ({ opener: {}, location: { href: "" }, close: vi.fn() });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("openSignedPdf", () => {
  test("abre la pestaña antes de pedir la URL, le quita el opener y la lleva al PDF", async () => {
    const tab = fakeTab();
    const win = fakeWindow(tab);
    const order: string[] = [];
    win.open.mockImplementation(() => {
      order.push("open");
      return tab;
    });
    const onError = vi.fn();
    const pending = openSignedPdf(async () => {
      order.push("getUrl");
      return { ok: true, data: { url: URL_FIRMADA } };
    }, onError);
    // La pestaña se abre y la URL se pide en el mismo toque, antes de esperar nada.
    expect(order).toEqual(["open", "getUrl"]);
    expect(win.open).toHaveBeenCalledWith("", "_blank");
    expect(tab.opener).toBeNull();
    await pending;
    expect(tab.location.href).toBe(URL_FIRMADA);
    expect(tab.close).not.toHaveBeenCalled();
    expect(win.location.assign).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  test("si el servidor dice que no, cierra la pestaña vacía y pasa el mensaje", async () => {
    const tab = fakeTab();
    const win = fakeWindow(tab);
    const onError = vi.fn();
    await openSignedPdf(async (): Promise<ActionResult<{ url: string }>> => ({ ok: false, error: "No existe." }), onError);
    expect(tab.close).toHaveBeenCalledTimes(1);
    expect(tab.location.href).toBe("");
    expect(win.location.assign).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith("No existe.");
  });

  test("si pedir la URL lanza, no lanza: cierra la pestaña y dice que no se pudo abrir", async () => {
    const tab = fakeTab();
    fakeWindow(tab);
    const onError = vi.fn();
    await expect(openSignedPdf(() => Promise.reject(new TypeError("Failed to fetch")), onError)).resolves.toBe(
      undefined,
    );
    expect(tab.close).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(OPEN_FAILED_TEXT);
  });

  test("si el navegador bloqueó la pestaña, el PDF se abre en esta", async () => {
    const win = fakeWindow(null);
    const onError = vi.fn();
    await openSignedPdf(async () => ({ ok: true, data: { url: URL_FIRMADA } }), onError);
    expect(win.location.assign).toHaveBeenCalledWith(URL_FIRMADA);
    expect(onError).not.toHaveBeenCalled();
  });

  test("bloqueada y sin URL, solo el mensaje: no saca a la persona de la app", async () => {
    const win = fakeWindow(null);
    const onError = vi.fn();
    await openSignedPdf(async (): Promise<ActionResult<{ url: string }>> => ({ ok: false, error: "No." }), onError);
    expect(win.location.assign).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith("No.");
  });
});
