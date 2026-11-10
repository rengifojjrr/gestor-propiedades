/**
 * Los pocos colores que hacen falta FUERA de la hoja de estilos (manifiesto y color de la barra del
 * navegador), donde no se puede leer una variable de CSS. La fuente de verdad es `src/app/globals.css`;
 * `tokens.test.ts` comprueba que estos valores sean los mismos.
 */
export const THEME_COLORS = {
  light: { paper: "#eef2ef", brand: "#0e6249" },
  dark: { paper: "#0e1718", brand: "#5fd3a6" },
} as const;
