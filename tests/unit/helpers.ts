/** Ayudas de prueba: fija «hoy», carga la semilla y da el actor de cada cuenta de ejemplo. */
import { data } from '@/data';
import { buildSeed } from '@/data/seed';
import { clock } from '@/lib/clock';
import { actorFor, type Actor } from '@/services';

/** Jueves 5 de noviembre de 2026, 10:00 en Nueva York. */
export const TODAY = '2026-11-05';

export async function seedAt(iso = `${TODAY}T10:00:00`): Promise<void> {
  clock.setFixed(iso, 'America/New_York');
  await data().replaceAll(buildSeed(clock.now()), []);
}

export async function as(userId: string, viewer?: string): Promise<Actor> {
  const user = await data().users.get(userId);
  if (!user) throw new Error(`No existe ${userId}`);
  const v = viewer ? await data().users.get(viewer) : undefined;
  return actorFor(user, v);
}
