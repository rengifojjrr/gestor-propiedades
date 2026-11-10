import type { MetadataRoute } from "next";
import { THEME_COLORS } from "@/components/ui/tokens";

/**
 * Manifiesto de la app instalable (se sirve en /manifest.webmanifest). Sin service worker: no hay modo
 * sin conexión. Los íconos salen de `public/icons/icon.svg` con `node scripts/generar-iconos.mjs`.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Pasarelas",
    short_name: "Pasarelas",
    description: "Libro privado de cobros, comisiones, depósitos y repartos.",
    lang: "es",
    start_url: "/pasarelas",
    scope: "/",
    display: "standalone",
    background_color: THEME_COLORS.light.paper,
    theme_color: THEME_COLORS.light.brand,
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
