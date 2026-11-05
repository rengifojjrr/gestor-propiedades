/**
 * .ics de ejemplo para probar la importación sin un archivo real: dos reservas al estilo Airbnb
 * («Reserved», UID …@airbnb.com) y un día no disponible («Airbnb (Not available)»), con fechas de
 * día completo (VALUE=DATE) en las próximas semanas.
 */

export interface SampleEvent {
  start: string;
  /** Exclusiva (como en los .ics de Airbnb: el día de salida). */
  end: string;
  summary: string;
}

/** Huella corta y estable (FNV-1a) para que el mismo ejemplo tenga los mismos UID. */
function hex(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

const icsDate = (iso: string) => iso.replaceAll('-', '');

/** Arma el texto del calendario (líneas con CRLF, como pide el formato iCalendar). */
export function buildSampleIcs(propertyId: string, events: SampleEvent[], stampIso: string): string {
  const stamp = `${icsDate(stampIso.slice(0, 10))}T120000Z`;
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Gestor de Propiedades//Ejemplo de calendario//ES', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Ejemplo (demo)'];
  for (const e of events) {
    lines.push(
      'BEGIN:VEVENT',
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${icsDate(e.start)}`,
      `DTEND;VALUE=DATE:${icsDate(e.end)}`,
      `SUMMARY:${e.summary}`,
      `UID:${hex(propertyId + e.start)}${hex(e.end + e.summary)}-${hex(propertyId)}@airbnb.com`,
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return `${lines.join('\r\n')}\r\n`;
}

/** Tres eventos en las ventanas dadas: dos reservas y un bloqueo (el último). */
export function sampleEvents(windows: { start: string; end: string }[]): SampleEvent[] {
  return windows.slice(0, 3).map((w, i) => ({ ...w, summary: i === 2 ? 'Airbnb (Not available)' : 'Reserved' }));
}
