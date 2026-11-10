import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AjustesError from "./error";
import AjustesLoading from "./loading";

/**
 * `/ajustes` con sus propios estados de carga y de error: sin ellos, un fallo caía en `global-error` y la app
 * perdía su marco (menú y barra), y mientras cargaba no se veía nada.
 */
describe("Ajustes: error.tsx y loading.tsx", () => {
  it("el error deja la cabecera «Ajustes», dice qué pasó y ofrece «Reintentar»", () => {
    const markup = renderToStaticMarkup(createElement(AjustesError, { error: new Error("x"), retry: () => {} }));
    expect(markup).toMatch(/<h1[^>]*>Ajustes<\/h1>/);
    expect(markup).toContain("No se pudieron cargar los ajustes");
    expect(markup).toMatch(/<button[^>]*>Reintentar<\/button>/);
  });

  it("mientras carga lo anuncia al lector de pantalla", () => {
    const markup = renderToStaticMarkup(createElement(AjustesLoading));
    expect(markup).toMatch(/role="status"[^>]*>Cargando los ajustes…</);
  });
});
