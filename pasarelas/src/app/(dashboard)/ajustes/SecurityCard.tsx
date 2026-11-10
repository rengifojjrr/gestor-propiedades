"use client";

import { useState, useTransition, type ChangeEvent } from "react";
import { signOut } from "@/app/(auth)/login/actions";
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  DateTimeText,
  Field,
  Input,
  SubmitButton,
  notify,
} from "@/components/ui";
import type { VerifiedFactor } from "@/lib/auth/session";
import {
  changePassword,
  confirmEnrollment,
  removeFactor,
  startEnrollment,
  type EnrollmentStart,
  type PasswordResult,
} from "./actions";

type Enrollment = Extract<EnrollmentStart, { ok: true }>;
type PasswordProblem = Extract<PasswordResult, { ok: false }>;

const SECTION = "flex flex-col gap-3 py-5 first:pt-0 last:pb-0";
const SECTION_TITLE = "titulo text-base";

export type SecurityCardProps = {
  /** El correo de la sesión. */
  email: string;
  /** Los dispositivos del segundo factor ya verificados. */
  factors: VerifiedFactor[];
};

/** Ajustes → Seguridad: el segundo factor, la contraseña y la sesión. */
export function SecurityCard({ email, factors }: SecurityCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Seguridad</CardTitle>
      </CardHeader>
      <CardBody className="flex flex-col divide-y divide-rule">
        <SecondFactor factors={factors} />
        <PasswordChange email={email} />
        <SessionEnd email={email} />
      </CardBody>
    </Card>
  );
}

/** La clave en grupos de cuatro, que es como se copia a mano sin perderse. */
function inGroups(secret: string): string {
  return secret.match(/.{1,4}/g)?.join(" ") ?? secret;
}

function SecondFactor({ factors }: { factors: VerifiedFactor[] }) {
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toRemove, setToRemove] = useState<VerifiedFactor | null>(null);
  const [removing, startRemoving] = useTransition();

  const start = async () => {
    const result = await startEnrollment();
    setCodeError(null);
    setError(result.ok ? null : result.error);
    if (result.ok) setEnrollment(result);
  };

  const confirm = async (formData: FormData) => {
    const result = await confirmEnrollment(formData);
    if (!result.ok) {
      setCodeError(result.error);
      return;
    }
    setEnrollment(null);
    setCodeError(null);
    notify.success("Segundo factor activado");
  };

  const remove = (factor: VerifiedFactor) =>
    startRemoving(async () => {
      const result = await removeFactor(factor.id);
      setToRemove(null);
      setError(result.ok ? null : result.error);
      if (result.ok) notify.success("Dispositivo quitado");
    });

  return (
    <section className={SECTION}>
      <h3 className={SECTION_TITLE}>Segundo factor</h3>
      <p className="text-ink-soft">
        Además de la contraseña, entrar pide un código de 6 dígitos que genera una app de autenticación en tu teléfono.
      </p>
      {error ? <Alert tone="danger" announce title={error} /> : null}

      {factors.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {factors.map((factor) => (
            <li
              key={factor.id}
              className="flex items-center justify-between gap-3 rounded-control border border-rule py-2 pr-2 pl-3"
            >
              <div className="flex min-w-0 flex-col">
                <span className="font-semibold">{factor.name}</span>
                <span className="text-sm text-ink-soft">
                  Activo desde <DateTimeText value={factor.createdAt} />
                </span>
              </div>
              <Button aria-label={`Quitar ${factor.name}`} onClick={() => setToRemove(factor)}>
                Quitar
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p>Todavía no tienes ningún dispositivo: tu cuenta se abre solo con la contraseña.</p>
      )}

      {enrollment ? (
        <div className="flex flex-col gap-4 rounded-control border border-rule-strong p-3">
          <p>
            Abre tu app de autenticación (por ejemplo, Google Authenticator o Authy), agrega una cuenta y escanea este
            código.
          </p>
          {/* El QR llega de Auth como `data:image/svg+xml`, con módulos negros sobre fondo transparente: va en un
              `<img>` normal (next/image no aplica a un `data:`) y sobre blanco, también en modo oscuro. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={enrollment.qrCode}
            alt="Código QR para tu app de autenticación"
            width={231}
            height={231}
            className="size-52 self-center rounded-control bg-[#fff]"
          />
          <div className="flex flex-col gap-1">
            <p className="text-sm text-ink-soft">¿No puedes escanearlo? Escribe esta clave en la app:</p>
            <code data-testid="clave-totp" className="cifra font-sans text-base font-semibold break-words">
              {inGroups(enrollment.secret)}
            </code>
          </div>
          <form action={confirm} className="flex flex-col gap-3">
            <input type="hidden" name="factorId" value={enrollment.factorId} />
            <Field label="Código de 6 dígitos" hint="El que muestra la app después de escanear." error={codeError}>
              <Input
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={7}
                required
                className="cifra text-lg tracking-widest"
              />
            </Field>
            <div className="flex flex-wrap gap-2">
              <SubmitButton pendingLabel="Verificando…">Verificar y activar</SubmitButton>
              <Button onClick={() => setEnrollment(null)}>Cancelar</Button>
            </div>
          </form>
        </div>
      ) : (
        // Un formulario y no un `onClick`: si se toca antes de que la página termine de cargar, React lo repite después.
        <form action={start}>
          <SubmitButton variant={factors.length > 0 ? "secondary" : "primary"} pendingLabel="Preparando…">
            {factors.length > 0 ? "Agregar otro dispositivo" : "Activar segundo factor"}
          </SubmitButton>
        </form>
      )}

      <ConfirmDialog
        open={toRemove !== null}
        onClose={() => setToRemove(null)}
        onConfirm={() => toRemove && remove(toRemove)}
        title={toRemove ? `¿Quitar «${toRemove.name}»?` : ""}
        description={
          factors.length > 1
            ? "Ese dispositivo dejará de servir para entrar; los demás siguen activos. Si entraste con el código de este, se te pedirá el de otro."
            : "Es tu único dispositivo: la cuenta volverá a abrirse solo con la contraseña."
        }
        confirmLabel="Quitar"
        variant="danger"
        pending={removing}
      />
    </section>
  );
}

const EMPTY_PASSWORDS = { current: "", password: "", confirm: "" };

function PasswordChange({ email }: { email: string }) {
  // Campos controlados: si algo falla, lo escrito se queda (React vacía los no controlados al terminar la acción).
  const [values, setValues] = useState(EMPTY_PASSWORDS);
  const [problem, setProblem] = useState<PasswordProblem | null>(null);

  const bind = (name: keyof typeof EMPTY_PASSWORDS) => ({
    name,
    value: values[name],
    onChange: (event: ChangeEvent<HTMLInputElement>) => setValues((prev) => ({ ...prev, [name]: event.target.value })),
  });

  const submit = async (formData: FormData) => {
    const result = await changePassword(formData);
    if (!result.ok) {
      setProblem(result);
      return;
    }
    setValues(EMPTY_PASSWORDS);
    setProblem(null);
    notify.success("Contraseña cambiada");
  };

  return (
    <section className={SECTION}>
      <h3 className={SECTION_TITLE}>Contraseña</h3>
      <p className="text-ink-soft">
        Al cambiarla se cierran tus sesiones en los demás dispositivos: pierden el acceso a tus datos de inmediato,
        aunque una pantalla que ya esté abierta puede tardar en notarlo.
      </p>
      <form action={submit} className="flex max-w-sm flex-col gap-3">
        {/* Para que el gestor de contraseñas sepa de qué cuenta es la contraseña nueva. */}
        <input type="text" name="username" autoComplete="username" value={email} readOnly hidden />
        {problem?.error ? <Alert tone="danger" announce title={problem.error} /> : null}
        <Field label="Contraseña actual" error={problem?.fieldErrors?.current}>
          <Input type="password" autoComplete="current-password" required {...bind("current")} />
        </Field>
        <Field label="Contraseña nueva" hint="Al menos 10 caracteres." error={problem?.fieldErrors?.password}>
          <Input type="password" autoComplete="new-password" required {...bind("password")} />
        </Field>
        <Field label="Repite la contraseña nueva" error={problem?.fieldErrors?.confirm}>
          <Input type="password" autoComplete="new-password" required {...bind("confirm")} />
        </Field>
        <SubmitButton variant="secondary" className="self-start">
          Cambiar contraseña
        </SubmitButton>
      </form>
    </section>
  );
}

const EVERYWHERE_HINT_ID = "cerrar-en-todos-aviso";

function SessionEnd({ email }: { email: string }) {
  return (
    <section className={SECTION}>
      <h3 className={SECTION_TITLE}>Sesión</h3>
      <p className="text-ink-soft">
        Entraste como <span className="font-semibold break-all text-ink">{email}</span>.
      </p>
      <form action={signOut} className="flex flex-wrap gap-2">
        <Button type="submit" name="scope" value="local">
          Cerrar sesión
        </Button>
        <Button type="submit" name="scope" value="global" variant="ghost" aria-describedby={EVERYWHERE_HINT_ID}>
          Cerrar sesión en todos los dispositivos
        </Button>
      </form>
      {/* Auth cierra la sesión de los otros dispositivos y la base deja de responderles en el acto, aunque su
          token siga firmado hasta que caduca (1 h): lo que puede tardar es que su pantalla abierta lo note. */}
      <p id={EVERYWHERE_HINT_ID} className="text-sm text-ink-soft">
        Los demás dispositivos pierden el acceso a tus datos de inmediato, aunque una pantalla que ya esté abierta
        puede tardar en notarlo.
      </p>
    </section>
  );
}
