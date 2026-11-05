/**
 * Finanzas: ingresos y gastos registrados (nunca se mueve dinero), consolidación en moneda base
 * con tasas manuales, reportes por propiedad y del portafolio, ROI, estado de cuenta y CSV.
 */
import { data } from '@/data';
import { categoryLabel } from '@/domain/labels';
import { convert, leaseDaysInPeriod, occupancyStats, rateFor } from '@/domain/rules';
import {
  EXPENSE_CATEGORIES,
  FxRateSchema,
  INCOME_CATEGORIES,
  PAYMENT_METHODS,
  isoDate,
  monthKey,
  type Property,
  type Transaction,
} from '@/domain/types';
import { nowIso, todayLocal } from '@/lib/clock';
import { addDays, diffDays, lastMonths, monthEndExclusive, monthKeyOf, monthLabel, monthStart } from '@/lib/dates';
import { newId } from '@/lib/ids';
import { round2 } from '@/lib/money';
import { z } from 'zod';
import {
  allowed,
  audit,
  authorize,
  can,
  getSettings,
  NotFoundError,
  parse,
  pushNotification,
  RuleError,
  subjectFor,
  type Actor,
} from './core';

// ───────────────────────── Registro ─────────────────────────

export interface PostInput {
  propertyId?: string;
  type: 'income' | 'expense';
  category: string;
  amount: number;
  /** Si no se da: la moneda de la propiedad (o la base si no hay propiedad). */
  currency?: string;
  date: string;
  description: string;
  method?: Transaction['method'];
  reference?: string;
  status?: Transaction['status'];
  source: Transaction['source'];
  createdBy: string;
}

/**
 * Registra un movimiento (uso interno de los servicios, que ya verificaron permisos).
 * Convierte a la moneda base con la tasa manual vigente en la fecha; si falta la tasa, falla.
 */
export async function postTransaction(input: PostInput): Promise<Transaction> {
  const db = data();
  const settings = await getSettings();
  let currency = input.currency;
  if (input.propertyId) {
    const p = await db.properties.get(input.propertyId);
    if (!p) throw new NotFoundError('la propiedad');
    if (currency && currency !== p.currency)
      throw new RuleError(`Los movimientos de ${p.name} van en ${p.currency}, su moneda.`);
    currency = p.currency;
  }
  currency ??= settings.baseCurrency;
  const rates = await db.fxRates.all();
  const fxRate = rateFor(currency, settings.baseCurrency, rates, input.date);
  const tx: Transaction = {
    id: newId('tx'),
    propertyId: input.propertyId,
    type: input.type,
    category: input.category,
    amount: round2(input.amount),
    currency,
    amountBase: round2(input.amount * fxRate),
    fxRate,
    date: input.date,
    description: input.description,
    method: input.method,
    reference: input.reference,
    status: input.status ?? 'posted',
    source: input.source,
    createdBy: input.createdBy,
    createdAt: nowIso(),
  };
  await db.transactions.put(tx);
  return tx;
}

const ManualTxSchema = z.object({
  propertyId: z.string().optional(),
  type: z.enum(['income', 'expense']),
  category: z.string().min(2, 'Elige una categoría'),
  amount: z.number({ error: 'Escribe un monto' }).positive('El monto debe ser mayor que cero'),
  date: isoDate,
  description: z.string().min(2, 'Escribe una descripción'),
  method: z.enum(PAYMENT_METHODS).optional(),
  reference: z.string().optional(),
});
export type ManualTxInput = z.infer<typeof ManualTxSchema>;

/**
 * Registrar un ingreso o gasto a mano. Los gastos por encima del umbral quedan
 * «pendientes de aprobación» del propietario (salvo que los registre él).
 */
export async function recordManual(actor: Actor, raw: ManualTxInput): Promise<Transaction> {
  const input = parse(ManualTxSchema, raw);
  await authorize(actor, 'finance.write', { propertyId: input.propertyId ?? null });
  const settings = await getSettings();
  const tx = await postTransaction({ ...input, source: { kind: 'manual' }, createdBy: actor.realUser.id });
  if (tx.type === 'expense' && tx.amountBase > settings.approvalThreshold && actor.user.role !== 'owner') {
    tx.status = 'pending_approval';
    await data().transactions.put(tx);
    await pushNotification({
      kind: 'approval',
      title: 'Gasto por aprobar',
      body: `${tx.description}: ${tx.amount} ${tx.currency}.`,
      link: '/finanzas',
      propertyId: tx.propertyId,
      roles: ['owner'],
    });
  }
  await audit(actor, `finance.${tx.type}`, 'transaction', tx.id, `Registró ${tx.type === 'income' ? 'un ingreso' : 'un gasto'}: ${tx.description} (${tx.amount} ${tx.currency}).`);
  return tx;
}

/** El propietario aprueba un gasto pendiente: entra a las cuentas. */
export async function approveTransaction(actor: Actor, id: string): Promise<Transaction> {
  await authorize(actor, 'finance.approve');
  const tx = await data().transactions.get(id);
  if (!tx) throw new NotFoundError('el movimiento');
  if (tx.status !== 'pending_approval') throw new RuleError('Este movimiento no está pendiente de aprobación.');
  tx.status = 'posted';
  await data().transactions.put(tx);
  await audit(actor, 'finance.approve', 'transaction', tx.id, `Aprobó el gasto «${tx.description}».`);
  return tx;
}

export async function voidTransaction(actor: Actor, id: string): Promise<void> {
  const tx = await data().transactions.get(id);
  if (!tx) throw new NotFoundError('el movimiento');
  await authorize(actor, 'finance.write', { propertyId: tx.propertyId ?? null });
  tx.status = 'void';
  await data().transactions.put(tx);
  await audit(actor, 'finance.void', 'transaction', tx.id, `Anuló «${tx.description}».`);
}

// ───────────────────────── Consultas ─────────────────────────

export interface TxFilter {
  propertyId?: string;
  month?: string;
  from?: string;
  to?: string;
  type?: 'income' | 'expense';
  includePending?: boolean;
}

export interface TransactionView extends Transaction {
  propertyName: string;
  categoryLabel: string;
}

export async function listTransactions(actor: Actor, filter: TxFilter = {}): Promise<TransactionView[]> {
  const s = await authorize(actor, 'finance.read');
  const db = data();
  const [all, props, settings] = await Promise.all([db.transactions.all(), db.properties.all(), getSettings()]);
  const from = filter.month ? monthStart(filter.month) : filter.from;
  const to = filter.month ? monthEndExclusive(filter.month) : filter.to;
  const names = new Map(props.map((p) => [p.id, p.name]));
  return allowed(s, 'finance.read', all, (t) => ({ propertyId: t.propertyId ?? null }))
    .filter(
      (t) =>
        (filter.includePending ? t.status !== 'void' : t.status === 'posted') &&
        (!filter.propertyId || t.propertyId === filter.propertyId) &&
        (!filter.type || t.type === filter.type) &&
        (!from || t.date >= from) &&
        (!to || t.date < to),
    )
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
    .map((t) => ({
      ...t,
      propertyName: t.propertyId ? (names.get(t.propertyId) ?? '—') : 'Portafolio',
      categoryLabel: categoryLabel(t.category, settings.customExpenseCategories),
    }));
}

export async function pendingApprovals(actor: Actor): Promise<TransactionView[]> {
  return (await listTransactions(actor, { includePending: true })).filter((t) => t.status === 'pending_approval');
}

export interface CategoryAmount {
  category: string;
  label: string;
  amount: number;
}

export interface MonthSummary {
  month: string;
  label: string;
  baseCurrency: string;
  income: number;
  expenses: number;
  net: number;
  margin: number;
  incomeByCategory: CategoryAmount[];
  expensesByCategory: CategoryAmount[];
  pendingApproval: number;
  budget: number | null;
  overBudget: boolean;
  previous: { income: number; expenses: number; net: number };
}

function totals(txs: Transaction[]) {
  let income = 0;
  let expenses = 0;
  for (const t of txs) {
    if (t.status !== 'posted') continue;
    if (t.type === 'income') income += t.amountBase;
    else expenses += t.amountBase;
  }
  return { income: round2(income), expenses: round2(expenses), net: round2(income - expenses) };
}

function byCategory(txs: Transaction[], type: 'income' | 'expense', custom: { key: string; label: string }[]): CategoryAmount[] {
  const map = new Map<string, number>();
  for (const t of txs) if (t.type === type && t.status === 'posted') map.set(t.category, (map.get(t.category) ?? 0) + t.amountBase);
  return [...map.entries()]
    .map(([category, amount]) => ({ category, label: categoryLabel(category, custom), amount: round2(amount) }))
    .sort((a, b) => b.amount - a.amount);
}

async function scopedTransactions(actor: Actor, propertyId?: string) {
  const s = await authorize(actor, 'finance.read', { propertyId: propertyId ?? null });
  const all = await data().transactions.all();
  return allowed(s, 'finance.read', all, (t) => ({ propertyId: t.propertyId ?? null })).filter(
    (t) => t.status !== 'void' && (!propertyId || t.propertyId === propertyId),
  );
}

/** Resumen de un mes en la moneda base (solo movimientos registrados; los pendientes aparte). */
export async function monthSummary(actor: Actor, month: string, propertyId?: string): Promise<MonthSummary> {
  parse(monthKey, month);
  const [txs, settings, budgets] = await Promise.all([scopedTransactions(actor, propertyId), getSettings(), data().budgets.all()]);
  const inMonth = (m: string) => txs.filter((t) => t.date >= monthStart(m) && t.date < monthEndExclusive(m));
  const cur = inMonth(month);
  const prevKey = lastMonths(month, 2)[0];
  const t = totals(cur);
  const budget = propertyId ? null : (budgets.find((b) => b.month === month && !b.propertyId)?.amount ?? null);
  return {
    month,
    label: monthLabel(month),
    baseCurrency: settings.baseCurrency,
    ...t,
    margin: t.income ? t.net / t.income : 0,
    incomeByCategory: byCategory(cur, 'income', settings.customExpenseCategories),
    expensesByCategory: byCategory(cur, 'expense', settings.customExpenseCategories),
    pendingApproval: round2(cur.filter((x) => x.status === 'pending_approval').reduce((s, x) => s + x.amountBase, 0)),
    budget,
    overBudget: budget != null && t.expenses > budget,
    previous: totals(inMonth(prevKey)),
  };
}

export interface SeriesPoint {
  month: string;
  label: string;
  income: number;
  expenses: number;
  net: number;
}

/** Ingresos y gastos de los últimos `count` meses (flujo de caja). */
export async function series(actor: Actor, endMonth: string, count = 6, propertyId?: string): Promise<SeriesPoint[]> {
  const txs = await scopedTransactions(actor, propertyId);
  return lastMonths(endMonth, count).map((m) => {
    const t = totals(txs.filter((x) => x.date >= monthStart(m) && x.date < monthEndExclusive(m)));
    return { month: m, label: monthLabel(m, 'short'), ...t };
  });
}

export interface PropertyKpis {
  propertyId: string;
  propertyName: string;
  city: string;
  rentalMode: Property['rentalMode'];
  heroSrc: string;
  /** Moneda de la propiedad (ADR y RevPAR van en esta moneda). */
  currency: string;
  /** Moneda de ingresos, gastos y neto (consolidados en la moneda base). */
  baseCurrency: string;
  income: number;
  expenses: number;
  net: number;
  margin: number;
  occupancy: number;
  adr: number | null;
  revpar: number | null;
  nightsSold: number;
  availableNights: number;
  yieldLabel: 'Alto rendimiento' | 'Estable' | 'Bajo rendimiento';
}

/** Ocupación, ADR y RevPAR de una propiedad en un período (los de por meses: días con contrato). */
export async function propertyOccupancy(propertyId: string, start: string, endExclusive: string) {
  const db = data();
  const [p, bookings, blocks, leases] = await Promise.all([
    db.properties.get(propertyId),
    db.bookings.find((b) => b.propertyId === propertyId),
    db.blocks.find((b) => b.propertyId === propertyId),
    db.leases.find((l) => l.propertyId === propertyId),
  ]);
  if (!p) throw new NotFoundError('la propiedad');
  const stats = occupancyStats(bookings, blocks, start, endExclusive);
  const days = diffDays(start, endExclusive);
  const leaseDays = Math.min(
    days,
    leases.reduce((s, l) => s + leaseDaysInPeriod(l, start, endExclusive), 0),
  );
  if (p.rentalMode === 'monthly') return { ...stats, occupancy: days ? leaseDays / days : 0, adr: null, revpar: null, leaseDays };
  if (p.rentalMode === 'mixed' && leaseDays) {
    const occupied = Math.min(days, leaseDays + stats.nightsSold);
    return { ...stats, occupancy: days ? occupied / days : 0, leaseDays };
  }
  return { ...stats, leaseDays };
}

/** Desempeño por propiedad en el mes (moneda base). */
export async function propertyPerformance(actor: Actor, month: string): Promise<PropertyKpis[]> {
  const s = await authorize(actor, 'finance.read');
  const db = data();
  const [props, txs, settings] = await Promise.all([db.properties.all(), scopedTransactions(actor), getSettings()]);
  const start = monthStart(month);
  const end = monthEndExclusive(month);
  const rows: PropertyKpis[] = [];
  for (const p of allowed(s, 'finance.read', props.filter((x) => !x.archived), (x) => ({ propertyId: x.id }))) {
    const t = totals(txs.filter((x) => x.propertyId === p.id && x.date >= start && x.date < end));
    // Ocupación «en libros»: todo el mes, incluidas las reservas confirmadas que faltan.
    const occ = await propertyOccupancy(p.id, start, end);
    const margin = t.income ? t.net / t.income : 0;
    rows.push({
      propertyId: p.id,
      propertyName: p.name,
      city: p.city,
      rentalMode: p.rentalMode,
      heroSrc: p.photos[0]?.src ?? '',
      currency: p.currency,
      baseCurrency: settings.baseCurrency,
      ...t,
      margin,
      occupancy: occ.occupancy,
      adr: occ.adr,
      revpar: occ.revpar,
      nightsSold: occ.nightsSold,
      availableNights: occ.availableNights,
      yieldLabel: margin >= 0.35 ? 'Alto rendimiento' : margin >= 0.1 ? 'Estable' : 'Bajo rendimiento',
    });
  }
  return rows.sort((a, b) => b.net - a.net);
}

export interface PortfolioKpis {
  occupancy: number;
  adr: number;
  revpar: number;
  nightsSold: number;
  availableNights: number;
}

/** Ocupación, ADR y RevPAR del portafolio (solo propiedades por noches o mixtas para ADR/RevPAR). */
export async function portfolioKpis(actor: Actor, month: string): Promise<PortfolioKpis> {
  const rows = await propertyPerformance(actor, month);
  const nightly = rows.filter((r) => r.rentalMode !== 'monthly');
  const nightsSold = nightly.reduce((s, r) => s + r.nightsSold, 0);
  const availableNights = nightly.reduce((s, r) => s + r.availableNights, 0);
  const roomRevenue = nightly.reduce((s, r) => s + (r.adr ?? 0) * r.nightsSold, 0);
  return {
    occupancy: rows.length ? rows.reduce((s, r) => s + r.occupancy, 0) / rows.length : 0,
    adr: nightsSold ? round2(roomRevenue / nightsSold) : 0,
    revpar: availableNights ? round2(roomRevenue / availableNights) : 0,
    nightsSold,
    availableNights,
  };
}

export interface RoiResult {
  propertyId: string;
  purchasePrice: number;
  estimatedValue: number | null;
  netLast12: number;
  months: number;
  annualizedNet: number;
  roi: number;
  appreciation: number | null;
}

/** ROI: ganancia neta anualizada / precio de compra (solo si hay precio de compra y se puede ver). */
export async function roi(actor: Actor, propertyId: string): Promise<RoiResult | null> {
  const s = await authorize(actor, 'finance.read', { propertyId });
  if (!can(s, 'property.readPrivate', { propertyId })) return null;
  const p = await data().properties.get(propertyId);
  const price = p?.ownerPrivate.purchasePrice;
  if (!p || !price) return null;
  const txs = await scopedTransactions(actor, propertyId);
  const since = addDays(todayLocal(), -365);
  const window = txs.filter((t) => t.date >= since);
  const t = totals(window);
  const first = window.reduce((m, x) => (x.date < m ? x.date : m), todayLocal());
  const months = Math.max(1, Math.round(diffDays(first, todayLocal()) / 30.4));
  const annualizedNet = round2((t.net / months) * 12);
  return {
    propertyId,
    purchasePrice: price,
    estimatedValue: p.ownerPrivate.estimatedValue ?? null,
    netLast12: t.net,
    months,
    annualizedNet,
    roi: annualizedNet / price,
    appreciation: p.ownerPrivate.estimatedValue ? (p.ownerPrivate.estimatedValue - price) / price : null,
  };
}

// ───────────────────────── Estado de cuenta y CSV ─────────────────────────

export interface StatementRow {
  propertyId: string | null;
  propertyName: string;
  currency: string;
  income: CategoryAmount[];
  expenses: CategoryAmount[];
  totalIncome: number;
  totalExpenses: number;
  net: number;
  /** En moneda base. */
  netBase: number;
}

export interface OwnerStatement {
  companyName: string;
  ownerName: string;
  month: string;
  label: string;
  baseCurrency: string;
  generatedAt: string;
  rows: StatementRow[];
  totals: { income: number; expenses: number; net: number };
  pending: TransactionView[];
  transactions: TransactionView[];
}

/** Estado de cuenta mensual del propietario (para imprimir o guardar en PDF). */
export async function ownerStatement(actor: Actor, month: string): Promise<OwnerStatement> {
  const settings = await getSettings();
  const db = data();
  const [txs, props, users] = await Promise.all([
    listTransactions(actor, { month, includePending: true }),
    db.properties.all(),
    db.users.all(),
  ]);
  const posted = txs.filter((t) => t.status === 'posted');
  const groups = new Map<string, TransactionView[]>();
  for (const t of posted) groups.set(t.propertyId ?? '', [...(groups.get(t.propertyId ?? '') ?? []), t]);
  const rows: StatementRow[] = [...groups.entries()].map(([pid, list]) => {
    const p = props.find((x) => x.id === pid);
    const sum = (type: 'income' | 'expense') => round2(list.filter((t) => t.type === type).reduce((s, t) => s + t.amount, 0));
    const sumBase = (type: 'income' | 'expense') => round2(list.filter((t) => t.type === type).reduce((s, t) => s + t.amountBase, 0));
    return {
      propertyId: pid || null,
      propertyName: p?.name ?? 'Portafolio (gastos generales)',
      currency: p?.currency ?? settings.baseCurrency,
      income: byCategory(list, 'income', settings.customExpenseCategories),
      expenses: byCategory(list, 'expense', settings.customExpenseCategories),
      totalIncome: sum('income'),
      totalExpenses: sum('expense'),
      net: round2(sum('income') - sum('expense')),
      netBase: round2(sumBase('income') - sumBase('expense')),
    };
  });
  rows.sort((a, b) => (a.propertyId ? 0 : 1) - (b.propertyId ? 0 : 1) || a.propertyName.localeCompare(b.propertyName));
  const t = totals(posted);
  return {
    companyName: settings.companyName,
    ownerName: users.find((u) => u.role === 'owner')?.name ?? '',
    month,
    label: monthLabel(month),
    baseCurrency: settings.baseCurrency,
    generatedAt: nowIso(),
    rows,
    totals: t,
    pending: txs.filter((x) => x.status === 'pending_approval'),
    transactions: posted,
  };
}

/** Marca BOM para que Excel lea el CSV como UTF-8. */
const BOM = String.fromCharCode(0xfeff);

function csvCell(v: string | number | undefined): string {
  const s = v === undefined ? '' : String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Exporta movimientos a CSV (separado por comas, UTF-8 con BOM para Excel). */
export async function exportCsv(actor: Actor, filter: TxFilter = {}): Promise<string> {
  await authorize(actor, 'finance.export');
  const rows = await listTransactions(actor, { ...filter, includePending: true });
  const header = ['fecha', 'propiedad', 'tipo', 'categoria', 'descripcion', 'monto', 'moneda', 'monto_base', 'tasa', 'estado', 'metodo', 'referencia'];
  const lines = rows.map((t) =>
    [t.date, t.propertyName, t.type === 'income' ? 'ingreso' : 'gasto', t.categoryLabel, t.description, t.amount, t.currency, t.amountBase, t.fxRate, t.status, t.method, t.reference]
      .map(csvCell)
      .join(','),
  );
  await audit(actor, 'finance.export', 'transaction', undefined, `Exportó ${rows.length} movimientos a CSV.`);
  return BOM + [header.join(','), ...lines].join('\n');
}

// ───────────────────────── Monedas y presupuestos ─────────────────────────

export async function listRates(actor: Actor) {
  await authorize(actor, 'settings.read');
  return (await data().fxRates.all()).sort((a, b) => a.currency.localeCompare(b.currency) || b.date.localeCompare(a.date));
}

const RateInput = FxRateSchema.omit({ id: true });

export async function setRate(actor: Actor, raw: z.infer<typeof RateInput>) {
  await authorize(actor, 'settings.write');
  const input = parse(RateInput, raw);
  const settings = await getSettings();
  if (input.currency === settings.baseCurrency) throw new RuleError('La moneda base no necesita tasa.');
  const rate = { id: newId('fx'), ...input };
  await data().fxRates.put(rate);
  await audit(actor, 'settings.fx', 'fx', rate.id, `Tasa ${input.currency} = ${input.rate} ${settings.baseCurrency} desde ${input.date}.`);
  return rate;
}

export async function removeRate(actor: Actor, id: string) {
  await authorize(actor, 'settings.write');
  await data().fxRates.remove(id);
  await audit(actor, 'settings.fx', 'fx', id, 'Eliminó una tasa de cambio.');
}

/** Convierte un monto con las tasas de Ajustes (para mostrar equivalencias). */
export async function convertAmount(amount: number, from: string, to: string, date = todayLocal()): Promise<number> {
  const settings = await getSettings();
  return convert(amount, from, to, settings.baseCurrency, await data().fxRates.all(), date);
}

export async function setBudget(actor: Actor, month: string, amount: number) {
  await authorize(actor, 'finance.write');
  parse(monthKey, month);
  const existing = (await data().budgets.find((b) => b.month === month && !b.propertyId))[0];
  const budget = { id: existing?.id ?? newId('bg'), month, amount: round2(amount) };
  await data().budgets.put(budget);
  await audit(actor, 'finance.budget', 'budget', budget.id, `Presupuesto de gastos de ${monthLabel(month)}: ${amount}.`);
  return budget;
}

export const INCOME_CATEGORY_KEYS = INCOME_CATEGORIES;
export const EXPENSE_CATEGORY_KEYS = EXPENSE_CATEGORIES;

/** Mes actual (AAAA-MM) en la zona del navegador. */
export function currentMonth(): string {
  return monthKeyOf(todayLocal());
}

export { subjectFor };
