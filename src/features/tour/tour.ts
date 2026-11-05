/** Recorrido guiado: estado y arranque (se completa en la etapa E7). */
import { svc } from '@/services';

/** Restablece los datos, entra como propietario y devuelve la ruta de inicio. */
export async function startTour(login: (userId: string) => void): Promise<string | null> {
  await svc.system.resetDemo();
  login('u-owner');
  return '/panel';
}
