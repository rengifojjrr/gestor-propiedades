import { Skeleton } from "@/components/ui";

export default function CuentasLoading() {
  return (
    <div className="flex flex-col gap-6">
      <p className="sr-only" role="status">
        Cargando las cuentas destino…
      </p>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-5 w-full max-w-md" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-56 w-full rounded-card" />
        <Skeleton className="h-56 w-full rounded-card" />
      </div>
    </div>
  );
}
