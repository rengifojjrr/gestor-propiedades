/** Tarjeta grande de una propiedad en el portafolio (estilo «Property Portfolio» de Stitch). */
import { Bath, BedDouble, CalendarRange, MapPin, Ruler, TrendingUp, Users } from 'lucide-react';
import type { ReactNode } from 'react';
import { PROPERTY_STATUS_LABEL, RENTAL_MODE_LABEL } from '@/domain/labels';
import { formatNumber, formatPercent } from '@/lib/money';
import type { PropertyKpis, PropertyView } from '@/services';
import { Badge, Button, LinkButton, Money, PROPERTY_STATUS_TONE } from '@/ui';
import { CoverPhoto, Fact, plural } from './shared';

function PriceBlock({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 even:border-l even:border-outline-variant even:pl-4">
      <p className="text-label-sm text-on-surface-variant uppercase">{label}</p>
      <p className="truncate text-headline-md text-primary">{children}</p>
    </div>
  );
}

export function PropertyCard({
  property: p,
  kpis,
  baseCurrency,
  canEdit,
  onChangeStatus,
}: {
  property: PropertyView;
  kpis?: PropertyKpis;
  baseCurrency?: string;
  canEdit: boolean;
  onChangeStatus: () => void;
}) {
  const prices: ReactNode[] = [];
  if (p.nightlyRate != null && p.rentalMode !== 'monthly')
    prices.push(
      <PriceBlock key="night" label="Tarifa por noche">
        <Money amount={p.nightlyRate} currency={p.currency} whole />
      </PriceBlock>,
    );
  if (p.monthlyRent != null && p.rentalMode !== 'nightly')
    prices.push(
      <PriceBlock key="month" label="Renta mensual">
        <Money amount={p.monthlyRent} currency={p.currency} whole />
      </PriceBlock>,
    );
  if (kpis && baseCurrency)
    prices.push(
      <PriceBlock key="income" label="Ingresos del mes">
        <Money amount={kpis.income} currency={baseCurrency} tone="income" whole />
      </PriceBlock>,
    );

  return (
    <article className="flex flex-col overflow-hidden rounded-lg border border-outline-variant/40 bg-surface-lowest shadow-card" aria-label={p.name}>
      <div className="relative h-48 overflow-hidden bg-surface-container">
        <CoverPhoto property={p} alt={`Foto de ${p.name}`} className="h-full w-full" />
        <Badge tone={PROPERTY_STATUS_TONE[p.status]} upper className="absolute top-3 left-3 shadow-card">
          {PROPERTY_STATUS_LABEL[p.status]}
        </Badge>
      </div>

      <div className="flex flex-1 flex-col p-4">
        <h3 className="text-headline-md text-primary">{p.name}</h3>
        <p className="mt-0.5 flex items-center gap-1 text-body-sm text-on-surface-variant">
          <MapPin size={14} className="shrink-0" aria-hidden />
          <span className="truncate">
            {[p.neighborhood, p.city].filter(Boolean).join(', ')}
          </span>
        </p>

        {prices.length > 0 && <div className="mt-4 grid grid-cols-2 items-end gap-x-4 gap-y-3">{prices}</div>}

        <div className="mt-4 grid grid-cols-2 gap-x-2 gap-y-3.5 border-y border-outline-variant/40 py-4">
          {kpis && <Fact icon={TrendingUp} label="Ocupación" value={formatPercent(kpis.occupancy)} />}
          <Fact icon={BedDouble} label="Cuartos" value={p.bedrooms === 0 ? 'Estudio' : p.bedrooms} />
          <Fact icon={Bath} label="Baños" value={formatNumber(p.bathrooms, 1)} />
          <Fact icon={Users} label="Capacidad" value={plural(p.capacity, 'persona', 'personas')} />
          <Fact icon={Ruler} label="Tamaño" value={`${formatNumber(p.sizeM2)} m²`} />
          <Fact icon={CalendarRange} label="Alquiler" value={RENTAL_MODE_LABEL[p.rentalMode]} />
        </div>

        <div className="mt-auto flex flex-wrap justify-end gap-2 pt-4">
          <LinkButton to={`/propiedades/${p.id}`} variant="secondary" size="sm" aria-label={`Ver ${p.name}`}>
            Ver
          </LinkButton>
          {canEdit && (
            <>
              <LinkButton to={`/propiedades/${p.id}/editar`} variant="secondary" size="sm" aria-label={`Editar ${p.name}`}>
                Editar
              </LinkButton>
              <Button size="sm" onClick={onChangeStatus} aria-label={`Cambiar estado de ${p.name}`}>
                Cambiar estado
              </Button>
            </>
          )}
        </div>
      </div>
    </article>
  );
}
