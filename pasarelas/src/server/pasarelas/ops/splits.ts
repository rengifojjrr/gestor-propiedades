import "server-only";
import { SCHEME_ISSUE_TEXT, validateScheme } from "@/lib/pasarelas";
import type { AllocBase, BeneficiaryKind, ISODate, Pct } from "@/lib/pasarelas";
import type { Db } from "../dto";
import { UserError } from "../errors";

/**
 * Las escrituras de Repartos: los beneficiarios y los esquemas de reparto. El cliente llega de fuera, con la sesión
 * del usuario (la RLS aplica): lo de otro usuario no se ve, y se trata como algo que ya no existe.
 *
 * Un esquema nunca se edita: se le agrega una versión con su «vigente desde» (cada cobro guarda congelada la que
 * usó). Lo que tiene historia no se borra (la base no deja): se dice que se desactive.
 */

export type BeneficiaryInput = {
  /** Sin `id` se crea; con `id`, se edita ese. */
  id: string | null;
  name: string;
  kind: BeneficiaryKind;
  accountAlias: string | null;
  notes: string | null;
};

export type SchemeInput = {
  /** Sin `schemeId`, un esquema nuevo con su primera versión; con `schemeId`, una versión nueva de ese. */
  schemeId: string | null;
  name: string;
  base: AllocBase;
  remainderBeneficiaryId: string | null;
  effectiveFrom: ISODate;
  /** En su orden. */
  lines: { beneficiaryId: string; pct: Pct }[];
};

export type SavedScheme = { schemeId: string; versionId: string; version: number };

const BENEFICIARY_NOT_FOUND = "Ese beneficiario ya no existe.";
const SCHEME_NOT_FOUND = "Ese esquema de reparto ya no existe.";
const IN_USE = "Tiene movimientos: desactívalo en su lugar";
const IN_SCHEME = "Está en un esquema de reparto: desactívalo en su lugar";

/** ¿Lo rechazó una clave foránea? Al borrar: algo todavía lo usa. */
function isForeignKey(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "23503";
}

/** El mensaje de la base, si lo trae. */
function messageOf(error: unknown): string {
  const message = typeof error === "object" && error !== null ? (error as { message?: unknown }).message : undefined;
  return typeof message === "string" ? message : "";
}

/** Si la escritura no tocó ninguna fila, lo que se quería cambiar no existe (o es de otro usuario). */
function touched(rows: readonly unknown[], text: string): void {
  if (rows.length === 0) throw new UserError(text);
}

// ─── Beneficiarios ──────────────────────────────────────────────────────────────────────────────────────────

/** Crea el beneficiario (sin `id`) o edita el que se indica. Devuelve su id. */
export async function saveBeneficiary(supabase: Db, b: BeneficiaryInput): Promise<string> {
  const fields = { name: b.name, kind: b.kind, account_alias: b.accountAlias, notes: b.notes };
  if (b.id === null) {
    const { data } = await supabase.from("pay_beneficiaries").insert(fields).select("id").single().throwOnError();
    return data.id;
  }
  const { data } = await supabase.from("pay_beneficiaries").update(fields).eq("id", b.id).select("id").throwOnError();
  touched(data, BENEFICIARY_NOT_FOUND);
  return b.id;
}

/** Activa o desactiva el beneficiario. Uno inactivo no se ofrece en esquemas nuevos; lo registrado lo conserva. */
export async function setBeneficiaryActive(supabase: Db, id: string, active: boolean): Promise<void> {
  const { data } = await supabase.from("pay_beneficiaries").update({ active }).eq("id", id).select("id").throwOnError();
  touched(data, BENEFICIARY_NOT_FOUND);
}

/**
 * Borra un beneficiario sin historia. Si tiene repartos o liquidaciones, o está en una versión de un esquema (que
 * no se edita), la base no lo deja borrar: se dice que se desactive.
 */
export async function deleteBeneficiary(supabase: Db, id: string): Promise<void> {
  try {
    const { data } = await supabase.from("pay_beneficiaries").delete().eq("id", id).select("id").throwOnError();
    touched(data, BENEFICIARY_NOT_FOUND);
  } catch (error) {
    if (!isForeignKey(error)) throw error;
    // Postgres nombra la tabla que todavía lo usa: «… on table "pay_scheme_lines"».
    throw new UserError(messageOf(error).includes('on table "pay_scheme_') ? IN_SCHEME : IN_USE);
  }
}

// ─── Esquemas ───────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Guarda un esquema nuevo con su primera versión, o una versión nueva de uno que ya existe (cambia también su
 * nombre), en una sola transacción (`pay_save_scheme`). Antes lo valida con el motor y, si no vale, no escribe
 * nada y lanza el mismo texto que enseña la pantalla (`SCHEME_ISSUE_TEXT`). La base vuelve a exigir lo mismo.
 */
export async function saveScheme(supabase: Db, s: SchemeInput): Promise<SavedScheme> {
  const [issue] = validateScheme(s.lines, s.remainderBeneficiaryId);
  if (issue !== undefined) throw new UserError(SCHEME_ISSUE_TEXT[issue]);
  const { data } = await supabase
    .rpc("pay_save_scheme", {
      p: {
        scheme_id: s.schemeId,
        name: s.name,
        base: s.base,
        remainder_beneficiary_id: s.remainderBeneficiaryId,
        effective_from: s.effectiveFrom,
        lines: s.lines.map((line) => ({ beneficiary_id: line.beneficiaryId, pct: line.pct })),
      },
    })
    .throwOnError();
  const saved = data as { scheme_id: string; version_id: string; version: number };
  return { schemeId: saved.scheme_id, versionId: saved.version_id, version: saved.version };
}

/** Activa o desactiva el esquema. Uno inactivo no se ofrece al registrar; lo ya repartido no cambia. */
export async function setSchemeActive(supabase: Db, id: string, active: boolean): Promise<void> {
  const { data } = await supabase.from("pay_schemes").update({ active }).eq("id", id).select("id").throwOnError();
  touched(data, SCHEME_NOT_FOUND);
}

/**
 * Borra un esquema sin cobros, con sus versiones (la empresa que lo tenía por defecto queda sin esquema). Si algún
 * cobro lo usa (también en la papelera), la base no lo deja: se dice que se desactive.
 */
export async function deleteScheme(supabase: Db, id: string): Promise<void> {
  try {
    const { data } = await supabase.from("pay_schemes").delete().eq("id", id).select("id").throwOnError();
    touched(data, SCHEME_NOT_FOUND);
  } catch (error) {
    if (isForeignKey(error)) throw new UserError(IN_USE);
    throw error;
  }
}
