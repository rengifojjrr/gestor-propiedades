/** «Ficha»: tipo, modo, espacio, comodidades, licencia, horarios, zona horaria, moneda y precios. */
import { Bath, BedDouble, CalendarRange, Home, Ruler, Users } from 'lucide-react';
import { PROPERTY_TYPE_LABEL, RENTAL_MODE_LABEL } from '@/domain/labels';
import { diffDays, formatDate, formatTime } from '@/lib/dates';
import { formatNumber, formatPercent } from '@/lib/money';
import type { PropertyView } from '@/services';
import { Badge, Card, CardHeader, KeyValue, Money } from '@/ui';
import { Fact, plural } from '../shared';

function LicenseValue({ license, today }: { license: NonNullable<PropertyView['license']>; today: string }) {
  const days = diffDays(today, license.expiresOn);
  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-2">
      <span>
        {license.number} · vence {formatDate(license.expiresOn, { year: true })}
      </span>
      {days < 0 ? <Badge tone="bad">Vencida</Badge> : days <= 30 ? <Badge tone="warn">Vence en {days} días</Badge> : null}
    </span>
  );
}

export function FactsCard({ property: p }: { property: PropertyView }) {
  const hasPrices = p.nightlyRate != null || p.monthlyRent != null;
  return (
    <Card padding="lg">
      <CardHeader title="Ficha" subtitle={p.address} />
      <div className="grid grid-cols-2 gap-x-3 gap-y-4 md:grid-cols-3">
        <Fact icon={Home} label="Tipo" value={PROPERTY_TYPE_LABEL[p.type]} />
        <Fact icon={CalendarRange} label="Alquiler" value={RENTAL_MODE_LABEL[p.rentalMode]} />
        <Fact icon={BedDouble} label="Cuartos" value={p.bedrooms === 0 ? 'Estudio' : p.bedrooms} />
        <Fact icon={Bath} label="Baños" value={formatNumber(p.bathrooms, 1)} />
        <Fact icon={Users} label="Capacidad" value={plural(p.capacity, 'persona', 'personas')} />
        <Fact icon={Ruler} label="Tamaño" value={`${formatNumber(p.sizeM2)} m²`} />
      </div>

      {p.amenities.length > 0 && (
        <div className="mt-5">
          <h3 className="mb-2 text-label-md text-on-surface-variant">Comodidades</h3>
          <ul className="flex flex-wrap gap-2">
            {p.amenities.map((a) => (
              <li key={a}>
                <Badge tone="neutral">{a}</Badge>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-5 grid gap-x-8 md:grid-cols-2">
        <dl>
          <KeyValue label="Barrio y ciudad" value={[p.neighborhood, p.city, p.region].filter(Boolean).join(', ')} />
          <KeyValue label="País" value={p.country || '—'} />
          <KeyValue label="Entrada / salida" value={`${formatTime(p.checkInTime)} / ${formatTime(p.checkOutTime)}`} />
          <KeyValue label="Zona horaria" value={p.timezone.replace(/_/g, ' ')} />
          <KeyValue label="Moneda" value={p.currency} />
          <KeyValue label="Licencia" value={p.license ? <LicenseValue license={p.license} today={p.today} /> : 'Sin licencia registrada'} />
        </dl>
        {hasPrices && (
          <dl>
            {p.rentalMode !== 'monthly' && p.nightlyRate != null && <KeyValue label="Tarifa por noche" value={<Money amount={p.nightlyRate} currency={p.currency} />} />}
            {p.rentalMode !== 'monthly' && p.cleaningFee != null && <KeyValue label="Cargo de limpieza" value={<Money amount={p.cleaningFee} currency={p.currency} />} />}
            {p.cleaningPay != null && <KeyValue label="Pago a limpieza por tarea" value={<Money amount={p.cleaningPay} currency={p.currency} />} />}
            {p.monthlyRent != null && <KeyValue label="Renta mensual" value={<Money amount={p.monthlyRent} currency={p.currency} />} />}
            {p.rentalMode !== 'monthly' && <KeyValue label="Impuesto de hospedaje" value={formatPercent(p.taxRate, 2)} />}
          </dl>
        )}
      </div>
    </Card>
  );
}
