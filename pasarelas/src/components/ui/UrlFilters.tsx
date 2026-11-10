"use client";

import { Search, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { FormEvent } from "react";
import { IconButton } from "./Button";
import { cn } from "./cn";
import { Field } from "./Field";
import { Input, Select } from "./Inputs";
import { PERIOD_PRESETS, hrefWith, periodChanges, type PeriodPresetValue } from "./url";

/*
 * Filtros que viven en la URL: leen su valor de los parámetros de búsqueda y, al cambiar, reemplazan la URL
 * (sin mover el desplazamiento). La página, que es un Server Component, vuelve a leer `searchParams` y
 * consulta de nuevo. Como usan `useSearchParams()`, quien los ponga los envuelve en `<Suspense>`.
 */
function useUrlFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const apply = (changes: Record<string, string | null>) => {
    router.replace(hrefWith(pathname, searchParams, changes), { scroll: false });
  };
  return { searchParams, apply };
}

export type UrlSelectProps = {
  /** Nombre del parámetro en la URL: `empresa`. */
  param: string;
  /** Etiqueta visible del filtro. */
  label: string;
  options: readonly { value: string; label: string }[];
  /** Texto de la opción «sin filtrar» (quita el parámetro). */
  allLabel?: string;
  className?: string;
};

/** Filtro de una lista de opciones. Elegir la primera («Todas») quita el filtro. */
export function UrlSelect({ param, label, options, allLabel = "Todas", className }: UrlSelectProps) {
  const { searchParams, apply } = useUrlFilters();
  return (
    <Field label={label} className={className}>
      <Select value={searchParams.get(param) ?? ""} onChange={(event) => apply({ [param]: event.target.value })}>
        <option value="">{allLabel}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
    </Field>
  );
}

export type UrlSearchProps = {
  /** Nombre del parámetro en la URL. */
  param?: string;
  label?: string;
  placeholder?: string;
  className?: string;
};

/** Búsqueda por texto. Se aplica al enviar (Intro o el botón de la lupa), no en cada tecla. */
export function UrlSearch({ param = "q", label = "Buscar", placeholder, className }: UrlSearchProps) {
  const { searchParams, apply } = useUrlFilters();
  const current = searchParams.get(param) ?? "";

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const typed = new FormData(event.currentTarget).get(param);
    apply({ [param]: typeof typed === "string" ? typed.trim() : null });
  };

  return (
    <form role="search" onSubmit={submit} className={className}>
      <Field label={label}>
        <div className="flex gap-2">
          {/* `key`: si la URL cambia por otro lado (p. ej. al borrar la búsqueda), el campo se pone al día. */}
          <Input
            key={current}
            type="search"
            name={param}
            defaultValue={current}
            placeholder={placeholder}
            enterKeyHint="search"
            autoComplete="off"
          />
          {current ? (
            <IconButton label="Borrar la búsqueda" onClick={() => apply({ [param]: null })}>
              <X aria-hidden className="size-5" />
            </IconButton>
          ) : null}
          <IconButton type="submit" variant="secondary" label="Buscar">
            <Search aria-hidden className="size-5" />
          </IconButton>
        </div>
      </Field>
    </form>
  );
}

const isPreset = (value: string | null): value is PeriodPresetValue =>
  PERIOD_PRESETS.some((preset) => preset.value === value);

/** Una fecha a medio escribir con el teclado (año «0002») todavía no es un filtro. */
const isWholeDate = (value: string) => value === "" || value >= "1900-01-01";

export type UrlPeriodProps = {
  label?: string;
  /** El período que rige cuando la URL no trae ninguno. */
  defaultPreset?: PeriodPresetValue;
  className?: string;
};

/**
 * Filtro de período: este mes, el anterior, 30, 90 y 365 días, este año o fechas a elegir.
 * Parámetros: `periodo` y, solo con «Elegir fechas», `desde` y `hasta` (AAAA-MM-DD).
 */
export function UrlPeriod({ label = "Período", defaultPreset = "este_mes", className }: UrlPeriodProps) {
  const { searchParams, apply } = useUrlFilters();
  const requested = searchParams.get("periodo");
  const preset = isPreset(requested) ? requested : defaultPreset;
  const from = searchParams.get("desde") ?? "";
  const to = searchParams.get("hasta") ?? "";

  return (
    <div className={cn("flex flex-wrap items-start gap-3", className)}>
      <Field label={label} className="min-w-44 flex-1">
        <Select
          value={preset}
          onChange={(event) => {
            if (isPreset(event.target.value)) apply(periodChanges(event.target.value));
          }}
        >
          {PERIOD_PRESETS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </Field>
      {preset === "personalizado" ? (
        <>
          <Field label="Desde" className="min-w-36 flex-1">
            <Input
              type="date"
              defaultValue={from}
              max={to || undefined}
              onChange={(event) => {
                if (isWholeDate(event.target.value)) apply({ desde: event.target.value });
              }}
            />
          </Field>
          <Field label="Hasta" className="min-w-36 flex-1">
            <Input
              type="date"
              defaultValue={to}
              min={from || undefined}
              onChange={(event) => {
                if (isWholeDate(event.target.value)) apply({ hasta: event.target.value });
              }}
            />
          </Field>
        </>
      ) : null}
    </div>
  );
}
