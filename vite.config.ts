/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

/** GitHub Pages sirve el proyecto en /gestor-propiedades/. */
const BASE = '/gestor-propiedades/';

/**
 * Lee un token de src/styles/tokens.css (la única fuente de colores) para que el manifiesto
 * de la PWA y la etiqueta theme-color no repitan valores escritos a mano.
 */
function token(name: string): string {
  const css = readFileSync(new URL('./src/styles/tokens.css', import.meta.url), 'utf8');
  const match = css.match(new RegExp(`--${name}:\\s*([^;]+);`));
  if (!match) throw new Error(`Token --${name} no encontrado en src/styles/tokens.css`);
  return match[1].trim();
}

function themeColorPlugin(): Plugin {
  return {
    name: 'gp-theme-color',
    transformIndexHtml: (html) => html.replaceAll('%THEME_COLOR%', token('gp-primary')),
  };
}

export default defineConfig({
  base: BASE,
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  plugins: [
    react(),
    tailwindcss(),
    themeColorPlugin(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['favicon.svg', 'logo.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        id: BASE,
        name: 'Gestor de Propiedades',
        short_name: 'Propiedades',
        description: 'Gestor interno de propiedades. Demo con datos de ejemplo.',
        lang: 'es',
        start_url: BASE,
        scope: BASE,
        display: 'standalone',
        orientation: 'portrait',
        theme_color: token('gp-primary'),
        background_color: token('gp-surface'),
        icons: [
          { src: 'icons/pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webp,woff2}'],
        navigateFallback: 'index.html',
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
    }),
  ],
  preview: { port: 4173, strictPort: true },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
    setupFiles: ['tests/unit/setup.ts'],
    testTimeout: 20_000,
  },
});
