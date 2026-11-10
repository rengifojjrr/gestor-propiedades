import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionResult } from "@/server/pasarelas/result";

/**
 * Qué hace el navegador con un archivo ya subido cuando el registro sale mal. Solo se simula la red (Storage y la
 * Server Action): la decisión que se prueba es la de `upload.ts`. Si el servidor dice que no (`ok: false`), el
 * archivo se borra; si la llamada no vuelve (se cortó la conexión), NO: no se sabe si la fila quedó y puede ser suya.
 */

const USER_ID = "00000000-0000-4000-8000-000000000001";
const TX_ID = "00000000-0000-4000-8000-000000000002";

const storage = {
  upload: vi.fn(async () => ({ error: null })),
  remove: vi.fn(async () => ({ data: [], error: null })),
};
const register = vi.fn<(input: unknown) => Promise<ActionResult<{ id: string }>>>();

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: { getSession: async () => ({ data: { session: { user: { id: USER_ID } } } }) },
    storage: { from: () => storage },
  }),
}));
vi.mock("@/server/pasarelas/actions/receipts", () => ({
  registerReceiptAction: (input: unknown) => register(input),
}));

const { saveUploaded, uploadReceipt } = await import("./upload");

/** Un PDF mínimo: los PDF se suben tal cual (no pasan por el lienzo del navegador). */
const pdf = () => new File(["%PDF-1.7\n%demo\n"], "Recibo de Grupo A.pdf", { type: "application/pdf" });

const uploadedPath = (): string => {
  const [call] = storage.upload.mock.calls as unknown as [string, File][];
  if (call === undefined) throw new Error("no se subió nada");
  return call[0];
};

beforeEach(() => {
  storage.upload.mockClear();
  storage.remove.mockClear();
  register.mockReset();
});

describe("uploadReceipt", () => {
  it("sube a la carpeta del cobro y registra el archivo sin su nombre original", async () => {
    register.mockResolvedValue({ ok: true, data: { id: "r1" } });

    expect(await uploadReceipt(pdf(), TX_ID)).toEqual({ ok: true, data: { id: "r1" } });

    const path = uploadedPath();
    expect(path).toMatch(new RegExp(`^${USER_ID}/${TX_ID}/[0-9a-f-]{36}\\.pdf$`));
    expect(register).toHaveBeenCalledWith({
      transactionId: TX_ID,
      path,
      mime: "application/pdf",
      sizeBytes: pdf().size,
    });
    expect(storage.remove).not.toHaveBeenCalled();
  });

  it("si el servidor rechaza el registro, borra el archivo subido y dice por qué", async () => {
    register.mockResolvedValue({ ok: false, error: "Ese cobro ya no existe." });

    expect(await uploadReceipt(pdf(), TX_ID)).toEqual({ ok: false, error: "Ese cobro ya no existe." });

    expect(storage.remove).toHaveBeenCalledWith([uploadedPath()]);
  });

  it("si la llamada al servidor no vuelve, no borra el archivo y pide revisar antes de repetir", async () => {
    register.mockRejectedValue(new TypeError("Failed to fetch"));

    expect(await uploadReceipt(pdf(), TX_ID)).toEqual({
      ok: false,
      error: "No se pudo confirmar si el comprobante quedó guardado. Revisa los comprobantes antes de volver a subirlo.",
    });

    expect(storage.remove).not.toHaveBeenCalled();
  });
});

describe("saveUploaded", () => {
  it("con el guardado hecho, el archivo se queda", async () => {
    const result = await saveUploaded("u/c/logo.webp", async () => ({ ok: true, data: undefined }));
    expect(result).toEqual({ ok: true, data: undefined });
    expect(storage.remove).not.toHaveBeenCalled();
  });

  it("con un rechazo del servidor, borra el archivo", async () => {
    const result = await saveUploaded("u/c/logo.webp", async () => ({ ok: false, error: "No." }));
    expect(result).toEqual({ ok: false, error: "No." });
    expect(storage.remove).toHaveBeenCalledWith(["u/c/logo.webp"]);
  });

  it("si la llamada lanza, deja el archivo y lanza lo mismo", async () => {
    const cut = new TypeError("Failed to fetch");
    await expect(saveUploaded("u/c/logo.webp", () => Promise.reject(cut))).rejects.toBe(cut);
    expect(storage.remove).not.toHaveBeenCalled();
  });

  it("sin archivo no hay nada que borrar", async () => {
    await saveUploaded(null, async () => ({ ok: false, error: "No." }));
    expect(storage.remove).not.toHaveBeenCalled();
  });
});
