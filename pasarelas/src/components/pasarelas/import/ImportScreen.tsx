"use client";

import { useMemo, useState } from "react";
import {
  Alert,
  Button,
  ButtonLink,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Checkbox,
  Field,
  Input,
  notify,
} from "@/components/ui";
import { mapRows, validateMapping, type ColumnMapping } from "@/lib/pasarelas/import";
import { importTransactions, saveImportMapping } from "@/server/pasarelas/actions/import";
import type { SavedImportMapping } from "@/server/pasarelas/queries/import";
import { MappingCard } from "./MappingCard";
import {
  chunk,
  columnChoices,
  defaultExtrasKey,
  FORMAT_LABEL,
  formatConflict,
  IMPORT_BATCH_SIZE,
  proposeMapping,
  type ImportChoices,
  type Proposal,
} from "./plan";
import { readCsv, type CsvFile } from "./readCsv";
import { ReviewCard } from "./ReviewCard";
import { SettingsCard, type ImportSettings } from "./SettingsCard";

type Counts = { created: number; duplicates: number };

/** Cómo terminó una importación: todo, o un error después de guardar algunos lotes. */
type Outcome = { counts: Counts; error: string | null };

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

function createdText(created: number): string {
  if (created === 0) return "No se creó ningún cobro nuevo";
  return created === 1 ? "Se creó 1 cobro" : `Se crearon ${created} cobros`;
}

function duplicatesText(duplicates: number, gateway: string): string | null {
  if (duplicates === 0) return null;
  const existed = duplicates === 1 ? "1 ya existía" : `${duplicates} ya existían`;
  return `${existed} con la misma referencia en ${gateway} y no se ${duplicates === 1 ? "tocó" : "tocaron"}.`;
}

/**
 * «Importar CSV»: se eligen empresa, pasarela, canal y opciones; se elige el archivo, que se lee aquí (no se sube);
 * se reconoce su formato y se propone el mapeo (el recordado para la pasarela, o el del formato); se revisa «Así lo
 * entendí» y se importa en lotes. Al servidor solo viajan las filas ya convertidas.
 */
export function ImportScreen({
  choices,
  saved,
}: {
  choices: ImportChoices;
  /** El mapeo recordado de cada pasarela, por id. */
  saved: Record<string, SavedImportMapping>;
}) {
  const firstCompany = choices.companies[0]!.id;
  const firstGateway = choices.gateways[0]!.id;
  const [settings, setSettings] = useState<ImportSettings>({
    companyId: firstCompany,
    gatewayId: firstGateway,
    channelId: "",
    extraIds: choices.defaultExtras[defaultExtrasKey(firstCompany, firstGateway)] ?? [],
  });
  const [file, setFile] = useState<CsvFile | null>(null);
  const [fileKey, setFileKey] = useState(0);
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);
  const [showMapping, setShowMapping] = useState(false);
  const [useReportedFee, setUseReportedFee] = useState(false);
  const [conflictOk, setConflictOk] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const gateway = choices.gateways.find((candidate) => candidate.id === settings.gatewayId)!;
  const importing = progress !== null;

  /** Propone el mapeo de un archivo para una pasarela, y deja el editor abierto si hay que mapear a mano. */
  function propose(csv: CsvFile, gatewayId: string) {
    const next = proposeMapping(csv.headers, saved[gatewayId]);
    setProposal(next);
    setMapping(next.mapping);
    setShowMapping(next.from === "a_mano");
    setConflictOk(false);
  }

  function onCompany(companyId: string) {
    const extraIds = choices.defaultExtras[defaultExtrasKey(companyId, settings.gatewayId)] ?? [];
    setSettings({ ...settings, companyId, channelId: "", extraIds });
  }

  function onGateway(gatewayId: string) {
    const extraIds = choices.defaultExtras[defaultExtrasKey(settings.companyId, gatewayId)] ?? [];
    setSettings({ ...settings, gatewayId, extraIds });
    if (file !== null) propose(file, gatewayId);
  }

  async function onFile(picked: File | undefined) {
    setFile(null);
    setProposal(null);
    setMapping(null);
    setReadError(null);
    setOutcome(null);
    if (picked === undefined) return;
    setReading(true);
    const read = await readCsv(picked);
    setReading(false);
    if ("error" in read) {
      setReadError(read.error);
      return;
    }
    setFile(read);
    propose(read, settings.gatewayId);
  }

  function startOver() {
    setFile(null);
    setProposal(null);
    setMapping(null);
    setOutcome(null);
    setFileKey((key) => key + 1);
  }

  const columns = useMemo(() => (file === null ? [] : columnChoices(file.headers)), [file]);
  const problems = useMemo(
    () => (file === null || mapping === null ? [] : validateMapping(file.headers, mapping)),
    [file, mapping],
  );
  const result = useMemo(
    () =>
      file === null || mapping === null || proposal === null || problems.length > 0
        ? null
        : mapRows(file.rows, mapping, proposal.format),
    [file, mapping, proposal, problems],
  );
  const conflict = proposal === null ? null : formatConflict(saved[settings.gatewayId], proposal.format);
  const canImport = result !== null && result.ok.length > 0 && (conflict === null || conflictOk) && !importing;

  async function runImport() {
    if (result === null || proposal === null || mapping === null) return;
    const rows = result.ok;
    // Fuera del try: si la llamada misma falla (red cortada, cuerpo demasiado grande), se dice cuánto ya se guardó.
    const counts: Counts = { created: 0, duplicates: 0 };
    setOutcome(null);
    setProgress({ done: 0, total: rows.length });
    try {
      const remembered = await saveImportMapping({ gatewayId: settings.gatewayId, format: proposal.format, mapping });
      if (!remembered.ok) {
        setOutcome({ counts, error: remembered.error });
        return;
      }
      for (const batch of chunk(rows, IMPORT_BATCH_SIZE)) {
        const batchResult = await importTransactions({
          companyId: settings.companyId,
          gatewayId: settings.gatewayId,
          channelId: settings.channelId === "" ? null : settings.channelId,
          extraIds: settings.extraIds,
          useReportedFee: useReportedFee && mapping.fee != null,
          alreadyDeposited: false,
          rows: batch,
        });
        if (!batchResult.ok) {
          setOutcome({ counts, error: batchResult.error });
          return;
        }
        counts.created += batchResult.data.created;
        counts.duplicates += batchResult.data.duplicates;
        setProgress({ done: counts.created + counts.duplicates, total: rows.length });
      }
      setOutcome({ counts, error: null });
      notify.success(createdText(counts.created));
    } catch {
      setOutcome({ counts: { ...counts }, error: "Se perdió la conexión con el servidor." });
    } finally {
      setProgress(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <SettingsCard
        choices={choices}
        value={settings}
        onCompany={onCompany}
        onGateway={onGateway}
        onChange={setSettings}
        disabled={importing}
      />

      <Card>
        <CardHeader>
          <CardTitle>Archivo</CardTitle>
        </CardHeader>
        <CardBody className="flex flex-col gap-4">
          <Field
            label="Archivo CSV"
            hint="De Stripe (movimientos de saldo o pagos), de PayPal (actividad) u otro. Se lee en este dispositivo: el archivo no se sube."
          >
            <Input
              key={fileKey}
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => void onFile(event.currentTarget.files?.[0])}
              disabled={importing || reading}
            />
          </Field>
          {reading ? <p role="status">Leyendo el archivo…</p> : null}
          {readError ? (
            <Alert tone="danger" announce>
              {readError}
            </Alert>
          ) : null}
          {file !== null && proposal !== null ? (
            <div className="flex flex-col gap-3">
              <p>
                <span className="font-semibold">{file.name}</span> · {plural(file.rows.length, "fila", "filas")}
              </p>
              {proposal.format === "otro" ? (
                <Alert tone="info" title="No reconocimos este archivo">
                  Elige qué columna es cada dato. Lo que elijas se recuerda para la próxima vez con {gateway.name}.
                </Alert>
              ) : (
                <p className="text-ink-soft">
                  Formato: {FORMAT_LABEL[proposal.format]}.{" "}
                  {proposal.from === "guardado"
                    ? `Con las columnas que usaste la última vez con ${gateway.name}.`
                    : "Con sus columnas de siempre."}
                </p>
              )}
              {proposal.format !== "otro" ? (
                <Button
                  variant="ghost"
                  className="self-start"
                  aria-expanded={showMapping}
                  onClick={() => setShowMapping((shown) => !shown)}
                >
                  {showMapping ? "Ocultar columnas" : "Ajustar columnas"}
                </Button>
              ) : null}
            </div>
          ) : null}
        </CardBody>
      </Card>

      {file !== null && mapping !== null && (showMapping || problems.length > 0) && outcome === null ? (
        <MappingCard
          columns={columns}
          mapping={mapping}
          problems={problems}
          onChange={setMapping}
          disabled={importing}
        />
      ) : null}

      {outcome !== null ? (
        <Card>
          <CardHeader>
            <CardTitle>{outcome.error === null ? "Importación terminada" : "La importación se detuvo"}</CardTitle>
          </CardHeader>
          <CardBody className="flex flex-col gap-4">
            {outcome.error === null ? (
              <Alert tone="success" title={`${createdText(outcome.counts.created)}.`}>
                {duplicatesText(outcome.counts.duplicates, gateway.name)}
              </Alert>
            ) : (
              <Alert tone="danger" announce title={outcome.error}>
                {outcome.counts.created + outcome.counts.duplicates > 0
                  ? `Antes del error: ${createdText(outcome.counts.created).toLowerCase()}. `
                  : ""}
                Puedes volver a importar el archivo: lo que ya se guardó no se repite.
              </Alert>
            )}
            <div className="flex flex-wrap gap-2">
              <ButtonLink href="/pasarelas/cobros" variant="primary">
                Ver cobros
              </ButtonLink>
              <Button onClick={startOver}>Importar otro archivo</Button>
            </div>
          </CardBody>
        </Card>
      ) : result !== null ? (
        <ReviewCard result={result}>
          <div className="flex flex-col gap-3 border-t border-rule pt-4">
            <Checkbox
              label="Usar la comisión del archivo"
              hint={
                mapping?.fee == null
                  ? "Este mapeo no lee ninguna columna de comisión."
                  : `En lugar de calcularla con la tarifa de ${gateway.name}. Si una fila no la trae, se calcula.`
              }
              checked={useReportedFee && mapping?.fee != null}
              onChange={(event) => setUseReportedFee(event.currentTarget.checked)}
              disabled={mapping?.fee == null || importing}
            />
            {conflict !== null ? (
              <div className="flex flex-col gap-2">
                <Alert tone="warning" title="Ojo: puede duplicar cobros">
                  La última vez importaste en {gateway.name} un archivo de {FORMAT_LABEL[conflict]} y este es de{" "}
                  {FORMAT_LABEL[proposal!.format]}. Cada formato da otra referencia al mismo cobro: si ya importaste
                  estos cobros con el otro, se registrarían dos veces.
                </Alert>
                <Checkbox
                  label="Son otros cobros: importar igual"
                  checked={conflictOk}
                  onChange={(event) => setConflictOk(event.currentTarget.checked)}
                  disabled={importing}
                />
              </div>
            ) : null}
            {progress !== null ? (
              <p role="status">
                Importando… {progress.done} de {progress.total}
              </p>
            ) : null}
            <Button variant="primary" className="self-start" onClick={() => void runImport()} disabled={!canImport}>
              {importing
                ? "Importando…"
                : result.ok.length === 0
                  ? "No hay cobros para importar"
                  : `Importar ${plural(result.ok.length, "cobro", "cobros")}`}
            </Button>
          </div>
        </ReviewCard>
      ) : null}
    </div>
  );
}
