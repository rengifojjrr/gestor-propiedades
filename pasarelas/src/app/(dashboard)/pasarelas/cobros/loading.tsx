import { Skeleton } from "@/components/ui";

/** Mientras se leen los cobros: el lugar de los filtros, de los totales y de la lista. */
export default function CobrosLoading() {
  return (
    <div role="status" className="flex flex-col gap-5">
      <span className="sr-only">Cargando cobros…</span>
      <Skeleton className="h-9 w-40" />
      <Skeleton className="h-11 w-full" />
      <Skeleton className="h-28 w-full" />
      {Array.from({ length: 5 }, (_, index) => (
        <Skeleton key={index} className="h-24 w-full" />
      ))}
    </div>
  );
}
