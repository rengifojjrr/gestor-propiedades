"use client";

import Link from "next/link";
import { Checkbox, DateText, Money, TBody, THead, Table, Td, Th, Tr } from "@/components/ui";
import { depositWindowOf } from "@/lib/pasarelas/dates";
import { cmp, isZero } from "@/lib/pasarelas/money";
import type { ISODate } from "@/lib/pasarelas/types";
import type { TxListItem } from "@/server/pasarelas/dto";
import { DepositWindowShort, isWindow } from "./DepositWindow";
import { StatusBadge } from "./StatusBadge";
import { txName } from "./statusChanges";
import { SelectAllCheckbox, useTxSelection } from "./TxBulkBar";
import { TxStatusMenu } from "./TxStatusMenu";

/** Un cobro de la lista con los nombres ya resueltos contra la configuración. */
export type TxRowView = TxListItem & { companyName: string; channelName: string | null; gatewayName: string };

/** El nombre de la casilla que elige el cobro: «Seleccionar el cobro pi_123». */
export const selectLabel = (tx: TxRowView): string => `Seleccionar el cobro ${txName(tx)}`;

/** El enlace al detalle: la referencia, o «Ver cobro» con su fecha y monto para el lector de pantalla. */
export function TxLink({ tx, className }: { tx: TxRowView; className?: string }) {
  return (
    <Link href={`/pasarelas/cobros/${tx.id}`} className={className}>
      {tx.reference ?? (
        <>
          Ver cobro<span className="sr-only"> {txName(tx)}</span>
        </>
      )}
    </Link>
  );
}

/**
 * La casilla de un cobro, con su nombre solo para el lector de pantalla (la fila ya dice de qué cobro se trata).
 * Sin texto a la vista, la fila tocable mediría lo que la casilla: el ancho la deja en 44 px.
 */
export function TxCheckbox({ tx }: { tx: TxRowView }) {
  const { isSelected, toggle } = useTxSelection();
  return (
    <Checkbox
      label={<span className="sr-only">{selectLabel(tx)}</span>}
      className="w-11 shrink-0"
      checked={isSelected(tx.id)}
      onChange={(event) => toggle(tx.id, event.currentTarget.checked)}
    />
  );
}

/**
 * Cuándo cae o cayó: la fecha real si ya se depositó; si no, la estimada. Si la estimada es una ventana, la corta
 * («16–18 nov»); si es un solo día, la fecha de siempre.
 */
export function DepositDate({ tx }: { tx: TxRowView }) {
  const estimated = depositWindowOf(tx);
  if (tx.status === "depositado" && tx.depositedOn !== null) {
    return (
      <span className="flex flex-col">
        <span className="text-sm text-ink-soft">Cayó</span>
        <DateText value={tx.depositedOn} />
      </span>
    );
  }
  if (estimated !== null) {
    return (
      <span className="flex flex-col">
        <span className="text-sm text-ink-soft">Estimado</span>
        {isWindow(estimated) ? <DepositWindowShort window={estimated} /> : <DateText value={estimated.to} />}
      </span>
    );
  }
  return <span className="text-ink-soft">—</span>;
}

/**
 * La marca discreta de lo que pagó el comprador de las comisiones de un cobro: «la pagó el comprador» si pagó todas;
 * si un reembolso o una disputa le dejaron una parte al negocio, cuánto pagó él. Nada si no pagó nada (un reembolso
 * total: recuperó lo que pagó) o si la comisión la pagamos nosotros.
 */
export function BuyerPaidMark({ tx }: { tx: TxRowView }) {
  if (isZero(tx.buyerFees)) return null;
  return (
    <span className="text-sm text-ink-soft">
      {cmp(tx.buyerFees, tx.fees) === 0 ? (
        "la pagó el comprador"
      ) : (
        <>
          el comprador pagó <Money value={tx.buyerFees} currency={tx.currency} />
        </>
      )}
    </span>
  );
}

/**
 * La lista de cobros como tabla (desde 768 px), con una casilla por fila para elegir y, bajo el estado, «Cambiar
 * estado».
 */
export function TxTable({ rows, today }: { rows: TxRowView[]; today: ISODate }) {
  return (
    <Table label="Cobros">
      <THead>
        <Tr>
          <Th className="w-12 py-0">
            <SelectAllCheckbox />
          </Th>
          <Th>Fecha</Th>
          <Th>Cobro</Th>
          <Th>Estado</Th>
          <Th numeric>Bruto</Th>
          <Th numeric>Comisiones</Th>
          <Th numeric>Neto</Th>
          <Th>Depósito</Th>
        </Tr>
      </THead>
      <TBody>
        {rows.map((tx) => (
          <Tr key={tx.id}>
            <Td className="py-0">
              <TxCheckbox tx={tx} />
            </Td>
            <Td>
              <DateText value={tx.occurredOn} />
            </Td>
            <Td>
              <span className="flex flex-col">
                <TxLink tx={tx} className="-my-2 inline-flex min-h-11 items-center font-semibold text-brand hover:underline" />
                <span className="text-sm text-ink-soft">
                  {tx.companyName} · {tx.gatewayName}
                </span>
              </span>
            </Td>
            <Td>
              {/* Un <div>: el menú lleva sus diálogos y su lista, que no caben en un <span>. */}
              <div className="flex flex-col items-start gap-1">
                <StatusBadge tx={tx} today={today} />
                <TxStatusMenu tx={tx} today={today} placement="center" className="-my-2" />
              </div>
            </Td>
            <Td numeric>
              <Money value={tx.gross} currency={tx.currency} />
            </Td>
            <Td numeric>
              <span className="flex flex-col items-end">
                <Money value={tx.fees} currency={tx.currency} />
                <BuyerPaidMark tx={tx} />
              </span>
            </Td>
            <Td numeric>
              <Money value={tx.net} currency={tx.currency} />
            </Td>
            <Td>
              <DepositDate tx={tx} />
            </Td>
          </Tr>
        ))}
      </TBody>
    </Table>
  );
}
