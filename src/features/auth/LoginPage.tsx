/**
 * Entrada: «Entrar como…» (cuentas de ejemplo, sin contraseña), recorrido guiado,
 * QR del link para abrirla en el teléfono, «Instalar» y las herramientas de la demo.
 */
import { Download, PlayCircle, QrCode, Share, Smartphone } from 'lucide-react';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { useInstall } from '@/app/install';
import { HOME_BY_ROLE, useSession } from '@/app/session';
import { useLive } from '@/data/live';
import { DemoDataPanel } from '@/features/demo/DemoDataPanel';
import { startTour } from '@/features/tour/tour';
import { formatDate } from '@/lib/dates';
import { clearLangPreference } from '@/lib/i18n';
import { svc } from '@/services';
import { AccountList } from '@/layout/RoleSwitcher';
import { Badge, Banner, Button, Card, CardHeader, Loading, Skeleton, tokenValue } from '@/ui';

function AppQr() {
  const [src, setSrc] = useState<string>();
  const url = `${window.location.origin}${import.meta.env.BASE_URL}`;
  useEffect(() => {
    QRCode.toDataURL(url, { margin: 1, width: 220, color: { dark: tokenValue('primary') || undefined, light: tokenValue('surface-lowest') || undefined } })
      .then(setSrc)
      .catch(() => setSrc(undefined));
  }, [url]);
  return (
    <div className="flex flex-col items-center gap-2">
      {src ? <img src={src} alt={`Código QR para abrir ${url}`} className="h-44 w-44 rounded-md" /> : <div className="h-44 w-44 animate-pulse rounded-md bg-surface-container" />}
      <a href={url} className="max-w-full truncate text-label-sm text-on-surface-variant underline">
        {url.replace(/^https?:\/\//, '')}
      </a>
    </div>
  );
}

export default function LoginPage() {
  const { ready, realUser, login } = useSession();
  const navigate = useNavigate();
  const info = useLive(() => svc.system.demoInfo(), []);
  const install = useInstall();
  const [starting, setStarting] = useState(false);
  if (ready && realUser) return <Navigate to={HOME_BY_ROLE[realUser.role]} replace />;

  return (
    <div className="min-h-dvh bg-surface">
      <div className="mx-auto max-w-5xl px-4 py-8 md:py-12">
        <header className="mb-8 flex flex-col items-start gap-3">
          <img src={`${import.meta.env.BASE_URL}logo.svg`} alt="" className="h-14 w-14 rounded-lg" />
          <div>
            <h1 className="text-headline-xl text-primary">Gestor de Propiedades</h1>
            <p className="mt-1 text-body-lg text-on-surface-variant">Uso interno: todas las propiedades, sus problemas y sus cuentas, desde un solo panel.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge tone="warn">Datos de ejemplo</Badge>
            {info?.seedDate && <Badge tone="info">Datos del {formatDate(info.seedDate, { year: true })}</Badge>}
          </div>
        </header>

        {info?.stale && (
          <Banner tone="warn" className="mb-6">
            Los datos de ejemplo son de otro día. Usa «Restablecer» (abajo) o inicia el recorrido: ahí se restablecen solos.
          </Banner>
        )}

        <div className="grid gap-6 lg:grid-cols-5">
          <Card padding="lg" className="lg:col-span-3">
            <CardHeader title="Entrar como…" subtitle="Elige una cuenta de ejemplo. Cada rol ve su propia app y solo sus datos." />
            {ready ? (
              <AccountList
                onPick={(u) => {
                  clearLangPreference();
                  login(u.id);
                  navigate(HOME_BY_ROLE[u.role]);
                }}
              />
            ) : (
              <div className="space-y-2" aria-busy="true">
                <Loading label="Preparando los datos de ejemplo…" className="py-4" />
                {Array.from({ length: 6 }, (_, i) => (
                  <Skeleton key={i} className="h-16" />
                ))}
              </div>
            )}
          </Card>

          <div className="space-y-6 lg:col-span-2">
            <Card tone="dark" padding="lg">
              <h2 className="text-headline-md">Recorrido guiado</h2>
              <p className="mt-1 text-body-sm text-on-primary-container-muted">
                8 pasos: del panel a una salida, la limpieza con fotos, el daño que se vuelve orden urgente, el técnico que la resuelve y el gasto en las finanzas.
              </p>
              <Button
                variant="mint"
                size="lg"
                icon={PlayCircle}
                className="mt-4"
                fullWidth
                loading={starting}
                disabled={!ready}
                data-testid="iniciar-recorrido"
                onClick={async () => {
                  setStarting(true);
                  const home = await startTour(login);
                  setStarting(false);
                  if (home) navigate(home);
                }}
              >
                Iniciar recorrido
              </Button>
              <p className="mt-2 text-label-sm font-normal text-on-primary-container-muted">Restablece los datos de ejemplo antes de empezar.</p>
            </Card>

            <Card padding="lg">
              <CardHeader title="Ábrela en el teléfono" subtitle="Escanea el código y toca «Instalar»." action={<QrCode size={22} className="text-primary" aria-hidden />} />
              <AppQr />
              <div className="mt-4 space-y-2">
                {install.installed ? (
                  <Banner tone="good" icon={Smartphone}>
                    Ya está instalada en este dispositivo.
                  </Banner>
                ) : install.canPrompt ? (
                  <Button icon={Download} fullWidth onClick={install.install}>
                    Instalar
                  </Button>
                ) : install.ios ? (
                  <Banner icon={Share}>En iPhone: toca Compartir y luego «Agregar a inicio».</Banner>
                ) : (
                  <p className="text-body-sm text-on-surface-variant">En Chrome o Edge: menú ⋮ → «Instalar app». En iPhone: Compartir → «Agregar a inicio».</p>
                )}
              </div>
            </Card>

            <DemoDataPanel compact />
          </div>
        </div>

        <footer className="mt-10 flex flex-wrap items-center justify-between gap-3 text-body-sm text-on-surface-variant">
          <span>Demo sin servidor: los datos viven en cada navegador. Pagos y códigos son de ejemplo.</span>
          <Link to="/creditos" className="underline">
            Créditos
          </Link>
        </footer>
      </div>
    </div>
  );
}
