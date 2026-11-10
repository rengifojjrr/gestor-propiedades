import { z } from "zod";

/**
 * El código del segundo factor tal como llega de un formulario: seis dígitos. Se aceptan con espacios en medio,
 * como los muestran algunas apps («123 456»), y sale ya sin ellos.
 */
export const TotpCode = z
  .string()
  .transform((value) => value.replace(/\s/g, ""))
  .pipe(z.string().regex(/^\d{6}$/));

/** Lo que se dice cuando el código no vale, al entrar y al activar un dispositivo. */
export const WRONG_CODE = "Ese código no es correcto. Espera a que tu app muestre uno nuevo y vuelve a intentarlo.";
