import { redirect } from "next/navigation";
import { describe, expect, test } from "vitest";
import { RETRY_TEXT, UNSURE_TEXT, callAction, callActionOr, failureOf, isUnsure } from "./callAction";

describe("callAction", () => {
  test("lo que responde la acción pasa tal cual, sea bien o mal, y no es una duda", async () => {
    const done = await callAction(async () => ({ ok: true as const, data: 3 }));
    expect(done).toEqual({ ok: true, data: 3 });
    const refused = await callAction(async () => ({ ok: false as const, error: "No", fieldErrors: { on: ["Mal"] } }));
    expect(refused).toEqual({ ok: false, error: "No", fieldErrors: { on: ["Mal"] } });
    expect(isUnsure(done)).toBe(false);
    expect(isUnsure(refused)).toBe(false);
  });

  test("si la llamada no llega o no vuelve, no lanza: dice que no se sabe si quedó, y nada más", async () => {
    const result = await callAction(() => Promise.reject(new TypeError("Failed to fetch")));
    expect(result).toEqual({ ok: false, error: UNSURE_TEXT, unsure: true });
    expect(isUnsure(result)).toBe(true);
  });

  test("una redirección de Next (la acción que borra y lleva a la lista) no es un corte: sigue su camino", async () => {
    let redirection: unknown;
    try {
      redirect("/pasarelas/pasarelas");
    } catch (error) {
      redirection = error;
    }
    await expect(callAction(() => Promise.reject(redirection))).rejects.toBe(redirection);
  });

  test("con otro texto, ese", async () => {
    const result = await callAction(() => Promise.reject(new Error("x")), "Revisa la lista.");
    expect(result).toEqual({ ok: false, error: "Revisa la lista.", unsure: true });
  });

  test("el texto de la duda no da por guardado ni por perdido el cambio, e invita a revisarlo", () => {
    expect(UNSURE_TEXT).toMatch(/no se sabe si se guardó/);
    expect(UNSURE_TEXT).toMatch(/antes de repetirlo/);
  });
});

describe("failureOf", () => {
  test("el error para pintar: su texto, y si es la duda de un corte", async () => {
    expect(failureOf({ ok: false, error: "No" })).toEqual({ text: "No", unsure: false });
    const cut = await callAction<void>(() => Promise.reject(new Error("x")));
    if (cut.ok) throw new Error("Se esperaba un error");
    expect(failureOf(cut)).toEqual({ text: UNSURE_TEXT, unsure: true });
  });
});

describe("callActionOr", () => {
  test("lo que responde la acción, con su propio tipo, pasa tal cual", async () => {
    const answer = { error: "Correo o contraseña incorrectos.", email: "ana@example.com" };
    expect(await callActionOr(async () => answer, () => "corte")).toBe(answer);
  });

  test("si la llamada no llega o no vuelve, no lanza: devuelve lo de `onCut`", async () => {
    const result = await callActionOr(
      () => Promise.reject(new TypeError("Failed to fetch")),
      () => ({ error: RETRY_TEXT }),
    );
    expect(result).toEqual({ error: RETRY_TEXT });
  });

  test("una redirección de Next (entrar, cerrar sesión) no es un corte: sigue su camino", async () => {
    let redirection: unknown;
    try {
      redirect("/login");
    } catch (error) {
      redirection = error;
    }
    await expect(callActionOr(() => Promise.reject(redirection), () => "corte")).rejects.toBe(redirection);
  });

  test("el texto de repetir dice que se cortó y que se puede volver a intentar, sin la duda", () => {
    expect(RETRY_TEXT).toBe("Se perdió la conexión. Revisa tu señal y vuelve a intentarlo.");
  });
});
