"use client";

import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";
import { DepositDialog } from "@/components/pasarelas/tx/DepositDialog";
import { DepositWindowShort } from "@/components/pasarelas/tx/DepositWindow";
import { cobros } from "@/components/pasarelas/tx/plural";
import { Badge, Button, DateText, Money, cn } from "@/components/ui";
import { formatDate, windowDayLabels, type DateWindow } from "@/lib/pasarelas/dates";
import type { TransitPhase } from "@/lib/pasarelas/transit";
import type { Currency, ISODate, Money as MoneyValue } from "@/lib/pasarelas/types";
import { PhaseText, ProgressBar, WindowDays } from "./TransitPhase";

/** Un cobro de un grupo, con sus nombres ya resueltos y su fase (del motor). */
export type TransitItemView = {
  id: string;
  /** Su referencia o, sin ella, la fecha del cobro: «Cobro del vie 6 nov 2026». */
  title: string;
  /** «Escuela Demo · Stripe». */
  source: string;
  /** Lo que llega al banco: el neto menos lo que retiene la pasarela. */
  payout: MoneyValue;
  phase: TransitPhase;
  label: string;
  window: DateWindow;
  progress: number;
};

/** Un grupo por fecha y cuenta (o una de sus partes), con su cuenta ya nombrada y sus cobros. */
export type TransitGroupView = {
  /** El día en que cuenta: la fecha más tardía de las ventanas de sus cobros. */
  date: ISODate;
  /** Desde cuándo puede caer: la más temprana de sus ventanas (`date` si todas son de un solo día). */
  from: ISODate;
  accountName: string;
  payout: MoneyValue;
  count: number;
  ids: string[];
  overdue: boolean;
  phase: TransitPhase;
  label: string;
  items: TransitItemView[];
};

export type TransitGroupsProps = {
  /** Lo atrasado y lo que cae en los próximos 14 días. */
  soon: TransitGroupView[];
  /** Lo que cae más adelante: va plegado. */
  later: TransitGroupView[];
  currency: Currency;
  today: ISODate;
};

/**
 * La lista de «Dinero en camino»: los grupos por fecha y cuenta, lo atrasado primero, cada uno con su fase,
 * «Marcar depositado» y sus cobros uno por uno al abrirlo; lo que cae dentro de más de 14 días, plegado bajo «Más
 * adelante». «Marcar depositado» marca TODO lo del grupo que siga por caer, con la fecha propuesta: la estimada si
 * ya pasó, hoy si no (no se marca depositado algo con una fecha que todavía no llegó).
 */
export function TransitGroups({ soon, later, currency, today }: TransitGroupsProps) {
  const [open, setOpen] = useState<TransitGroupView | null>(null);
  const laterCount = later.reduce((sum, group) => sum + group.count, 0);
  const list = (groups: TransitGroupView[]) => (
    // Cada grupo con su alto: abrir uno no estira al de al lado.
    <ul className="grid items-start gap-3 md:grid-cols-2">
      {groups.map((group) => (
        <li key={`${group.date}·${group.ids[0] ?? ""}`}>
          <GroupCard group={group} currency={currency} onDeposit={() => setOpen(group)} />
        </li>
      ))}
    </ul>
  );
  return (
    <div className="flex flex-col gap-3">
      {soon.length === 0 && later.length === 0 ? (
        <p className="rounded-card border border-rule bg-surface p-4 text-ink-soft">No hay nada por caer.</p>
      ) : null}
      {soon.length === 0 ? null : list(soon)}
      {later.length === 0 ? null : (
        <details className="group/later rounded-card border border-rule bg-surface">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-4 py-2 font-semibold [&::-webkit-details-marker]:hidden">
            <ChevronDown aria-hidden className="size-5 transition-transform group-open/later:rotate-180" />
            Más adelante ({cobros(laterCount)})
          </summary>
          <div className="px-3 pb-3">{list(later)}</div>
        </details>
      )}
      <DepositDialog
        ids={open?.ids ?? []}
        open={open !== null}
        onClose={() => setOpen(null)}
        defaultDate={open !== null && open.date < today ? open.date : today}
        today={today}
        // El grupo se armó al pintar el Resumen: lo que entretanto se depositó (en otra pestaña) se salta.
        onlyPending
      />
    </div>
  );
}

function GroupCard({
  group,
  currency,
  onDeposit,
}: {
  group: TransitGroupView;
  currency: Currency;
  onDeposit: () => void;
}) {
  const titleId = useId();
  const window = { from: group.from, to: group.date };
  const [first, last] = windowDayLabels(window);
  // El nombre del grupo, como texto corrido: «vie 13 nov 2026 · Cuenta principal (…4321)», o con una ventana,
  // «Entre el lun 16 y el mié 18 nov · Cuenta principal (…4321)».
  const name = last === undefined ? formatDate(group.date) : `Entre el ${first} y el ${last}`;
  return (
    <article
      aria-labelledby={titleId}
      className={cn(
        "flex flex-col gap-2 rounded-card border p-3 sm:p-4",
        group.overdue ? "border-warning bg-warning-soft" : "border-rule bg-surface",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <h4 id={titleId} className="min-w-0 font-semibold">
          <span className="sr-only">{`${name} · ${group.accountName}`}</span>
          <span aria-hidden className="flex flex-col">
            {last === undefined ? <DateText value={group.date} /> : <DepositWindowShort window={window} />}
            <span className="font-normal break-words text-ink-soft">{group.accountName}</span>
          </span>
        </h4>
        <p className="flex shrink-0 flex-col items-end">
          <Money value={group.payout} currency={currency} className="text-xl font-semibold" />
          <span className="text-sm text-ink-soft">{cobros(group.count)}</span>
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <PhaseText phase={group.phase} label={group.label} />
        {group.overdue ? <Badge tone="warning">Atrasado</Badge> : null}
      </div>
      {/* Cerrado, el botón y «Ver el cobro» van en una línea; abierto, sus cobros toman todo el ancho. */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <Button onClick={onDeposit}>Marcar depositado</Button>
        <details className="group/items open:basis-full">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 font-semibold text-brand [&::-webkit-details-marker]:hidden">
            <ChevronDown aria-hidden className="size-5 transition-transform group-open/items:rotate-180" />
            {group.count === 1 ? "Ver el cobro" : `Ver los ${group.count} cobros`}
          </summary>
          <ul className="flex flex-col">
            {group.items.map((item) => (
              <li key={item.id} className="flex flex-col gap-1.5 border-t border-rule py-3 last:pb-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-col">
                    <Link
                      href={`/pasarelas/cobros/${item.id}`}
                      className="flex min-h-11 items-center font-semibold break-words text-brand hover:underline"
                    >
                      {item.title}
                    </Link>
                    <span className="text-sm text-ink-soft">{item.source}</span>
                  </div>
                  <Money value={item.payout} currency={currency} className="pt-2.5 font-semibold" />
                </div>
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <PhaseText phase={item.phase} label={item.label} className="text-sm" />
                  <WindowDays window={item.window} />
                </div>
                <ProgressBar progress={item.progress} overdue={item.phase === "atrasado"} />
              </li>
            ))}
          </ul>
        </details>
      </div>
    </article>
  );
}
