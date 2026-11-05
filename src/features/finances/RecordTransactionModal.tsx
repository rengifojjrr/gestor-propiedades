/**
 * «Registrar ingreso» / «Registrar gasto»: deja constancia de un movimiento (no mueve dinero).
 * Los gastos de Administración por encima del umbral quedan pendientes del propietario.
 */
import { CircleDollarSign, Info } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useAction } from '@/app/hooks';
import { useActor } from '@/app/session';
import { useLive } from '@/data/live';
import { EXPENSE_CATEGORY_LABEL, INCOME_CATEGORY_LABEL, PAYMENT_METHOD_LABEL } from '@/domain/labels';
import { PAYMENT_METHODS, type PaymentMethod } from '@/domain/types';
import { todayLocal } from '@/lib/clock';
import { formatMoney, parseAmount } from '@/lib/money';
import { svc } from '@/services';
import { Banner, Button, Modal, Select, Tabs, TextInput, useToast } from '@/ui';

type TxType = 'income' | 'expense';

const FORM_ID = 'registrar-movimiento';

/** Móntalo solo mientras está abierto (así cada vez empieza limpio). */
export function RecordTransactionModal({ initialType, onClose }: { initialType: TxType; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [type, setType] = useState<TxType>(initialType);
  return (
    <Modal
      open
      onClose={onClose}
      title={type === 'income' ? 'Registrar ingreso' : 'Registrar gasto'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form={FORM_ID} loading={busy} icon={CircleDollarSign} data-testid="guardar-movimiento">
            Registrar
          </Button>
        </>
      }
    >
      <RecordForm type={type} setType={setType} onDone={onClose} setBusy={setBusy} />
    </Modal>
  );
}

function RecordForm({ type, setType, onDone, setBusy }: { type: TxType; setType: (t: TxType) => void; onDone: () => void; setBusy: (b: boolean) => void }) {
  const actor = useActor();
  const run = useAction();
  const toast = useToast();
  const properties = useLive(() => svc.properties.listProperties(actor), [actor]);
  const settings = useLive(() => svc.system.getAppSettings(actor), [actor]);
  const [propertyId, setPropertyId] = useState('');
  const [category, setCategory] = useState(type === 'income' ? 'booking' : 'maintenance');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayLocal());
  const [description, setDescription] = useState('');
  const [method, setMethod] = useState<PaymentMethod | ''>('transfer');
  const [reference, setReference] = useState('');
  const [errors, setErrors] = useState<Partial<Record<'amount' | 'description' | 'date', string>>>({});

  const base = settings?.baseCurrency ?? 'USD';
  const property = properties?.find((p) => p.id === propertyId);
  const currency = property?.currency ?? base;
  const categoryOptions =
    type === 'income'
      ? Object.entries(INCOME_CATEGORY_LABEL).map(([value, label]) => ({ value, label }))
      : [
          ...Object.entries(EXPENSE_CATEGORY_LABEL).map(([value, label]) => ({ value, label })),
          ...(settings?.customExpenseCategories ?? []).map((c) => ({ value: c.key, label: `${c.label} (propia)` })),
        ];
  const parsed = parseAmount(amount);
  const needsApproval = type === 'expense' && actor.user.role !== 'owner' && settings && Number.isFinite(parsed) && currency === base && parsed > settings.approvalThreshold;

  const switchType = (t: TxType) => {
    setType(t);
    setCategory(t === 'income' ? 'booking' : 'maintenance');
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const next: typeof errors = {};
    if (!Number.isFinite(parsed) || parsed <= 0) next.amount = 'Escribe un monto mayor que cero.';
    if (description.trim().length < 2) next.description = 'Escribe una descripción corta.';
    if (!date) next.date = 'Elige la fecha.';
    setErrors(next);
    if (Object.keys(next).length) return;
    setBusy(true);
    const tx = await run(() =>
      svc.finance.recordManual(actor, {
        type,
        propertyId: propertyId || undefined,
        category,
        amount: parsed,
        date,
        description: description.trim(),
        method: method || undefined,
        reference: reference.trim() || undefined,
      }),
    );
    setBusy(false);
    if (!tx) return;
    if (tx.status === 'pending_approval') toast.info(`Gasto registrado. Quedó pendiente de la aprobación del propietario (${formatMoney(tx.amount, tx.currency)}).`);
    else toast.success(type === 'income' ? 'Ingreso registrado.' : 'Gasto registrado.');
    onDone();
  };

  return (
    <form id={FORM_ID} onSubmit={submit} className="space-y-4" noValidate>
      <Tabs
        ariaLabel="Tipo de movimiento"
        value={type}
        onChange={switchType}
        tabs={[
          { id: 'income', label: 'Ingreso' },
          { id: 'expense', label: 'Gasto' },
        ]}
      />
      <Select
        label="Propiedad"
        value={propertyId}
        onChange={(e) => setPropertyId(e.target.value)}
        options={[{ value: '', label: `Portafolio (general) · ${base}` }, ...(properties ?? []).map((p) => ({ value: p.id, label: `${p.name} · ${p.currency}` }))]}
        hint={propertyId ? `Los movimientos de esta propiedad van en ${currency}, su moneda.` : 'Gastos o ingresos que no son de una sola propiedad.'}
      />
      <Select label="Categoría" value={category} onChange={(e) => setCategory(e.target.value)} options={categoryOptions} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextInput
          label={`Monto (${currency})`}
          inputMode="decimal"
          placeholder="0.00"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          error={errors.amount}
          hint={Number.isFinite(parsed) && parsed > 0 ? formatMoney(parsed, currency) : undefined}
          data-testid="monto-movimiento"
          autoFocus
        />
        <TextInput label="Fecha" type="date" value={date} max={todayLocal()} onChange={(e) => setDate(e.target.value)} error={errors.date} />
      </div>
      <TextInput
        label="Descripción"
        placeholder={type === 'income' ? 'Ej.: Depósito por daños, estadía directa…' : 'Ej.: Cambio de filtro del aire, jardinero…'}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        error={errors.description}
        data-testid="descripcion-movimiento"
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Select
          label="Método"
          value={method}
          onChange={(e) => setMethod(e.target.value as PaymentMethod | '')}
          placeholder="Sin indicar"
          options={PAYMENT_METHODS.map((m) => ({ value: m, label: PAYMENT_METHOD_LABEL[m] }))}
        />
        <TextInput label="Referencia (opcional)" placeholder="Nº de transferencia, factura…" value={reference} onChange={(e) => setReference(e.target.value)} />
      </div>
      {needsApproval && settings && (
        <Banner tone="warn">
          Pasa de {formatMoney(settings.approvalThreshold, base)}: quedará pendiente de la aprobación del propietario.
        </Banner>
      )}
      <p className="flex items-start gap-2 text-body-sm text-on-surface-variant">
        <Info size={16} className="mt-0.5 shrink-0" aria-hidden />
        Solo se registra: la app no cobra ni paga nada.
      </p>
    </form>
  );
}
