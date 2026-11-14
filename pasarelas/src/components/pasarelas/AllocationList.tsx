import { Fragment } from "react";
import { Alert, Badge, DateText, Money, Percent } from "@/components/ui";
import { buyerFeesOf, retentionOf, type Retention } from "@/lib/pasarelas/breakdown";
import { formatDate } from "@/lib/pasarelas/dates";
import { ZERO } from "@/lib/pasarelas/decimal";
import { cmp, isZero, neg, sub } from "@/lib/pasarelas/money";
import type { PayoutStatus } from "@/lib/pasarelas/payouts";
import type { AllocLine, Breakdown, Currency, ISODate, Money as MoneyValue } from "@/lib/pasarelas/types";
import type { TxPayout } from "@/server/pasarelas/queries/settlements";
import { PayAllButton, PayPartButton, UndoPayoutButton } from "./tx/PayoutActions";
import { PayoutBadge } from "./tx/PayoutState";
import { undoPayoutText } from "./tx/payoutText";

/*
 * El reparto de un cobro tal como lo calculó el motor: sobre qué se reparte y cuánto le toca a cada beneficiario.
 * Si la comisión la pagó el comprador, se reparte lo que queda (el neto) y lo dice. Si con un reembolso total el
 * comprador ya no pagó nada (`buyerFeesOf` en 0), no dice que la pagó él: solo cómo se registró el cobro.
 * Una parte que no pagó comisión lleva «no paga comisión» y una frase explica la cuenta: su parte salió del bruto.
 * Si la pasarela retuvo algo, a cada persona que lo recibe le dice lo que ya recibió de la retención y lo que falta
 * (o lo que recibió de más, un adelanto); y advierte de quien lo recibe sin estar en el reparto de ese cobro: es un
 * adelanto y su saldo baja.
 * Los nombres vienen dentro del desglose. Sin estado: se puede usar desde el servidor (detalle del cobro) o dentro
 * de la vista previa de «Registrar cobro».
 *
 * En el detalle del cobro (`payouts`), cada parte dice además lo que ya se le pagó y lo que falta («Pagado», «Falta
 * $25,00», «Se le pagó de más $10,00»), con «Marcar pagado…», cada pago ligado al cobro con su «Deshacer», y
 * «Marcar todo el reparto pagado…». Lo retenido se ve como ya recibido, y lo que falta lo dice el estado de pago.
 */

const BASE_LABEL = { neto: "Sobre el neto", bruto: "Sobre el bruto" } as const;

/** «Grupo A», «Grupo A y Grupo C», «Grupo A, Grupo B y Grupo C». */
function namesText(names: readonly string[]): string {
  return names.length === 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} y ${names.at(-1) ?? ""}`;
}

/** Lo que va antes del porcentaje número `i` de `count`: «el», «, el» o « y el». */
function before(i: number, count: number): string {
  if (i === 0) return "el ";
  return i === count - 1 ? " y el " : ", el ";
}

/**
 * «Grupo A no paga comisión: su parte es el 20 % del bruto. La comisión la pagan los demás.» (o, con varias, «Grupo A
 * y Grupo C no pagan comisión: sus partes son el 50 % y el 20 % del bruto…»).
 */
function SparedNote({ lines }: { lines: readonly AllocLine[] }) {
  const one = lines.length === 1;
  return (
    <p className="text-sm">
      {namesText(lines.map((line) => line.name))} {one ? "no paga comisión: su parte es " : "no pagan comisión: sus partes son "}
      {lines.map((line, i) => (
        <Fragment key={line.beneficiaryId}>
          {before(i, lines.length)}
          <Percent value={line.pct} />
        </Fragment>
      ))}{" "}
      del bruto. La comisión la pagan los demás.
    </p>
  );
}

type Share = Retention["shares"][number];

/**
 * «ya recibió $2,50 de la retención · falta $42,65» (o «· $31,94 de adelanto» si recibió más que su parte). Con el
 * estado de pago a la vista (`brief`), solo lo recibido: lo que falta lo dice ese estado, que cuenta también lo pagado.
 */
function ReceivedNote({
  share,
  line,
  currency,
  brief,
}: {
  share: Share;
  line: AllocLine;
  currency: Currency;
  brief: boolean;
}) {
  const rest: MoneyValue = sub(line.amount, share.amount);
  return (
    <span className="text-sm text-ink-soft">
      ya recibió <Money value={share.amount} currency={currency} /> de la retención
      {brief ? null : (
        <>
          {" · "}
          {cmp(rest, ZERO) >= 0 ? (
            <>
              falta <Money value={rest} currency={currency} />
            </>
          ) : (
            <>
              <Money value={neg(rest)} currency={currency} /> de adelanto
            </>
          )}
        </>
      )}
    </span>
  );
}

/** Lo pagado a las partes del reparto de un cobro, para su detalle. */
export type PayoutsView = {
  transactionId: string;
  /** Lo que se le debe a cada parte (`payoutStatus`); `null` si el cobro no tiene nada pendiente (fallido, papelera). */
  status: PayoutStatus | null;
  /** Cada pago ligado al cobro, con los otros cobros que paga. */
  payments: readonly TxPayout[];
  /** Los nombres de los beneficiarios: también los de quien tiene pagos sin estar en el reparto del desglose. */
  names: Readonly<Record<string, string>>;
  /** Hoy en Nueva York: la fecha que viene puesta al marcar un pago. */
  today: ISODate;
};

/** «Pagado el sáb 14 nov 2026: $25,00», con lo que cubre si paga otros cobros, y su «Deshacer». */
function PaymentLine({ payment, name }: { payment: TxPayout; name: string }) {
  const refund = cmp(payment.here, ZERO) < 0;
  const what = refund ? `la devolución de ${name}` : `el pago a ${name}`;
  const shown = (amount: MoneyValue) => (refund ? neg(amount) : amount);
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3">
      <p className="min-w-0 text-sm text-ink-soft">
        {refund ? "Devolvió el " : "Pagado el "}
        <DateText value={payment.paidOn} />: <Money value={shown(payment.here)} currency={payment.currency} />
        {payment.others.length === 0 ? null : (
          <>
            {" "}
            (de un pago de <Money value={shown(payment.amount)} currency={payment.currency} /> por{" "}
            {payment.others.length + 1} cobros)
          </>
        )}
      </p>
      <UndoPayoutButton
        settlementId={payment.settlementId}
        label={`${what} del ${formatDate(payment.paidOn)}`}
        text={undoPayoutText({ ...payment, beneficiaryName: name })}
      />
    </div>
  );
}

/** El estado de pago de una parte, «Marcar pagado…» si le falta algo, y sus pagos ligados al cobro. */
function PartPayouts({
  beneficiaryId,
  name,
  currency,
  payouts,
}: {
  beneficiaryId: string;
  name: string;
  currency: Currency;
  payouts: PayoutsView;
}) {
  const part = payouts.status?.parts.find((candidate) => candidate.beneficiaryId === beneficiaryId);
  const payments = payouts.payments.filter((payment) => payment.beneficiaryId === beneficiaryId);
  if (part === undefined && payments.length === 0) return null;
  return (
    <div className="mt-1 flex flex-col gap-1">
      {part === undefined ? null : (
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <PayoutBadge part={part} currency={currency} />
          {part.state === "falta" ? (
            <PayPartButton
              transactionId={payouts.transactionId}
              beneficiaryId={beneficiaryId}
              name={name}
              currency={currency}
              owed={part.owed}
              today={payouts.today}
            />
          ) : null}
        </div>
      )}
      {payments.map((payment) => (
        <PaymentLine key={payment.settlementId} payment={payment} name={name} />
      ))}
    </div>
  );
}

type PayoutsProps = { lines: readonly AllocLine[]; currency: Currency; payouts: PayoutsView };

/**
 * Quienes tienen pagos ligados al cobro sin estar en el reparto de su desglose (se cambió el esquema después de
 * pagarles): se les pagó de más, y sus pagos se pueden deshacer.
 */
function OutsidePayouts({ lines, currency, payouts }: PayoutsProps) {
  const inLines = new Set(lines.map((line) => line.beneficiaryId));
  const ids = [
    ...new Set([
      ...(payouts.status?.parts ?? []).map((part) => part.beneficiaryId),
      ...payouts.payments.map((payment) => payment.beneficiaryId),
    ]),
  ].filter((id) => !inLines.has(id));
  if (ids.length === 0) return null;
  return (
    <div className="flex flex-col gap-2 border-t border-rule pt-2">
      <p className="text-sm font-semibold">Pagos a quien no está en el reparto</p>
      {ids.map((id) => {
        const name = payouts.names[id] ?? "Beneficiario que ya no existe";
        return (
          <div key={id} className="flex flex-col">
            <span>{name}</span>
            <PartPayouts beneficiaryId={id} name={name} currency={currency} payouts={payouts} />
          </div>
        );
      })}
    </div>
  );
}

/** «Marcar todo el reparto pagado…», si a alguna parte le falta algo. */
function PayAll({ lines, currency, payouts }: PayoutsProps) {
  const missing = (payouts.status?.parts ?? [])
    .filter((part) => part.state === "falta")
    .map((part) => ({
      beneficiaryId: part.beneficiaryId,
      name:
        lines.find((line) => line.beneficiaryId === part.beneficiaryId)?.name ??
        payouts.names[part.beneficiaryId] ??
        "Beneficiario que ya no existe",
      owed: part.owed,
    }));
  // En el orden del reparto (la base no lo guarda); quien no esté en él, al final.
  const place = (id: string) => {
    const at = lines.findIndex((line) => line.beneficiaryId === id);
    return at < 0 ? lines.length : at;
  };
  missing.sort((a, b) => place(a.beneficiaryId) - place(b.beneficiaryId));
  if (missing.length === 0) return null;
  return (
    <PayAllButton transactionId={payouts.transactionId} currency={currency} parts={missing} today={payouts.today} />
  );
}

/** Quienes reciben lo retenido sin estar en el reparto de este cobro: un adelanto que les baja el saldo. */
function OutsideNote({ shares, currency }: { shares: readonly Share[]; currency: Currency }) {
  return (
    <Alert tone="warning">
      {shares.map((share) => (
        <p key={share.beneficiaryId}>
          {share.name} recibe <Money value={share.amount} currency={currency} /> de la retención pero no está en el
          reparto de este cobro: es un adelanto y su saldo baja.
        </p>
      ))}
    </Alert>
  );
}

export function AllocationList({ breakdown, payouts }: { breakdown: Breakdown; payouts?: PayoutsView }) {
  const { currency, alloc } = breakdown;
  // Solo cuenta lo que de verdad recibió (con un reembolso total o un fallido, nada).
  const received = (retentionOf(breakdown)?.shares ?? []).filter((share) => !isZero(share.amount));
  const shareOf = new Map(received.map((share) => [share.beneficiaryId, share]));
  const outside = received.filter((share) => !alloc.lines.some((line) => line.beneficiaryId === share.beneficiaryId));
  if (alloc.baseKind === null) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-ink-soft">Este cobro no se reparte.</p>
        {outside.length > 0 ? <OutsideNote shares={outside} currency={currency} /> : null}
        {payouts === undefined ? null : <OutsidePayouts lines={[]} currency={currency} payouts={payouts} />}
      </div>
    );
  }
  const spared = alloc.lines.filter((line) => line.feeExempt);
  return (
    <div className="flex flex-col gap-2">
      {breakdown.state.feesPaidBy === "comprador" ? (
        <p className="text-sm">
          {isZero(buyerFeesOf(breakdown))
            ? "Se reparte sobre lo que te queda: el cobro se registró con la comisión a cargo del comprador."
            : "Se reparte sobre lo que te queda: la comisión la pagó el comprador."}
        </p>
      ) : null}
      {spared.length > 0 ? <SparedNote lines={spared} /> : null}
      <p className="text-sm text-ink-soft">
        {BASE_LABEL[alloc.baseKind]}: <Money value={alloc.baseAmount} currency={currency} />
      </p>
      <ul aria-label="Reparto" className={payouts === undefined ? "flex flex-col gap-2" : "flex flex-col gap-3"}>
        {alloc.lines.map((line) => {
          const share = shareOf.get(line.beneficiaryId);
          return (
            <li key={line.beneficiaryId} className="flex flex-col">
              <span className="flex items-baseline justify-between gap-3">
                <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                  <span>{line.name}</span>
                  {line.isRemainder ? <Badge>Resto</Badge> : null}
                  {line.feeExempt ? <Badge>no paga comisión</Badge> : null}
                  <Percent value={line.pct} className="text-sm text-ink-soft" />
                </span>
                <Money value={line.amount} currency={currency} />
              </span>
              {share === undefined ? null : (
                <ReceivedNote share={share} line={line} currency={currency} brief={payouts !== undefined} />
              )}
              {payouts === undefined ? null : (
                <PartPayouts beneficiaryId={line.beneficiaryId} name={line.name} currency={currency} payouts={payouts} />
              )}
            </li>
          );
        })}
      </ul>
      {outside.length > 0 ? <OutsideNote shares={outside} currency={currency} /> : null}
      {payouts === undefined ? null : (
        <>
          <OutsidePayouts lines={alloc.lines} currency={currency} payouts={payouts} />
          <PayAll lines={alloc.lines} currency={currency} payouts={payouts} />
        </>
      )}
    </div>
  );
}
