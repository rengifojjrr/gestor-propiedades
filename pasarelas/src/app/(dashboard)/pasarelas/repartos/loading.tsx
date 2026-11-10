import { Skeleton } from "@/components/ui";

export default function RepartosLoading() {
  return (
    <div className="flex flex-col gap-6">
      <p className="sr-only" role="status">
        Cargando los repartos…
      </p>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-5 w-full max-w-md" />
      </div>
      <Skeleton className="h-56 w-full rounded-card" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-48 w-full rounded-card" />
        <Skeleton className="h-48 w-full rounded-card" />
      </div>
    </div>
  );
}
