"use client";

import { Store } from "lucide-react";
import { useId, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  Dialog,
  EmptyState,
  Field,
  Input,
  Money,
  MoneyInput,
  Percent,
  PctInput,
  SubmitButton,
  Switch,
  notify,
} from "@/components/ui";
import type { Currency } from "@/lib/pasarelas/types";
import { deleteChannel, saveChannel } from "@/server/pasarelas/actions/companies";
import type { CompanyChannel } from "@/server/pasarelas/queries/companies";
import { ExternalLink } from "./ExternalLink";
import { useActionForm } from "./useActionForm";

const NETWORK_TEXT = "No se pudo borrar. Revisa tu conexión e inténtalo de nuevo.";

/** Un monto o un porcentaje guardado, como se escribe en el formulario: coma decimal. */
const typed = (value: string) => value.replace(".", ",");

type ChannelValues = { name: string; url: string; platformFeePct: string; platformFeeFixed: string; active: boolean };

const EMPTY: ChannelValues = { name: "", url: "", platformFeePct: "", platformFeeFixed: "", active: true };

function valuesOf(channel: CompanyChannel): ChannelValues {
  return {
    name: channel.name,
    url: channel.url ?? "",
    platformFeePct: typed(channel.platformFeePct),
    platformFeeFixed: typed(channel.platformFeeFixed),
    active: channel.active,
  };
}

/** Alta o edición de un canal. Lo que no se escribe del costo vale 0. */
function ChannelForm({
  companyId,
  currency,
  channel,
  onSaved,
}: {
  companyId: string;
  currency: Currency;
  channel: CompanyChannel | null;
  onSaved: () => void;
}) {
  const [values, setValues] = useState<ChannelValues>(channel ? valuesOf(channel) : EMPTY);
  const { submit, formError, errorOf } = useActionForm();
  const set =
    (field: "name" | "url" | "platformFeePct" | "platformFeeFixed") =>
    (event: { currentTarget: { value: string } }) => {
      const { value } = event.currentTarget;
      setValues((current) => ({ ...current, [field]: value }));
    };

  async function save() {
    const result = await submit(() =>
      saveChannel({
        ...values,
        id: channel?.id,
        companyId,
        platformFeePct: values.platformFeePct.trim() || "0",
        platformFeeFixed: values.platformFeeFixed.trim() || "0",
      }),
    );
    if (!result.ok) return;
    notify.success(channel ? "Canal guardado" : "Canal agregado");
    onSaved();
  }

  return (
    <form action={save} noValidate className="flex flex-col gap-4">
      <Field label="Nombre" hint="La página o el lugar donde vendes: «Tienda en línea»." error={errorOf("name")}>
        <Input value={values.name} onChange={set("name")} autoComplete="off" maxLength={120} />
      </Field>
      <Field label="Link" optional hint="Empieza por https://" error={errorOf("url")}>
        <Input value={values.url} onChange={set("url")} inputMode="url" autoComplete="url" maxLength={300} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Comisión de la plataforma" error={errorOf("platformFeePct")}>
          <PctInput value={values.platformFeePct} onChange={set("platformFeePct")} />
        </Field>
        <Field label="Cargo fijo" error={errorOf("platformFeeFixed")}>
          <MoneyInput value={values.platformFeeFixed} onChange={set("platformFeeFixed")} currency={currency} />
        </Field>
      </div>
      {channel ? (
        <Switch
          label="Activo"
          hint="Un canal inactivo no se ofrece al registrar cobros."
          checked={values.active}
          onChange={(event) => {
            const { checked } = event.currentTarget;
            setValues((current) => ({ ...current, active: checked }));
          }}
        />
      ) : null}
      {formError ? (
        <Alert tone="danger" announce>
          {formError}
        </Alert>
      ) : null}
      <SubmitButton className="self-start">Guardar canal</SubmitButton>
    </form>
  );
}

/**
 * Los canales de venta de la empresa (sus páginas, con el costo de cada plataforma): verlos, agregar, editar y
 * borrar. Un canal con cobros no se borra: se desactiva.
 */
export function ChannelsCard({
  companyId,
  currency,
  channels,
}: {
  companyId: string;
  currency: Currency;
  channels: readonly CompanyChannel[];
}) {
  const titleId = useId();
  // `null`: cerrado; `"nuevo"`: agregar; un canal: editarlo.
  const [editing, setEditing] = useState<CompanyChannel | "nuevo" | null>(null);
  const [removing, setRemoving] = useState<CompanyChannel | null>(null);
  const [busy, setBusy] = useState(false);

  async function remove(channel: CompanyChannel) {
    setBusy(true);
    let result;
    try {
      result = await deleteChannel({ id: channel.id });
    } catch {
      result = { ok: false as const, error: NETWORK_TEXT };
    }
    setBusy(false);
    setRemoving(null);
    if (result.ok) notify.success(`Canal «${channel.name}» borrado`);
    else notify.error(result.error);
  }

  return (
    <Card>
      <section aria-labelledby={titleId}>
        <CardHeader>
          <CardTitle id={titleId}>Canales de venta</CardTitle>
          <Button onClick={() => setEditing("nuevo")}>Agregar canal</Button>
        </CardHeader>
        <CardBody>
          {channels.length === 0 ? (
            <EmptyState
              icon={<Store aria-hidden className="size-8" />}
              title="Sin canales"
              description="Agrega las páginas donde vende esta empresa, con lo que cobra cada plataforma. Sin canal, un cobro no paga plataforma."
            />
          ) : (
            <ul className="flex flex-col divide-y divide-rule">
              {channels.map((channel) => (
                <li key={channel.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold">{channel.name}</p>
                    {channel.active ? null : <Badge>Inactivo</Badge>}
                  </div>
                  <p className="text-ink-soft">
                    Costo: <Percent value={channel.platformFeePct} className="text-ink" /> +{" "}
                    <Money value={channel.platformFeeFixed} currency={currency} className="text-ink" />
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {channel.url ? (
                      <ExternalLink href={channel.url} context={`de ${channel.name}`}>
                        Abrir página
                      </ExternalLink>
                    ) : null}
                    <Button variant="ghost" onClick={() => setEditing(channel)}>
                      Editar<span className="sr-only"> {channel.name}</span>
                    </Button>
                    <Button variant="ghost" onClick={() => setRemoving(channel)}>
                      Borrar<span className="sr-only"> {channel.name}</span>
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </section>

      <Dialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === "nuevo" ? "Agregar canal" : "Editar canal"}
      >
        {editing !== null ? (
          <ChannelForm
            key={editing === "nuevo" ? "nuevo" : editing.id}
            companyId={companyId}
            currency={currency}
            channel={editing === "nuevo" ? null : editing}
            onSaved={() => setEditing(null)}
          />
        ) : null}
      </Dialog>
      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        onConfirm={() => {
          if (removing) void remove(removing);
        }}
        title={`¿Borrar el canal «${removing?.name ?? ""}»?`}
        description="No se puede deshacer. Si ya tiene cobros no se puede borrar: desactívalo al editarlo."
        confirmLabel="Borrar canal"
        variant="danger"
        pending={busy}
      />
    </Card>
  );
}
