/** Herramientas de la demo: restablecer los datos de ejemplo y exportar o importar el estado en JSON. */
import { Download, RotateCcw, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { downloadFile, useAction } from '@/app/hooks';
import { useSession } from '@/app/session';
import { useLive } from '@/data/live';
import { formatDate } from '@/lib/dates';
import { actorFor, svc } from '@/services';
import { Button, Card, CardHeader, useConfirm } from '@/ui';

export function DemoDataPanel({ compact = false }: { compact?: boolean }) {
  const confirm = useConfirm();
  const run = useAction();
  const { actor, accounts } = useSession();
  const info = useLive(() => svc.system.demoInfo(), []);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<'reset' | 'export' | 'import' | null>(null);

  const reset = async () => {
    if (!(await confirm({ title: '¿Restablecer los datos de ejemplo?', body: 'Se borra todo lo que cambiaste en este navegador (fotos, mensajes, gastos…) y se cargan los datos de ejemplo para hoy.', confirmLabel: 'Restablecer', danger: true }))) return;
    setBusy('reset');
    await run(() => svc.system.resetDemo(), { success: 'Datos de ejemplo restablecidos para hoy.' });
    setBusy(null);
  };

  const exportJson = async () => {
    setBusy('export');
    const ownerUser = accounts.find((u) => u.role === 'owner');
    const who = actor ?? (ownerUser ? actorFor(ownerUser) : null);
    const json = who ? await run(() => svc.system.exportDemo(who)) : undefined;
    if (json) downloadFile(json, `gestor-propiedades-demo-${new Date().toISOString().slice(0, 10)}.json`, 'application/json');
    setBusy(null);
  };

  const importJson = async (file: File) => {
    if (!(await confirm({ title: '¿Importar este estado?', body: 'Reemplaza todos los datos de este navegador por los del archivo.', confirmLabel: 'Importar', danger: true }))) return;
    setBusy('import');
    await run(async () => svc.system.importDemo(await file.text()), { success: 'Estado importado.' });
    setBusy(null);
  };

  return (
    <Card padding={compact ? 'md' : 'lg'}>
      <CardHeader
        title="Datos de la demo"
        subtitle={info?.seedDate ? `Datos de ejemplo del ${formatDate(info.seedDate, { year: true })}. Viven solo en este navegador.` : 'Viven solo en este navegador.'}
      />
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" icon={RotateCcw} onClick={reset} loading={busy === 'reset'} data-testid="restablecer-datos">
          Restablecer
        </Button>
        <Button variant="secondary" icon={Download} onClick={exportJson} loading={busy === 'export'}>
          Exportar JSON
        </Button>
        <Button variant="secondary" icon={Upload} onClick={() => fileRef.current?.click()} loading={busy === 'import'}>
          Importar JSON
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void importJson(f);
          }}
        />
      </div>
    </Card>
  );
}
