"use client";

import { useEffect, useMemo, useState } from "react";
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
import {
  mapRows,
  referenceWarning,
  validateMapping,
  type ColumnMapping,
  type ImportRow,
} from "@/lib/pasarelas/import";
import { importTransactions, previewImport, saveImportMapping } from "@/server/pasarelas/actions/import";
import type { ImportPreview } from "@/server/pasarelas/ops/import";
import type { SavedImportMapping } from "@/server/pasarelas/queries/import";
import { MappingCard } from "./MappingCard";
import {
  chunk,
  columnChoices,
  defaultExtrasKey,
  FORMAT_LABEL,
  formatConflict,
  IMPORT_BATCH_SIZE,
  mergePreviews,
  planReview,
  proposeMapping,
  type ImportChoices,
  type MergedPreview,
  type Proposal,
} from "./plan";
import { readCsv, type CsvFile } from "./readCsv";
import { ReviewCard, type ReviewState } from "./ReviewCard";
import { SettingsCard, type ImportSettings } from "./SettingsCard";

type Counts = { created: number; duplicates: number; trashed: number };

/**
 * Cómo terminó una importación: todo, o un error después de guardar algunos lotes. `heldBack`: los posibles
 * repetidos que no se mandaron porque no se confirmaron.
 */
type Outcome = { counts: Counts; heldBack: number; error: string | null };

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

function trashedText(trashed: number): string | null {
  if (trashed === 0) return null;
  return trashed === 1
    ? "1 tiene la misma referencia que un cobro de la papelera y no se creó: restáuralo, o bórralo del todo desde la papelera y vuelve a importar el archivo."
    : `${trashed} tienen la misma referencia que cobros de la papelera y no se crearon: restáuralos, o bórralos del todo desde la papelera y vuelve a importar el archivo.`;
}

function heldBackText(heldBack: number): string | null {
  if (heldBack === 0) return null;
  return heldBack === 1
    ? "1 posible repetido no se importó: confírmalo si de verdad es otro cobro."
    : `${heldBack} posibles repetidos no se importaron: confírmalos si de verdad son otros cobros.`;
}

/** Lo que se le pregunta al servidor antes de importar: las filas y lo elegido que cambia el cálculo. */
type PreviewRequest = {
  rows: ImportRow[];
  companyId: string;
  gatewayId: string;
  channelId: string | null;
  extraIds: string[];
};

/** La vista previa de todas las filas, de a un lote (solo lee). */
async function loadPreview(request: PreviewRequest): Promise<{ preview: MergedPreview } | { error: string }> {
  try {
    const parts: ImportPreview[] = [];
    for (const rows of chunk(request.rows, IMPORT_BATCH_SIZE)) {
      const answer = await previewImport({ ...request, useReportedFee: false, rows });
      if (!answer.ok) return { error: answer.error };
      parts.push(answer.data);
    }
    return { preview: mergePreviews(parts) };
  } catch {
    return { error: "Se perdió la conexión con el servidor." };
  }
}

/**
 * «Importar CSV»: se eligen empresa, pasarela, canal y opciones; se elige el archivo, que se lee aquí (no se sube);
 * se reconoce su formato y se propone el mapeo (el recordado para la pasarela, o el del formato); el servidor dice
 * lo que ya está registrado y cuándo cae cada cobro; se revisa «Así lo entendí» y se importa en lotes. Al servidor
 * solo viajan las filas ya convertidas.
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
  const [alreadyDeposited, setAlreadyDeposited] = useState(false);
  const [includePossible, setIncludePossible] = useState(false);
  const [conflictOk, setConflictOk] = useState(false);
  const [loaded, setLoaded] = useState<
    ({ request: PreviewRequest } & ({ preview: MergedPreview } | { error: string })) | null
  >(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const gateway = choices.gateways.find((candidate) => candidate.id === settings.gatewayId)!;
  const company = choices.companies.find((candidate) => candidate.id === settings.companyId)!;
  const importing = progress !== null;

  /** Propone el mapeo de un archivo para una pasarela, y deja el editor abierto si hay que mapear a mano. */
  function propose(csv: CsvFile, gatewayId: string) {
    const next = proposeMapping(csv.headers, saved[gatewayId]);
    setProposal(next);
    setMapping(next.mapping);
    setShowMapping(next.from === "a_mano");
    setConflictOk(false);
    setIncludePossible(false);
    setAlreadyDeposited(false);
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

  // Lo que ya está registrado y cuándo cae cada cobro: se vuelve a preguntar si cambian las filas o lo elegido.
  const { companyId, gatewayId, channelId, extraIds } = settings;
  const request = useMemo<PreviewRequest | null>(
    () =>
      result === null || result.ok.length === 0
        ? null
        : { rows: result.ok, companyId, gatewayId, channelId: channelId === "" ? null : channelId, extraIds },
    [result, companyId, gatewayId, channelId, extraIds],
  );
  useEffect(() => {
    if (request === null) return;
    let current = true;
    void loadPreview(request).then((answer) => {
      if (current) setLoaded({ request, ...answer });
    });
    return () => {
      current = false;
    };
  }, [request]);

  const answer = loaded !== null && loaded.request === request ? loaded : null;
  const review = useMemo<ReviewState>(() => {
    if (answer === null || request === null) return { state: "cargando" };
    if ("error" in answer) return { state: "error", message: answer.error };
    return {
      state: "listo",
      preview: answer.preview,
      plan: planReview(request.rows, answer.preview, { includePossible }),
    };
  }, [answer, request, includePossible]);
  const plan = review.state === "listo" ? review.plan : null;

  const referenceNotice =
    file === null || mapping === null || proposal === null ? null : referenceWarning(proposal.format, file.headers, mapping);
  const conflict = proposal === null ? null : formatConflict(saved[settings.gatewayId], proposal.format);
  const canImport =
    plan !== null && plan.deposit.creating > 0 && (conflict === null || conflictOk) && !importing;

  async function runImport() {
    if (plan === null || proposal === null || mapping === null) return;
    const rows = plan.send;
    const heldBack = plan.heldBack;
    // Fuera del try: si la llamada misma falla (red cortada, cuerpo demasiado grande), se dice cuánto ya se guardó.
    const counts: Counts = { created: 0, duplicates: 0, trashed: 0 };
    setOutcome(null);
    setProgress({ done: 0, total: rows.length });
    try {
      const remembered = await saveImportMapping({ gatewayId: settings.gatewayId, format: proposal.format, mapping });
      if (!remembered.ok) {
        setOutcome({ counts, heldBack, error: remembered.error });
        return;
      }
      for (const batch of chunk(rows, IMPORT_BATCH_SIZE)) {
        const batchResult = await importTransactions({
          companyId: settings.companyId,
          gatewayId: settings.gatewayId,
          channelId: settings.channelId === "" ? null : settings.channelId,
          extraIds: settings.extraIds,
          useReportedFee: useReportedFee && mapping.fee != null,
          alreadyDeposited,
          rows: batch,
        });
        if (!batchResult.ok) {
          setOutcome({ counts, heldBack, error: batchResult.error });
          return;
        }
        counts.created += batchResult.data.created;
        counts.duplicates += batchResult.data.duplicates;
        counts.trashed += batchResult.data.trashed;
        setProgress({ done: counts.created + counts.duplicates + counts.trashed, total: rows.length });
      }
      setOutcome({ counts, heldBack, error: null });
      notify.success(createdText(counts.created));
    } catch {
      setOutcome({ counts: { ...counts }, heldBack, error: "Se perdió la conexión con el servidor." });
    } finally {
      setProgress(null);
    }
  }

  const importLabel = importing
    ? "Importando…"
    : result === null || result.ok.length === 0
      ? "No hay cobros para importar"
      : plan === null
        ? "Revisando…"
        : plan.deposit.creating === 0
          ? "No hay cobros nuevos para importar"
          : `Importar ${plural(plan.deposit.creating, "cobro", "cobros")}`;

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
                {[
                  duplicatesText(outcome.counts.duplicates, gateway.name),
                  trashedText(outcome.counts.trashed),
                  heldBackText(outcome.heldBack),
                ]
                  .filter((text) => text !== null)
                  .map((text) => (
                    <p key={text}>{text}</p>
                  ))}
              </Alert>
            ) : (
              <Alert tone="danger" announce title={outcome.error}>
                {outcome.counts.created + outcome.counts.duplicates + outcome.counts.trashed > 0
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
        <ReviewCard
          result={result}
          review={review}
          gatewayName={gateway.name}
          companyName={company.name}
          referenceNotice={referenceNotice}
          alreadyDeposited={alreadyDeposited}
          onAlreadyDeposited={setAlreadyDeposited}
          includePossible={includePossible}
          onIncludePossible={setIncludePossible}
          disabled={importing}
        >
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
              {importLabel}
            </Button>
          </div>
        </ReviewCard>
      ) : null}
    </div>
  );
}
