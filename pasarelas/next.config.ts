import path from "node:path";
import type { NextConfig } from "next";

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
};

export default nextConfig;
