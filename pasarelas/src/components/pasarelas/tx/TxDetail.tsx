import type { ReactNode } from "react";
import { AllocationList } from "@/components/pasarelas/AllocationList";
import { BreakdownCard } from "@/components/pasarelas/BreakdownCard";
import { ORIGIN_LABEL, isOption, originOf } from "@/components/pasarelas/gateways/international";
import { Alert, Card, CardBody, CardHeader, CardTitle, DateText, DateTimeText } from "@/components/ui";
import { depositWindowOf } from "@/lib/pasarelas/dates";
import type { ISODate, PayConfig, TxSnapshot } from "@/lib/pasarelas/types";
import type { TxDetail as TxDetailData } from "@/server/pasarelas/dto";
import { DepositWindowText } from "./DepositWindow";
import { EventsTimeline } from "./EventsTimeline";
import { ReceiptsCard } from "./ReceiptsCard";
import { StatusBadge } from "./StatusBadge";
import { TxActions } from "./TxActions";

/** Una fila de datos: qué es a la izquierda y su valor a la derecha. */
function Row({ label, testId, children }: { label: string; testId?: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
      <dt className="text-ink-soft">{label}</dt>
      <dd data-testid={testId} className="ml-auto min-w-0 text-right break-words">
        {children}
      </dd>
    </div>
  );
}

/** Los nombres de lo que eligió el cobro, con la configuración de ahora; si ya no existe, lo congelado. */
function namesOf(tx: TxSnapshot, cfg: PayConfig) {
  const { rules } = tx.breakdown;
  const account = cfg.bankAccounts.find((candidate) => candidate.id === tx.bankAccountId);
  return {
    company: cfg.companies.find((candidate) => candidate.id === tx.companyId)?.name ?? "—",
    channel:
      tx.channelId === null
        ? null
        : (cfg.channels.find((candidate) => candidate.id === tx.channelId)?.name ?? rules.platform?.name ?? "—"),
    gateway: cfg.gateways.find((candidate) => candidate.id === tx.gatewayId)?.name ?? rules.gateway.name,
    account:
      tx.bankAccountId === null
        ? null
        : account === undefined
          ? "Cuenta que ya no existe"
          : account.last4 === null
            ? account.alias
            : `${account.alias} ··${account.last4}`,
  };
}

const DISPUTE_LABEL = { abierta: "Abierta", ganada: "Ganada", perdida: "Perdida" } as const;

/**
 * «Nacional» o «Internacional», si la pasarela cobra (o cobró) un recargo a los pagos internacionales: el cobro fue
 * internacional si su desglose congelado trae ese recargo. Si la pasarela nunca lo tuvo, no hay nada que decir.
 */
function originText(tx: TxSnapshot, cfg: PayConfig): string | null {
  const gateway = cfg.gateways.find((candidate) => candidate.id === tx.gatewayId);
  if (gateway === undefined || gateway.extras.every(isOption)) return null;
  return ORIGIN_LABEL[originOf(gateway, tx.breakdown.rules.extras.map((option) => option.id)).origin];
}

/** Lo que el cobro es fuera de las cifras: quién, por dónde, cuándo y a qué cuenta. */
function DataCard({ tx, cfg }: { tx: TxSnapshot; cfg: PayConfig }) {
  const names = namesOf(tx, cfg);
  const scheme = tx.breakdown.rules.scheme;
  const origin = originText(tx, cfg);
  const estimated = depositWindowOf(tx);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Datos</CardTitle>
      </CardHeader>
      <CardBody>
        <dl className="flex flex-col gap-2">
          <Row label="Empresa">{names.company}</Row>
          {names.channel === null ? null : <Row label="Canal">{names.channel}</Row>}
          <Row label="Pasarela">{names.gateway}</Row>
          {origin === null ? null : (
            <Row label="Origen" testId="origen">
              {origin}
            </Row>
          )}
          <Row label="Fecha del cobro">
            <DateTimeText value={tx.occurredAt} />
          </Row>
          <Row label="Fecha estimada" testId="fecha-estimada">
            {estimated === null ? (
              "—"
            ) : (
              <span className="flex flex-col items-end">
                <DepositWindowText window={estimated} />
                {tx.estimatedIsManual ? <span className="text-sm text-ink-soft">puesta a mano</span> : null}
              </span>
            )}
          </Row>
          {tx.depositedOn === null ? null : (
            <Row label="Depositado el" testId="depositado-el">
              <DateText value={tx.depositedOn} />
            </Row>
          )}
          <Row label="Cuenta destino">{names.account ?? "Sin cuenta"}</Row>
          <Row label="Reparto">{scheme === null ? "Sin reparto" : scheme.name}</Row>
          {tx.disputeState === null ? null : (
            <Row label="Disputa">
              {DISPUTE_LABEL[tx.disputeState]}
              {tx.disputeOpenedOn === null ? null : (
                <>
                  {" · abierta el "}
                  <DateText value={tx.disputeOpenedOn} />
                </>
              )}
              {tx.disputeClosedOn === null ? null : (
                <>
                  {" · cerrada el "}
                  <DateText value={tx.disputeClosedOn} />
                </>
              )}
            </Row>
          )}
          {tx.reference === null ? null : (
            <Row label="Referencia">
              <span className="break-all">{tx.reference}</span>
            </Row>
          )}
          {tx.note === null ? null : <Row label="Nota">{tx.note}</Row>}
        </dl>
      </CardBody>
    </Card>
  );
}

export type TxDetailProps = {
  tx: TxDetailData;
  /** La configuración del usuario: los nombres de empresa, canal, pasarela y cuenta. */
  cfg: PayConfig;
  /** Hoy en Nueva York. */
  today: ISODate;
};

/**
 * El detalle de un cobro: su estado y sus acciones, sus datos, el desglose congelado, el reparto, los comprobantes
 * y el historial. En el celular, una columna; en el escritorio ancho, dos.
 */
export function TxDetail({ tx, cfg, today }: TxDetailProps) {
  // A los componentes del navegador solo va el cobro: el reparto, los comprobantes y el historial se pintan aquí.
  const { allocations: _allocations, receipts, events, ...snapshot } = tx;
  const trashed = tx.deletedAt !== null;
  return (
    <div className="flex flex-col gap-5">
      {trashed ? (
        <Alert tone="warning" title="Este cobro está en la papelera">
          No cuenta en los totales. Restáuralo para poder cambiarlo.
        </Alert>
      ) : null}
      <StatusBadge tx={tx} today={today} />
      <TxActions tx={snapshot} today={today} />
      <div className="grid gap-5 xl:grid-cols-2 xl:items-start">
        <div className="flex min-w-0 flex-col gap-5">
          <DataCard tx={tx} cfg={cfg} />
          <BreakdownCard breakdown={tx.breakdown} />
          <Card>
            <CardHeader>
              <CardTitle>Reparto</CardTitle>
            </CardHeader>
            <CardBody>
              <AllocationList breakdown={tx.breakdown} />
            </CardBody>
          </Card>
        </div>
        <div className="flex min-w-0 flex-col gap-5">
          <ReceiptsCard transactionId={tx.id} receipts={receipts} editable={!trashed} />
          <EventsTimeline events={events} />
        </div>
      </div>
    </div>
  );
}
