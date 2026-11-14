import Link from "next/link";
import { Money, TBody, THead, Table, Td, Th, Tr } from "@/components/ui";
import { moneyTone } from "@/components/ui/tone";
import { BalanceFigures } from "@/components/pasarelas/splits/BalanceList";
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
 * saldo de toda la historia (asignado menos liquidado, menos lo que una pasarela ya le pagó de lo que retuvo). Un
 * saldo negativo es lo que el beneficiario recibió de más: está a favor de la empresa. En el celular, cada
 * beneficiario va en su tarjeta, como en Repartos: con tres columnas de montos la tabla no cabe en 390 px y el saldo
 * quedaría fuera de la vista.
 */
export function SplitsTable({ rows, currency, nameOf }: SplitsTableProps) {
  return (
    <section aria-labelledby={HEADING_ID} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id={HEADING_ID} className="titulo text-xl">
          {CAPTION}
        </h2>
        <p className="text-ink-soft">
          Asignado y liquidado en el período; el saldo es de toda la historia y descuenta lo que una pasarela ya le
          pagó de lo que retuvo. Lo liquidado y el saldo no se separan por empresa ni por pasarela.
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
        <>
          <ul aria-label={CAPTION} className="flex flex-col gap-4 md:hidden">
            {rows.map((row) => (
              <li key={row.beneficiaryId} className="flex min-w-0 flex-col gap-2">
                <h3 className="titulo text-base leading-snug">{nameOf(row.beneficiaryId)}</h3>
                <BalanceFigures
                  rows={[{ currency, assigned: row.assigned, settled: row.settled, balance: row.balance }]}
                />
              </li>
            ))}
          </ul>
          <div className="hidden md:block">
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
          </div>
        </>
      )}
    </section>
  );
}
