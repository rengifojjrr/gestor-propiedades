import "server-only";
import { cache } from "react";
import type { PayConfig } from "@/lib/pasarelas";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { loadPayConfig, seedHolidays } from "./config";

/**
 * La configuración del usuario de la sesión, para las pantallas. Una vez por petición (`cache` de React).
 *
 * Vive aparte de `config.ts` porque depende de la sesión de Next (cookies): `config.ts` se sigue pudiendo importar
 * fuera de Next (la semilla y las pruebas de integración).
 *
 * La primera vez, cuando el usuario todavía no tiene ningún feriado, siembra los feriados bancarios y la devuelve
 * con ellos. No se vuelve a leer: dentro de un mismo render Next memoiza los `fetch` GET iguales (misma URL y
 * cabeceras), y la segunda lectura de feriados, idéntica a la primera, devolvería la misma respuesta vacía. Los días
 * que devuelve `seedHolidays` ya están todos en la base. En el caso normal es una sola lectura.
 */
export const getPayConfig = cache(async (): Promise<PayConfig> => {
  await requireSession();
  const supabase = await createClient();
  const cfg = await loadPayConfig(supabase);
  if (cfg.holidays.length > 0) return cfg;
  return { ...cfg, holidays: await seedHolidays(supabase) };
});
