/** «Auditoría»: quién hizo qué y cuándo. Solo se agrega: nadie puede editar ni borrar entradas. */
import { History, Lock } from 'lucide-react';
import { useState } from 'react';
import { useLive } from '@/data/live';
import { ROLE_LABEL } from '@/domain/labels';
import type { Role } from '@/domain/types';
import { formatDateTime } from '@/lib/dates';
import { svc } from '@/services';
import { Avatar, Badge, Button, EmptyState, Loading, SearchInput, Select } from '@/ui';
import { SettingsSection, useSettingsPerms } from './SettingsSection';

const ENTITY_LABEL: Record<string, string> = {
  booking: 'Reservas',
  lease: 'Contratos',
  transaction: 'Finanzas',
  budget: 'Finanzas',
  fx: 'Monedas',
  settings: 'Ajustes',
  user: 'Equipo',
  document: 'Documentos',
  property: 'Propiedades',
  accessCode: 'Códigos de acceso',
  checklist: 'Checklists',
  cleaning: 'Limpieza',
  maintenance: 'Mantenimiento',
  incident: 'Incidencias',
  vendor: 'Proveedores',
  thread: 'Mensajes',
  template: 'Plantillas',
  person: 'Personas',
  demo: 'Demo',
};

const STEP = 20;

export function AuditSection() {
  const { actor } = useSettingsPerms();
  const [q, setQ] = useState('');
  const [entity, setEntity] = useState('');
  const [limit, setLimit] = useState(STEP);
  const entries = useLive(async () => (await svc.system.listAudit(actor, { q: q || undefined, entity: entity || undefined })).sort((a, b) => b.at.localeCompare(a.at)), [actor, q, entity]);
  const all = useLive(() => svc.system.listAudit(actor), [actor]);
  const entities = [...new Set((all ?? []).map((e) => e.entity))].sort((a, b) => (ENTITY_LABEL[a] ?? a).localeCompare(ENTITY_LABEL[b] ?? b));

  return (
    <SettingsSection id="auditoria" icon={History} title="Auditoría" subtitle="Quién hizo qué y cuándo, en todo el sistema.">
      <p className="mb-4 flex items-center gap-2 rounded-md bg-surface-low px-3 py-2 text-body-sm text-on-surface-variant">
        <Lock size={16} className="shrink-0" aria-hidden />
        Solo se agrega: nadie puede editar ni borrar entradas.
      </p>
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_14rem]">
        <SearchInput
          value={q}
          onChange={(v) => {
            setQ(v);
            setLimit(STEP);
          }}
          placeholder="Buscar por persona o acción…"
          label="Buscar en la auditoría"
        />
        <Select
          aria-label="Área"
          value={entity}
          onChange={(e) => {
            setEntity(e.target.value);
            setLimit(STEP);
          }}
          options={[{ value: '', label: 'Todas las áreas' }, ...entities.map((e) => ({ value: e, label: ENTITY_LABEL[e] ?? e }))]}
        />
      </div>
      {!entries ? (
        <Loading />
      ) : entries.length === 0 ? (
        <EmptyState icon={History} title="Sin resultados" body="Prueba con otra búsqueda." />
      ) : (
        <>
          <ol className="divide-y divide-outline-variant/40">
            {entries.slice(0, limit).map((e) => (
              <li key={e.id} className="flex items-start gap-3 py-3">
                <Avatar name={e.actorName} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="text-body-sm text-on-surface">
                    <span className="font-semibold text-primary">{e.actorName}</span>
                    <span className="text-on-surface-variant"> · {ROLE_LABEL[e.actorRole as Role] ?? e.actorRole}</span>
                  </p>
                  <p className="text-body-sm text-on-surface">{e.summary}</p>
                  <p className="mt-1 flex flex-wrap items-center gap-2 text-label-sm font-normal text-on-surface-variant">
                    <time dateTime={e.at}>{formatDateTime(e.at)}</time>
                    <Badge tone="neutral">{ENTITY_LABEL[e.entity] ?? e.entity}</Badge>
                  </p>
                </div>
              </li>
            ))}
          </ol>
          <div className="mt-2 flex items-center justify-between gap-3 text-body-sm text-on-surface-variant">
            <span>
              {Math.min(limit, entries.length)} de {entries.length}
            </span>
            {entries.length > limit && (
              <Button variant="ghost" size="sm" onClick={() => setLimit((l) => l + STEP)}>
                Ver más
              </Button>
            )}
          </div>
        </>
      )}
    </SettingsSection>
  );
}
