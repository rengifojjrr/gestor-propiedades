import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Todo el contenido es privado y por usuario: nada se prerrenderiza ni se guarda en caché compartida.
  // (El arranque oficial de Next 16.4 enciende cacheComponents; aquí va apagado a propósito. Ver AGENTS.md.)
  cacheComponents: false,
  poweredByHeader: false,
  reactStrictMode: true,
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
