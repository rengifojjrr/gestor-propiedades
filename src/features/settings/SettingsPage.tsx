/**
 * Ajustes (Stitch «Account & System Settings»): perfil, empresa, monedas, aprobación de gastos,
 * datos privados, idiomas, plantillas, checklists, categorías, equipo, auditoría, demo y apariencia.
 * Propietario y administración; lo del sistema solo lo cambia el propietario (Administración lo ve
 * deshabilitado con la explicación). Barra de secciones fija en el teléfono; índice lateral en pantallas anchas.
 */
import { LogOut, Palette, ShieldCheck, UserPlus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useSession } from '@/app/session';
import { useLive, useLiveResult } from '@/data/live';
import { ROLE_DESCRIPTION, ROLE_LABEL } from '@/domain/labels';
import { DemoDataPanel } from '@/features/demo/DemoDataPanel';
import { ThemePicker } from '@/features/more/ProfilePage';
import { formatMoney } from '@/lib/money';
import { svc, type TeamMember } from '@/services';
import { Badge, Button, Card, cn, ErrorState, LinkButton, Loading, PageHeader } from '@/ui';
import { AuditSection } from './AuditSection';
import { CategoriesSection } from './CategoriesSection';
import { ChecklistSection } from './ChecklistSection';
import { SettingsSection, useSettingsPerms } from './SettingsSection';
import { ApprovalSection, CompanySection, CurrencySection, LanguagesSection, PrivacySection, TemplatesSection } from './SystemSections';
import { TeamSection, UserModal } from './TeamSection';

const SECTIONS = [
  { id: 'empresa', label: 'Empresa' },
  { id: 'monedas', label: 'Monedas' },
  { id: 'aprobacion', label: 'Aprobación de gastos' },
  { id: 'privados', label: 'Datos privados' },
  { id: 'idiomas', label: 'Idiomas' },
  { id: 'plantillas', label: 'Plantillas' },
  { id: 'checklists', label: 'Checklists de limpieza' },
  { id: 'categorias', label: 'Categorías de gasto' },
  { id: 'equipo', label: 'Equipo' },
  { id: 'auditoria', label: 'Auditoría' },
  { id: 'demo', label: 'Datos de la demo' },
  { id: 'apariencia', label: 'Apariencia' },
] as const;

type SectionId = (typeof SECTIONS)[number]['id'];

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');
}

function jumpTo(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/** Sección visible ahora (la primera que cruza la franja de arriba de la pantalla). */
function useActiveSection(ready: boolean): [SectionId, (id: SectionId) => void] {
  const [active, setActive] = useState<SectionId>(SECTIONS[0].id);
  useEffect(() => {
    if (!ready || typeof IntersectionObserver === 'undefined') return;
    const visible = new Map<string, boolean>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) visible.set(e.target.id, e.isIntersecting);
        const first = SECTIONS.find((s) => visible.get(s.id));
        if (first) setActive(first.id);
      },
      { rootMargin: '-150px 0px -55% 0px' },
    );
    for (const s of SECTIONS) {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    }
    // Al llegar al final, la última sección (no alcanza a subir hasta la franja).
    const onScroll = () => {
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 8) setActive(SECTIONS[SECTIONS.length - 1].id);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', onScroll);
    };
  }, [ready]);
  return [active, setActive];
}

export default function SettingsPage() {
  const { user, logout } = useSession();
  const { actor, isOwner, canManage } = useSettingsPerms();
  const navigate = useNavigate();
  const res = useLiveResult(() => svc.system.getAppSettings(actor), [actor]);
  const settings = res.data;
  const accounts = useLive(() => svc.system.listTeam(actor).catch(() => [] as TeamMember[]), [actor]);
  const [modal, setModal] = useState<TeamMember | 'new' | null>(null);
  const [active, setActive] = useActiveSection(!!settings);
  const barRef = useRef<HTMLDivElement>(null);

  // Mantiene a la vista el botón de la sección activa en la barra del teléfono.
  useEffect(() => {
    const bar = barRef.current;
    const chip = bar?.querySelector<HTMLElement>(`[data-section="${active}"]`);
    if (bar && chip) bar.scrollTo({ left: chip.offsetLeft - bar.clientWidth / 2 + chip.clientWidth / 2, behavior: 'smooth' });
  }, [active]);

  if (!user) return null;
  if (res.error && !settings) return <ErrorState error={res.error} />;
  if (!settings) return <Loading />;

  const go = (id: SectionId) => {
    setActive(id);
    jumpTo(id);
  };
  const activeCount = accounts?.filter((a) => a.active).length;

  return (
    <div data-testid="ajustes" className="space-y-6">
      <PageHeader title="Ajustes" subtitle="Tu empresa, el dinero, el equipo y la auditoría, en un solo lugar." />

      {/* Perfil y accesos rápidos */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
        <Card padding="lg" className="flex flex-col items-center gap-5 text-center md:col-span-8 md:flex-row md:text-left">
          <span aria-hidden className="flex h-20 w-20 shrink-0 items-center justify-center rounded-lg border-2 border-surface-high bg-surface-container text-headline-lg text-primary">
            {initials(user.name)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-headline-md text-primary">{user.name}</p>
            <p className="truncate text-body-md text-on-surface-variant">{user.email}</p>
            <Badge tone="good" icon={ShieldCheck} className="mt-2">
              {ROLE_LABEL[user.role]}
            </Badge>
            <p className="mt-2 text-body-sm text-on-surface-variant">{ROLE_DESCRIPTION[user.role]}</p>
          </div>
          <LinkButton to="/perfil" variant="secondary" className="w-full md:w-auto">
            Ver mi perfil
          </LinkButton>
        </Card>
        <Card tone="dark" padding="lg" className="flex flex-col justify-between gap-4 md:col-span-4">
          <div>
            <p className="text-label-md tracking-wider text-on-primary-container uppercase">Accesos rápidos</p>
            <p className="mt-1 text-body-sm text-on-primary-container-muted">
              Base {settings.baseCurrency} · aprobación desde {formatMoney(settings.approvalThreshold, settings.baseCurrency)}
              {activeCount != null && ` · ${activeCount} cuentas activas`}
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <Button variant="mint" icon={UserPlus} fullWidth disabled={!canManage} onClick={() => setModal('new')}>
              Agregar usuario
            </Button>
            <Button
              variant="danger"
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
        </Card>
      </div>

      {/* Barra de secciones (teléfono y tableta) */}
      <nav aria-label="Secciones de ajustes" className="sticky top-16 z-20 -mx-4 border-b border-outline-variant/60 bg-surface/95 px-4 py-2 backdrop-blur md:-mx-8 md:px-8 xl:hidden">
        <div ref={barRef} className="scrollbar-none flex gap-2 overflow-x-auto">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              data-section={s.id}
              aria-current={active === s.id ? 'true' : undefined}
              onClick={() => go(s.id)}
              className={cn(
                'h-9 shrink-0 rounded-full border px-3.5 text-label-md transition-colors',
                active === s.id ? 'border-primary bg-primary text-on-primary' : 'border-outline-variant bg-surface-lowest text-on-surface-variant hover:text-primary',
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
      </nav>

      <div className="xl:grid xl:grid-cols-[12.5rem_minmax(0,1fr)] xl:gap-6">
        {/* Índice lateral (pantallas anchas) */}
        <nav aria-label="Secciones de ajustes" className="hidden xl:block">
          <ul className="sticky top-24 space-y-0.5">
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => go(s.id)}
                  aria-current={active === s.id ? 'true' : undefined}
                  className={cn(
                    'w-full rounded-md px-3 py-2 text-left text-label-md transition-colors',
                    active === s.id ? 'bg-secondary-container text-on-secondary-container' : 'text-on-surface-variant hover:bg-surface-low hover:text-primary',
                  )}
                >
                  {s.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <div className="min-w-0 space-y-6">
          {!isOwner && (
            <p className="rounded-md bg-info-container px-4 py-3 text-body-sm text-on-info-container">
              Entraste como {ROLE_LABEL[user.role]}: ves todo, pero la empresa, las monedas, el umbral de aprobación y los datos privados solo los cambia el propietario.
            </p>
          )}
          <CompanySection key={`empresa-${settings.companyName}`} settings={settings} />
          <CurrencySection settings={settings} />
          <ApprovalSection key={`umbral-${settings.approvalThreshold}`} settings={settings} />
          <PrivacySection settings={settings} />
          <LanguagesSection settings={settings} />
          <TemplatesSection />
          <ChecklistSection />
          <CategoriesSection settings={settings} />
          <TeamSection onAdd={() => setModal('new')} onEdit={(m) => setModal(m)} />
          <AuditSection />
          <div id="demo" className="scroll-mt-36 xl:scroll-mt-24">
            <DemoDataPanel />
          </div>
          <SettingsSection id="apariencia" icon={Palette} title="Tema de la pantalla" subtitle="Claro, oscuro o como el sistema. Se guarda en este dispositivo.">
            <ThemePicker />
          </SettingsSection>
        </div>
      </div>

      {modal && <UserModal member={modal === 'new' ? null : modal} onClose={() => setModal(null)} />}
    </div>
  );
}
