import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Field, type FieldProps } from "./Field";
import { Input, MoneyInput, PctInput, Select, Textarea } from "./Inputs";

type ControlProps = { id?: string; "aria-describedby"?: string };

/** Un `Field` con su control dentro, ya convertido en HTML. */
function render(control: ReactElement, field: Omit<FieldProps, "label" | "children"> = {}): string {
  return renderToStaticMarkup(createElement(Field, { label: "Referencia", ...field, children: control }));
}

/** El valor de un atributo de la primera etiqueta `<tag>` (o null si no lo lleva). */
function attr(markup: string, tag: string, name: string): string | null {
  const element = new RegExp(`<${tag}\\b[^>]*>`).exec(markup)?.[0] ?? "";
  return new RegExp(`\\s${name}="([^"]*)"`).exec(element)?.[1] ?? null;
}

/** El texto del elemento con ese id. */
function textOf(markup: string, id: string): string | null {
  const match = new RegExp(`<(\\w+)[^>]*\\bid="${id}"[^>]*>(.*?)</\\1>`).exec(markup);
  return match?.[2]?.replace(/<[^>]+>/g, "") ?? null;
}

const CONTROLS = [
  ["Input", "input", (props: ControlProps) => createElement(Input, props)],
  ["Textarea", "textarea", (props: ControlProps) => createElement(Textarea, props)],
  ["Select", "select", (props: ControlProps) => createElement(Select, props)],
  ["MoneyInput", "input", (props: ControlProps) => createElement(MoneyInput, props)],
  ["PctInput", "input", (props: ControlProps) => createElement(PctInput, props)],
] as const;

describe.each(CONTROLS)("Field con %s", (_name, tag, control) => {
  it("sin id propio, la etiqueta apunta al id que pone el Field", () => {
    const markup = render(control({}));
    const id = attr(markup, tag, "id");
    expect(id).not.toBeNull();
    expect(attr(markup, "label", "for")).toBe(id);
  });

  it("si el control trae su propio id, se respeta y la etiqueta apunta a él", () => {
    const markup = render(control({ id: "referencia-del-cobro" }));
    expect(attr(markup, tag, "id")).toBe("referencia-del-cobro");
    expect(attr(markup, "label", "for")).toBe("referencia-del-cobro");
  });

  it("sin ayuda, sin error y sin descripción propia no describe nada", () => {
    const markup = render(control({}));
    expect(attr(markup, tag, "aria-describedby")).toBeNull();
    expect(attr(markup, tag, "aria-invalid")).toBeNull();
  });

  it("con ayuda y error, el control queda descrito por las dos (primero la ayuda)", () => {
    const markup = render(control({}), { hint: "La que da la pasarela.", error: "Ya existe un cobro con esta referencia." });
    const ids = (attr(markup, tag, "aria-describedby") ?? "").split(" ");
    expect(ids.map((id) => textOf(markup, id))).toEqual(["La que da la pasarela.", "Ya existe un cobro con esta referencia."]);
    expect(attr(markup, tag, "aria-invalid")).toBe("true");
  });

  it("un aria-describedby propio se combina con la ayuda y el error, no los reemplaza", () => {
    const markup = render(control({ "aria-describedby": "nota-externa" }), {
      hint: "La que da la pasarela.",
      error: "Ya existe un cobro con esta referencia.",
    });
    const ids = (attr(markup, tag, "aria-describedby") ?? "").split(" ");
    expect(ids).toHaveLength(3);
    expect(ids[0]).toBe("nota-externa");
    expect(ids.slice(1).map((id) => textOf(markup, id))).toEqual([
      "La que da la pasarela.",
      "Ya existe un cobro con esta referencia.",
    ]);
  });

  it("un aria-describedby propio se conserva tal cual cuando el Field no tiene ayuda ni error", () => {
    const markup = render(control({ "aria-describedby": "nota-externa" }));
    expect(attr(markup, tag, "aria-describedby")).toBe("nota-externa");
  });
});
