/**
 * Mapa con Leaflet y OpenStreetMap, con marcadores propios (divIcon). Se carga perezoso:
 * usa <LazyMap …/> desde ./index para no meter Leaflet en el paquete principal.
 */
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router';
import { cn } from './cn';

export interface MapMarker {
  id: string;
  lat: number;
  lng: number;
  label: string;
  sublabel?: string;
  tone: 'good' | 'warn' | 'bad' | 'info' | 'neutral';
  /** Ruta interna al tocar el marcador. */
  to?: string;
}

const TONE_CLASS: Record<MapMarker['tone'], string> = {
  good: 'bg-secondary text-on-secondary',
  warn: 'bg-warning text-on-primary',
  bad: 'bg-error text-on-error',
  info: 'bg-primary text-on-primary',
  neutral: 'bg-outline text-on-primary',
};

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export default function MapView({ markers, className, zoom = 12, ariaLabel = 'Mapa de propiedades' }: { markers: MapMarker[]; className?: string; zoom?: number; ariaLabel?: string }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!el.current || map.current) return;
    map.current = L.map(el.current, { scrollWheelZoom: false, attributionControl: true, zoomControl: true });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map.current);
    return () => {
      map.current?.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const layer = L.layerGroup().addTo(m);
    for (const mk of markers) {
      const icon = L.divIcon({
        className: 'gp-marker',
        iconSize: [36, 36],
        iconAnchor: [18, 36],
        html: `<div class="flex h-9 w-9 items-center justify-center rounded-full rounded-br-none rotate-45 shadow-pop ring-2 ring-surface-lowest ${TONE_CLASS[mk.tone]}"><svg class="-rotate-45" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5V21H3z"/></svg></div>`,
      });
      const marker = L.marker([mk.lat, mk.lng], { icon, title: mk.label, alt: mk.label, keyboard: true }).addTo(layer);
      marker.bindTooltip(`<strong>${escapeHtml(mk.label)}</strong>${mk.sublabel ? `<br/>${escapeHtml(mk.sublabel)}` : ''}`, { direction: 'top', offset: [0, -34] });
      if (mk.to) marker.on('click', () => navigate(mk.to!));
    }
    if (markers.length === 1) m.setView([markers[0].lat, markers[0].lng], zoom);
    else if (markers.length > 1) m.fitBounds(L.latLngBounds(markers.map((x) => [x.lat, x.lng] as [number, number])), { padding: [36, 36] });
    else m.setView([27.5, -82], 5);
    return () => {
      layer.remove();
    };
  }, [markers, zoom, navigate]);

  return <div ref={el} role="region" aria-label={ariaLabel} className={cn('z-0 h-72 w-full overflow-hidden rounded-lg', className)} />;
}
