import { Skeleton } from "@/components/ui";

/** Mientras se lee el cobro: el lugar del título, de las acciones, del desglose y del historial. */
export default function CobroLoading() {
  return (
    <div role="status" className="flex flex-col gap-5">
      <span className="sr-only">Cargando el cobro…</span>
      <Skeleton className="h-9 w-56" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-64 w-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}
