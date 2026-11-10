// Genera los íconos de la app (manifiesto y pantalla de inicio de iOS) a partir de public/icons/icon.svg.
// Uso, desde pasarelas/:  node scripts/generar-iconos.mjs
// Rasteriza con el Chromium de Playwright (ya instalado para las pruebas de punta a punta).
import { readFile, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";

const ICONS_DIR = new URL("../public/icons/", import.meta.url);

/**
 * - `fullBleed`: el color de fondo llega hasta los bordes (sin esquinas transparentes). Lo piden el ícono
 *   «maskable» (el sistema lo recorta con su propia forma) y el de iOS (que pinta de negro lo transparente).
 * - `scale`: tamaño del dibujo dentro del lienzo. El «maskable» lo achica para que quepa en la zona segura
 *   (un círculo del 80 % del lado).
 */
const TARGETS = [
  { file: "icon-192.png", size: 192, fullBleed: false, scale: 1 },
  { file: "icon-512.png", size: 512, fullBleed: false, scale: 1 },
  { file: "icon-maskable-512.png", size: 512, fullBleed: true, scale: 0.8 },
  { file: "apple-touch-icon.png", size: 180, fullBleed: true, scale: 1 },
];

const svg = await readFile(new URL("icon.svg", ICONS_DIR), "utf8");
const background = svg.match(/<rect[^>]*\sfill="(#[0-9a-fA-F]{6})"/)?.[1];
if (!background) throw new Error("icon.svg: no encuentro el color de fondo (el primer <rect fill=\"#rrggbb\">).");

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const { file, size, fullBleed, scale } of TARGETS) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<style>
         html, body { margin: 0; height: 100%; background: ${fullBleed ? background : "transparent"}; }
         body { display: grid; place-items: center; }
         svg { display: block; width: ${size * scale}px; height: ${size * scale}px; }
       </style>${svg}`,
    );
    await writeFile(new URL(file, ICONS_DIR), await page.screenshot({ type: "png", omitBackground: !fullBleed }));
    console.log(`public/icons/${file} (${size}×${size})`);
  }
} finally {
  await browser.close();
}
