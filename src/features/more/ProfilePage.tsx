/** Perfil: quién eres, tu rol, «Ver como…» (solo propietario), tema claro/oscuro y salir. */
import { Eye, LogOut, Monitor, Moon, Sun } from 'lucide-react';
import { useNavigate } from 'react-router';
import { HOME_BY_ROLE, useSession } from '@/app/session';
import { useThemeMode, type ThemeMode } from '@/app/theme';
import { ROLE_DESCRIPTION, ROLE_LABEL } from '@/domain/labels';
import { Avatar, Badge, Button, Card, CardHeader, cn, PageHeader, Select } from '@/ui';

export function ThemePicker() {
  const [mode, setMode] = useThemeMode();
  const options: { id: ThemeMode; label: string; icon: typeof Sun }[] = [
    { id: 'system', label: 'Sistema', icon: Monitor },
    { id: 'light', label: 'Claro', icon: Sun },
    { id: 'dark', label: 'Oscuro', icon: Moon },
  ];
  return (
    <div>
      <p className="mb-2 text-label-md text-on-surface">Apariencia</p>
      <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Apariencia">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={mode === o.id}
            onClick={() => setMode(o.id)}
            className={cn('flex h-16 flex-col items-center justify-center gap-1 rounded-md border text-label-sm', mode === o.id ? 'border-secondary bg-secondary-container text-on-secondary-container' : 'border-outline-variant text-on-surface-variant')}
          >
            <o.icon size={20} aria-hidden />
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function ProfilePage() {
  const { user, realUser, accounts, viewAs, viewingAs, logout } = useSession();
  const navigate = useNavigate();
  if (!user || !realUser) return null;
  return (
    <div className="space-y-6">
      <PageHeader title="Perfil" />
      <Card padding="lg" className="flex flex-col items-center text-center">
        <Avatar name={user.name} size="lg" />
        <p className="mt-3 text-headline-md text-primary">{user.name}</p>
        <p className="text-body-sm text-on-surface-variant">{user.email}</p>
        <Badge tone="good" className="mt-2">
          {ROLE_LABEL[user.role]}
        </Badge>
        <p className="mt-2 max-w-sm text-body-sm text-on-surface-variant">{ROLE_DESCRIPTION[user.role]}</p>
      </Card>

      {realUser.role === 'owner' && (
        <Card padding="lg">
          <CardHeader title="Ver como…" subtitle="Mira la app con los ojos de otro rol. Solo mirar: no se puede cambiar nada." action={<Eye size={20} className="text-primary" aria-hidden />} />
          <Select
            label="Cuenta"
            value={viewingAs ? user.id : ''}
            placeholder="— Mi cuenta (propietario) —"
            options={accounts.filter((u) => u.role !== 'owner').map((u) => ({ value: u.id, label: `${ROLE_LABEL[u.role]} · ${u.name}` }))}
            onChange={(e) => {
              const id = e.target.value || null;
              viewAs(id);
              const target = accounts.find((u) => u.id === id);
              navigate(HOME_BY_ROLE[target?.role ?? 'owner']);
            }}
          />
        </Card>
      )}

      <Card padding="lg">
        <ThemePicker />
      </Card>

      <Button
        variant="secondary"
        icon={LogOut}
        fullWidth
        onClick={() => {
          logout();
          navigate('/entrar');
        }}
      >
        Salir
      </Button>
    </div>
  );
}
