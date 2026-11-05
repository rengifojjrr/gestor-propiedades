/** Crear una limpieza (propietario y administración): propiedad, tipo, fecha y hora, quién y prioridad. */
import { ClipboardPlus } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useBusyAction } from '@/app/hooks';
import { useActor } from '@/app/session';
import { useLive } from '@/data/live';
import { CLEANING_TYPE_LABEL } from '@/domain/labels';
import { CLEANING_TYPES, type CleaningType } from '@/domain/types';
import { todayIn } from '@/lib/clock';
import { svc } from '@/services';
import { Button, Card, Loading, PageHeader, Select, TextArea, TextInput } from '@/ui';
import { SegmentedChoice, useFieldStaff } from './shared';

export default function CleaningFormPage() {
  const actor = useActor();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [run, busy] = useBusyAction();
  const properties = useLive(() => svc.properties.listProperties(actor), [actor]);
  const { cleaners } = useFieldStaff();

  const [propertyId, setPropertyId] = useState(params.get('propertyId') ?? '');
  const [type, setType] = useState<CleaningType>('checkout');
  // Sin tocar, fecha, hora y persona salen de la propiedad (hoy, su hora de salida y su limpieza).
  const [dateInput, setDate] = useState<string>();
  const [timeInput, setTime] = useState<string>();
  const [assigneeInput, setAssigneeId] = useState<string>();
  const [priority, setPriority] = useState<'high' | 'normal'>('normal');
  const [notes, setNotes] = useState('');
  const [tried, setTried] = useState(false);

  if (!properties) return <Loading />;

  const property = properties.find((p) => p.id === propertyId);
  const date = dateInput ?? (property ? todayIn(property.timezone) : '');
  const time = timeInput ?? property?.checkOutTime ?? '';
  const assigneeId = assigneeInput ?? property?.defaultCleanerId ?? '';

  const errors = {
    propertyId: !propertyId ? 'Elige una propiedad' : undefined,
    date: !/^\d{4}-\d{2}-\d{2}$/.test(date) ? 'Elige la fecha' : undefined,
    time: !/^\d{2}:\d{2}$/.test(time) ? 'Elige la hora' : undefined,
  };
  const valid = !errors.propertyId && !errors.date && !errors.time;

  const submit = async () => {
    setTried(true);
    if (!valid) return;
    const task = await run(() => svc.operations.createCleaning(actor, { propertyId, type, date, time, assigneeId: assigneeId || undefined, priority, notes: notes.trim() }), { success: 'Limpieza creada' });
    if (task) navigate(`/operacion/limpieza/${task.id}`, { replace: true });
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader back="/operacion" title="Crear limpieza" subtitle="La checklist de la propiedad se copia sola en la tarea." />
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
            onChange={(e) => {
              setPropertyId(e.target.value);
              setTime(undefined);
              setAssigneeId(undefined);
            }}
            placeholder="Elige una propiedad"
            options={properties.map((p) => ({ value: p.id, label: `${p.name} · ${p.city}` }))}
            error={tried ? errors.propertyId : undefined}
          />
          <SegmentedChoice name="tipo-limpieza" label="Tipo" size="md" value={type} onChange={setType} options={CLEANING_TYPES.map((c) => ({ value: c, label: CLEANING_TYPE_LABEL[c] }))} />
          <div className="grid grid-cols-2 gap-4">
            <TextInput type="date" label="Fecha" value={date} onChange={(e) => setDate(e.target.value)} error={tried ? errors.date : undefined} />
            <TextInput type="time" label="Hora" value={time} onChange={(e) => setTime(e.target.value)} error={tried ? errors.time : undefined} />
          </div>
          <Select
            label="Quién la hace"
            value={assigneeId}
            onChange={(e) => setAssigneeId(e.target.value)}
            placeholder="La persona de la propiedad"
            options={cleaners.map((c) => ({ value: c.id, label: `${c.name}${c.id === property?.defaultCleanerId ? ' (de esta propiedad)' : ''}` }))}
          />
          <SegmentedChoice
            name="prioridad-limpieza"
            label="Prioridad"
            size="md"
            value={priority}
            onChange={setPriority}
            options={[
              { value: 'normal', label: 'Normal' },
              { value: 'high', label: 'Alta', selectedClass: 'border-error bg-error-container text-on-error-container' },
            ]}
          />
          <TextArea label="Notas para la limpieza (opcional)" placeholder="Ej. llega un grupo grande: dejar la cuna armada" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={() => navigate(-1)}>
              Cancelar
            </Button>
            <Button type="submit" icon={ClipboardPlus} loading={busy}>
              Crear limpieza
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
