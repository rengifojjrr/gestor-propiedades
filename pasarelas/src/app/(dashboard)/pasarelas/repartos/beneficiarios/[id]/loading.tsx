import { Skeleton } from "@/components/ui";

export default function BeneficiarioLoading() {
  return (
    <div className="flex flex-col gap-6">
      <p className="sr-only" role="status">
        Cargando el beneficiario…
      </p>
      <Skeleton className="h-8 w-56" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-96 w-full rounded-card" />
        <Skeleton className="h-96 w-full rounded-card" />
      </div>
    </div>
  );
}
