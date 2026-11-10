import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { PayRuleError, PayStateError } from "@/lib/pasarelas";
import { runAction } from "./action";
import { UserError } from "./errors";

// `runAction` depende de la petición de Next (cookies, caché): aquí se simula lo de Next y la sesión.
const { revalidatePath } = vi.hoisted(() => ({ revalidatePath: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("next/navigation", () => ({
  unstable_rethrow: (error: unknown) => {
    if (error instanceof Error && error.message === "NEXT_REDIRECT") throw error;
  },
}));
vi.mock("@/lib/auth/session", () => ({
  requireSession: async () => ({ userId: "u1", email: "demo@example.com", aal: "aal2", hasFactor: true }),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));

const schema = z.object({ n: z.number() });
const GENERIC = "No se pudo guardar. Inténtalo de nuevo.";

let consoleError: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  revalidatePath.mockClear();
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => consoleError.mockRestore());

describe("runAction: qué revalida", () => {
  it("sin rutas pedidas, revalida /pasarelas con todo su árbol", async () => {
    expect(await runAction(schema, { n: 1 }, async (_ctx, { n }) => n + 1)).toEqual({ ok: true, data: 2 });
    expect(revalidatePath.mock.calls).toEqual([["/pasarelas", "layout"]]);
  });

  it("con rutas pedidas, revalida solo esas", async () => {
    await runAction(schema, { n: 1 }, async () => null, { revalidate: ["/pasarelas/cobros", "/pasarelas/resumen"] });
    expect(revalidatePath.mock.calls).toEqual([["/pasarelas/cobros"], ["/pasarelas/resumen"]]);
  });

  it("con `revalidate: []` (una acción que solo lee) no revalida nada", async () => {
    await runAction(schema, { n: 1 }, async () => "url", { revalidate: [] });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("si la entrada no valida o la operación falla, no revalida", async () => {
    expect(await runAction(schema, { n: "x" }, async () => null)).toMatchObject({ ok: false });
    expect(
      await runAction(schema, { n: 1 }, async () => {
        throw new UserError("Ese cobro ya no existe.");
      }),
    ).toEqual({ ok: false, error: "Ese cobro ya no existe." });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("runAction: qué registra cuando falla", () => {
  it("un error esperado se le enseña a la persona y no se registra", async () => {
    for (const error of [
      new UserError("Ese cobro ya no existe."),
      new PayStateError("reembolso_excede"),
      new PayRuleError("sin_tarifa"),
    ]) {
      const result = await runAction(schema, { n: 1 }, async () => {
        throw error;
      });
      expect(result).toEqual({ ok: false, error: error.message });
    }
    // Un rechazo de la base que tiene su mensaje (aquí, un nombre repetido) tampoco.
    const duplicate = {
      code: "23505",
      details: null,
      hint: null,
      message: 'duplicate key value violates unique constraint "pay_companies_name_uq"',
    };
    expect(
      await runAction(schema, { n: 1 }, async () => {
        throw duplicate;
      }),
    ).toEqual({ ok: false, error: "Ya hay una empresa con ese nombre." });
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("un fallo interno da el mensaje general y deja el error original en el registro del servidor", async () => {
    const zodThrown = (() => {
      try {
        z.object({ a: z.string() }).parse({});
      } catch (error) {
        return error;
      }
    })();
    const unknownSqlState = { code: "XX000", details: null, hint: null, message: "internal error" };
    for (const error of [new TypeError("fetch failed"), zodThrown, unknownSqlState, "algo raro"]) {
      consoleError.mockClear();
      const result = await runAction(schema, { n: 1 }, async () => {
        throw error;
      });
      expect(result).toEqual({ ok: false, error: GENERIC });
      expect(consoleError).toHaveBeenCalledWith("[runAction]", error);
    }
  });

  it("los errores de control de Next (redirect) pasan sin registrarse", async () => {
    const redirect = new Error("NEXT_REDIRECT");
    await expect(
      runAction(schema, { n: 1 }, async () => {
        throw redirect;
      }),
    ).rejects.toBe(redirect);
    expect(consoleError).not.toHaveBeenCalled();
  });
});
