/**
 * Archivos (fotos y documentos) guardados en el navegador como Blob.
 * Las pantallas piden el archivo por id después de que el servicio dueño (tarea, orden, documento)
 * ya verificó el permiso. Con Supabase: Storage con URLs firmadas por registro (docs/SUPABASE.md).
 */
import { data } from '@/data';
import type { FileRecord } from '@/domain/types';
import { nowIso } from '@/lib/clock';
import { newId } from '@/lib/ids';

export async function storeFile(blob: Blob, name: string): Promise<string> {
  const record: FileRecord = {
    id: newId('f'),
    blob,
    name,
    mime: blob.type || 'application/octet-stream',
    size: blob.size,
    createdAt: nowIso(),
  };
  return data().files.put(record);
}

export async function getFile(id: string): Promise<FileRecord | undefined> {
  return data().files.get(id);
}
