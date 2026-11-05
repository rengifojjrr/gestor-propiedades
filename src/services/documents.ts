/**
 * Documentos por propiedad y por persona: contratos, seguros, escrituras, licencias, facturas e
 * inspecciones. Se suben desde el teléfono y en la demo se guardan en el navegador. Con vencimientos.
 */
import { data } from '@/data';
import { DOC_CATEGORY_LABEL, DOC_VISIBILITY_LABEL } from '@/domain/labels';
import { DOC_CATEGORIES, DOC_VISIBILITY, isoDate, type DocumentRecord } from '@/domain/types';
import { nowIso, todayLocal } from '@/lib/clock';
import { addDays, diffDays } from '@/lib/dates';
import { newId } from '@/lib/ids';
import { z } from 'zod';
import { allowed, audit, authorize, NotFoundError, parse, RuleError, subjectFor, type Actor } from './core';
import { storeFile } from './files';

export const EXPIRY_WINDOW_DAYS = 30;

export type DocStatus = 'valid' | 'expiring' | 'expired' | 'none';

export interface DocumentView extends DocumentRecord {
  propertyName?: string;
  personName?: string;
  categoryLabel: string;
  visibilityLabel: string;
  status: DocStatus;
  daysToExpiry?: number;
}

function docStatus(d: DocumentRecord, today: string): { status: DocStatus; daysToExpiry?: number } {
  if (!d.expiresOn) return { status: 'none' };
  const days = diffDays(today, d.expiresOn);
  return { status: days < 0 ? 'expired' : days <= EXPIRY_WINDOW_DAYS ? 'expiring' : 'valid', daysToExpiry: days };
}

export interface DocFilter {
  propertyId?: string;
  personId?: string;
  leaseId?: string;
  category?: DocumentRecord['category'];
  status?: DocStatus;
  q?: string;
}

export async function listDocuments(actor: Actor, filter: DocFilter = {}): Promise<DocumentView[]> {
  const s = await subjectFor(actor);
  const db = data();
  const [docs, props, people] = await Promise.all([db.documents.all(), db.properties.all(), db.people.all()]);
  const today = todayLocal();
  const q = filter.q?.trim().toLowerCase();
  return allowed(s, 'document.read', docs, (d) => ({ propertyId: d.propertyId ?? null, personId: d.personId ?? null, visibility: d.visibility }))
    .map((d) => ({
      ...d,
      propertyName: props.find((p) => p.id === d.propertyId)?.name,
      personName: people.find((p) => p.id === d.personId)?.name,
      categoryLabel: DOC_CATEGORY_LABEL[d.category],
      visibilityLabel: DOC_VISIBILITY_LABEL[d.visibility],
      ...docStatus(d, today),
    }))
    .filter(
      (d) =>
        (!filter.propertyId || d.propertyId === filter.propertyId) &&
        (!filter.personId || d.personId === filter.personId) &&
        (!filter.leaseId || d.leaseId === filter.leaseId) &&
        (!filter.category || d.category === filter.category) &&
        (!filter.status || d.status === filter.status) &&
        (!q || `${d.name} ${d.tags.join(' ')} ${d.propertyName ?? ''}`.toLowerCase().includes(q)),
    )
    .sort((a, b) => (a.expiresOn ?? '9999').localeCompare(b.expiresOn ?? '9999') || a.name.localeCompare(b.name));
}

export interface ComplianceStats {
  total: number;
  withExpiry: number;
  valid: number;
  expiring: number;
  expired: number;
  /** % de documentos con vencimiento que están al día. */
  activeCompliance: number;
}

export async function complianceStats(actor: Actor): Promise<ComplianceStats> {
  const docs = await listDocuments(actor);
  const withExpiry = docs.filter((d) => d.status !== 'none');
  const valid = withExpiry.filter((d) => d.status === 'valid').length;
  const expiring = withExpiry.filter((d) => d.status === 'expiring').length;
  const expired = withExpiry.filter((d) => d.status === 'expired').length;
  return { total: docs.length, withExpiry: withExpiry.length, valid, expiring, expired, activeCompliance: withExpiry.length ? (valid + expiring) / withExpiry.length : 1 };
}

const UploadInput = z.object({
  name: z.string().trim().min(2, 'Escribe un nombre'),
  category: z.enum(DOC_CATEGORIES),
  propertyId: z.string().optional(),
  personId: z.string().optional(),
  leaseId: z.string().optional(),
  tags: z.array(z.string()),
  expiresOn: isoDate.optional(),
  visibility: z.enum(DOC_VISIBILITY),
});
export type UploadInput = z.input<typeof UploadInput>;

export const MAX_DOC_BYTES = 15 * 1024 * 1024;

export async function uploadDocument(actor: Actor, raw: UploadInput, file: Blob, fileName: string): Promise<DocumentRecord> {
  const input = parse(UploadInput, raw);
  await authorize(actor, 'document.write', { propertyId: input.propertyId ?? null, visibility: input.visibility });
  if (file.size > MAX_DOC_BYTES) throw new RuleError('El archivo pesa más de 15 MB.');
  const fileId = await storeFile(file, fileName);
  const doc: DocumentRecord = {
    id: newId('doc'),
    ...input,
    fileId,
    mime: file.type || 'application/octet-stream',
    size: file.size,
    uploadedBy: actor.realUser.id,
    createdAt: nowIso(),
    sample: false,
  };
  await data().documents.put(doc);
  await audit(actor, 'document.upload', 'document', doc.id, `Subió «${doc.name}».`);
  return doc;
}

const DocPatch = UploadInput.partial();

export async function updateDocument(actor: Actor, id: string, raw: z.input<typeof DocPatch>): Promise<DocumentRecord> {
  const patch = parse(DocPatch, raw);
  const db = data();
  const d = await db.documents.get(id);
  if (!d) throw new NotFoundError('el documento');
  await authorize(actor, 'document.write', { propertyId: d.propertyId ?? null, visibility: d.visibility });
  const next = { ...d, ...patch };
  await db.documents.put(next);
  await audit(actor, 'document.update', 'document', id, `Editó «${d.name}».`);
  return next;
}

export async function deleteDocument(actor: Actor, id: string): Promise<void> {
  const db = data();
  const d = await db.documents.get(id);
  if (!d) return;
  await authorize(actor, 'document.write', { propertyId: d.propertyId ?? null, visibility: d.visibility });
  await db.documents.remove(id);
  if (d.fileId) await db.files.remove(d.fileId);
  await audit(actor, 'document.delete', 'document', id, `Borró «${d.name}».`);
}

/** El archivo del documento. Los de ejemplo no tienen archivo: se genera una hoja que lo dice. */
export async function openDocument(actor: Actor, id: string): Promise<{ blob: Blob; name: string }> {
  const db = data();
  const d = await db.documents.get(id);
  if (!d) throw new NotFoundError('el documento');
  await authorize(actor, 'document.read', { propertyId: d.propertyId ?? null, personId: d.personId ?? null, visibility: d.visibility });
  if (d.fileId) {
    const f = await db.files.get(d.fileId);
    if (f) return { blob: f.blob, name: f.name };
  }
  const p = d.propertyId ? await db.properties.get(d.propertyId) : undefined;
  const text = [
    'DOCUMENTO DE EJEMPLO — sin valor legal',
    '',
    d.name,
    `Tipo: ${DOC_CATEGORY_LABEL[d.category]}`,
    p ? `Propiedad: ${p.name}` : '',
    d.expiresOn ? `Vence: ${d.expiresOn}` : '',
    '',
    'En la demo los documentos de ejemplo no tienen archivo. Los que subas desde el teléfono',
    'se guardan en este navegador y se abren aquí mismo.',
  ]
    .filter((l) => l !== undefined)
    .join('\n');
  return { blob: new Blob([text], { type: 'text/plain;charset=utf-8' }), name: `${d.name}.txt` };
}

/** Documentos que vencen en los próximos días (para avisos). */
export async function expiringDocuments(actor: Actor, days = EXPIRY_WINDOW_DAYS): Promise<DocumentView[]> {
  const limit = addDays(todayLocal(), days);
  return (await listDocuments(actor)).filter((d) => d.expiresOn && d.expiresOn <= limit);
}
