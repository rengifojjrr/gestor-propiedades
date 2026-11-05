/** «Más» (teléfono): el resto del menú del rol, tema, datos de la demo y salir. */
import { Info, LogOut, PlayCircle } from 'lucide-react';
import { useNavigate } from 'react-router';
import { NAV } from '@/app/nav';
import { useSession } from '@/app/session';
import { DemoDataPanel } from '@/features/demo/DemoDataPanel';
import { startTour } from '@/features/tour/tour';
import { Card, ListRow, PageHeader } from '@/ui';
import { ThemePicker } from './ProfilePage';

export default function MorePage() {
  const { user, logout, login } = useSession();
  const navigate = useNavigate();
  if (!user) return null;
  const items = NAV[user.role].more;
  return (
    <div className="space-y-6">
      <PageHeader title="Más" subtitle="Todo lo demás de tu menú." />
      <Card padding="sm" className="space-y-1">
        {items.map((item) => (
          <ListRow key={item.to + item.label} to={item.to} icon={item.icon} title={item.label} tone="plain" />
        ))}
        {(user.role === 'owner' || user.role === 'admin') && (
          <ListRow
            icon={PlayCircle}
            title="Recorrido guiado (8 pasos)"
            subtitle="Restablece los datos y cuenta la historia completa"
            tone="plain"
            onClick={async () => {
              const home = await startTour(login);
              if (home) navigate(home);
            }}
          />
        )}
        <ListRow to="/creditos" icon={Info} title="Créditos" tone="plain" />
        <ListRow
          icon={LogOut}
          title="Salir"
          subtitle="Volver a «Entrar como…»"
          tone="plain"
          onClick={() => {
            logout();
            navigate('/entrar');
          }}
        />
      </Card>
      <Card>
        <ThemePicker />
      </Card>
      {(user.role === 'owner' || user.role === 'admin') && <DemoDataPanel compact />}
    </div>
  );
}
