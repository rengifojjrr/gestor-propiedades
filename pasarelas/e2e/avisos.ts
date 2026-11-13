import type { Page } from "@playwright/test";

/**
 * Espera a que los avisos pasajeros (sonner) queden quietos. Un aviso a medio entrar, a medio pasar detrás del
 * siguiente o a medio irse tiene el texto translúcido, y axe lo mide como falta de contraste: se llama antes de
 * `expectNoSeriousAxe`.
 */
export async function waitForStillToasts(page: Page): Promise<void> {
  await page.waitForFunction(() =>
    document.getAnimations().every((animation) => {
      const target = animation.effect instanceof KeyframeEffect ? animation.effect.target : null;
      return animation.playState !== "running" || !(target instanceof Element && target.closest("[data-sonner-toaster]"));
    }),
  );
}
