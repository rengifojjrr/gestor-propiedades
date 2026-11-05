/** Editar la ficha de un huésped o inquilino (contacto, idioma, país y etiquetas). */
import { useState } from 'react';
import { useBusyAction } from '@/app/hooks';
import { useActor } from '@/app/session';
import type { Lang } from '@/domain/types';
import { svc, type PersonView } from '@/services';
import type { PersonInput } from '@/services/people';
import { Button, Modal, Select, TextInput } from '@/ui';
import { LANG_LABEL } from './text';

/** Datos actuales de la ficha listos para guardar (con cambios encima). */
export function personInput(p: PersonView, patch: Partial<PersonInput> = {}): PersonInput {
  return {
    id: p.id,
    kind: p.kind,
    name: p.name,
    email: p.email,
    phone: p.phone,
    language: p.language,
    country: p.country,
    notes: p.notes,
    doNotRent: p.doNotRent,
    idVerified: p.idVerified,
    tags: p.tags,
    ...patch,
  };
}

export function PersonEditModal({ person, onClose }: { person: PersonView; onClose: () => void }) {
  const actor = useActor();
  const [run, busy] = useBusyAction();
  const [name, setName] = useState(person.name);
  const [email, setEmail] = useState(person.email ?? '');
  const [phone, setPhone] = useState(person.phone ?? '');
  const [language, setLanguage] = useState<Lang>(person.language);
  const [country, setCountry] = useState(person.country ?? '');
  const [tags, setTags] = useState(person.tags.join(', '));

  const save = async () => {
    const saved = await run(
      () =>
        svc.people.savePerson(
          actor,
          personInput(person, {
            name: name.trim(),
            email: email.trim() || undefined,
            phone: phone.trim() || undefined,
            language,
            country: country.trim() || undefined,
            tags: [...new Set(tags.split(',').map((x) => x.trim()).filter(Boolean))],
          }),
        ),
      { success: 'Ficha guardada' },
    );
    if (saved) onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Editar ficha"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={save} loading={busy} disabled={name.trim().length < 2} data-testid="guardar-ficha">
            Guardar
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <TextInput label="Nombre" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextInput label="Correo" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nombre@ejemplo.test" />
          <TextInput label="Teléfono" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 555 0100" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Idioma de los mensajes"
            value={language}
            onChange={(e) => setLanguage(e.target.value as Lang)}
            options={(['es', 'en'] as const).map((l) => ({ value: l, label: LANG_LABEL[l] }))}
            hint="Su app y las plantillas salen en este idioma."
          />
          <TextInput label="País" value={country} onChange={(e) => setCountry(e.target.value)} />
        </div>
        <TextInput label="Etiquetas" value={tags} onChange={(e) => setTags(e.target.value)} hint="Separadas por comas (ej.: frecuente, familia)." />
        <p className="text-body-sm text-on-surface-variant">Las notas, el documento verificado y «No volver a alquilar» se cambian en la ficha.</p>
      </form>
    </Modal>
  );
}
