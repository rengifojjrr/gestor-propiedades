import { Skeleton } from "@/components/ui";

export default function NuevoEsquemaLoading() {
  return (
    <div className="flex flex-col gap-6">
      <p className="sr-only" role="status">
        Cargando…
      </p>
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-96 w-full max-w-2xl rounded-card" />
    </div>
  );
}
