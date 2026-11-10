import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { THEME_COLORS } from "./tokens";

/**
 * Los colores viven en `src/app/globals.css` (`@theme` para el modo claro y un bloque
 * `prefers-color-scheme: dark` para el oscuro). Esta prueba lee ese archivo y comprueba el contraste
 * AA de cada pareja que el kit usa de verdad: si alguien cambia un color y rompe el contraste, falla aquí.
 */
const css = readFileSync(fileURLToPath(new URL("../../app/globals.css", import.meta.url)), "utf8");
const DARK_MARKER = "@media (prefers-color-scheme: dark)";

function colorsIn(block: string): Record<string, string> {
  const found: Record<string, string> = {};
  for (const match of block.matchAll(/--color-([a-z-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    const [, name, hex] = match;
    if (name && hex) found[name] = hex.toLowerCase();
  }
  return found;
}

const [lightCss = "", afterMarker = ""] = css.split(DARK_MARKER);
const darkCss = afterMarker.slice(0, afterMarker.indexOf("\n}"));
const light = colorsIn(lightCss);
const dark = colorsIn(darkCss);

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255].map((channel) => {
    const v = channel / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Texto sobre fondo: AA pide 4,5 : 1. */
const TEXT_PAIRS: [string, string][] = [
  ["ink", "paper"],
  ["ink", "surface"],
  ["ink", "sunken"],
  ["ink-soft", "paper"],
  ["ink-soft", "surface"],
  ["ink-soft", "sunken"],
  ["brand", "paper"],
  ["brand", "surface"],
  ["brand", "sunken"],
  ["brand", "brand-soft"],
  ["on-brand", "brand"],
  ["on-brand", "brand-strong"],
  ["danger", "paper"],
  ["danger", "surface"],
  ["danger", "sunken"],
  ["danger", "danger-soft"],
  ["on-danger", "danger"],
  ["warning", "paper"],
  ["warning", "surface"],
  ["warning", "warning-soft"],
  ["info", "paper"],
  ["info", "surface"],
  ["info", "info-soft"],
  ["ink", "brand-soft"],
  ["ink", "danger-soft"],
  ["ink", "warning-soft"],
  ["ink", "info-soft"],
];

/** Bordes de controles y anillo de foco: 3 : 1 (WCAG 1.4.11). */
const NON_TEXT_PAIRS: [string, string][] = [
  ["rule-strong", "paper"],
  ["rule-strong", "surface"],
  ["focus", "paper"],
  ["focus", "surface"],
  ["brand", "surface"],
];

const TOKENS = [...new Set([...TEXT_PAIRS, ...NON_TEXT_PAIRS].flat()), "rule"];

describe.each([
  ["claro", light],
  ["oscuro", dark],
])("tokens de color · modo %s", (_mode, theme) => {
  it("define todos los tokens", () => {
    expect(Object.keys(theme).sort()).toEqual([...TOKENS].sort());
  });

  it.each(TEXT_PAIRS)("texto %s sobre %s: contraste AA (≥ 4,5)", (fg, bg) => {
    expect(contrast(theme[fg] ?? "", theme[bg] ?? "")).toBeGreaterThanOrEqual(4.5);
  });

  it.each(NON_TEXT_PAIRS)("%s sobre %s: contraste ≥ 3", (fg, bg) => {
    expect(contrast(theme[fg] ?? "", theme[bg] ?? "")).toBeGreaterThanOrEqual(3);
  });
});

describe("colores que se usan fuera de la hoja de estilos (manifiesto, barra del navegador)", () => {
  it("son los mismos que los tokens", () => {
    expect(THEME_COLORS).toEqual({
      light: { paper: light.paper, brand: light.brand },
      dark: { paper: dark.paper, brand: dark.brand },
    });
  });
});
