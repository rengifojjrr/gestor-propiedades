import { AxeBuilder } from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

/** Lo que se exige en todas las pantallas: WCAG 2.0 y 2.1, niveles A y AA. */
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const BLOCKING_IMPACTS = new Set(["serious", "critical"]);

/*
 * El `Page` que espera axe es el de SU `playwright-core` (el lockfile instala 1.65 para él), no el de
 * `@playwright/test` 1.63 que usan las pruebas: los tipos difieren en dos métodos nuevos que axe no usa.
 * En ejecución es el mismo objeto; la conversión solo concilia los tipos.
 */
type AxePage = ConstructorParameters<typeof AxeBuilder>[0]["page"];

/**
 * Pasa axe sobre la página y devuelve, una línea por elemento, las violaciones serias o críticas
 * (regla, impacto, qué pide y el elemento que falla). Lista vacía = pantalla limpia.
 */
export async function seriousAxeViolations(page: Page): Promise<string[]> {
  const { violations } = await new AxeBuilder({ page: page as unknown as AxePage }).withTags(WCAG_TAGS).analyze();
  return violations
    .filter((violation) => BLOCKING_IMPACTS.has(violation.impact ?? ""))
    .flatMap((violation) =>
      violation.nodes.map(
        (node) =>
          `[${violation.impact}] ${violation.id}: ${violation.help}\n    en ${node.target.join(" ")}\n    ${node.failureSummary?.replace(/\n\s*/g, " ") ?? ""}`,
      ),
    );
}

/** Falla, listando cada caso, si la página tiene violaciones serias o críticas de axe. */
export async function expectNoSeriousAxe(page: Page): Promise<void> {
  const found = await seriousAxeViolations(page);
  expect(found, `Violaciones serias o críticas de axe en ${page.url()}:\n${found.join("\n")}`).toEqual([]);
}

/** Falla si la página se puede desplazar hacia los lados (algo se sale del ancho de la pantalla). */
export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(scrollWidth, `La página mide ${scrollWidth} px de ancho en una pantalla de ${innerWidth} px`).toBeLessThanOrEqual(
    innerWidth,
  );
}
