/**
 * Portafolio: todas las propiedades en tarjetas grandes (o en el mapa), con búsqueda, filtro por
 * estado y orden. Propietario y administración también editan y cambian el estado desde aquí.
 */
import { Building2, LayoutGrid, Map as MapIcon, Plus, SearchX } from 'lucide-react';
import { Suspense, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useActor } from '@/app/session';
import { useLive, useLiveResult } from '@/data/live';
import { PROPERTY_STATUS_LABEL } from '@/domain/labels';
import type { PropertyStatus } from '@/domain/types';
import { svc, type PropertyKpis, type PropertyView } from '@/services';
import { Card, EmptyState, ErrorState, LazyMap, LinkButton, Loading, PageHeader, SearchInput, Select, Tabs } from '@/ui';
import { PropertyCard } from './PropertyCard';
import { propertyMarker, usePermissions } from './shared';
import { StatusModal } from './StatusModal';

type SortKey = 'name' | 'occupancy' | 'income';
type ViewMode = 'list' | 'map';

const STATUSES: PropertyStatus[] = ['occupied', 'vacant', 'maintenance', 'blocked'];
const STATUS_FILTER_LABEL: Record<PropertyStatus, string> = { occupied: 'Ocupadas', vacant: 'Libres', maintenance: 'En mantenimiento', blocked: 'Bloqueadas' };

/** Minúsculas y sin acentos, para buscar «san juan» o «atlánta» igual. */
const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

export default function PropertiesPage() {
  const actor = useActor();
  const perms = usePermissions();
  const [params, setParams] = useSearchParams();
  const statusParam = params.get('estado');
  const status = STATUSES.includes(statusParam as PropertyStatus) ? (statusParam as PropertyStatus) : '';
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<SortKey>('name');
  const [view, setView] = useState<ViewMode>('list');
  const [statusFor, setStatusFor] = useState<PropertyView | null>(null);

  const list = useLiveResult(() => svc.properties.listProperties(actor), [actor]);
  const canFinance = perms.allowed('finance.read');
  const month = svc.finance.currentMonth();
  const finance = useLive(
    () =>
      canFinance
        ? Promise.all([svc.finance.propertyPerformance(actor, month), svc.finance.monthSummary(actor, month)])
            .then(([rows, summary]) => ({ rows, baseCurrency: summary.baseCurrency }))
            .catch(() => null)
        : Promise.resolve(null),
    [actor, canFinance, month],
  );
  const kpisById = useMemo(() => new Map<string, PropertyKpis>((finance?.rows ?? []).map((r) => [r.propertyId, r])), [finance]);

  const properties = list.data;
  const shown = useMemo(() => {
    if (!properties) return [];
    const needle = fold(q.trim());
    const rows = properties.filter(
      (p) => (!status || p.status === status) && (!needle || fold(`${p.name} ${p.city} ${p.neighborhood} ${p.region}`).includes(needle)),
    );
    const metric = (p: PropertyView) => (sort === 'occupancy' ? (kpisById.get(p.id)?.occupancy ?? -1) : (kpisById.get(p.id)?.income ?? -1));
    return sort === 'name' ? rows : [...rows].sort((a, b) => metric(b) - metric(a) || a.name.localeCompare(b.name));
  }, [properties, q, status, sort, kpisById]);
  const markers = useMemo(() => shown.map((p) => propertyMarker(p)), [shown]);

  const canCreate = perms.allowed('property.create');
  const cities = new Set(properties?.map((p) => p.city)).size;
  const sortOptions = [
    { value: 'name', label: 'Orden: nombre' },
    ...(finance ? [{ value: 'occupancy', label: 'Orden: ocupación' }, { value: 'income', label: 'Orden: ingresos' }] : []),
  ];

  const setStatus = (value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set('estado', value);
    else next.delete('estado');
    setParams(next, { replace: true });
  };

  return (
    <div>
      <PageHeader
        title="Portafolio"
        subtitle={
          properties
            ? `${properties.length} ${properties.length === 1 ? 'propiedad' : 'propiedades'} en ${cities} ${cities === 1 ? 'ciudad' : 'ciudades'}. Toca una para ver su ficha.`
            : 'Todas tus propiedades en un solo lugar.'
        }
        actions={
          canCreate && (
            <LinkButton to="/propiedades/nueva" icon={Plus}>
              Agregar propiedad
            </LinkButton>
          )
        }
      />

      <Card padding="sm" className="mb-6 space-y-3">
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <SearchInput value={q} onChange={setQ} placeholder="Buscar por nombre, ciudad o barrio" label="Buscar propiedades" className="md:flex-1" />
          <div className="flex gap-2">
            {sortOptions.length > 1 && (
              <Select aria-label="Ordenar" value={sort} onChange={(e) => setSort(e.target.value as SortKey)} options={sortOptions} className="min-w-0 flex-1 md:w-48" />
            )}
            <Tabs<ViewMode>
              ariaLabel="Vista"
              value={view}
              onChange={setView}
              className="shrink-0"
              tabs={[
                {
                  id: 'list',
                  label: (
                    <>
                      <LayoutGrid size={16} aria-hidden />
                      <span className="sr-only sm:not-sr-only">Tarjetas</span>
                    </>
                  ),
                },
                {
                  id: 'map',
                  label: (
                    <>
                      <MapIcon size={16} aria-hidden />
                      <span className="sr-only sm:not-sr-only">Mapa</span>
                    </>
                  ),
                },
              ]}
            />
          </div>
        </div>
        <Tabs<PropertyStatus | ''>
          ariaLabel="Filtrar por estado"
          value={status}
          onChange={setStatus}
          className="bg-surface-low"
          tabs={[
            { id: '', label: 'Todas', count: properties?.length },
            ...STATUSES.map((s) => ({ id: s, label: STATUS_FILTER_LABEL[s], count: properties?.filter((p) => p.status === s).length })),
          ]}
        />
      </Card>

      {list.error ? (
        <ErrorState error={list.error} />
      ) : !properties ? (
        <Loading label="Cargando propiedades…" />
      ) : properties.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="Todavía no hay propiedades"
          body="Agrega la primera para empezar a llevar reservas, contratos y cuentas."
          action={
            canCreate && (
              <LinkButton to="/propiedades/nueva" icon={Plus}>
                Agregar propiedad
              </LinkButton>
            )
          }
        />
      ) : shown.length === 0 ? (
        <EmptyState icon={SearchX} title="Ninguna propiedad coincide" body="Prueba con otra búsqueda o quita el filtro de estado." />
      ) : view === 'map' ? (
        <Card padding="none" className="overflow-hidden">
          <Suspense fallback={<Loading label="Cargando el mapa…" className="h-112" />}>
            <LazyMap markers={markers} className="h-112 rounded-none md:h-136" ariaLabel="Mapa del portafolio" />
          </Suspense>
          <ul className="flex flex-wrap gap-x-5 gap-y-2 border-t border-outline-variant/40 px-4 py-3 text-body-sm text-on-surface-variant" aria-label="Propiedades en el mapa">
            {shown.map((p) => (
              <li key={p.id}>
                <Link to={`/propiedades/${p.id}`} className="text-primary underline-offset-2 hover:underline">
                  {p.name}
                </Link>{' '}
                · {PROPERTY_STATUS_LABEL[p.status]}
              </li>
            ))}
          </ul>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
          {shown.map((p) => (
            <PropertyCard
              key={p.id}
              property={p}
              kpis={kpisById.get(p.id)}
              baseCurrency={finance?.baseCurrency}
              canEdit={perms.allowed('property.update', { propertyId: p.id })}
              onChangeStatus={() => setStatusFor(p)}
            />
          ))}
        </div>
      )}

      {statusFor && <StatusModal property={statusFor} open onClose={() => setStatusFor(null)} />}
    </div>
  );
}
