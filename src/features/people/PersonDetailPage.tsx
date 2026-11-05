/**
 * Ficha de un huésped o inquilino: contacto, idioma, país, etiquetas, notas, «Documento verificado»
 * (nunca se guarda la imagen), «No volver a alquilar» con motivo, estadías, contratos y conversaciones.
 */
import type { LucideIcon } from 'lucide-react';
import { Ban, BadgeCheck, CalendarDays, FileSignature, Globe, Languages, Mail, MessageSquare, NotebookPen, Pencil, Phone, ShieldCheck, Tag, UserRound } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useParams } from 'react-router';
import { useBusyAction } from '@/app/hooks';
import { useActor, useSession } from '@/app/session';
import { useLive, useLiveResult } from '@/data/live';
import { CHANNEL_LABEL } from '@/domain/labels';
import { clock, todayLocal } from '@/lib/clock';
import { formatDate, formatRange, relativeDay, timeAgo } from '@/lib/dates';
import { formatMoney } from '@/lib/money';
import { can, svc, type PersonView, type ThreadView } from '@/services';
import { Avatar, Badge, Banner, BookingStatusBadge, Button, Card, CardHeader, EmptyState, ErrorState, ListRow, Loading, Modal, PageHeader, TextArea, Toggle, useConfirm } from '@/ui';
import { useSubject } from './hooks';
import { MessageButton } from './PeopleCards';
import { personInput, PersonEditModal } from './PersonEditModal';
import { LANG_LABEL, SPEAKS } from './text';

const LEASE_STATUS = { active: 'Vigente', ended: 'Terminado', terminated: 'Cancelado' } as const;

/** El motivo de «No volver a alquilar» se agrega a las notas con este prefijo (y la fecha). */
const DNR_PREFIX = 'No volver a alquilar';

/** Motivo para la franja roja: la última nota, sin el prefijo que se agrega al marcar. */
function doNotRentReason(notes: string): string {
  const last = notes.split('\n').map((l) => l.trim()).filter(Boolean).slice(-1)[0] ?? '';
  return last.replace(new RegExp(`^${DNR_PREFIX}[^:]*:\\s*`, 'i'), '');
}

function NotesCard({ person, canWrite }: { person: PersonView; canWrite: boolean }) {
  const actor = useActor();
  const [run, busy] = useBusyAction();
  const [notes, setNotes] = useState(person.notes);
  const changed = notes !== person.notes;
  return (
    <Card padding="lg" as="section" aria-label="Notas">
      <CardHeader title="Notas" subtitle="Solo las ve el equipo." action={<NotebookPen size={20} className="text-primary" aria-hidden />} />
      {canWrite ? (
        <>
          <TextArea aria-label="Notas sobre la persona" rows={5} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Preferencias, acuerdos, lo que el equipo debe saber…" />
          <div className="mt-3 flex justify-end gap-2">
            {changed && (
              <Button variant="ghost" onClick={() => setNotes(person.notes)}>
                Descartar
              </Button>
            )}
            <Button
              onClick={() => run(() => svc.people.savePerson(actor, personInput(person, { notes })), { success: 'Notas guardadas' })}
              loading={busy}
              disabled={!changed}
              data-testid="guardar-notas"
            >
              Guardar notas
            </Button>
          </div>
        </>
      ) : (
        <p className="text-body-md whitespace-pre-line text-on-surface">{person.notes || 'Sin notas.'}</p>
      )}
    </Card>
  );
}

function SafetyCard({ person, canWrite }: { person: PersonView; canWrite: boolean }) {
  const actor = useActor();
  const confirm = useConfirm();
  const [run] = useBusyAction();
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const markDoNotRent = async () => {
    setSaving(true);
    const note = reason.trim() ? `${DNR_PREFIX} (${formatDate(todayLocal(), { year: true })}): ${reason.trim()}` : '';
    const done = await run(() => svc.people.setDoNotRent(actor, person.id, true, note), {
      success: `${person.name} quedó marcado: no volver a alquilar`,
    });
    setSaving(false);
    if (done) {
      setAsking(false);
      setReason('');
    }
  };

  return (
    <Card padding="lg" as="section" aria-label="Verificación y alertas">
      <CardHeader title="Verificación y alertas" action={<ShieldCheck size={20} className="text-primary" aria-hidden />} />
      <Toggle
        label="Documento verificado"
        description="Solo se marca que se revisó. Nunca se guarda la imagen del documento."
        checked={person.idVerified}
        disabled={!canWrite}
        onChange={(v) =>
          void run(() => svc.people.savePerson(actor, personInput(person, { idVerified: v })), {
            success: v ? 'Documento marcado como verificado' : 'Se quitó la marca de documento verificado',
          })
        }
      />
      <div className="my-2 border-t border-outline-variant/40" />
      <Toggle
        label="No volver a alquilar"
        description={person.doNotRent ? 'Marcado. El motivo queda en las notas.' : 'Avisa al equipo en sus próximas reservas.'}
        checked={person.doNotRent}
        disabled={!canWrite}
        onChange={async (v) => {
          if (v) return setAsking(true);
          const ok = await confirm({ title: `¿Quitar «No volver a alquilar» a ${person.name}?`, confirmLabel: 'Quitar la marca' });
          if (ok) void run(() => svc.people.setDoNotRent(actor, person.id, false), { success: 'Se quitó la marca' });
        }}
      />
      <Modal
        open={asking}
        onClose={() => setAsking(false)}
        title="No volver a alquilar"
        footer={
          <>
            <Button variant="secondary" onClick={() => setAsking(false)}>
              Cancelar
            </Button>
            <Button variant="danger" icon={Ban} onClick={markDoNotRent} loading={saving} data-testid="confirmar-no-alquilar">
              Marcar
            </Button>
          </>
        }
      >
        <p className="mb-3 text-body-md text-on-surface-variant">
          {person.name} quedará marcado para todo el equipo. El motivo se agrega a sus notas, con la fecha de hoy en la auditoría.
        </p>
        <TextArea label="Motivo" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ej.: Fiesta no autorizada y daños en la sala." autoFocus />
      </Modal>
    </Card>
  );
}

function ContactLine({ icon: Icon, label, children }: { icon: LucideIcon; label: string; children: ReactNode }) {
  return (
    <li className="flex items-center gap-3 border-b border-outline-variant/40 py-2.5 last:border-b-0">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-low text-primary" title={label}>
        <Icon size={16} aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-label-sm font-normal text-on-surface-variant">{label}</span>
        <span className="block truncate text-body-md text-on-surface">{children}</span>
      </span>
    </li>
  );
}

function ProfileCard({ person }: { person: PersonView }) {
  return (
    <Card padding="lg" as="section" aria-label="Contacto">
      <div className="mb-3 flex items-center gap-4">
        <Avatar name={person.name} size="lg" />
        <div className="min-w-0">
          <p className="truncate text-headline-md text-primary">{person.name}</p>
          <p className="text-body-sm text-on-surface-variant">
            {person.kind === 'tenant' ? 'Inquilino' : 'Huésped'} desde {formatDate(person.createdAt.slice(0, 10), { year: true })}
          </p>
        </div>
      </div>
      <ul>
        <ContactLine icon={Mail} label="Correo">
          {person.email ? (
            <a href={`mailto:${person.email}`} className="text-primary underline">
              {person.email}
            </a>
          ) : (
            '—'
          )}
        </ContactLine>
        <ContactLine icon={Phone} label="Teléfono">
          {person.phone ? (
            <a href={`tel:${person.phone.replace(/\s/g, '')}`} className="text-primary underline">
              {person.phone}
            </a>
          ) : (
            '—'
          )}
        </ContactLine>
        <ContactLine icon={Languages} label="Idioma de los mensajes">
          {LANG_LABEL[person.language]}
        </ContactLine>
        <ContactLine icon={Globe} label="País">
          {person.country || '—'}
        </ContactLine>
      </ul>
      {(person.kind === 'guest' || person.lastStay) && (
        <dl className="mt-3 grid grid-cols-2 gap-3">
          <div className="rounded-md bg-surface-low p-3">
            <dt className="text-label-sm text-on-surface-variant">Estadías terminadas</dt>
            <dd className="text-headline-md text-primary tabular">{person.stays}</dd>
          </div>
          <div className="rounded-md bg-surface-low p-3">
            <dt className="text-label-sm text-on-surface-variant">Última salida</dt>
            <dd className="text-label-md text-primary">{person.lastStay ? formatDate(person.lastStay, { year: true }) : '—'}</dd>
          </div>
        </dl>
      )}
      {person.tags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5" aria-label="Etiquetas">
          {person.tags.map((tag) => (
            <Badge key={tag} tone="info" icon={Tag}>
              {tag}
            </Badge>
          ))}
        </div>
      )}
    </Card>
  );
}

function Conversations({ threads }: { threads?: ThreadView[] }) {
  return (
    <Card padding="lg" as="section" aria-label="Conversaciones">
      <CardHeader title="Conversaciones" action={<MessageSquare size={20} className="text-primary" aria-hidden />} />
      {!threads ? (
        <Loading />
      ) : !threads.length ? (
        <p className="text-body-sm text-on-surface-variant">Todavía no hay conversaciones.</p>
      ) : (
        <div className="space-y-2">
          {threads.map((t) => (
            <ListRow
              key={t.id}
              to={`/mensajes/${t.id}`}
              icon={MessageSquare}
              title={`${t.propertyName} · ${t.bookingCode ?? t.leaseCode ?? t.subject}`}
              subtitle={t.lastMessagePreview || 'Sin mensajes todavía'}
              trailing={
                <span className="flex shrink-0 flex-col items-end gap-1">
                  <span className="text-label-sm font-normal text-on-surface-variant">{timeAgo(t.lastMessageAt, clock.now())}</span>
                  {t.unreadTeam > 0 && <span className="rounded-full bg-error px-2 text-label-sm text-on-error">{t.unreadTeam} sin leer</span>}
                </span>
              }
            />
          ))}
        </div>
      )}
    </Card>
  );
}

export default function PersonDetailPage() {
  const { id = '' } = useParams();
  const actor = useActor();
  const { user } = useSession();
  const subject = useSubject();
  const res = useLiveResult(() => svc.people.getPerson(actor, id), [actor, id]);
  const threads = useLive(() => svc.people.listThreads(actor).then((list) => list.filter((t) => t.personId === id)), [actor, id]);
  const [editing, setEditing] = useState(false);

  if (!res.data) {
    if (res.error)
      return (
        <div>
          <PageHeader back="/huespedes" title="Ficha de la persona" />
          <ErrorState error={res.error} />
        </div>
      );
    return <Loading />;
  }

  const p = res.data;
  const canWrite = !!subject && can(subject, 'person.write');
  const canSend = !!subject && can(subject, 'message.send');
  const seesLeases = user?.role === 'owner' || user?.role === 'admin';
  const now = p.currentBooking ?? p.nextBooking;
  const lastThread = threads?.[0];
  const activeLease = p.leases.find((l) => l.status === 'active');

  return (
    <div>
      <PageHeader
        back="/huespedes"
        eyebrow={
          <span className="flex flex-wrap items-center gap-1.5">
            <Badge tone="neutral" icon={UserRound}>
              {p.kind === 'tenant' ? 'Inquilino' : 'Huésped'}
            </Badge>
            {p.idVerified && (
              <Badge tone="good" icon={BadgeCheck}>
                Documento verificado
              </Badge>
            )}
            {p.doNotRent && (
              <Badge tone="bad" icon={Ban}>
                No volver a alquilar
              </Badge>
            )}
          </span>
        }
        title={p.name}
        subtitle={[p.country, SPEAKS[p.language]].filter(Boolean).join(' · ')}
        actions={
          <>
            {canWrite && (
              <Button variant="secondary" icon={Pencil} onClick={() => setEditing(true)} data-testid="editar-ficha">
                Editar
              </Button>
            )}
            <MessageButton threadId={lastThread?.id} bookingId={now?.id ?? (activeLease ? undefined : p.bookings[0]?.id)} leaseId={activeLease?.id} canSend={canSend} />
          </>
        }
      />

      {p.doNotRent && (
        <Banner tone="bad" icon={Ban} className="mb-6">
          <strong>No volver a alquilar</strong> · {doNotRentReason(p.notes) || 'Sin motivo anotado.'}
        </Banner>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="min-w-0 space-y-6 lg:col-span-5 xl:col-span-4">
          <ProfileCard person={p} />
          <SafetyCard person={p} canWrite={canWrite} />
          <NotesCard key={p.notes} person={p} canWrite={canWrite} />
        </div>

        <div className="min-w-0 space-y-6 lg:col-span-7 xl:col-span-8">
          {now && (
            <Card tone="dark" padding="lg" as="section" aria-label={p.currentBooking ? 'En casa ahora' : 'Próxima llegada'}>
              <p className="text-label-md tracking-widest text-on-primary-container-muted uppercase">{p.currentBooking ? 'En casa ahora' : 'Próxima llegada'}</p>
              <p className="mt-1 text-headline-lg">{now.propertyName}</p>
              <p className="text-body-md text-on-primary-container-muted">
                {formatRange(now.checkIn, now.checkOut)} · {p.currentBooking ? `sale ${relativeDay(now.checkOut, todayLocal()).toLowerCase()}` : `llega ${relativeDay(now.checkIn, todayLocal()).toLowerCase()}`}
              </p>
            </Card>
          )}
          {!now && p.lease && (
            <Card tone="dark" padding="lg" as="section" aria-label="Contrato vigente">
              <p className="text-label-md tracking-widest text-on-primary-container-muted uppercase">Contrato vigente</p>
              <p className="mt-1 text-headline-lg">{p.lease.propertyName}</p>
              <p className="text-body-md text-on-primary-container-muted">Hasta el {formatDate(p.lease.end, { year: true })}</p>
            </Card>
          )}

          {(p.kind === 'guest' || p.bookings.length > 0) && (
            <Card padding="lg" as="section" aria-label="Estadías">
              <CardHeader title="Estadías" subtitle={`${p.bookings.length} ${p.bookings.length === 1 ? 'reserva' : 'reservas'}`} action={<CalendarDays size={20} className="text-primary" aria-hidden />} />
              {!p.bookings.length ? (
                <EmptyState icon={CalendarDays} title="Sin reservas" className="py-6" />
              ) : (
                <div className="space-y-2">
                  {p.bookings.map((b) => (
                    <ListRow
                      key={b.id}
                      to={`/reservas/${b.id}`}
                      icon={CalendarDays}
                      title={`${b.propertyName} · ${formatRange(b.checkIn, b.checkOut)} ${b.checkIn.slice(0, 4)}`}
                      subtitle={`${b.code} · ${CHANNEL_LABEL[b.channel]} · ${b.guests} ${b.guests === 1 ? 'huésped' : 'huéspedes'}`}
                      trailing={<BookingStatusBadge status={b.status} />}
                    />
                  ))}
                </div>
              )}
            </Card>
          )}

          {(p.kind === 'tenant' || p.leases.length > 0) && (
            <Card padding="lg" as="section" aria-label="Contratos">
              <CardHeader title="Contratos" action={<FileSignature size={20} className="text-primary" aria-hidden />} />
              {!p.leases.length ? (
                <p className="text-body-sm text-on-surface-variant">Sin contratos.</p>
              ) : (
                <div className="space-y-2">
                  {p.leases.map((l) => (
                    <ListRow
                      key={l.id}
                      to={seesLeases ? `/contratos/${l.id}` : undefined}
                      icon={FileSignature}
                      title={`${l.propertyName} · ${l.code}`}
                      subtitle={`${formatDate(l.start, { year: true })} – ${formatDate(l.end, { year: true })} · ${formatMoney(l.rent, l.currency)} al mes`}
                      trailing={<Badge tone={l.status === 'active' ? 'good' : 'neutral'}>{LEASE_STATUS[l.status]}</Badge>}
                    />
                  ))}
                </div>
              )}
            </Card>
          )}

          <Conversations threads={threads} />
        </div>
      </div>

      {editing && <PersonEditModal person={p} onClose={() => setEditing(false)} />}
    </div>
  );
}
