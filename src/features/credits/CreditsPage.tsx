/** Créditos de las imágenes, mapas, letra e íconos. */
import { Link } from 'react-router';
import { Card, PageHeader } from '@/ui';

const ITEMS = [
  { title: 'Ilustraciones de las propiedades', body: 'Ilustraciones SVG originales hechas para esta demo (Miami, Orlando, Tampa, Houston, Atlanta y San Juan). Se pueden reutilizar libremente (CC0). No son fotos de propiedades reales.' },
  { title: 'Mapas', body: '© colaboradores de OpenStreetMap (ODbL), mostrados con Leaflet (BSD-2).' },
  { title: 'Letra', body: 'Manrope, de Mikhail Sharanda (SIL Open Font License), servida desde el propio sitio.' },
  { title: 'Íconos', body: 'Lucide (licencia ISC).' },
  { title: 'Diseño', body: 'Basado en las pantallas de referencia hechas con Stitch para este proyecto.' },
  { title: 'Datos', body: 'Todo es inventado: personas, direcciones (marcadas «de ejemplo»), teléfonos 555, correos .test, códigos y montos.' },
];

export default function CreditsPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <PageHeader title="Créditos" back />
      <div className="space-y-3">
        {ITEMS.map((i) => (
          <Card key={i.title}>
            <h2 className="text-label-md text-primary">{i.title}</h2>
            <p className="mt-1 text-body-sm text-on-surface-variant">{i.body}</p>
          </Card>
        ))}
      </div>
      <p className="mt-6 text-body-sm text-on-surface-variant">
        <Link to="/" className="underline">
          Volver a la app
        </Link>
      </p>
    </div>
  );
}
