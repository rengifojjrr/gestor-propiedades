import { Skeleton } from "@/components/ui";

/** Mientras se lee el cobro que se va a editar: el lugar del título y de los campos. */
export default function EditarCobroLoading() {
  return (
    <div role="status" className="flex max-w-2xl flex-col gap-4">
      <span className="sr-only">Cargando el cobro…</span>
      <Skeleton className="h-9 w-48" />
      {Array.from({ length: 6 }, (_, index) => (
        <Skeleton key={index} className="h-16 w-full" />
      ))}
    </div>
  );
}
