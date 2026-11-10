import "server-only";
import { cache } from "react";
import type { PayConfig } from "@/lib/pasarelas";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { ensureHolidays, loadPayConfig } from "./config";

/**
 * La configuración del usuario de la sesión, para las pantallas. Una vez por petición (`cache` de React).
 *
 * Vive aparte de `config.ts` porque depende de la sesión de Next (cookies): `config.ts` se sigue pudiendo importar
 * fuera de Next (la semilla y las pruebas de integración).
 *
 * La primera vez, cuando el usuario todavía no tiene ningún feriado, siembra los feriados bancarios y vuelve a
 * leer. En el caso normal es una sola lectura.
 */
export const getPayConfig = cache(async (): Promise<PayConfig> => {
  await requireSession();
  const supabase = await createClient();
  const cfg = await loadPayConfig(supabase);
  if (cfg.holidays.length > 0) return cfg;
  await ensureHolidays(supabase);
  return loadPayConfig(supabase);
});
