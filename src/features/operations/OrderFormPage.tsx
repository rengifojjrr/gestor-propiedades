/**
 * Nueva orden de mantenimiento (propietario y administración): propiedad, qué pasa, categoría,
 * prioridad, quién la atiende, fecha y presupuesto (avisa si necesitará la aprobación del propietario).
 */
import { Hourglass, Wrench } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useBusyAction } from '@/app/hooks';
import { useActor } from '@/app/session';
import { useLive } from '@/data/live';
import type { MaintenanceCategory, Priority } from '@/domain/types';
import { formatMoney } from '@/lib/money';
import { svc } from '@/services';
import { Banner, Button, Card, Loading, PageHeader, Select, TextArea, TextInput, useToast } from '@/ui';
import { assigneePayload, AssigneeOptions, type AssigneeValue } from './AssignModals';
import { CATEGORY_OPTIONS, numberOrUndefined, PriorityPicker, useFieldStaff } from './shared';

export default function OrderFormPage() {
  const actor = useActor();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [run, busy] = useBusyAction();
  const toast = useToast();
  const properties = useLive(() => svc.properties.listProperties(actor), [actor]);
  const settings = useLive(() => svc.system.getAppSettings(actor), [actor]);
  const { technicians } = useFieldStaff();

  const [propertyId, setPropertyId] = useState(params.get('propertyId') ?? '');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<MaintenanceCategory>('general');
  const [priority, setPriority] = useState<Priority>('medium');
  const [assignee, setAssignee] = useState<AssigneeValue>('');
  const [scheduledDate, setScheduledDate] = useState('');
  const [estimateText, setEstimateText] = useState('');
  const [tried, setTried] = useState(false);

  const property = properties?.find((p) => p.id === propertyId);
  const currency = property?.currency ?? settings?.baseCurrency ?? 'USD';
  const estimate = numberOrUndefined(estimateText);
  // Equivalencia en la moneda base para comparar con el umbral (si la propiedad usa otra moneda).
  const estimateBase = useLive(
    () =>
      estimate == null || !settings
        ? Promise.resolve(undefined)
        : currency === settings.baseCurrency
          ? Promise.resolve(estimate)
          : svc.finance.convertAmount(estimate, currency, settings.baseCurrency).catch(() => undefined),
    [estimate, currency, settings?.baseCurrency],
  );

  if (!properties) return <Loading />;

  const errors = {
    propertyId: !propertyId ? 'Elige una propiedad' : undefined,
    title: title.trim().length < 3 ? 'Escribe un título' : undefined,
    estimate: estimateText.trim() && (estimate == null || estimate < 0) ? 'Escribe un número (0 o más)' : undefined,
  };
  const valid = !errors.propertyId && !errors.title && !errors.estimate;
  const needsApproval = settings && estimateBase != null && estimateBase > settings.approvalThreshold;

  const submit = async () => {
    setTried(true);
    if (!valid) return;
    const order = await run(() =>
      svc.operations.createOrder(actor, {
        propertyId,
        title: title.trim(),
        description: description.trim(),
        category,
        priority,
        ...assigneePayload(assignee, technicians),
        scheduledDate: scheduledDate || undefined,
        estimate,
      }),
    );
    if (!order) return;
    toast.success(`Orden ${order.code} creada`);
    navigate(`/operacion/mantenimiento/${order.id}`, { replace: true });
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader back="/operacion" title="Nueva orden" subtitle="Una reparación o servicio en una propiedad." />
      <Card padding="lg">
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Select
            label="Propiedad"
            value={propertyId}
            onChange={(e) => setPropertyId(e.target.value)}
            placeholder="Elige una propiedad"
            options={properties.map((p) => ({ value: p.id, label: `${p.name} · ${p.city}` }))}
            error={tried ? errors.propertyId : undefined}
          />
          <TextInput label="¿Qué hay que hacer?" placeholder="Ej. cambiar el sifón del lavamanos" value={title} onChange={(e) => setTitle(e.target.value)} error={tried ? errors.title : undefined} />
          <TextArea label="Descripción (opcional)" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
          <Select label="Categoría" value={category} onChange={(e) => setCategory(e.target.value as MaintenanceCategory)} options={CATEGORY_OPTIONS} />
          <PriorityPicker name="prioridad-orden" label="Prioridad" value={priority} onChange={setPriority} />
          <AssigneeOptions value={assignee} onChange={setAssignee} category={category} name="quien-orden" allowAuto />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextInput type="date" label="Fecha programada (opcional)" value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)} />
            <TextInput
              label={`Presupuesto (${currency}, opcional)`}
              inputMode="decimal"
              placeholder="0"
              value={estimateText}
              onChange={(e) => setEstimateText(e.target.value)}
              error={tried ? errors.estimate : undefined}
              hint={settings ? `Más de ${formatMoney(settings.approvalThreshold, settings.baseCurrency)} necesita aprobación.` : undefined}
            />
          </div>
          {needsApproval && (
            <Banner tone="warn" icon={Hourglass}>
              Necesitará la aprobación del propietario: supera {formatMoney(settings.approvalThreshold, settings.baseCurrency)}.
            </Banner>
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={() => navigate(-1)}>
              Cancelar
            </Button>
            <Button type="submit" icon={Wrench} loading={busy}>
              Crear orden
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
