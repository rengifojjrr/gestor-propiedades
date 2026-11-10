import { ShieldAlert } from "lucide-react";
import Link from "next/link";

/**
 * El aviso que el marco muestra en todas las pantallas mientras la cuenta no tenga segundo factor.
 * No es un `Alert`: está siempre, así que no debe interrumpir al lector de pantalla en cada página.
 */
export function MfaBanner() {
  return (
    <aside
      aria-label="Aviso de seguridad"
      className="mb-5 flex gap-3 rounded-control border-l-4 border-warning bg-warning-soft px-3 pt-3 pb-1 text-ink"
    >
      <ShieldAlert aria-hidden className="mt-0.5 size-5 shrink-0 text-warning" />
      <div className="flex min-w-0 flex-col gap-1">
        <p className="font-semibold">Activa el segundo factor</p>
        <p className="text-sm">
          Hoy tu cuenta se abre solo con la contraseña. Haz que además pida un código de tu teléfono.
        </p>
        <Link href="/ajustes" className="inline-flex min-h-11 items-center self-start font-semibold underline">
          Ir a Ajustes → Seguridad
        </Link>
      </div>
    </aside>
  );
}
