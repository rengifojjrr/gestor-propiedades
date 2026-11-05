/** Botón flotante «Cambiar de rol» (para la presentación) y la lista de cuentas de ejemplo. */
import { Check, Users } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { NAV } from '@/app/nav';
import { HOME_BY_ROLE, useSession } from '@/app/session';
import { ROLE_DESCRIPTION, ROLE_LABEL } from '@/domain/labels';
import type { User } from '@/domain/types';
import { useTour } from '@/features/tour/tour';
import { Avatar, cn, Modal } from '@/ui';

export function AccountList({ onPick, currentId }: { onPick: (u: User) => void; currentId?: string }) {
  const { accounts } = useSession();
  return (
    <ul className="space-y-2">
      {accounts.map((u) => (
        <li key={u.id}>
          <button
            type="button"
            onClick={() => onPick(u)}
            data-testid={`entrar-${u.id}`}
            className={cn(
              'flex w-full items-center gap-3 rounded-md border border-outline-variant/60 bg-surface-lowest p-3 text-left transition-colors hover:border-primary',
              currentId === u.id && 'border-secondary bg-secondary-container/30',
            )}
          >
            <Avatar name={u.name} />
            <span className="min-w-0 flex-1">
              <span className="block text-label-md text-primary">
                {ROLE_LABEL[u.role]} · <span className="font-normal">{u.name}</span>
              </span>
              <span className="block truncate text-body-sm text-on-surface-variant">{u.title ?? ROLE_DESCRIPTION[u.role]}</span>
            </span>
            {currentId === u.id && <Check size={18} className="text-secondary" aria-label="Cuenta actual" />}
          </button>
        </li>
      ))}
    </ul>
  );
}

export function RoleSwitcher() {
  const { realUser, user, login } = useSession();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const tour = useTour();
  // Durante el recorrido, el propio recorrido cambia de rol (el botón vuelve al minimizarlo).
  if (tour.active && !tour.minimized) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid="cambiar-rol"
        className={cn(
          'no-print fixed bottom-24 left-4 z-30 flex h-11 items-center gap-2 rounded-full bg-primary-container px-4 text-label-md text-on-primary-container shadow-pop',
          // En las apps de huésped e inquilino la barra de abajo sigue en la computadora: el botón va encima.
          user && NAV[user.role].variant !== 'person' && 'lg:bottom-6',
        )}
      >
        <Users size={18} aria-hidden />
        Cambiar de rol
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Cambiar de rol">
        <p className="mb-3 text-body-sm text-on-surface-variant">Demo: entra con cualquier cuenta de ejemplo, sin contraseña.</p>
        <AccountList
          currentId={realUser?.id}
          onPick={(u) => {
            login(u.id);
            setOpen(false);
            navigate(HOME_BY_ROLE[u.role]);
          }}
        />
      </Modal>
    </>
  );
}
