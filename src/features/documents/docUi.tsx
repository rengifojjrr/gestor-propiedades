/** Piezas de Documentos: ícono por categoría, chip de vencimiento y visibilidad corta. */
import type { LucideIcon } from 'lucide-react';
import { AlertTriangle, BadgeCheck, CheckCircle2, ClipboardCheck, Clock, FileSignature, FileText, Home, Landmark, Lock, Luggage, Receipt, ShieldCheck, Users, Wallet } from 'lucide-react';
import type { DocCategory, DocVisibility } from '@/domain/types';
import { formatDate } from '@/lib/dates';
import type { DocumentView } from '@/services';
import { Badge, cn } from '@/ui';

export const DOC_ICON: Record<DocCategory, LucideIcon> = {
  contract: FileSignature,
  insurance: ShieldCheck,
  deed: Landmark,
  license: BadgeCheck,
  invoice: Receipt,
  inspection: ClipboardCheck,
  other: FileText,
};

export function DocIcon({ category, className }: { category: DocCategory; className?: string }) {
  const Icon = DOC_ICON[category];
  return (
    <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-surface-high text-primary', className)}>
      <Icon size={20} aria-hidden />
    </span>
  );
}

const days = (n: number) => `${n} ${n === 1 ? 'día' : 'días'}`;

/** Vigente / Por vencer en N días / Vencido hace N días / Sin vencimiento. */
export function expiryText(d: Pick<DocumentView, 'status' | 'daysToExpiry'>): string {
  const n = d.daysToExpiry ?? 0;
  switch (d.status) {
    case 'valid':
      return 'Vigente';
    case 'expiring':
      return n === 0 ? 'Vence hoy' : `Por vencer en ${days(n)}`;
    case 'expired':
      return `Vencido hace ${days(-n)}`;
    default:
      return 'Sin vencimiento';
  }
}

export function ExpiryBadge({ doc }: { doc: Pick<DocumentView, 'status' | 'daysToExpiry'> }) {
  const tone = doc.status === 'valid' ? 'good' : doc.status === 'expiring' ? 'warn' : doc.status === 'expired' ? 'bad' : 'neutral';
  const icon = doc.status === 'valid' ? CheckCircle2 : doc.status === 'expiring' ? Clock : doc.status === 'expired' ? AlertTriangle : undefined;
  return (
    <Badge tone={tone} icon={icon}>
      {expiryText(doc)}
    </Badge>
  );
}

export function expiryDate(d: Pick<DocumentView, 'expiresOn'>): string {
  return d.expiresOn ? formatDate(d.expiresOn, { year: true }) : '—';
}

export const VISIBILITY_SHORT: Record<DocVisibility, { label: string; icon: LucideIcon }> = {
  owner: { label: 'Solo propietario', icon: Lock },
  team: { label: 'Equipo', icon: Users },
  finance: { label: 'Finanzas', icon: Wallet },
  tenant: { label: 'Inquilino', icon: Home },
  guest: { label: 'Huésped', icon: Luggage },
};

export function VisibilityTag({ visibility, title }: { visibility: DocVisibility; title?: string }) {
  const v = VISIBILITY_SHORT[visibility];
  return (
    <span className="inline-flex items-center gap-1 text-label-sm font-normal whitespace-nowrap text-on-surface-variant" title={title}>
      <v.icon size={14} aria-hidden />
      {v.label}
    </span>
  );
}

export function formatSize(bytes?: number): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
