import { Skeleton } from "@/components/ui";

/** Mientras carga «Registrar cobro»: el título y el lugar de los campos y de la vista previa. */
export default function RegistrarLoading() {
  return (
    <div role="status" className="flex flex-col gap-6">
      <span className="sr-only">Cargando…</span>
      <Skeleton className="h-9 w-56" />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
        <div className="flex flex-col gap-4">
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="flex flex-col gap-1.5">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-11 w-full" />
            </div>
          ))}
        </div>
        <Skeleton className="h-72 w-full" />
      </div>
    </div>
  );
}
