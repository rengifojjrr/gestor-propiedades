/**
 * Sesión de la demo: quién entró («Entrar como…», sin contraseñas) y, para el propietario,
 * «Ver como…» (mirar con los ojos de otro rol, solo lectura). Se guarda en localStorage.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { refreshAll, useLive } from '@/data/live';
import type { Role, User } from '@/domain/types';
import { actorFor, svc, type Actor } from '@/services';

const KEY = 'gp.session';

interface Stored {
  userId: string | null;
  viewAsUserId: string | null;
}

function read(): Stored {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { userId: null, viewAsUserId: null, ...JSON.parse(raw) };
  } catch {
    /* sin almacenamiento */
  }
  return { userId: null, viewAsUserId: null };
}

function write(s: Stored) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* nada */
  }
}

export interface SessionValue {
  ready: boolean;
  /** Usuario efectivo (el «ver como» si está activo). */
  user: User | null;
  /** Quien realmente entró. */
  realUser: User | null;
  actor: Actor | null;
  viewingAs: boolean;
  accounts: User[];
  login(userId: string): void;
  logout(): void;
  viewAs(userId: string | null): void;
}

const Ctx = createContext<SessionValue | null>(null);

export const HOME_BY_ROLE: Record<Role, string> = {
  owner: '/panel',
  admin: '/panel',
  support: '/panel',
  accountant: '/finanzas',
  cleaner: '/limpieza',
  technician: '/tecnico',
  guest: '/huesped',
  tenant: '/inquilino',
};

export function SessionProvider({ children, ready: dataReady }: { children: ReactNode; ready: boolean }) {
  const [stored, setStored] = useState<Stored>(read);
  const accountsList = useLive(() => (dataReady ? svc.system.demoAccounts() : Promise.resolve(null)), [dataReady]);
  const accounts = useMemo(() => accountsList?.map((a) => a.user) ?? [], [accountsList]);
  const realUser = accounts.find((u) => u.id === stored.userId) ?? null;
  const viewUser = realUser?.role === 'owner' && stored.viewAsUserId ? (accounts.find((u) => u.id === stored.viewAsUserId) ?? null) : null;
  const user = viewUser ?? realUser;

  // El actor cambia solo si cambia algo que importa para los permisos.
  const key = [realUser?.id, realUser?.role, JSON.stringify(realUser?.propertyIds), realUser?.active, viewUser?.id, viewUser?.role, JSON.stringify(viewUser?.propertyIds)].join('|');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const actor = useMemo(() => (realUser ? actorFor(viewUser ?? realUser, viewUser ? realUser : undefined) : null), [key]);

  useEffect(() => write(stored), [stored]);
  useEffect(() => {
    refreshAll();
  }, [key]);

  const login = useCallback((userId: string) => setStored({ userId, viewAsUserId: null }), []);
  const logout = useCallback(() => setStored({ userId: null, viewAsUserId: null }), []);
  const viewAs = useCallback((userId: string | null) => setStored((s) => ({ ...s, viewAsUserId: userId })), []);

  const value = useMemo<SessionValue>(
    () => ({
      // Listo cuando hay datos Y ya llegó la lista de cuentas (si no, un enlace profundo se pierde al recargar).
      ready: dataReady && Array.isArray(accountsList),
      user,
      realUser,
      actor,
      viewingAs: !!viewUser,
      accounts,
      login,
      logout,
      viewAs,
    }),
    [dataReady, accountsList, user, realUser, actor, viewUser, accounts, login, logout, viewAs],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSession fuera de SessionProvider');
  return v;
}

/** El actor actual (solo dentro de rutas protegidas). */
export function useActor(): Actor {
  const { actor } = useSession();
  if (!actor) throw new Error('useActor sin sesión');
  return actor;
}
