/**
 * «Enviar a todos»: un mensaje para todos los huéspedes e inquilinos que están ahora en una
 * propiedad. Puede partir de una plantilla (ES/EN) con los datos de la propiedad ya puestos.
 */
import { Megaphone, Send } from 'lucide-react';
import { useState } from 'react';
import { useBusyAction } from '@/app/hooks';
import { useActor } from '@/app/session';
import { useLive } from '@/data/live';
import { renderTemplate } from '@/domain/rules';
import type { Lang } from '@/domain/types';
import { fTime } from '@/features/guest/format';
import { svc } from '@/services';
import { Banner, Button, cn, Modal, Select, TextArea, useToast } from '@/ui';
import { tidyText } from './text';

export function BroadcastModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const actor = useActor();
  const toast = useToast();
  const [run, busy] = useBusyAction();
  const properties = useLive(() => svc.properties.listProperties(actor), [actor]);
  const templates = useLive(() => svc.people.listTemplates(actor), [actor]);
  const company = useLive(() => svc.system.getCompanyName(), []);
  const [chosen, setChosen] = useState('');
  const [body, setBody] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [lang, setLang] = useState<Lang>('es');

  const sorted = [...(properties ?? [])].sort((a, b) => Number(b.status === 'occupied') - Number(a.status === 'occupied') || a.name.localeCompare(b.name));
  const propertyId = chosen || sorted.find((p) => p.status === 'occupied')?.id || sorted[0]?.id || '';
  const property = sorted.find((p) => p.id === propertyId);
  const pending = [...new Set([...body.matchAll(/\[(\w+)\]/g)].map((m) => m[1]))];

  const fill = (id: string, l: Lang, pid = propertyId) => {
    const tpl = templates?.find((x) => x.id === id);
    const p = sorted.find((x) => x.id === pid);
    if (!tpl || !p) return;
    setBody(
      tidyText(renderTemplate(tpl.body[l], {
        property_name: p.name,
        city: p.city,
        check_in_time: fTime(p.checkInTime, l),
        check_out_time: fTime(p.checkOutTime, l),
        company: company?.companyName,
        app_link: `${window.location.origin}${import.meta.env.BASE_URL}`,
      })),
    );
  };

  const close = () => {
    setBody('');
    setTemplateId('');
    onClose();
  };

  const send = async () => {
    if (!propertyId) return;
    const count = await run(() => svc.people.broadcast(actor, propertyId, body));
    if (count === undefined) return;
    toast.success(`Mensaje enviado: le llegó a ${count} ${count === 1 ? 'persona' : 'personas'} en ${property?.name ?? 'la propiedad'}.`);
    close();
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title="Enviar a todos"
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancelar
          </Button>
          <Button icon={Send} onClick={send} loading={busy} disabled={body.trim().length < 2 || !propertyId} data-testid="enviar-a-todos-confirmar">
            Enviar a todos
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="flex items-start gap-2 text-body-sm text-on-surface-variant">
          <Megaphone size={18} className="mt-0.5 shrink-0 text-primary" aria-hidden />
          Le llega a cada huésped o inquilino que está ahora en la propiedad, dentro de su conversación en la app.
        </p>
        <Select
          label="Propiedad"
          value={propertyId}
          onChange={(e) => {
            setChosen(e.target.value);
            if (templateId) fill(templateId, lang, e.target.value);
          }}
          options={sorted.map((p) => ({ value: p.id, label: `${p.name} · ${p.city}${p.status === 'occupied' ? ' (ocupada)' : ' (sin huéspedes ahora)'}` }))}
        />
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <Select
              label="Partir de una plantilla"
              value={templateId}
              placeholder="— Sin plantilla —"
              options={(templates ?? []).map((x) => ({ value: x.id, label: x.name }))}
              onChange={(e) => {
                setTemplateId(e.target.value);
                if (e.target.value) fill(e.target.value, lang);
              }}
            />
          </div>
          <div className="flex h-11 shrink-0 items-center rounded-full bg-surface-container p-0.5" role="group" aria-label="Idioma de la plantilla">
            {(['es', 'en'] as const).map((l) => (
              <button
                key={l}
                type="button"
                aria-pressed={lang === l}
                onClick={() => {
                  setLang(l);
                  if (templateId) fill(templateId, l);
                }}
                className={cn('h-10 rounded-full px-3 text-label-md uppercase', lang === l ? 'bg-primary text-on-primary' : 'text-on-surface-variant')}
              >
                {l}
              </button>
            ))}
          </div>
        </div>
        <TextArea
          label="Mensaje"
          rows={5}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Ej.: Mañana de 9 a 11 a. m. cortan el agua en el edificio. Disculpa las molestias."
          hint={`${body.trim().length} caracteres`}
          maxLength={2000}
          data-testid="texto-a-todos"
        />
        {pending.length > 0 && (
          <Banner tone="warn">
            Cambia lo que quedó entre corchetes ({pending.map((k) => `[${k}]`).join(', ')}): son datos de cada persona y en un mensaje a todos no se rellenan.
          </Banner>
        )}
      </div>
    </Modal>
  );
}
