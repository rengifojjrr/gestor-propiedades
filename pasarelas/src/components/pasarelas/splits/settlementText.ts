/**
 * Lo que se dice cuando un reintento de «Registrar liquidación» llega con el mismo id que una ya guardada pero con
 * otros datos: la persona creyó que no había quedado y cambió algo. Lo lanza el servidor y el formulario lo reconoce
 * para empezar una liquidación nueva. Va aparte porque lo leen los dos lados.
 */
export const SETTLEMENT_ALREADY_SAVED_TEXT =
  "Esta liquidación ya se había guardado en el primer intento, con los datos de entonces: lo que cambiaste no se " +
  "guardó. Revísala en la lista.";
