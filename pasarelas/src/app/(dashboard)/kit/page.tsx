import { Download, Inbox, Pencil } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import {
  Alert,
  BackLink,
  Badge,
  Button,
  ButtonLink,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Checkbox,
  DateText,
  DateTimeText,
  EmptyState,
  Field,
  IconButton,
  Input,
  Money,
  MoneyInput,
  PageHeader,
  Pagination,
  PctInput,
  Percent,
  Select,
  Skeleton,
  Stat,
  Switch,
  Table,
  TabsNav,
  TBody,
  Td,
  Textarea,
  Th,
  THead,
  Tr,
  UrlPeriod,
  UrlSearch,
  UrlSelect,
} from "@/components/ui";
import { ConfirmDemo, DialogDemo, NotifyDemo, SubmitDemo } from "./KitDemos";
import { Section, Spec } from "./Specimen";

export const metadata: Metadata = { title: "Kit de interfaz" };

/** Los tokens de color, con la clase que los usa y para qué son. */
const COLORS = [
  ["paper", "bg-paper", "La página"],
  ["surface", "bg-surface", "Tarjetas, campos y barras"],
  ["sunken", "bg-sunken", "Cabeceras de tabla y zonas hundidas"],
  ["ink", "bg-ink", "Texto"],
  ["ink-soft", "bg-ink-soft", "Texto secundario"],
  ["rule", "bg-rule", "Separadores"],
  ["rule-strong", "bg-rule-strong", "Borde de los controles"],
  ["brand", "bg-brand", "Lo que se puede tocar; lo que salió bien"],
  ["brand-strong", "bg-brand-strong", "Marca, al pasar por encima"],
  ["brand-soft", "bg-brand-soft", "Fondo de lo elegido"],
  ["danger", "bg-danger", "Negativos, errores, borrar"],
  ["danger-soft", "bg-danger-soft", "Fondo de un error"],
  ["warning", "bg-warning", "Atrasados y avisos"],
  ["warning-soft", "bg-warning-soft", "Fondo de un aviso"],
  ["info", "bg-info", "Información"],
  ["info-soft", "bg-info-soft", "Fondo de una nota"],
  ["focus", "bg-focus", "Anillo de foco"],
] as const;

const DEMO_ROWS = [
  { id: "ch_demo_1042", company: "Tienda Demo", gross: "100.00", fees: "-9.70", net: "90.30" },
  { id: "ch_demo_1043", company: "Escuela Demo", gross: "33.33", fees: "-1.27", net: "32.06" },
  { id: "ch_demo_1044", company: "Tienda Demo", gross: "0.00", fees: "-3.20", net: "-3.20" },
] as const;

const PAGE_SIZE = 50;
const DEMO_TOTAL = 120;

/**
 * Galería del kit: cada componente con sus props y un ejemplo vivo. Es una herramienta de desarrollo:
 * en producción no existe (404), salvo en un build hecho con PASARELAS_KIT=1 para poder probarla.
 */
export default async function KitPage({ searchParams }: PageProps<"/kit">) {
  if (process.env.NODE_ENV === "production" && process.env.PASARELAS_KIT !== "1") notFound();

  const { pagina } = await searchParams;
  const requested = Number.parseInt(typeof pagina === "string" ? pagina : "", 10);
  const lastPage = Math.ceil(DEMO_TOTAL / PAGE_SIZE);
  const page = Number.isInteger(requested) ? Math.min(Math.max(requested, 1), lastPage) : 1;

  return (
    <>
      <PageHeader
        title="Kit de interfaz"
        description="Las piezas con las que se arman las pantallas. Todo se importa de @/components/ui."
      />

      <Section
        id="kit-colores"
        title="Colores"
        intro="Papel frío, tinta azul y verde billete. Solo existen estos colores (los de Tailwind están apagados) y todos tienen su par para el modo oscuro, que sigue al sistema. Se usan como bg-…, text-… y border-…."
      >
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {COLORS.map(([name, swatch, use]) => (
            <li key={name} className="flex flex-col gap-1">
              <span aria-hidden className={`h-12 rounded-control border border-rule-strong ${swatch}`} />
              <code className="font-mono text-sm font-semibold">{name}</code>
              <span className="text-sm text-ink-soft">{use}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section
        id="kit-tipografia"
        title="Tipografía"
        intro="Una sola familia, Archivo, en tres anchos: ancha para los títulos, normal para el texto y estrecha para las cifras."
      >
        <Spec name=".titulo">
          <p className="titulo text-3xl leading-tight">Cobros de noviembre</p>
        </Spec>
        <Spec name="texto">
          <p className="max-w-prose">
            Cada cobro guarda lo que se llevó la pasarela, lo que quedó neto y cómo se repartió. Lo calculado
            se congela: cambiar una tarifa no reescribe los cobros viejos.
          </p>
        </Spec>
        <Spec name=".cifra">
          <p className="cifra text-3xl leading-tight font-semibold">$1.234.567,89</p>
        </Spec>
        <Spec name=".doble-raya">
          <p className="cifra text-3xl leading-tight font-semibold">
            <span className="doble-raya">$90,30</span>
          </p>
        </Spec>
      </Section>

      <Section
        id="kit-cifras"
        title="Cifras"
        intro="Reciben el valor canónico y lo escriben con los formateadores del motor: nadie formatea dinero a mano en una pantalla. Siempre con números tabulares, para que las columnas se alineen."
      >
        <Spec
          name="Money"
          props={[
            ["value: Money", "el monto canónico, como texto (\"90.30\", \"-3.20\"); se escribe con formatMoney. Los negativos salen con su signo y en tinta roja; el cero, atenuado"],
            ["currency: Currency", "la moneda (\"USD\"): pone el símbolo, o el código detrás si no lo tiene"],
            ["className?: string", "clases de más (tamaño, peso)"],
          ]}
        >
          <ul className="flex flex-col gap-1 text-xl">
            <li>
              <Money value="90.30" currency="USD" />
            </li>
            <li>
              <Money value="-3.20" currency="USD" />
            </li>
            <li>
              <Money value="0.00" currency="USD" />
            </li>
            <li>
              <Money value="5.00" currency="MXN" />
            </li>
          </ul>
          <ul className="flex flex-col items-end gap-1 self-start text-xl">
            <li>
              <span data-testid="ancho-tabular">
                <Money value="1234.56" currency="USD" />
              </span>
            </li>
            <li>
              <span data-testid="ancho-tabular">
                <Money value="6543.21" currency="USD" />
              </span>
            </li>
          </ul>
        </Spec>
        <Spec
          name="Percent"
          props={[
            ["value: Pct", "el porcentaje canónico, como texto (\"2.9\"); se escribe con formatPct"],
            ["className?: string", "clases de más"],
          ]}
        >
          <p className="text-xl">
            <Percent value="2.9" />
          </p>
        </Spec>
        <Spec
          name="DateText · DateTimeText"
          props={[
            ["DateText value: ISODate", "la fecha de calendario (\"2026-11-13\"); se escribe con formatDate y va en el atributo datetime"],
            ["DateTimeText value: string", "el instante en ISO con zona (\"2026-11-13T15:30:00Z\"); se escribe con formatDateTime, en hora de Nueva York"],
            ["className?: string", "clases de más"],
          ]}
        >
          <p className="flex flex-col gap-1">
            <DateText value="2026-11-13" />
            <DateTimeText value="2026-11-13T15:30:00Z" />
            <DateTimeText value="2026-11-14T03:30:00Z" />
          </p>
        </Spec>
        <Spec
          name="Stat"
          props={[
            ["label: string", "qué es la cifra"],
            ["value: ReactNode", "la cifra (normalmente un Money)"],
            ["hint?: ReactNode", "una aclaración corta"],
            ["total?: boolean", "es un total: lleva la doble raya contable"],
          ]}
        >
          <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3">
            <Stat label="Bruto" value={<Money value="1250.00" currency="USD" />} />
            <Stat
              label="Comisiones"
              value={<Money value="-121.25" currency="USD" />}
              hint={
                <>
                  <Percent value="9.7" /> del bruto
                </>
              }
            />
            <Stat label="Neto" total value={<Money value="1128.75" currency="USD" />} />
          </div>
        </Spec>
      </Section>

      <Section id="kit-botones" title="Botones" intro="Una sola acción principal por pantalla. Todos miden al menos 44 px.">
        <Spec
          name="Button"
          props={[
            ["variant?: \"primary\" | \"secondary\" | \"ghost\" | \"danger\"", "por defecto, secondary"],
            ["type?", "por defecto \"button\": no envía el formulario por accidente"],
          ]}
        >
          <div className="flex flex-wrap gap-2">
            <Button variant="primary">Registrar cobro</Button>
            <Button>Exportar CSV</Button>
            <Button variant="ghost">Ver historial</Button>
            <Button variant="danger">Borrar del todo</Button>
            <Button disabled>No disponible</Button>
          </div>
        </Spec>
        <Spec name="ButtonLink" props={[["href: string", "a dónde lleva; acepta lo mismo que Link"], ["variant?", "como Button"]]}>
          <div className="flex flex-wrap gap-2">
            <ButtonLink href="/pasarelas/registrar" variant="primary">
              Registrar cobro
            </ButtonLink>
            <ButtonLink href="/pasarelas/cobros">
              <Download aria-hidden className="size-5" />
              Ver los cobros
            </ButtonLink>
          </div>
        </Spec>
        <Spec
          name="IconButton"
          props={[
            ["label: string", "obligatorio: es el nombre del botón para lectores de pantalla"],
            ["children", "el ícono, con aria-hidden"],
          ]}
        >
          <div className="flex flex-wrap gap-2">
            <IconButton label="Editar el cobro">
              <Pencil aria-hidden className="size-5" />
            </IconButton>
            <IconButton label="Descargar el comprobante" variant="secondary">
              <Download aria-hidden className="size-5" />
            </IconButton>
          </div>
        </Spec>
        <Spec
          name="SubmitButton"
          props={[
            ["pendingLabel?: ReactNode", "texto mientras la acción corre (por defecto «Guardando…»)"],
            ["variant?", "por defecto, primary"],
          ]}
        >
          <SubmitDemo />
        </Spec>
      </Section>

      <Section
        id="kit-campos"
        title="Campos"
        intro="Field pone la etiqueta, la ayuda y el error, y los enlaza al control que lleva dentro. Switch y Checkbox traen su propia etiqueta, su ayuda y su error."
      >
        <div className="grid max-w-2xl gap-5 sm:grid-cols-2">
          <Spec
            name="Field + Input"
            props={[
              ["label: ReactNode", "la etiqueta visible"],
              ["hint?: ReactNode", "ayuda corta bajo el control"],
              ["error?: string", "mensaje de error; marca el control con aria-invalid"],
              ["optional?: boolean", "agrega «(opcional)»"],
            ]}
          >
            <Field label="Referencia" error="Ya existe un cobro con esta referencia.">
              <Input name="reference" defaultValue="ch_demo_1042" autoComplete="off" />
            </Field>
          </Spec>
          <Spec name="Textarea" props={[["rows?: number", "por defecto, 3"]]}>
            <Field label="Nota" optional hint="Hasta 280 caracteres.">
              <Textarea name="note" maxLength={280} />
            </Field>
          </Spec>
          <Spec name="Select" props={[["children", "los <option>"]]}>
            <Field label="Pasarela">
              <Select name="gateway" defaultValue="stripe">
                <option value="stripe">Stripe</option>
                <option value="paypal">PayPal</option>
                <option value="zelle">Zelle</option>
              </Select>
            </Field>
          </Spec>
          <Spec name="Input type=&quot;date&quot;">
            <Field label="Fecha del cobro">
              <Input type="date" name="occurredOn" defaultValue="2026-11-13" />
            </Field>
          </Spec>
          <Spec name="MoneyInput" props={[["currency?: string", "el código que se muestra junto al campo"]]}>
            <Field label="Monto" hint="Con coma o con punto: 1.234,56">
              <MoneyInput name="gross" currency="USD" />
            </Field>
          </Spec>
          <Spec name="PctInput">
            <Field label="Comisión">
              <PctInput name="pct" defaultValue="2,9" />
            </Field>
          </Spec>
          <Spec
            name="Switch"
            props={[
              ["label: ReactNode", "el nombre del interruptor"],
              ["hint?: ReactNode", "aclaración bajo la etiqueta"],
              ["error?: string", "mensaje de error bajo la fila; marca el interruptor con aria-invalid"],
            ]}
          >
            <Switch name="fast" label="Pago rápido" hint="1,5 % sobre el bruto; el dinero cae el mismo día." defaultChecked />
            <Switch
              name="applyToExisting"
              label="Aplicar a los cobros ya registrados"
              error="Hay cobros depositados en ese período: no se pueden recalcular."
            />
          </Spec>
          <Spec
            name="Checkbox"
            props={[
              ["label: ReactNode", "el texto junto a la casilla"],
              ["hint?: ReactNode", "aclaración bajo la etiqueta"],
              ["error?: string", "mensaje de error bajo la fila; marca la casilla con aria-invalid"],
            ]}
          >
            <Checkbox name="refundsReturnFee" label="La pasarela devuelve la comisión al reembolsar" />
            <Checkbox
              name="confirmPurge"
              label="Entiendo que borrar del todo no se puede deshacer"
              hint="Se borran también sus comprobantes."
              error="Marca la casilla para continuar."
            />
          </Spec>
        </div>
      </Section>

      <Section id="kit-tarjetas" title="Tarjetas">
        <Spec name="Card · CardHeader · CardTitle · CardBody" props={[["CardTitle as?: \"h2\" | \"h3\"", "nivel del encabezado"]]}>
          <Card className="max-w-md">
            <CardHeader>
              <CardTitle as="h3">Próximos depósitos</CardTitle>
              <Badge tone="warning">1 atrasado</Badge>
            </CardHeader>
            <CardBody className="flex flex-col gap-3">
              <p className="flex items-baseline justify-between gap-3">
                <DateText value="2026-11-17" />
                <Money value="90.30" currency="USD" />
              </p>
              <p className="flex items-baseline justify-between gap-3">
                <DateText value="2026-11-18" />
                <Money value="32.06" currency="USD" />
              </p>
            </CardBody>
          </Card>
        </Spec>
      </Section>

      <Section id="kit-estados" title="Etiquetas y avisos" intro="El color acompaña; lo que informa es el texto.">
        <Spec name="Badge" props={[["tone?: \"neutral\" | \"info\" | \"success\" | \"warning\" | \"danger\"", "por defecto, neutral"]]}>
          <div className="flex flex-wrap gap-2">
            <Badge>Registrado</Badge>
            <Badge tone="info">En tránsito</Badge>
            <Badge tone="success">Depositado</Badge>
            <Badge tone="warning">Atrasado</Badge>
            <Badge tone="danger">En disputa</Badge>
          </div>
        </Spec>
        <Spec
          name="Alert"
          props={[
            ["tone?: \"info\" | \"success\" | \"warning\" | \"danger\"", "por defecto, info"],
            ["title?: ReactNode", "qué pasa, en una línea"],
            ["children?", "el detalle y qué hacer"],
          ]}
        >
          <div className="flex max-w-2xl flex-col gap-3">
            <Alert title="Faltan los feriados de 2027">Cárgalos para que las fechas estimadas de enero salgan bien.</Alert>
            <Alert tone="success" title="Reparto cuadrado">Las tres partes suman exactamente el neto.</Alert>
            <Alert tone="warning" title="2 depósitos atrasados">Su fecha estimada ya pasó y siguen sin caer.</Alert>
            <Alert tone="danger" title="El esquema no suma 100 %">Agrega un «Resto» o ajusta los porcentajes.</Alert>
          </div>
        </Spec>
        <Spec name="notify" props={[["notify.success(mensaje)", "aviso pasajero de que algo se hizo"], ["notify.error(mensaje)", "aviso pasajero de que algo falló"]]}>
          <NotifyDemo />
        </Spec>
      </Section>

      <Section id="kit-dialogos" title="Diálogos" intro="Sobre el <dialog> nativo: atrapan el foco, Escape los cierra y el foco vuelve a donde estaba.">
        <Spec
          name="Dialog"
          props={[
            ["open: boolean", "si está abierto; el estado lo lleva quien lo usa"],
            ["onClose: () => void", "al cerrar con Escape, con su botón o tocando fuera"],
            ["title: string", "el título; también es su nombre accesible"],
            ["description?: ReactNode", "una frase bajo el título"],
            ["footer?: ReactNode", "los botones"],
            ["placement?: \"center\" | \"bottom\"", "bottom: hoja pegada abajo (menús en el celular)"],
          ]}
        >
          <div>
            <DialogDemo />
          </div>
        </Spec>
        <Spec
          name="ConfirmDialog"
          props={[
            ["onConfirm: () => void", "al confirmar; quien lo usa cierra el diálogo"],
            ["confirmLabel: string", "el mismo verbo del título"],
            ["cancelLabel?: string", "por defecto, «Cancelar»"],
            ["variant?: \"primary\" | \"danger\"", "danger para lo que borra"],
            ["pending?: boolean", "desactiva los botones mientras la acción corre"],
          ]}
        >
          <div>
            <ConfirmDemo />
          </div>
        </Spec>
      </Section>

      <Section id="kit-tablas" title="Tablas" intro="Con rayas de libro. Si no caben a lo ancho se desplaza la tabla, no la página.">
        <Spec
          name="Table · THead · TBody · Tr · Th · Td"
          props={[
            ["Table label: string", "de qué es la tabla (nombra la zona desplazable)"],
            ["Th / Td numeric?: boolean", "columna de cifras: a la derecha y tabular"],
            ["Tr total?: boolean", "fila de total: raya de suma arriba y doble raya bajo cada cifra"],
          ]}
        >
          <Table label="Cobros de ejemplo">
            <THead>
              <Tr>
                <Th>Referencia</Th>
                <Th>Empresa</Th>
                <Th numeric>Bruto</Th>
                <Th numeric>Comisiones</Th>
                <Th numeric>Neto</Th>
              </Tr>
            </THead>
            <TBody>
              {DEMO_ROWS.map((row) => (
                <Tr key={row.id}>
                  <Th scope="row">{row.id}</Th>
                  <Td>{row.company}</Td>
                  <Td numeric>
                    <Money value={row.gross} currency="USD" />
                  </Td>
                  <Td numeric>
                    <Money value={row.fees} currency="USD" />
                  </Td>
                  <Td numeric>
                    <Money value={row.net} currency="USD" />
                  </Td>
                </Tr>
              ))}
              <Tr total>
                <Th scope="row" colSpan={2}>
                  Total
                </Th>
                <Td numeric>
                  <Money value="133.33" currency="USD" />
                </Td>
                <Td numeric>
                  <Money value="-14.17" currency="USD" />
                </Td>
                <Td numeric>
                  <Money value="119.16" currency="USD" />
                </Td>
              </Tr>
            </TBody>
          </Table>
        </Spec>
      </Section>

      <Section id="kit-vacios" title="Vacíos y carga">
        <Spec
          name="EmptyState"
          props={[
            ["title: string", "qué falta"],
            ["description?: ReactNode", "cómo empezar"],
            ["action?: ReactNode", "el botón que lo resuelve"],
            ["icon?: ReactNode", "ícono decorativo"],
          ]}
        >
          <EmptyState
            icon={<Inbox aria-hidden className="size-8" />}
            title="La papelera está vacía"
            description="Los cobros que borres aparecen aquí y se pueden restaurar."
            action={<ButtonLink href="/pasarelas/cobros">Ver los cobros</ButtonLink>}
          />
        </Spec>
        <Spec name="Skeleton" props={[["className", "el tamaño: h-6 w-40"]]}>
          <div className="flex max-w-md flex-col gap-2">
            <Skeleton className="h-7 w-40" />
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-3/4" />
          </div>
        </Spec>
      </Section>

      <Section id="kit-navegacion" title="Navegación">
        <Spec
          name="PageHeader"
          props={[
            ["title: string", "el único h1 de la pantalla (arriba de esta galería hay uno)"],
            ["description?: ReactNode", "una línea que orienta"],
            ["back?: { href, label }", "a dónde se vuelve"],
            ["actions?: ReactNode", "los botones de la pantalla"],
          ]}
        >
          <p className="text-sm text-ink-soft">El título de esta página es un PageHeader.</p>
        </Spec>
        <Spec name="BackLink" props={[["href: string", "la pantalla de la que cuelga esta"]]}>
          <BackLink href="/pasarelas/empresas">Empresas</BackLink>
        </Spec>
        <Spec
          name="TabsNav"
          props={[
            ["label: string", "qué agrupan las pestañas"],
            ["items: { href, label }[]", "cada pestaña es una URL"],
            ["current: string", "el href de la pestaña que se está viendo"],
          ]}
        >
          <TabsNav
            label="Secciones de ejemplo"
            current="/kit"
            items={[
              { href: "/kit", label: "Libro" },
              { href: "/kit?vista=esquemas", label: "Esquemas" },
              { href: "/kit?vista=beneficiarios", label: "Beneficiarios" },
            ]}
          />
        </Spec>
      </Section>

      <Section
        id="kit-filtros"
        title="Filtros en la URL"
        intro="Leen y escriben los parámetros de la dirección: el filtro se puede compartir y sobrevive a recargar. Van dentro de <Suspense>."
      >
        <Suspense fallback={<Skeleton className="h-11 w-full max-w-md" />}>
          <Spec name="UrlSearch" props={[["param?: string", "por defecto, q"], ["label?: string", "por defecto, «Buscar»"], ["placeholder?: string", "texto de ejemplo dentro del campo"]]}>
            <UrlSearch className="max-w-md" placeholder="Referencia o nota" />
          </Spec>
          <Spec
            name="UrlSelect"
            props={[
              ["param: string", "el parámetro de la URL"],
              ["label: string", "la etiqueta visible"],
              ["options: { value, label }[]", "las opciones"],
              ["allLabel?: string", "la opción que quita el filtro (por defecto, «Todas»)"],
            ]}
          >
            <UrlSelect
              className="max-w-xs"
              param="empresa"
              label="Empresa"
              options={[
                { value: "tienda", label: "Tienda Demo" },
                { value: "escuela", label: "Escuela Demo" },
              ]}
            />
          </Spec>
          <Spec
            name="UrlPeriod"
            props={[
              ["defaultPreset?", "el período cuando la URL no trae ninguno (por defecto, este_mes)"],
              ["parámetros", "periodo y, con «Elegir fechas», desde y hasta"],
            ]}
          >
            <UrlPeriod className="max-w-2xl" />
          </Spec>
          <Spec
            name="Pagination"
            props={[
              ["page: number", "la página actual (empieza en 1)"],
              ["pageSize: number", "filas por página"],
              ["total: number", "filas en total con el filtro aplicado"],
              ["param?: string", "por defecto, pagina"],
            ]}
          >
            <Pagination className="max-w-md" page={page} pageSize={PAGE_SIZE} total={DEMO_TOTAL} />
          </Spec>
        </Suspense>
      </Section>
    </>
  );
}
