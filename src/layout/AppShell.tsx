/**
 * Marco de la app: barra de arriba, riel izquierdo (computadora), barra de abajo (teléfono),
 * franjas de «Ver como…» y de datos viejos, botón flotante «Cambiar de rol» y el recorrido guiado.
 */
import { Bell, Eye, RotateCcw } from 'lucide-react';
import { Suspense, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { NAV, PERSON_NAV_LABELS, type NavItem } from '@/app/nav';
import { useSession } from '@/app/session';
import { useLive } from '@/data/live';
import { ROLE_LABEL } from '@/domain/labels';
import { formatDate } from '@/lib/dates';
import { useLang } from '@/lib/i18n';
import { svc } from '@/services';
import { Avatar, Badge, Banner, Button, cn, IconButton, Loading, useConfirm, useFileUrl } from '@/ui';
import { TourPanel } from '@/features/tour/TourPanel';
import { RoleSwitcher } from './RoleSwitcher';

function isActive(item: NavItem, pathname: string) {
  if (item.prefix === false) return pathname === item.to;
  return pathname === item.to || pathname.startsWith(`${item.to}/`);
}

function Brand() {
  const info = useLive(() => svc.system.getCompanyName(), []);
  const logoUrl = useFileUrl(info?.logoFileId);
  return (
    <span className="flex min-w-0 items-center gap-2">
      <img src={logoUrl ?? `${import.meta.env.BASE_URL}logo.svg`} alt="" className="h-8 w-8 shrink-0 rounded-md object-cover" />
      <span className="truncate text-headline-md font-bold text-primary">{info?.companyName ?? 'Gestor de Propiedades'}</span>
    </span>
  );
}

export function AppShell() {
  const { user, actor, realUser, viewingAs, viewAs } = useSession();
  const { pathname } = useLocation();
  const personLang = useLive(
    () =>
      actor?.user.role === 'guest'
        ? svc.bookings.guestHome(actor).then((h) => h.person.language)
        : actor?.user.role === 'tenant'
          ? svc.leases.tenantHome(actor).then((h) => h.person.language)
          : Promise.resolve(undefined),
    [actor],
  );
  const [lang, setLang] = useLang(personLang ?? 'es');
  const unread = useLive(() => (actor ? svc.system.unreadCount(actor) : Promise.resolve(0)), [actor]);
  const demo = useLive(() => svc.system.demoInfo(), []);
  const confirm = useConfirm();
  const [resetting, setResetting] = useState(false);
  if (!user || !actor) return null;
  const nav = NAV[user.role];
  const person = nav.variant === 'person';
  const label = (item: NavItem) => (person ? PERSON_NAV_LABELS[lang][item.label as keyof (typeof PERSON_NAV_LABELS)['es']] : item.label);

  return (
    <div className="min-h-dvh bg-surface">
      <a href="#contenido" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[90] focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-on-primary">
        Ir al contenido
      </a>
      <header className="pt-safe sticky top-0 z-40 border-b border-outline-variant bg-surface-lowest/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between gap-3 px-4 md:px-6">
          <Link to="/" className="min-w-0" aria-label="Inicio">
            <Brand />
          </Link>
          <div className="flex items-center gap-1 md:gap-2">
            <Badge tone="warn" className="hidden md:inline-flex">
              Datos de ejemplo
            </Badge>
            {person && (
              <div className="flex rounded-full bg-surface-container p-0.5" role="group" aria-label="Idioma / Language">
                {(['es', 'en'] as const).map((l) => (
                  <button
                    key={l}
                    type="button"
                    aria-pressed={lang === l}
                    onClick={() => setLang(l)}
                    className={cn('h-8 rounded-full px-3 text-label-md uppercase', lang === l ? 'bg-primary text-on-primary' : 'text-on-surface-variant')}
                  >
                    {l}
                  </button>
                ))}
              </div>
            )}
            {!person && (
              <Link to="/avisos" aria-label={`Avisos${unread ? `: ${unread} sin leer` : ''}`}>
                <IconButton icon={Bell} label="Avisos" badge={unread} tabIndex={-1} />
              </Link>
            )}
            <Link to="/perfil" className="rounded-full" aria-label={`Perfil de ${user.name}`}>
              <Avatar name={user.name} />
            </Link>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-[1440px]">
        {!person && (
          <aside className="sticky top-16 hidden h-[calc(100dvh-4rem)] w-64 shrink-0 flex-col overflow-y-auto border-r border-outline-variant bg-surface-container py-5 lg:flex" aria-label="Menú">
            <p className="mb-3 px-6 text-label-sm uppercase text-on-surface-variant">{ROLE_LABEL[user.role]}</p>
            <nav className="flex flex-col gap-1 px-2">
              {nav.rail.map((item) => (
                <NavLink
                  key={item.to + item.label}
                  to={item.to}
                  className={cn(
                    'flex items-center gap-3 rounded-md px-4 py-3 text-label-md transition-colors',
                    isActive(item, pathname) ? 'bg-secondary-container font-bold text-on-secondary-container' : 'text-on-surface-variant hover:bg-surface-high',
                  )}
                >
                  <item.icon size={20} aria-hidden />
                  {item.label}
                </NavLink>
              ))}
            </nav>
          </aside>
        )}

        <main id="contenido" className={cn('min-w-0 flex-1 px-4 pt-5 pb-40 md:px-8 lg:pb-16', person ? 'mx-auto max-w-3xl' : 'max-w-[1280px]')}>
          {viewingAs && realUser && (
            <Banner
              tone="warn"
              icon={Eye}
              className="mb-4"
              action={
                <Button size="sm" variant="secondary" onClick={() => viewAs(null)}>
                  Volver a mi cuenta
                </Button>
              }
            >
              Estás viendo como <strong>{user.name}</strong> ({ROLE_LABEL[user.role]}). Solo mirar: no se puede cambiar nada.
            </Banner>
          )}
          {demo?.stale && !viewingAs && (realUser?.role === 'owner' || realUser?.role === 'admin') && (
            <Banner
              tone="info"
              icon={RotateCcw}
              className="mb-4"
              action={
                <Button
                  size="sm"
                  variant="secondary"
                  loading={resetting}
                  onClick={async () => {
                    if (!(await confirm({ title: '¿Restablecer los datos de ejemplo?', body: 'Se borra lo que cambiaste en este navegador y se crean los datos para hoy.', confirmLabel: 'Restablecer' }))) return;
                    setResetting(true);
                    await svc.system.resetDemo();
                    setResetting(false);
                  }}
                >
                  Restablecer
                </Button>
              }
            >
              Los datos de ejemplo son del {demo.seedDate ? formatDate(demo.seedDate, { year: true }) : '—'}. Restablécelos para que «hoy» cuadre.
            </Banner>
          )}
          <Suspense fallback={<Loading />}>
            <Outlet />
          </Suspense>
        </main>
      </div>

      <nav className={cn('pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-outline-variant bg-surface-lowest shadow-pop', !person && 'lg:hidden')} aria-label="Menú principal">
        <div className={cn('mx-auto flex h-20 items-center justify-around px-2', person && 'max-w-3xl')}>
          {nav.bottom.map((item) => {
            const active = isActive(item, pathname);
            return (
              <NavLink
                key={item.to + item.label}
                to={item.to}
                className={cn(
                  'flex min-w-16 flex-col items-center justify-center gap-0.5 rounded-md px-3 py-1.5 text-[11px] font-semibold',
                  active ? 'bg-secondary-container text-on-secondary-container' : 'text-on-surface-variant',
                )}
                aria-current={active ? 'page' : undefined}
              >
                <item.icon size={22} aria-hidden />
                <span className="max-w-20 truncate">{label(item)}</span>
              </NavLink>
            );
          })}
        </div>
      </nav>

      <RoleSwitcher />
      <TourPanel />
    </div>
  );
}
