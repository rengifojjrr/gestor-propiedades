/** Kit de componentes (estilo Stitch). Importa desde '@/ui'. */
import { lazy } from 'react';

export * from './Badge';
export * from './Button';
export * from './Card';
export * from './cn';
export * from './Dialog';
export * from './Feedback';
export * from './Form';
export * from './Media';
export * from './Misc';
export * from './Stat';
export * from './Toast';
export * from './tokens';
export type { MapMarker } from './MapView';

/** Mapa perezoso (Leaflet se descarga solo cuando aparece). Envuélvelo en <Suspense>. */
export const LazyMap = lazy(() => import('./MapView'));
