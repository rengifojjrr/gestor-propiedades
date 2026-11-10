"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type ChangeEvent } from "react";
import { SignOutForm } from "@/app/(auth)/login/SignOutForm";
import { ActionError } from "@/components/pasarelas/ActionError";
import {
  RETRY_TEXT,
  UNSURE_TEXT,
  callActionOr,
  failureOf,
  type ActionFailure,
} from "@/components/pasarelas/callAction";
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

/** Confirmar o quitar un dispositivo sin respuesta (un corte): no se sabe si quedó. Va con «Ver cómo quedó». */
const unsure = () => ({ ok: false as const, error: UNSURE_TEXT, unsure: true as const });

function SecondFactor({ factors }: { factors: VerifiedFactor[] }) {
  const router = useRouter();
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  /** Un corte al confirmar el código: no se sabe si el dispositivo quedó activo. */
  const [confirmFailure, setConfirmFailure] = useState<ActionFailure | null>(null);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [toRemove, setToRemove] = useState<VerifiedFactor | null>(null);
  const [removing, startRemoving] = useTransition();

  // Si «Ver cómo quedó» enseña el dispositivo del alta ya activo (el código sí había llegado), el alta terminó: no
  // se sigue pidiendo el código y vuelve el botón para agregar otro.
  const enrolling =
    enrollment !== null && factors.every((factor) => factor.id !== enrollment.factorId) ? enrollment : null;

  const start = async () => {
    // Repetirlo tras un corte es seguro: `startEnrollment` quita antes el intento que quedó sin verificar.
    const result = await callActionOr(startEnrollment, () => ({ ok: false as const, error: RETRY_TEXT }));
    setCodeError(null);
    setConfirmFailure(null);
    setFailure(result.ok ? null : failureOf(result));
    if (result.ok) setEnrollment(result);
  };

  const confirm = async (formData: FormData) => {
    const result = await callActionOr(() => confirmEnrollment(formData), unsure);
    if (!result.ok) {
      // El error del código va en su campo; la duda de un corte, con «Ver cómo quedó».
      const problem = failureOf(result);
      setCodeError(problem.unsure ? null : problem.text);
      setConfirmFailure(problem.unsure ? problem : null);
      return;
    }
    setEnrollment(null);
    setCodeError(null);
    setConfirmFailure(null);
    notify.success("Segundo factor activado");
  };

  const cancel = () => {
    // Con la duda de un corte en pantalla, la lista se vuelve a pintar: el dispositivo pudo quedar activo.
    if (confirmFailure) router.refresh();
    setEnrollment(null);
  };

  const remove = (factor: VerifiedFactor) =>
    startRemoving(async () => {
      const result = await callActionOr(() => removeFactor(factor.id), unsure);
      setToRemove(null);
      setFailure(result.ok ? null : failureOf(result));
      if (result.ok) notify.success("Dispositivo quitado");
    });

  return (
    <section className={SECTION}>
      <h3 className={SECTION_TITLE}>Segundo factor</h3>
      <p className="text-ink-soft">
        Además de la contraseña, entrar pide un código de 6 dígitos que genera una app de autenticación en tu teléfono.
      </p>
      <ActionError failure={failure} />

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

      {enrolling ? (
        <div className="flex flex-col gap-4 rounded-control border border-rule-strong p-3">
          <p>
            Abre tu app de autenticación (por ejemplo, Google Authenticator o Authy), agrega una cuenta y escanea este
            código.
          </p>
          {/* El QR llega de Auth como `data:image/svg+xml`, con módulos negros sobre fondo transparente: va en un
              `<img>` normal (next/image no aplica a un `data:`) y sobre blanco, también en modo oscuro. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={enrolling.qrCode}
            alt="Código QR para tu app de autenticación"
            width={231}
            height={231}
            className="size-52 self-center rounded-control bg-[#fff]"
          />
          <div className="flex flex-col gap-1">
            <p className="text-sm text-ink-soft">¿No puedes escanearlo? Escribe esta clave en la app:</p>
            <code data-testid="clave-totp" className="cifra font-sans text-base font-semibold break-words">
              {inGroups(enrolling.secret)}
            </code>
          </div>
          <form action={confirm} className="flex flex-col gap-3">
            <input type="hidden" name="factorId" value={enrolling.factorId} />
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
            <ActionError failure={confirmFailure} />
            <div className="flex flex-wrap gap-2">
              <SubmitButton pendingLabel="Verificando…">Verificar y activar</SubmitButton>
              <Button onClick={cancel}>Cancelar</Button>
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

/**
 * Un corte al cambiarla: no se sabe si cambió, y volver a pintar la pantalla no lo enseñaría (no hay «Ver cómo
 * quedó»). Repetirlo sí lo dice, porque la actual se comprueba antes de cambiar nada.
 */
const PASSWORD_UNSURE_TEXT =
  "Se perdió la conexión y no se sabe si se cambió la contraseña. Vuelve a intentarlo: si te dice que la actual no es correcta, es que ya se cambió y vale la nueva.";

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
    const result = await callActionOr(
      () => changePassword(formData),
      (): PasswordProblem => ({ ok: false, error: PASSWORD_UNSURE_TEXT }),
    );
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
      <SignOutForm className="flex flex-wrap gap-2">
        <Button type="submit" name="scope" value="local">
          Cerrar sesión
        </Button>
        <Button type="submit" name="scope" value="global" variant="ghost" aria-describedby={EVERYWHERE_HINT_ID}>
          Cerrar sesión en todos los dispositivos
        </Button>
      </SignOutForm>
      {/* Auth cierra la sesión de los otros dispositivos y la base deja de responderles en el acto, aunque su
          token siga firmado hasta que caduca (1 h): lo que puede tardar es que su pantalla abierta lo note. */}
      <p id={EVERYWHERE_HINT_ID} className="text-sm text-ink-soft">
        Los demás dispositivos pierden el acceso a tus datos de inmediato, aunque una pantalla que ya esté abierta
        puede tardar en notarlo.
      </p>
    </section>
  );
}
