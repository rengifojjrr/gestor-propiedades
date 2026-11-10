import { DateText, Percent } from "@/components/ui";
import { dec, normPct } from "@/lib/pasarelas/decimal";
import { schemeTotal } from "@/lib/pasarelas/schemes";
import type { SchemeVersionCfg } from "@/lib/pasarelas/types";
import { BASE_LABEL, SINCE_START } from "./labels";

/** «Desde el inicio» o «Desde vie 13 nov 2026». */
export function SinceText({ from }: { from: string }) {
  return from === SINCE_START ? (
    <>Desde el inicio</>
  ) : (
    <>
      Desde <DateText value={from} />
    </>
  );
}

/** Una versión de un esquema: cada beneficiario con su porcentaje, quién recibe el resto, la base y desde cuándo. */
export function SchemeVersionSummary({
  version,
  nameOf,
}: {
  version: SchemeVersionCfg;
  /** El nombre de cada beneficiario. */
  nameOf: (beneficiaryId: string) => string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <ul className="flex flex-col gap-1">
        {version.lines.map((line) => (
          <li key={line.beneficiaryId} className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 break-words">{nameOf(line.beneficiaryId)}</span>
            <Percent value={line.pct} />
          </li>
        ))}
      </ul>
      {version.remainderBeneficiaryId ? (
        <p className="text-sm">
          Resto: {nameOf(version.remainderBeneficiaryId)} (
          <Percent value={normPct(dec("100").minus(dec(schemeTotal(version.lines))))} />)
        </p>
      ) : null}
      <p className="text-sm text-ink-soft">
        {BASE_LABEL[version.base]} · <SinceText from={version.effectiveFrom} />
      </p>
    </div>
  );
}
