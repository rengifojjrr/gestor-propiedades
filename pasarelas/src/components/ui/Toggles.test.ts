import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Checkbox, Switch } from "./Toggles";

const html = (element: ReactElement) => renderToStaticMarkup(element);

/** El valor de un atributo del `<input>` (o null si no lo lleva). */
function inputAttr(markup: string, name: string): string | null {
  const input = /<input\b[^>]*>/.exec(markup)?.[0] ?? "";
  return new RegExp(`\\s${name}="([^"]*)"`).exec(input)?.[1] ?? null;
}

/** El texto del elemento con ese id. */
function textOf(markup: string, id: string): string | null {
  const match = new RegExp(`<(\\w+)[^>]*\\bid="${id}"[^>]*>(.*?)</\\1>`).exec(markup);
  return match?.[2]?.replace(/<[^>]+>/g, "") ?? null;
}

const CONTROLS = [
  ["Checkbox", Checkbox],
  ["Switch", Switch],
] as const;

describe.each(CONTROLS)("%s", (_name, Control) => {
  it("sin error no queda marcado como inválido ni describe nada de más", () => {
    const markup = html(createElement(Control, { label: "Pago rápido" }));
    expect(inputAttr(markup, "aria-invalid")).toBeNull();
    expect(inputAttr(markup, "aria-describedby")).toBeNull();
    expect(markup).not.toContain("text-danger");
  });

  it("con ayuda, el control queda descrito por ella", () => {
    const markup = html(createElement(Control, { label: "Pago rápido", hint: "El dinero cae el mismo día." }));
    const describedBy = inputAttr(markup, "aria-describedby");
    expect(describedBy).not.toBeNull();
    expect(textOf(markup, describedBy ?? "")).toBe("El dinero cae el mismo día.");
    expect(inputAttr(markup, "aria-invalid")).toBeNull();
  });

  it("con error: aria-invalid y el mensaje enlazado por aria-describedby", () => {
    const markup = html(createElement(Control, { label: "Acepto", error: "Marca la casilla para continuar." }));
    expect(inputAttr(markup, "aria-invalid")).toBe("true");
    const describedBy = inputAttr(markup, "aria-describedby");
    expect(describedBy).not.toBeNull();
    expect(textOf(markup, describedBy ?? "")).toBe("Marca la casilla para continuar.");
  });

  it("con ayuda y error, el control queda descrito por las dos (primero la ayuda)", () => {
    const markup = html(
      createElement(Control, { label: "Acepto", hint: "No se puede deshacer.", error: "Marca la casilla para continuar." }),
    );
    const ids = (inputAttr(markup, "aria-describedby") ?? "").split(" ");
    expect(ids).toHaveLength(2);
    expect(ids.map((id) => textOf(markup, id))).toEqual(["No se puede deshacer.", "Marca la casilla para continuar."]);
  });

  it("un aria-describedby propio se suma al de la ayuda y el error, no los pisa", () => {
    const markup = html(
      createElement(Control, {
        label: "Acepto",
        hint: "No se puede deshacer.",
        error: "Marca la casilla para continuar.",
        "aria-describedby": "nota-externa",
      }),
    );
    const ids = (inputAttr(markup, "aria-describedby") ?? "").split(" ");
    expect(ids).toHaveLength(3);
    expect(ids[0]).toBe("nota-externa");
    expect(ids.slice(1).map((id) => textOf(markup, id))).toEqual(["No se puede deshacer.", "Marca la casilla para continuar."]);
  });

  it("un aria-labelledby propio se conserva, combinado con la etiqueta del control", () => {
    const markup = html(createElement(Control, { label: "Activa", "aria-labelledby": "fila-tienda-demo" }));
    const ids = (inputAttr(markup, "aria-labelledby") ?? "").split(" ");
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe("fila-tienda-demo");
    expect(textOf(markup, ids[1] ?? "")).toBe("Activa");
  });

  it("un error vacío o nulo no marca nada", () => {
    for (const error of [null, undefined, ""]) {
      const markup = html(createElement(Control, { label: "Acepto", error }));
      expect(inputAttr(markup, "aria-invalid")).toBeNull();
      expect(inputAttr(markup, "aria-describedby")).toBeNull();
    }
  });

  it("la etiqueta sigue siendo el nombre del control y la fila entera se puede tocar", () => {
    const markup = html(createElement(Control, { label: "Acepto", error: "Marca la casilla para continuar." }));
    expect(textOf(markup, inputAttr(markup, "aria-labelledby") ?? "")).toBe("Acepto");
    // El mensaje de error va fuera de la fila que se toca (el <label>).
    const label = /<label\b.*?<\/label>/.exec(markup)?.[0] ?? "";
    expect(label).toContain("<input");
    expect(label).not.toContain("Marca la casilla para continuar.");
  });
});
