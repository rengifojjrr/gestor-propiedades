/**
 * Recorrido guiado de 8 pasos (la historia completa de la demo):
 * panel → propiedad → reserva que termina hoy → limpieza que se crea sola → la limpieza con fotos y un daño →
 * orden urgente → el técnico la resuelve con foto y costo → el gasto en finanzas y la ganancia que baja.
 * Cada paso se puede hacer a mano en la pantalla o con «Hazlo por mí». El estado vive en localStorage.
 */
import { useEffect, useState } from 'react';
import { sampleImage } from '@/lib/images';
import { todayLocal } from '@/lib/clock';
import { monthKeyOf } from '@/lib/dates';
import { actorFor, svc, type Actor } from '@/services';

export const TOUR_PROPERTY = 'p-miami';
export const TOUR_GUEST = 'g-lucia';
export const TOUR_CLEANER = 'u-clean-1';
export const TOUR_TECH = 'u-tech';
export const TOUR_OWNER = 'u-owner';
export const TOUR_COST = 240;

export interface TourState {
  active: boolean;
  step: number;
  minimized: boolean;
  bookingId?: string;
  cleaningTaskId?: string;
  orderId?: string;
  profitBefore?: number;
  profitAfter?: number;
}

const KEY = 'gp.tour';
const listeners = new Set<() => void>();
let state: TourState = read();

function read(): TourState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as TourState;
  } catch {
    /* sin almacenamiento */
  }
  return { active: false, step: 1, minimized: false };
}

export function getTour(): TourState {
  return state;
}

export function setTour(patch: Partial<TourState>): void {
  state = { ...state, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* nada */
  }
  listeners.forEach((l) => l());
}

export function useTour(): TourState {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  return state;
}

async function actorOf(userId: string): Promise<Actor> {
  const user = await svc.system.getUser(userId);
  if (!user) throw new Error(`No existe la cuenta ${userId}`);
  return actorFor(user);
}

async function monthProfit(): Promise<number> {
  const owner = await actorOf(TOUR_OWNER);
  return (await svc.finance.monthSummary(owner, monthKeyOf(todayLocal()))).net;
}

/** Busca la reserva del recorrido: la de Lucía en Miami que termina hoy. */
async function findTourBooking(): Promise<string | undefined> {
  const owner = await actorOf(TOUR_OWNER);
  const list = await svc.bookings.listBookings(owner, { propertyId: TOUR_PROPERTY, guestId: TOUR_GUEST });
  return list.find((b) => b.checkOut === b.today && b.status !== 'cancelled')?.id ?? list[list.length - 1]?.id;
}

/** Restablece los datos, entra como propietario y arranca en el paso 1. Devuelve la ruta. */
export async function startTour(login: (userId: string) => void): Promise<string | null> {
  await svc.system.resetDemo();
  const bookingId = await findTourBooking();
  setTour({ active: true, step: 1, minimized: false, bookingId, cleaningTaskId: undefined, orderId: undefined, profitBefore: undefined, profitAfter: undefined });
  login(TOUR_OWNER);
  return '/panel';
}

export function endTour(): void {
  setTour({ active: false, step: 1, minimized: false });
}

export interface TourProgress {
  bookingDone: boolean;
  cleaningTaskId?: string;
  cleaningDone: boolean;
  damageReported: boolean;
  orderId?: string;
  orderCode?: string;
  orderResolved: boolean;
  profitNow?: number;
}

/** Lee cómo va la historia (para saber si cada paso ya está hecho, aunque se haya hecho a mano). */
export async function tourProgress(t: TourState): Promise<TourProgress> {
  const owner = await actorOf(TOUR_OWNER);
  const p: TourProgress = { bookingDone: false, cleaningDone: false, damageReported: false, orderResolved: false };
  if (!t.bookingId) return p;
  const booking = await svc.bookings.getBooking(owner, t.bookingId).catch(() => undefined);
  p.bookingDone = booking?.status === 'completed';
  const tasks = await svc.operations.listCleaning(owner, { propertyId: TOUR_PROPERTY });
  const task = tasks.find((x) => x.bookingId === t.bookingId && x.type === 'checkout');
  if (task) {
    p.cleaningTaskId = task.id;
    p.cleaningDone = task.status === 'done';
    p.damageReported = task.incidentIds.length > 0;
    if (task.incidentIds.length) {
      const incidents = await svc.operations.listIncidents(owner, { propertyId: TOUR_PROPERTY });
      const inc = incidents.find((i) => task.incidentIds.includes(i.id) && i.maintenanceOrderId);
      if (inc?.maintenanceOrderId) {
        const order = await svc.operations.getOrder(owner, inc.maintenanceOrderId).catch(() => undefined);
        p.orderId = order?.id;
        p.orderCode = order?.code;
        p.orderResolved = order?.status === 'resolved';
      }
    }
  }
  if (t.step >= 7) p.profitNow = await monthProfit();
  return p;
}

export interface TourStep {
  n: number;
  title: string;
  body: (t: TourState, p: TourProgress) => string;
  /** Cuenta con la que se mira este paso. */
  userId: string;
  route: (t: TourState, p: TourProgress) => string;
  /** Acción de «Hazlo por mí». */
  action?: (t: TourState, p: TourProgress) => Promise<void>;
  actionLabel?: string;
  /** Si el paso pide hacer algo, cuándo quedó hecho. */
  done?: (p: TourProgress) => boolean;
}

export const STEPS: TourStep[] = [
  {
    n: 1,
    title: 'El panel del propietario',
    body: () => 'Todo en un solo lugar: propiedades ocupadas y libres, ocupación, ganancia neta del mes, alertas, el mapa y lo de hoy.',
    userId: TOUR_OWNER,
    route: () => '/panel',
  },
  {
    n: 2,
    title: 'Abre una propiedad',
    body: () => 'La ficha del Apartamento Moderno Miami: operación (reserva, limpieza, órdenes), salud de la propiedad, finanzas y documentos.',
    userId: TOUR_OWNER,
    route: () => `/propiedades/${TOUR_PROPERTY}`,
  },
  {
    n: 3,
    title: 'Una reserva termina hoy',
    body: (_t, p) => (p.bookingDone ? 'Salida registrada. La reserva quedó «terminada» y su ingreso ya está en las finanzas.' : 'Lucía Fernández sale hoy. Toca «Registrar salida» en la reserva, o «Hazlo por mí».'),
    userId: TOUR_OWNER,
    route: (t) => `/reservas/${t.bookingId}`,
    actionLabel: 'Registrar la salida',
    action: async (t) => {
      const owner = await actorOf(TOUR_OWNER);
      await svc.bookings.checkOutBooking(owner, t.bookingId!);
    },
    done: (p) => p.bookingDone,
  },
  {
    n: 4,
    title: 'La limpieza de salida se creó sola',
    body: () => 'Al terminar la reserva se creó la limpieza de salida, asignada a Rosa, con la checklist de la propiedad y la hora de la próxima entrada.',
    userId: TOUR_OWNER,
    route: (_t, p) => (p.cleaningTaskId ? `/operacion/limpieza/${p.cleaningTaskId}` : '/operacion'),
  },
  {
    n: 5,
    title: 'Rosa limpia con fotos y reporta un daño',
    body: (_t, p) =>
      p.cleaningDone && p.damageReported
        ? 'Listo: checklist completa, fotos de antes y después, y un daño reportado (una fuga) que ya es una orden urgente.'
        : 'Ahora eres Rosa (limpieza). Fotos de antes, checklist, fotos de después y «Reportar daño». «Hazlo por mí» lo hace con fotos de ejemplo.',
    userId: TOUR_CLEANER,
    route: (_t, p) => (p.cleaningTaskId ? `/limpieza/tarea/${p.cleaningTaskId}` : '/limpieza'),
    actionLabel: 'Limpiar y reportar el daño',
    action: async (_t, p) => {
      if (!p.cleaningTaskId) throw new Error('Primero registra la salida (paso 3).');
      const rosa = await actorOf(TOUR_CLEANER);
      const id = p.cleaningTaskId;
      let task = await svc.operations.getCleaning(rosa, id);
      if (task.status === 'done' && task.incidentIds.length) return;
      if (!task.photos.some((x) => x.phase === 'before'))
        await svc.operations.addCleaningPhoto(rosa, id, 'before', await sampleImage('before', 'Baño principal'));
      task = await svc.operations.getCleaning(rosa, id);
      for (let i = 0; i < task.items.length; i++) if (!task.items[i].done) await svc.operations.setCleaningItem(rosa, id, i, true);
      if (!task.incidentIds.length)
        await svc.operations.reportDamage(
          rosa,
          id,
          { title: 'Fuga debajo del lavamanos', description: 'Gotea el sifón del baño principal y el mueble está mojado.', category: 'plumbing', severity: 'urgent', kind: 'damage' },
          await sampleImage('damage', 'Sifón del lavamanos'),
        );
      if (!task.photos.some((x) => x.phase === 'after'))
        await svc.operations.addCleaningPhoto(rosa, id, 'after', await sampleImage('after', 'Baño principal'));
      task = await svc.operations.getCleaning(rosa, id);
      if (task.status !== 'done') await svc.operations.completeCleaning(rosa, id);
    },
    done: (p) => p.cleaningDone && p.damageReported,
  },
  {
    n: 6,
    title: 'El daño se volvió una orden urgente',
    body: (_t, p) => `El reporte de Rosa creó solo la orden ${p.orderCode ?? ''} con prioridad urgente, asignada a Tomás (técnico), con la foto del daño.`.replace('  ', ' '),
    userId: TOUR_OWNER,
    route: (_t, p) => (p.orderId ? `/operacion/mantenimiento/${p.orderId}` : '/operacion'),
  },
  {
    n: 7,
    title: 'El técnico la resuelve con foto y costo',
    body: (_t, p) =>
      p.orderResolved
        ? 'Resuelta. El costo se registró como gasto de mantenimiento de la propiedad.'
        : `Ahora eres Tomás (técnico). Sube la foto de lo resuelto, anota el costo real (${TOUR_COST} USD) y márcala como resuelta.`,
    userId: TOUR_TECH,
    route: (_t, p) => (p.orderId ? `/tecnico/orden/${p.orderId}` : '/tecnico'),
    actionLabel: 'Resolver con foto y costo',
    action: async (_t, p) => {
      if (!p.orderId) throw new Error('Primero reporta el daño (paso 5).');
      const tomas = await actorOf(TOUR_TECH);
      const order = await svc.operations.getOrder(tomas, p.orderId);
      if (order.status === 'resolved') return;
      if (order.status !== 'in_progress') await svc.operations.updateOrder(tomas, p.orderId, { status: 'in_progress' });
      if (!order.photos.some((x) => x.phase === 'resolved'))
        await svc.operations.addOrderPhoto(tomas, p.orderId, 'resolved', await sampleImage('resolved', 'Sifón nuevo, sin fuga'));
      await svc.operations.resolveOrder(tomas, p.orderId, {
        actualCost: TOUR_COST,
        materials: [{ name: 'Sifón y sellador', qty: 1, cost: 35 }],
        note: 'Se cambió el sifón y se secó el mueble.',
      });
    },
    done: (p) => p.orderResolved,
  },
  {
    n: 8,
    title: 'El gasto llega a finanzas y la ganancia baja',
    body: (t, p) =>
      t.profitBefore != null && p.profitNow != null
        ? `La ganancia neta del mes pasó de ${fmt(t.profitBefore)} a ${fmt(p.profitNow)} (${fmt(p.profitNow - t.profitBefore)}). El gasto está en Finanzas → Mantenimiento.`
        : 'El costo de la reparación ya es un gasto de la propiedad y la ganancia neta del mes bajó en el panel.',
    userId: TOUR_OWNER,
    route: () => '/panel',
  },
];

function fmt(n: number): string {
  return new Intl.NumberFormat('es-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
}

/** Antes de entrar al paso 7 se guarda la ganancia del mes, para mostrar cuánto baja en el paso 8. */
export async function captureProfitBefore(): Promise<void> {
  if (getTour().profitBefore == null) setTour({ profitBefore: await monthProfit() });
}
