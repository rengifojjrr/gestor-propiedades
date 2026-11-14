import { Fragment } from "react";
import { Alert, Badge, Money, Percent } from "@/components/ui";
import { buyerFeesOf, retentionOf, type Retention } from "@/lib/pasarelas/breakdown";
import { ZERO } from "@/lib/pasarelas/decimal";
import { cmp, isZero, neg, sub } from "@/lib/pasarelas/money";
import type { AllocLine, Breakdown, Currency, Money as MoneyValue } from "@/lib/pasarelas/types";

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

/** «ya recibió $2,50 de la retención · falta $42,65» (o «· $31,94 de adelanto» si recibió más que su parte). */
function ReceivedNote({ share, line, currency }: { share: Share; line: AllocLine; currency: Currency }) {
  const rest: MoneyValue = sub(line.amount, share.amount);
  return (
    <span className="text-sm text-ink-soft">
      ya recibió <Money value={share.amount} currency={currency} /> de la retención ·{" "}
      {cmp(rest, ZERO) >= 0 ? (
        <>
          falta <Money value={rest} currency={currency} />
        </>
      ) : (
        <>
          <Money value={neg(rest)} currency={currency} /> de adelanto
        </>
      )}
    </span>
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

export function AllocationList({ breakdown }: { breakdown: Breakdown }) {
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
      <ul aria-label="Reparto" className="flex flex-col gap-2">
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
              {share === undefined ? null : <ReceivedNote share={share} line={line} currency={currency} />}
            </li>
          );
        })}
      </ul>
      {outside.length > 0 ? <OutsideNote shares={outside} currency={currency} /> : null}
    </div>
  );
}
