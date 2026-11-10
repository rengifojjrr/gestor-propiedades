import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Alert, type AlertProps } from "./Alert";

/** El `role` de la caja del aviso (o null si no lleva). */
function roleOf(props: AlertProps): string | null {
  const markup = renderToStaticMarkup(createElement(Alert, { title: "2 depósitos atrasados", ...props }));
  return /^<div\b[^>]*\srole="([^"]*)"/.exec(markup)?.[1] ?? null;
}

const TONES = ["info", "success", "warning", "danger"] as const;

describe("Alert", () => {
  it.each(TONES)("un aviso fijo de tono %s no interrumpe al lector de pantalla", (tone) => {
    expect(roleOf({ tone })).toBe("status");
  });

  it.each(TONES)("con announce, el de tono %s lleva role=\"alert\"", (tone) => {
    expect(roleOf({ tone, announce: true })).toBe("alert");
  });

  it("announce apagado es lo mismo que no pasarlo", () => {
    expect(roleOf({ tone: "danger", announce: false })).toBe("status");
  });
});
