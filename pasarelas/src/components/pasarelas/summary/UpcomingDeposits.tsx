"use client";

import { useId, useState } from "react";
import { DepositDialog } from "@/components/pasarelas/tx/DepositDialog";
import { cobros } from "@/components/pasarelas/tx/plural";
import { DepositWindowShort } from "@/components/pasarelas/tx/DepositWindow";
import { Badge, Button, DateText, Money, cn } from "@/components/ui";
import { formatDate, windowDayLabels } from "@/lib/pasarelas/dates";
import type { Currency, ISODate, Money as MoneyValue } from "@/lib/pasarelas/types";

/** Un grupo de `upcomingDeposits` con el nombre de su cuenta ya resuelto. */
export type DepositGroupView = {
  /** El día en que cuenta: la fecha más tardía de las ventanas de sus cobros. */
  date: ISODate;
  /** Desde cuándo puede caer: la más temprana de sus ventanas (`date` si todas son de un solo día). */
  from: ISODate;
  accountName: string;
  net: MoneyValue;
  count: number;
  ids: string[];
  overdue: boolean;
};

export type UpcomingDepositsProps = {
  groups: DepositGroupView[];
  currency: Currency;
  today: ISODate;
  /** Los días que cubre la lista (además de lo atrasado), ambos incluidos. */
  window: { from: ISODate; to: ISODate };
};

/**
 * Lo que cae en los próximos días, por fecha estimada y cuenta destino, con lo atrasado arriba y en ámbar. Un cobro
 * cuenta en el día de la fecha más tardía de su ventana; si el grupo tiene ventanas, se ve la corta («16–18 nov»).
 * «Marcar depositado» marca TODO lo de esa fecha y esa cuenta que siga por caer, con la fecha propuesta: la
 * estimada si ya pasó, hoy si no (no se marca depositado algo con una fecha que todavía no llegó).
 */
export function UpcomingDeposits({ groups, currency, today, window }: UpcomingDepositsProps) {
  const headingId = useId();
  const [open, setOpen] = useState<DepositGroupView | null>(null);
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id={headingId} className="titulo text-xl">
          Próximos depósitos
        </h2>
        <p className="text-ink-soft">
          Lo atrasado y lo que cae del <DateText value={window.from} /> al <DateText value={window.to} />, por cuenta.
          No depende del período.
        </p>
      </div>
      {groups.length === 0 ? (
        <p className="rounded-card border border-rule bg-surface p-4 text-ink-soft">
          No hay nada por caer en los próximos días.
        </p>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {groups.map((group) => (
            <li key={`${group.date}·${group.ids[0] ?? ""}`}>
              <DepositGroupCard group={group} currency={currency} onDeposit={() => setOpen(group)} />
            </li>
          ))}
        </ul>
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
    </section>
  );
}

function DepositGroupCard({
  group,
  currency,
  onDeposit,
}: {
  group: DepositGroupView;
  currency: Currency;
  onDeposit: () => void;
}) {
  const titleId = useId();
  const window = { from: group.from, to: group.date };
  const [first, last] = windowDayLabels(window);
  // El nombre del grupo, como texto corrido: «vie 13 nov 2026 · Cuenta principal ··4321», o con una ventana,
  // «Entre el lun 16 y el mié 18 nov · Cuenta principal ··4321».
  const name = last === undefined ? formatDate(group.date) : `Entre el ${first} y el ${last}`;
  return (
    <article
      aria-labelledby={titleId}
      className={cn(
        "flex h-full flex-col gap-3 rounded-card border p-4",
        group.overdue ? "border-warning bg-warning-soft" : "border-rule bg-surface",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 id={titleId} className="min-w-0 font-semibold">
          <span className="sr-only">{`${name} · ${group.accountName}`}</span>
          <span aria-hidden className="flex flex-col">
            {last === undefined ? <DateText value={group.date} /> : <DepositWindowShort window={window} />}
            <span className="font-normal text-ink-soft">{group.accountName}</span>
          </span>
        </h3>
        {group.overdue ? <Badge tone="warning">Atrasado</Badge> : null}
      </div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="flex flex-col">
          <Money value={group.net} currency={currency} className="text-xl font-semibold" />
          <span className="text-sm text-ink-soft">{cobros(group.count)}</span>
        </p>
        <Button onClick={onDeposit}>Marcar depositado</Button>
      </div>
    </article>
  );
}
