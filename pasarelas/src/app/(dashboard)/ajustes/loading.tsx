import { Skeleton } from "@/components/ui";

export default function AjustesLoading() {
  return (
    <div className="flex flex-col gap-6">
      <p className="sr-only" role="status">
        Cargando los ajustes…
      </p>
      <Skeleton className="h-8 w-40" />
      <div className="flex flex-col gap-4">
        <Skeleton className="h-64 w-full rounded-card" />
        <Skeleton className="h-32 w-full rounded-card" />
      </div>
    </div>
  );
}
