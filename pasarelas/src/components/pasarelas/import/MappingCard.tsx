"use client";

import { Alert, Card, CardBody, CardHeader, CardTitle, Field, Input, Select } from "@/components/ui";
import type { ColumnMapping } from "@/lib/pasarelas/import";

type ColumnField = "reference" | "date" | "time" | "timezone" | "gross" | "currency" | "fee" | "status" | "type" | "note";

/** Cada dato que se lee del archivo, en el orden en que se pide, con su etiqueta y su ayuda. */
const COLUMNS: { field: ColumnField; label: string; required?: boolean; hint?: string }[] = [
  { field: "reference", label: "Referencia", required: true, hint: "El identificador del cobro en la pasarela." },
  { field: "date", label: "Fecha", required: true },
  { field: "time", label: "Hora", hint: "Si la hora viene en otra columna." },
  { field: "timezone", label: "Zona horaria", hint: "Si cada fila dice su zona." },
  { field: "gross", label: "Monto cobrado", required: true },
  { field: "currency", label: "Moneda" },
  { field: "fee", label: "Comisión de la pasarela" },
  { field: "status", label: "Estado", hint: "Para dejar fuera lo fallido o pendiente." },
  { field: "type", label: "Tipo", hint: "Para dejar fuera reembolsos, retiros y comisiones sueltas." },
  { field: "note", label: "Nota" },
];

const DATE_FORMATS: { value: ColumnMapping["dateFormat"]; label: string }[] = [
  { value: "YYYY-MM-DD", label: "AAAA-MM-DD (2026-11-13)" },
  { value: "MM/DD/YYYY", label: "MM/DD/AAAA (11/13/2026)" },
  { value: "DD/MM/YYYY", label: "DD/MM/AAAA (13/11/2026)" },
];

/**
 * Qué columna del archivo es cada dato y cómo se leen las fechas y los montos. Solo se ofrecen columnas que no son
 * del comprador. `problems` son los de `validateMapping`: mientras haya alguno no se puede revisar ni importar.
 */
export function MappingCard({
  columns,
  mapping,
  problems,
  onChange,
  disabled,
}: {
  columns: string[];
  mapping: ColumnMapping;
  problems: string[];
  onChange: (next: ColumnMapping) => void;
  disabled: boolean;
}) {
  const set = <K extends keyof ColumnMapping>(key: K, value: ColumnMapping[K]) => onChange({ ...mapping, [key]: value });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Columnas del archivo</CardTitle>
      </CardHeader>
      <CardBody className="flex flex-col gap-4">
        <p className="text-ink-soft">
          Las columnas con datos del comprador (correo, nombre, dirección) no se ofrecen ni se leen.
        </p>
        <div className="grid gap-4 md:grid-cols-2">
          {COLUMNS.map(({ field, label, required, hint }) => (
            <Field key={field} label={label} hint={hint} optional={!required}>
              <Select
                value={mapping[field] ?? ""}
                onChange={(event) => {
                  const column = event.currentTarget.value;
                  set(field, required ? column : column === "" ? null : column);
                }}
                disabled={disabled}
              >
                <option value="">{required ? "Elige una columna" : "Ninguna"}</option>
                {columns.map((column) => (
                  <option key={column} value={column}>
                    {column}
                  </option>
                ))}
              </Select>
            </Field>
          ))}
          <Field label="Formato de fecha">
            <Select
              value={mapping.dateFormat}
              onChange={(event) => set("dateFormat", event.currentTarget.value as ColumnMapping["dateFormat"])}
              disabled={disabled}
            >
              {DATE_FORMATS.map((format) => (
                <option key={format.value} value={format.value}>
                  {format.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Separador decimal">
            <Select
              value={mapping.decimal}
              onChange={(event) => set("decimal", event.currentTarget.value as ColumnMapping["decimal"])}
              disabled={disabled}
            >
              <option value=".">Punto (1,234.56)</option>
              <option value=",">Coma (1.234,56)</option>
            </Select>
          </Field>
          <Field label="Zona horaria de las fechas" hint="Si el archivo no la dice. Por ejemplo UTC o America/New_York.">
            <Input
              value={mapping.fixedZone}
              onChange={(event) => set("fixedZone", event.currentTarget.value)}
              autoComplete="off"
              disabled={disabled}
            />
          </Field>
          <Field label="Moneda si no viene" hint="Tres letras, como USD.">
            <Input
              value={mapping.defaultCurrency}
              onChange={(event) => set("defaultCurrency", event.currentTarget.value.trim().toUpperCase())}
              maxLength={3}
              autoComplete="off"
              disabled={disabled}
            />
          </Field>
        </div>
        {problems.length > 0 ? (
          <Alert tone="warning" title="Falta ajustar el mapeo">
            <ul className="list-disc pl-5">
              {problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          </Alert>
        ) : null}
      </CardBody>
    </Card>
  );
}
