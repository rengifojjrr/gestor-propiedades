import Link from "next/link";
import { Field, Select } from "@/components/ui";
import type { LoaderCfg } from "@/lib/pasarelas/types";

/** La pantalla donde se crean los cargadores. */
export const LOADERS_PATH = "/pasarelas/cargadores";

/**
 * «Cargador»: de quién es la venta, para reportársela. Opcional. `loaders` son los que se ofrecen (al registrar,
 * solo los activos; al editar, también el que el cobro ya tiene, aunque esté desactivado). Sin ninguno, dice dónde
 * se crean.
 */
export function LoaderField({
  loaders,
  value,
  onChange,
  error,
}: {
  loaders: readonly LoaderCfg[];
  /** El id elegido, o `""` (sin cargador). */
  value: string;
  onChange: (loaderId: string) => void;
  error?: string | undefined;
}) {
  return (
    <Field
      label="Cargador"
      optional
      hint={
        loaders.length === 0 ? (
          <>
            Todavía no tienes cargadores:{" "}
            <Link href={LOADERS_PATH} className="font-semibold text-brand underline">
              créalos en Cargadores
            </Link>
            .
          </>
        ) : (
          "Quien trajo la venta: así sabes a quién reportársela."
        )
      }
      error={error}
    >
      <Select value={value} onChange={(event) => onChange(event.currentTarget.value)}>
        <option value="">Sin cargador</option>
        {loaders.map((loader) => (
          <option key={loader.id} value={loader.id}>
            {loader.active ? loader.name : `${loader.name} (desactivado)`}
          </option>
        ))}
      </Select>
    </Field>
  );
}
