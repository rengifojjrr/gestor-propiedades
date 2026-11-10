import Link from "next/link";
import { Money, TBody, THead, Table, Td, Th, Tr } from "@/components/ui";
import { moneyTone } from "@/components/ui/tone";
import type { Currency } from "@/lib/pasarelas/types";
import type { SplitRow } from "@/server/pasarelas/queries/summary";

export type SplitsTableProps = {
  rows: SplitRow[];
  currency: Currency;
  /** El nombre de un beneficiario por su id. */
  nameOf: (id: string) => string;
};

const CAPTION = "Repartos por beneficiario";
const HEADING_ID = "resumen-repartos";

/**
 * Lo de cada beneficiario en una moneda: lo asignado por los cobros del período, lo liquidado en el período y el
 * saldo de toda la historia (asignado menos liquidado). Un saldo negativo es lo que el beneficiario recibió de más:
 * está a favor de la empresa.
 */
export function SplitsTable({ rows, currency, nameOf }: SplitsTableProps) {
  return (
    <section aria-labelledby={HEADING_ID} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id={HEADING_ID} className="titulo text-xl">
          {CAPTION}
        </h2>
        <p className="text-ink-soft">
          Asignado y liquidado en el período; el saldo es de toda la historia. Lo liquidado y el saldo no se separan
          por empresa ni por pasarela.
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="rounded-card border border-rule bg-surface p-4 text-ink-soft">
          Todavía no hay repartos en {currency}.{" "}
          <Link href="/pasarelas/repartos" className="font-semibold text-brand hover:underline">
            Ir a Repartos
          </Link>
        </p>
      ) : (
        <Table label="Tabla de repartos por beneficiario">
          <caption className="sr-only">{CAPTION}</caption>
          <THead>
            <Tr>
              <Th>Beneficiario</Th>
              <Th numeric>Asignado</Th>
              <Th numeric>Liquidado</Th>
              <Th numeric>Saldo</Th>
            </Tr>
          </THead>
          <TBody>
            {rows.map((row) => (
              <Tr key={row.beneficiaryId}>
                <Th scope="row">{nameOf(row.beneficiaryId)}</Th>
                <Td numeric>
                  <Money value={row.assigned} currency={currency} />
                </Td>
                <Td numeric>
                  <Money value={row.settled} currency={currency} />
                </Td>
                <Td numeric>
                  <Money value={row.balance} currency={currency} />
                  {moneyTone(row.balance) === "negative" ? (
                    <span className="block text-sm font-normal text-ink-soft">a favor de la empresa</span>
                  ) : null}
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}
    </section>
  );
}
