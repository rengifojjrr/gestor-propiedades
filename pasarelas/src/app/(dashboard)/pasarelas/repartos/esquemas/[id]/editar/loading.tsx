import { Skeleton } from "@/components/ui";

/** Mientras se lee el esquema y cuántos cobros usan su última versión: el lugar del título y del editor. */
export default function EditarEsquemaLoading() {
  return (
    <div className="flex flex-col gap-6">
      <p className="sr-only" role="status">
        Cargando el esquema…
      </p>
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-96 w-full max-w-2xl rounded-card" />
    </div>
  );
}
