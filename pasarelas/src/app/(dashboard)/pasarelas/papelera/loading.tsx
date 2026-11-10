import { Skeleton } from "@/components/ui";

/** Mientras se lee la papelera: el lugar del título y de la lista. */
export default function PapeleraLoading() {
  return (
    <div role="status" className="flex flex-col gap-5">
      <span className="sr-only">Cargando la papelera…</span>
      <Skeleton className="h-9 w-40" />
      {Array.from({ length: 4 }, (_, index) => (
        <Skeleton key={index} className="h-24 w-full" />
      ))}
    </div>
  );
}
