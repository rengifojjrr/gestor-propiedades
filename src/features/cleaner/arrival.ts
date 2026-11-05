/** Textos de la app de limpieza sobre la próxima llegada. */
import { timeLabel, whenLabel } from '@/features/operations/shared';

/** «Llega otro huésped a las 4:00 p. m.» (mismo día) o «Próxima llegada: vie 7 nov, 4:00 p. m.». */
export function nextArrivalText(task: { date: string; nextCheckIn?: { date: string; time: string } }, today: string): string | undefined {
  const n = task.nextCheckIn;
  if (!n) return undefined;
  if (n.date === task.date) return `Llega otro huésped a las ${timeLabel(n.time)}`;
  return `Próxima llegada: ${whenLabel(n.date, n.time, today).toLowerCase()}`;
}
