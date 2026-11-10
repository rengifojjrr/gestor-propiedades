import { cn } from "./cn";

/**
 * Bloque gris que ocupa el lugar de algo que está cargando (para los `loading.tsx`). El tamaño se da con
 * clases: `<Skeleton className="h-6 w-40" />`. Es decorativo: el aviso «Cargando…» lo pone la pantalla.
 */
export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden className={cn("block animate-pulse rounded-control bg-sunken", className)} />;
}
