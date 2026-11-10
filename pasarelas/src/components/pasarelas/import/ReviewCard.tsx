"use client";

import type { ReactNode } from "react";
import {
  Alert,
  Button,
  ButtonLink,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Checkbox,
  DateText,
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
import { groupSkips, schemeText, type ReviewPlan, type ReviewState } from "./plan";

/** Cuántas filas convertidas se enseñan de muestra. */
const SAMPLE_SIZE = 5;
/** Cuántas líneas se nombran por motivo, y cuántos errores o posibles repetidos se listan. */
const LINES_SHOWN = 20;
const ERRORS_SHOWN = 50;

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

function linesText(lines: number[]): string {
  const shown = lines.slice(0, LINES_SHOWN).join(", ");
  const rest = lines.length - LINES_SHOWN;
  return `${lines.length === 1 ? "Línea" : "Líneas"} ${shown}${rest > 0 ? ` y ${rest} más` : ""}`;
}

const linesOf = (rows: readonly ImportRow[]): number[] => rows.map((row) => row.line);

/**
 * «Así lo entendí»: lo que se importaría, lo que ya está (repetido, en la papelera o registrado a mano con otra
 * referencia), lo que se deja fuera (y por qué) y lo que no se pudo leer, con una muestra de las primeras filas ya
 * convertidas; y, antes de importar, cuándo cae ese dinero y con qué esquema se reparte. La muestra solo enseña lo
 * convertido: nada del comprador.
 */
export function ReviewCard({
  result,
  review,
  gatewayName,
  companyName,
  referenceNotice,
  alreadyDeposited,
  onAlreadyDeposited,
  includePossible,
  onIncludePossible,
  onRetry,
  disabled,
  children,
}: {
  result: { ok: ImportRow[]; skipped: ImportSkip[]; errors: ImportSkip[] };
  review: ReviewState;
  gatewayName: string;
  companyName: string;
  /** Si la referencia elegida no coincide con lo registrado a mano (`referenceWarning`). */
  referenceNotice: string | null;
  alreadyDeposited: boolean;
  onAlreadyDeposited: (on: boolean) => void;
  includePossible: boolean;
  onIncludePossible: (on: boolean) => void;
  /** Vuelve a pedir la vista previa cuando falló. */
  onRetry: () => void;
  disabled: boolean;
  /** Las demás opciones y el botón para importar. */
  children: ReactNode;
}) {
  const { ok, skipped, errors } = result;
  const groups = groupSkips(skipped);
  const ready = review.state === "listo" ? review : null;
  const check = ready?.plan.check;
  // Sin filas convertibles no hay nada que buscar: cero nuevos y cero repetidos, no «…».
  const none = review.state === "sin_filas";

  return (
    <Card>
      <section aria-labelledby="asi-lo-entendi" className="contents">
        <CardHeader>
          <CardTitle id="asi-lo-entendi">Así lo entendí</CardTitle>
        </CardHeader>
        <CardBody className="flex flex-col gap-5">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat
              label="Nuevos"
              value={check ? check.fresh.length : none ? 0 : "…"}
              hint={check ? (check.fresh.length === 1 ? "cobro" : "cobros") : none ? "cobros" : "buscando"}
            />
            <Stat
              label="Repetidos"
              value={check ? check.repeated.length + check.trashed.length : none ? 0 : "…"}
              hint="ya están"
            />
            <Stat label="Omitidos" value={skipped.length} hint="no son cobros" />
            <Stat label="Con error" value={errors.length} hint="no se leen" />
          </div>

          {review.state === "cargando" ? (
            <p role="status" className="text-sm text-ink-soft">
              Buscando lo que ya está registrado en {gatewayName}…
            </p>
          ) : null}
          {review.state === "error" ? (
            <Alert tone="danger" announce title="No se pudo revisar lo que ya está registrado">
              <div className="flex flex-col items-start gap-2">
                <p>{review.message}</p>
                <Button onClick={onRetry} disabled={disabled}>
                  Reintentar
                </Button>
              </div>
            </Alert>
          ) : null}
          {referenceNotice !== null ? (
            <Alert tone="warning" title="Las referencias no coinciden con lo registrado a mano">
              {referenceNotice}
            </Alert>
          ) : null}

          {check && check.repeated.length > 0 ? (
            <div className="flex flex-col gap-2">
              <h3 className="font-semibold">Repetidos ({plural(check.repeated.length, "fila", "filas")})</h3>
              <p className="text-sm">Ya están en {gatewayName} con la misma referencia: no se tocan.</p>
              <p className="text-sm text-ink-soft">{linesText(linesOf(check.repeated))}</p>
            </div>
          ) : null}

          {check && check.trashed.length > 0 ? (
            <Alert tone="warning" title={`${check.trashed.length} en la papelera`}>
              <div className="flex flex-col items-start gap-2">
                <p>
                  {check.trashed.length === 1
                    ? "Tiene la misma referencia que un cobro que está en la papelera, así que no se creará. Restáuralo desde la papelera, o bórralo del todo allí y vuelve a importar el archivo."
                    : "Tienen la misma referencia que cobros que están en la papelera, así que no se crearán. Restáuralos desde la papelera, o bórralos del todo allí y vuelve a importar el archivo."}
                </p>
                <p className="text-ink-soft">{linesText(linesOf(check.trashed))}</p>
                <ButtonLink href="/pasarelas/papelera">Ir a la papelera</ButtonLink>
              </div>
            </Alert>
          ) : null}

          {check && check.possible.length > 0 ? (
            <div className="flex flex-col gap-2">
              <Alert tone="warning" title={`Posibles repetidos (${check.possible.length})`}>
                <div className="flex flex-col gap-2">
                  <p>
                    Pueden ser cobros que registraste a mano con otra referencia o sin ella: la misma empresa,
                    pasarela, moneda y monto, a un día como mucho. Si los importas y eran los mismos, el dinero se
                    contaría dos veces.
                  </p>
                  <ul className="flex flex-col gap-1">
                    {check.possible.slice(0, ERRORS_SHOWN).map(({ row, match }) => (
                      <li key={row.line} className="break-words">
                        Línea {row.line} · <span className="break-all">{row.reference}</span> ·{" "}
                        <Money value={row.grossOriginal} currency={row.currency} /> ·{" "}
                        <DateText value={row.occurredOn} />: registrado a mano el{" "}
                        <DateText value={match.occurredOn} />
                        {match.reference === null ? ", sin referencia" : `, con la referencia ${match.reference}`}
                      </li>
                    ))}
                  </ul>
                  {check.possible.length > ERRORS_SHOWN ? (
                    <p>Y {check.possible.length - ERRORS_SHOWN} más.</p>
                  ) : null}
                </div>
              </Alert>
              <Checkbox
                label={`Son otros cobros: importar también ${check.possible.length === 1 ? "esta fila" : `estas ${check.possible.length} filas`}`}
                hint="Sin marcarla, se importan las demás."
                checked={includePossible}
                onChange={(event) => onIncludePossible(event.currentTarget.checked)}
                disabled={disabled}
              />
            </div>
          ) : null}

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

          {ready && ready.plan.deposit.creating > 0 ? (
            <div className="flex flex-col gap-3 border-t border-rule pt-4">
              <h3 className="font-semibold">Cuándo cae el dinero y cómo se reparte</h3>
              <DepositSummary
                deposit={ready.plan.deposit}
                alreadyDeposited={alreadyDeposited}
                onAlreadyDeposited={onAlreadyDeposited}
                disabled={disabled}
              />
              <p className="text-sm">{schemeText(ready.preview.scheme, companyName)}</p>
            </div>
          ) : null}

          {children}
        </CardBody>
      </section>
    </Card>
  );
}

/**
 * Cuántos cobros quedarán por caer y cuántos entrarían ya atrasados; con «estos cobros ya se depositaron», cuántos
 * entran depositados con su fecha estimada. La opción va apagada: se resalta y se sugiere si hay atrasados.
 */
function DepositSummary({
  deposit,
  alreadyDeposited,
  onAlreadyDeposited,
  disabled,
}: {
  deposit: ReviewPlan["deposit"];
  alreadyDeposited: boolean;
  onAlreadyDeposited: (on: boolean) => void;
  disabled: boolean;
}) {
  const { creating, overdue, dueByToday } = deposit;
  const pending = creating - dueByToday;
  return (
    <>
      {alreadyDeposited ? (
        <p className="text-sm">
          {dueByToday} {dueByToday === 1 ? "entra como depositado" : "entran como depositados"} con su fecha
          estimada; {pending} {pending === 1 ? "queda" : "quedan"} por caer.
        </p>
      ) : (
        <p className="text-sm">
          {creating} {creating === 1 ? "quedará" : "quedarán"} por caer.
        </p>
      )}
      {!alreadyDeposited && overdue > 0 ? (
        <Alert tone="warning" title={`${overdue} ya ${overdue === 1 ? "está atrasado" : "están atrasados"}`}>
          Su fecha estimada de depósito ya pasó. Si ese dinero ya llegó, marca «Estos cobros ya se depositaron».
        </Alert>
      ) : null}
      <Checkbox
        label="Estos cobros ya se depositaron"
        hint="Los que tienen la fecha estimada (la más tardía, si la pasarela da una ventana de días) hasta hoy entran como depositados en esa fecha. Es una estimación, no la fecha real, y entra en el tiempo real promedio de depósito de la pasarela y de la cuenta."
        checked={alreadyDeposited}
        onChange={(event) => onAlreadyDeposited(event.currentTarget.checked)}
        disabled={disabled}
      />
    </>
  );
}
