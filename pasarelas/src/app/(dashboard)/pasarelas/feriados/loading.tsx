import { Skeleton } from "@/components/ui";

export default function FeriadosLoading() {
  return (
    <div className="flex flex-col gap-6">
      <p className="sr-only" role="status">
        Cargando los feriados…
      </p>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-5 w-full max-w-md" />
      </div>
      <Skeleton className="h-96 w-full rounded-card" />
    </div>
  );
}
