import { Skeleton } from "@/components/ui";

/** Lo que ocupa el lugar de una pantalla de Empresas mientras carga (su `loading.tsx`). */
export function ScreenLoading({ label }: { label: string }) {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-4">
      <span className="sr-only">{label}</span>
      <Skeleton className="h-9 w-56" />
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}
