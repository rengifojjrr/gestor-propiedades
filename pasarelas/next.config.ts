import path from "node:path";
import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

// La config se carga también con `next typegen` y `next build`: si falta la variable no se lanza, solo no
// se nombra ningún origen de Supabase.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseOrigin = supabaseUrl ? new URL(supabaseUrl).origin : "";
const supabaseWs = supabaseOrigin.replace(/^http/, "ws");

/*
 * Política de contenido (CSP): solo el propio sitio y el proyecto de Supabase (spec §6). Gobierna al NAVEGADOR;
 * lo que el servidor le pide a Supabase no pasa por aquí.
 * - `script-src 'unsafe-inline'`: Next escribe <script> en línea también en producción y sin eso no hidrata.
 *   (`'unsafe-eval'` solo con `next dev`: React lo usa para depurar.)
 * - `img-src data: blob:` + Supabase: el QR del segundo factor llega como `data:`, la vista previa de un
 *   comprobante es `blob:` y el comprobante guardado se ve con una URL firmada de Storage.
 * - `connect-src` + Supabase: el navegador sube los comprobantes directo a Storage.
 * - `upgrade-insecure-requests` no va con `next dev` ni con un Supabase local por `http://` (las pruebas de punta
 *   a punta): el navegador intentaría hablarle por https.
 */
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' blob: data: ${supabaseOrigin}`.trim(),
  "font-src 'self'",
  `connect-src 'self' ${supabaseOrigin} ${supabaseWs}`.trim(),
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(isDev || supabaseOrigin.startsWith("http://") ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), browsing-topics=()" },
  // Solo este sitio: sin `includeSubDomains` ni `preload`, la app no decide por todo el dominio del dueño.
  { key: "Strict-Transport-Security", value: "max-age=63072000" },
];

const nextConfig: NextConfig = {
  // Todo el contenido es privado y por usuario: nada se prerrenderiza ni se guarda en caché compartida.
  // (El arranque oficial de Next 16.4 enciende cacheComponents; aquí va apagado a propósito. Ver AGENTS.md.)
  cacheComponents: false,
  poweredByHeader: false,
  reactStrictMode: true,
  // En desarrollo, Next 16.4 solo sirve sus recursos (/_next/hmr y demás) a `localhost`. Las pruebas de punta a
  // punta entran por http://127.0.0.1:<puerto>: sin esto el websocket de recarga queda bloqueado y la consola se
  // llena de errores. Solo afecta a `next dev`.
  allowedDevOrigins: ["127.0.0.1"],
  // Este proyecto vive en una subcarpeta de un repo con otro proyecto en la raíz:
  // la raíz (de Turbopack y del rastreo de archivos) es ESTA carpeta, no la del repo.
  outputFileTracingRoot: path.join(__dirname),
  turbopack: {
    root: path.join(__dirname),
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  // En todas las respuestas: páginas, redirecciones, el manifiesto y los estáticos.
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
