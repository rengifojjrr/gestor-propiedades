import { ButtonLink, Card, CardBody, CardHeader, CardTitle } from "@/components/ui";

const TITLE_ID = "exportar-todo";

/** Ajustes → «Exportar todo»: descarga la copia propia del dueño (JSON) desde `GET /ajustes/exportar`. */
export function ExportCard() {
  return (
    <Card role="region" aria-labelledby={TITLE_ID}>
      <CardHeader>
        <CardTitle id={TITLE_ID}>Exportar todo</CardTitle>
      </CardHeader>
      <CardBody className="flex flex-col gap-3">
        <p className="text-ink-soft">
          Descarga en un archivo JSON todo lo que tienes registrado: empresas, pasarelas, cobros, repartos,
          liquidaciones y feriados, con los montos tal como están guardados. Es tu copia propia, para guardarla donde
          quieras. No incluye los comprobantes (las imágenes y los PDF), solo sus datos.
        </p>
        {/* `download`: el navegador guarda el archivo en vez de navegar. Sin `prefetch`: cada visita a Ajustes
            armaría la copia entera sin que nadie la pida. */}
        <ButtonLink href="/ajustes/exportar" download prefetch={false} className="self-start">
          Descargar copia (JSON)
        </ButtonLink>
      </CardBody>
    </Card>
  );
}
