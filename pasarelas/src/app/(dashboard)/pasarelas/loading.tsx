import { Skeleton } from "@/components/ui";

/** Mientras se arma el Resumen: el lugar de los filtros, de las cifras, de los gráficos y de los depósitos. */
export default function ResumenLoading() {
  return (
    <div role="status" className="flex flex-col gap-5">
      <span className="sr-only">Cargando el resumen…</span>
      <Skeleton className="h-9 w-40" />
      <Skeleton className="h-11 w-full" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 8 }, (_, index) => (
          <Skeleton key={index} className="h-24 w-full" />
        ))}
      </div>
      <Skeleton className="h-72 w-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}
