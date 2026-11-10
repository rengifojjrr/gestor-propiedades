import { Skeleton } from "@/components/ui";

/** Mientras carga «Importar CSV». */
export default function Loading() {
  return (
    <div className="flex flex-col gap-6">
      <p className="sr-only" role="status">
        Cargando…
      </p>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-5 w-72 max-w-full" />
      </div>
      <Skeleton className="h-56 w-full" />
      <Skeleton className="h-32 w-full" />
    </div>
  );
}
