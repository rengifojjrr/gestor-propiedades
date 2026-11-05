/** Editor de materiales de una orden (nombre, cantidad y costo de la línea). */
import { Plus, Trash2 } from 'lucide-react';
import { formatMoney } from '@/lib/money';
import { Button, IconButton, TextInput } from '@/ui';
import { numberOrUndefined } from './shared';

export interface MaterialRow {
  key: string;
  name: string;
  qty: string;
  cost: string;
}

export interface Material {
  name: string;
  qty: number;
  cost: number;
}

let seq = 1;
const rowKey = () => `m${seq++}`;

export function toRows(materials: Material[]): MaterialRow[] {
  return materials.map((m) => ({ key: rowKey(), name: m.name, qty: String(m.qty), cost: m.cost ? String(m.cost) : '' }));
}

/** Filas con nombre, con números válidos (lo vacío cuenta como 0, la cantidad vacía como 1). */
export function fromRows(rows: MaterialRow[]): Material[] {
  return rows
    .filter((r) => r.name.trim())
    .map((r) => ({ name: r.name.trim(), qty: Math.max(0, numberOrUndefined(r.qty) ?? 1), cost: Math.max(0, numberOrUndefined(r.cost) ?? 0) }));
}

export function materialsTotal(materials: Material[]): number {
  return materials.reduce((s, m) => s + m.cost, 0);
}

export function MaterialsEditor({ rows, onChange, currency, disabled, showCost = true }: { rows: MaterialRow[]; onChange: (rows: MaterialRow[]) => void; currency: string; disabled?: boolean; showCost?: boolean }) {
  const set = (key: string, patch: Partial<MaterialRow>) => onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const total = materialsTotal(fromRows(rows));
  return (
    <div className="space-y-3">
      {rows.length === 0 && <p className="text-body-sm text-on-surface-variant">Sin materiales todavía.</p>}
      {rows.map((r, i) => (
        <div key={r.key} className="grid grid-cols-6 items-center gap-2 rounded-md bg-surface-low p-2 sm:bg-transparent sm:p-0">
          <TextInput
            aria-label={`Material ${i + 1}`}
            placeholder="Material (ej. sifón)"
            value={r.name}
            disabled={disabled}
            onChange={(e) => set(r.key, { name: e.target.value })}
            className="col-span-6 sm:col-span-3"
          />
          <TextInput
            aria-label={`Cantidad del material ${i + 1}`}
            placeholder="Cant."
            inputMode="decimal"
            value={r.qty}
            disabled={disabled}
            onChange={(e) => set(r.key, { qty: e.target.value })}
            className={showCost ? 'col-span-2 sm:col-span-1' : 'col-span-5 sm:col-span-2'}
          />
          {showCost && (
            <TextInput
              aria-label={`Costo del material ${i + 1} (${currency})`}
              placeholder={`Costo ${currency}`}
              inputMode="decimal"
              value={r.cost}
              disabled={disabled}
              onChange={(e) => set(r.key, { cost: e.target.value })}
              className="col-span-3 sm:col-span-1"
            />
          )}
          <IconButton icon={Trash2} label={`Quitar material ${i + 1}`} disabled={disabled} onClick={() => onChange(rows.filter((x) => x.key !== r.key))} className="col-span-1 justify-self-end" />
        </div>
      ))}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="tonal" size="sm" icon={Plus} disabled={disabled} onClick={() => onChange([...rows, { key: rowKey(), name: '', qty: '1', cost: '' }])}>
          Agregar material
        </Button>
        {showCost && total > 0 && <p className="text-label-md text-on-surface">Materiales: {formatMoney(total, currency)}</p>}
      </div>
    </div>
  );
}
