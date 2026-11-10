import { createElement, lazy, type ComponentType, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { prerender } from "react-dom/static";
import { describe, expect, it } from "vitest";
import { Field, type FieldProps } from "./Field";
import { Input, MoneyInput, PctInput, Select, Textarea } from "./Inputs";

type ControlProps = { id?: string; "aria-describedby"?: string };

/** Un `Field` con lo que lleve dentro. Los hijos van aparte, como los pasa JSX; por eso el tipo se afirma. */
function field(children: ReactNode, props: Omit<FieldProps, "label" | "children"> = {}): ReactElement {
  return createElement(Field, { label: "Referencia", ...props } as FieldProps, children);
}

/** Un `Field` con su control dentro, ya convertido en HTML. */
function render(control: ReactNode, props: Omit<FieldProps, "label" | "children"> = {}): string {
  return renderToStaticMarkup(field(control, props));
}

/**
 * El mismo control, pero todavía sin resolver: así recibe el `Field` (que es de cliente) al hijo que le pasa un
 * Server Component mientras el servidor arma la página.
 */
function unresolved(control: ReactElement): ReactNode {
  const pending: unknown = lazy(async () => ({ default: control as unknown as ComponentType }));
  return pending as ReactNode;
}

/** Lo mismo que `render`, pero esperando a lo que esté sin resolver (como hace el servidor). */
async function renderWhenReady(element: ReactElement): Promise<string> {
  const { prelude } = await prerender(element);
  return new Response(prelude).text();
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

describe("Field", () => {
  it("un control que llega sin resolver también manda su id: la etiqueta apunta a él", async () => {
    const control = createElement(Input, { id: "referencia-del-cobro" });
    const markup = await renderWhenReady(field(unresolved(control)));
    expect(attr(markup, "input", "id")).toBe("referencia-del-cobro");
    expect(attr(markup, "label", "for")).toBe("referencia-del-cobro");
  });

  it("con más de un hijo no adivina cuál es el control: la etiqueta apunta al id que pone el Field", () => {
    const markup = render([
      createElement(Input, { key: "control" }),
      createElement("p", { key: "nota", id: "nota-al-pie" }, "Sin espacios."),
    ]);
    const id = attr(markup, "input", "id");
    expect(id).not.toBeNull();
    expect(id).not.toBe("nota-al-pie");
    expect(attr(markup, "label", "for")).toBe(id);
  });
});
