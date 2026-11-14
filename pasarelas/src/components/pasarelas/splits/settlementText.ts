/**
 * Lo que se dice cuando un reintento de «Registrar liquidación» llega con el mismo id que una ya guardada pero con
 * otros datos: la persona creyó que no había quedado y cambió algo. Lo lanza el servidor y el formulario lo reconoce
 * para empezar una liquidación nueva. Va aparte porque lo leen los dos lados.
 */
export const SETTLEMENT_ALREADY_SAVED_TEXT =
  "Esta liquidación ya se había guardado en el primer intento, con los datos de entonces: lo que cambiaste no se " +
  "guardó. Revísala en la lista.";

/**
 * Lo que se dice si, al marcar pagada una parte del reparto, ya no falta lo que se veía: otra pestaña la pagó, hubo
 * un reembolso o el cobro cambió. No se guarda nada: no se le paga a nadie más de lo que falta.
 */
export const PAYOUT_CHANGED_TEXT =
  "Lo que falta pagar cambió mientras lo veías (otro pago, un reembolso o un cambio en el cobro). No se guardó " +
  "nada: vuelve a cargar la página.";

/**
 * Lo que se dice cuando un reintento de un pago llega con el mismo id que uno ya guardado pero con otros datos (la
 * persona creyó que no había quedado y cambió algo).
 */
export const PAYOUT_ALREADY_SAVED_TEXT =
  "Ese pago ya se había guardado en el primer intento, con los datos de entonces: lo que cambiaste no se guardó. " +
  "Mira cómo quedó el reparto.";
