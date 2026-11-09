import { existsSync, readFileSync } from "node:fs";

/**
 * Las pruebas de integración corren contra el Supabase LOCAL (`npm run db:start`).
 * Aquí se cargan sus claves desde .env.local y se comprueba que responde y que es local:
 * estas pruebas crean y borran usuarios, así que nunca deben apuntar a un proyecto remoto.
 */
export default async function setup(): Promise<void> {
  if (existsSync(".env.local")) {
    for (const line of readFileSync(".env.local", "utf8").split("\n")) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (match && match[1] && process.env[match[1]] === undefined) {
        process.env[match[1]] = match[2] ?? "";
      }
    }
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
    throw new Error("Faltan las claves del stack local. Corre `npm run db:start` (escribe .env.local).");
  }

  const host = new URL(url).hostname;
  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new Error(`Las pruebas de integración solo corren contra el stack local, no contra ${host}.`);
  }

  try {
    const res = await fetch(`${url}/auth/v1/health`, { headers: { apikey: secret } });
    if (!res.ok) throw new Error(`estado ${res.status}`);
  } catch (error) {
    throw new Error(`El stack local no responde en ${url} (${String(error)}). Corre \`npm run db:start\`.`);
  }
}
