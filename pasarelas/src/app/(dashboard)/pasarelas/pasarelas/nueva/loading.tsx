import { Skeleton } from "@/components/ui";

/** Mientras carga el alta de una pasarela. */
export default function Loading() {
  return (
    <div className="flex flex-col gap-6">
      <p className="sr-only" role="status">
        Cargando…
      </p>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-6 w-28" />
        <Skeleton className="h-8 w-56 max-w-full" />
      </div>
      <Skeleton className="h-96 w-full" />
    </div>
  );
}
