import { parsePct } from "@/lib/pasarelas/money";
import { retentionRecipientsTotal, validateRetention, type RetentionIssue } from "@/lib/pasarelas/rules";
import type { Pct } from "@/lib/pasarelas/types";

/*
 * La retención de una pasarela mientras se escribe en su ficha: el % y el de cada persona son texto, como los
 * escribe la persona («5», «33,3333»). Las reglas son las del motor (`validateRetention`), las mismas que comprueban
 * la acción y la base al guardar.
 */

/** Una persona de la retención, como está en el formulario. */
export type RecipientDraft = { beneficiaryId: string; pct: string };

/** Lo escrito como porcentajes del motor: lo que no se lee cuenta 0 (no suma). */
const readRecipients = (recipients: readonly RecipientDraft[]) =>
  recipients.map((recipient) => ({ beneficiaryId: recipient.beneficiaryId, pct: parsePct(recipient.pct) ?? "0" }));

/**
 * Lo que no deja guardar la retención escrita, en el orden del motor. Si el % que retiene no se lee (vacío, más de
 * 100), no adivina: lo dice la acción junto a ese campo.
 */
export function retentionDraftIssues(pct: string, recipients: readonly RecipientDraft[]): RetentionIssue[] {
  const retained = parsePct(pct);
  if (retained === null) return [];
  return validateRetention({ pct: retained, recipients: readRecipients(recipients) });
}

/** Lo que suman los porcentajes de las personas, sin contar los que no se leen. */
export function retentionDraftTotal(recipients: readonly RecipientDraft[]): Pct {
  return retentionRecipientsTotal(readRecipients(recipients));
}
