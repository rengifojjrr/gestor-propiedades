"use client";

import { isOption } from "@/components/pasarelas/gateways/international";
import { Card, CardBody, CardHeader, CardTitle, Checkbox, Field, Select } from "@/components/ui";
import type { ImportChoices } from "./plan";

export type ImportSettings = { companyId: string; gatewayId: string; channelId: string; extraIds: string[] };

/**
 * Empresa, pasarela, canal y opciones: valen para todos los cobros del archivo. Si la pasarela cobra un recargo a
 * los pagos internacionales, va aparte: el archivo no dice qué cobro fue internacional, así que también vale para
 * todos.
 */
export function SettingsCard({
  choices,
  value,
  onCompany,
  onGateway,
  onChange,
  disabled,
}: {
  choices: ImportChoices;
  value: ImportSettings;
  onCompany: (companyId: string) => void;
  onGateway: (gatewayId: string) => void;
  onChange: (next: ImportSettings) => void;
  disabled: boolean;
}) {
  const channels = choices.channels.filter((channel) => channel.companyId === value.companyId);
  const gateway = choices.gateways.find((candidate) => candidate.id === value.gatewayId);
  const options = gateway?.extras.filter(isOption) ?? [];
  const international = gateway?.extras.find((extra) => !isOption(extra));
  const toggleExtra = (id: string, on: boolean) =>
    onChange({ ...value, extraIds: on ? [...value.extraIds, id] : value.extraIds.filter((other) => other !== id) });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Para todos los cobros del archivo</CardTitle>
      </CardHeader>
      <CardBody className="flex flex-col gap-4">
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Empresa">
            <Select value={value.companyId} onChange={(event) => onCompany(event.currentTarget.value)} disabled={disabled}>
              {choices.companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Pasarela">
            <Select value={value.gatewayId} onChange={(event) => onGateway(event.currentTarget.value)} disabled={disabled}>
              {choices.gateways.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Canal" hint="Si la plataforma por la que entraron cobra aparte.">
            <Select
              value={value.channelId}
              onChange={(event) => onChange({ ...value, channelId: event.currentTarget.value })}
              disabled={disabled}
            >
              <option value="">Sin canal</option>
              {channels.map((channel) => (
                <option key={channel.id} value={channel.id}>
                  {channel.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {gateway && options.length > 0 ? (
          <fieldset className="flex min-w-0 flex-col">
            <legend className="text-sm font-semibold">Opciones de {gateway.name}</legend>
            {options.map((extra) => (
              <Checkbox
                key={extra.id}
                label={extra.name}
                checked={value.extraIds.includes(extra.id)}
                onChange={(event) => toggleExtra(extra.id, event.currentTarget.checked)}
                disabled={disabled}
              />
            ))}
          </fieldset>
        ) : null}
        {gateway && international ? (
          <Checkbox
            label="Todos los cobros del archivo son internacionales"
            hint={`Les suma el recargo internacional de ${gateway.name}. El archivo no dice qué cobro fue internacional: si trae de los dos, impórtalos en dos archivos.`}
            checked={value.extraIds.includes(international.id)}
            onChange={(event) => toggleExtra(international.id, event.currentTarget.checked)}
            disabled={disabled}
          />
        ) : null}
      </CardBody>
    </Card>
  );
}
