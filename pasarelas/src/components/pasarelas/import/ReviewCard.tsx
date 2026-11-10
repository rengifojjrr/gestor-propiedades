"use client";

import type { ReactNode } from "react";
import {
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  DateTimeText,
  Money,
  Stat,
  Table,
  TBody,
  Td,
  Th,
  THead,
  Tr,
} from "@/components/ui";
import type { ImportRow, ImportSkip } from "@/lib/pasarelas/import";
import { groupSkips } from "./plan";

/** Cuántas filas convertidas se enseñan de muestra. */
const SAMPLE_SIZE = 5;
/** Cuántas líneas se nombran por motivo, y cuántos errores se listan. */
const LINES_SHOWN = 20;
const ERRORS_SHOWN = 50;

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

function linesText(lines: number[]): string {
  const shown = lines.slice(0, LINES_SHOWN).join(", ");
  const rest = lines.length - LINES_SHOWN;
  return `${lines.length === 1 ? "Línea" : "Líneas"} ${shown}${rest > 0 ? ` y ${rest} más` : ""}`;
}

/**
 * «Así lo entendí»: lo que se importaría, lo que se deja fuera (y por qué) y lo que no se pudo leer, con una
 * muestra de las primeras filas ya convertidas. La muestra solo enseña lo convertido: nada del comprador.
 */
export function ReviewCard({
  result,
  children,
}: {
  result: { ok: ImportRow[]; skipped: ImportSkip[]; errors: ImportSkip[] };
  /** Las opciones y el botón para importar. */
  children: ReactNode;
}) {
  const { ok, skipped, errors } = result;
  const groups = groupSkips(skipped);

  return (
    <Card>
      <section aria-labelledby="asi-lo-entendi" className="contents">
        <CardHeader>
          <CardTitle id="asi-lo-entendi">Así lo entendí</CardTitle>
        </CardHeader>
        <CardBody className="flex flex-col gap-5">
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Nuevos" value={ok.length} hint={ok.length === 1 ? "cobro" : "cobros"} />
            <Stat label="Omitidos" value={skipped.length} hint="no son cobros" />
            <Stat label="Con error" value={errors.length} hint="no se leen" />
          </div>
          <p className="text-sm text-ink-soft">
            Si alguno ya está registrado con la misma referencia en esta pasarela, no se repite: se cuenta como que ya
            existía.
          </p>

          {ok.length > 0 ? (
            <div className="flex flex-col gap-2">
              <h3 className="font-semibold">
                {ok.length > SAMPLE_SIZE ? `Las primeras ${SAMPLE_SIZE} filas, ya convertidas` : "Las filas, ya convertidas"}
              </h3>
              {/* En el celular, una tarjeta por fila: la tabla de cinco columnas no cabe sin cortar la referencia. */}
              <ul aria-label="Muestra de las filas convertidas" className="flex flex-col gap-2 md:hidden">
                {ok.slice(0, SAMPLE_SIZE).map((row) => (
                  <li key={row.line} className="flex flex-col gap-1 rounded-control border border-rule p-3">
                    <p className="font-semibold break-all">{row.reference}</p>
                    <p className="text-sm text-ink-soft">
                      Línea {row.line} · <DateTimeText value={row.occurredAt} />
                    </p>
                    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 text-sm">
                      <dt className="text-ink-soft">Monto</dt>
                      <dd className="text-right">
                        <Money value={row.grossOriginal} currency={row.currency} />
                      </dd>
                      <dt className="text-ink-soft">Comisión del archivo</dt>
                      <dd className="text-right">
                        {row.reportedFee === null ? "—" : <Money value={row.reportedFee} currency={row.currency} />}
                      </dd>
                    </dl>
                  </li>
                ))}
              </ul>
              <div className="hidden md:block">
                <Table label="Muestra de las filas convertidas">
                  <THead>
                    <Tr>
                      <Th>Línea</Th>
                      <Th>Referencia</Th>
                      <Th>Fecha y hora</Th>
                      <Th numeric>Monto</Th>
                      <Th numeric>Comisión del archivo</Th>
                    </Tr>
                  </THead>
                  <TBody>
                    {ok.slice(0, SAMPLE_SIZE).map((row) => (
                      <Tr key={row.line}>
                        <Td>{row.line}</Td>
                        <Td>{row.reference}</Td>
                        <Td>
                          <DateTimeText value={row.occurredAt} />
                        </Td>
                        <Td numeric>
                          <Money value={row.grossOriginal} currency={row.currency} />
                        </Td>
                        <Td numeric>
                          {row.reportedFee === null ? "—" : <Money value={row.reportedFee} currency={row.currency} />}
                        </Td>
                      </Tr>
                    ))}
                  </TBody>
                </Table>
              </div>
            </div>
          ) : null}

          {groups.length > 0 ? (
            <div className="flex flex-col gap-2">
              <h3 className="font-semibold">Omitidos ({plural(skipped.length, "fila", "filas")})</h3>
              <ul className="flex flex-col gap-2">
                {groups.map((group) => (
                  <li key={group.reason} className="rounded-control border border-rule p-3">
                    <p>{group.reason}</p>
                    <p className="text-sm text-ink-soft">{linesText(group.lines)}</p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {errors.length > 0 ? (
            <div className="flex flex-col gap-2">
              <h3 className="font-semibold">Con error ({plural(errors.length, "fila", "filas")})</h3>
              <p className="text-sm text-ink-soft">
                No se importan. Corrígelas en el archivo y vuelve a importarlo: lo que ya se importó no se repite.
              </p>
              <ul className="flex flex-col gap-2">
                {errors.slice(0, ERRORS_SHOWN).map((error) => (
                  <li key={error.line} className="rounded-control border border-rule p-3 break-words">
                    <span className="font-semibold">Línea {error.line}:</span> {error.reason}
                  </li>
                ))}
              </ul>
              {errors.length > ERRORS_SHOWN ? (
                <p className="text-sm text-ink-soft">Y {errors.length - ERRORS_SHOWN} más.</p>
              ) : null}
            </div>
          ) : null}

          {children}
        </CardBody>
      </section>
    </Card>
  );
}
