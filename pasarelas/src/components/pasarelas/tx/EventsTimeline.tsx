import { Card, CardBody, CardHeader, CardTitle, DateText, DateTimeText } from "@/components/ui";
import { isISODate } from "@/lib/pasarelas/dates";
import type { TxEvent } from "@/server/pasarelas/dto";

/** Lo que un reembolso o una disputa guarda además de su resumen: el día que dijo la persona y su nota. */
function extrasOf(event: TxEvent): { on: string | null; note: string | null } {
  const on = event.data?.fecha;
  const note = event.data?.nota;
  return { on: isISODate(on) ? on : null, note: typeof note === "string" && note !== "" ? note : null };
}

/**
 * El historial del cobro, del cambio más reciente al más antiguo: qué pasó y cuándo se anotó. De un reembolso o
 * una disputa, además, el día que se indicó y la nota. Sin estado: se pinta en el servidor.
 */
export function EventsTimeline({ events }: { events: TxEvent[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Historial</CardTitle>
      </CardHeader>
      <CardBody>
        {events.length === 0 ? (
          <p className="text-ink-soft">Sin cambios anotados.</p>
        ) : (
          <ol aria-label="Historial" className="flex flex-col gap-3">
            {events.map((event) => {
              const { on, note } = extrasOf(event);
              return (
                <li key={event.id} className="flex flex-col gap-0.5 border-l-2 border-rule pl-3">
                  <span className="font-semibold">{event.summary}</span>
                  {on === null ? null : (
                    <span className="text-sm">
                      El <DateText value={on} />
                    </span>
                  )}
                  {note === null ? null : <span className="text-sm break-words">{note}</span>}
                  <DateTimeText value={event.at} className="text-sm text-ink-soft" />
                </li>
              );
            })}
          </ol>
        )}
      </CardBody>
    </Card>
  );
}
