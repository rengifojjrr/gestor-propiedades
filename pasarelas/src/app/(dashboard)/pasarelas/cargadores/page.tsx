import { Users } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import { LoaderCard, UnassignedCard } from "@/components/pasarelas/loaders/LoaderCard";
import { NewLoaderButton } from "@/components/pasarelas/loaders/NewLoaderButton";
import { DateText, EmptyState, PageHeader, UrlPeriod } from "@/components/ui";
import { requireSession } from "@/lib/auth/session";
import { todayNY } from "@/lib/pasarelas";
import { createClient } from "@/lib/supabase/server";
import { loadLoaderReport } from "@/server/pasarelas/queries/loaders";

export const metadata: Metadata = { title: "Cargadores" };

/**
 * Cargadores: quién trae cada venta, para reportarle las suyas. Cada cargador con sus ventas del período elegido (el
 * mismo selector que el Resumen, en la URL) y el enlace a esos cobros, desde donde se exportan; y una fila «Sin
 * cargador» con lo que falta asignar. Aquí se crean, se renombran, se desactivan y se borran.
 */
export default async function CargadoresPage({ searchParams }: PageProps<"/pasarelas/cargadores">) {
  await requireSession();
  const sp = await searchParams;
  const today = todayNY(new Date());
  const report = await loadLoaderReport(await createClient(), sp, today);
  const none = report.loaders.length === 0;

  return (
    <>
      <PageHeader
        title="Cargadores"
        description="Quién te trae cada venta, para reportarle las suyas. Un cargador no cobra del reparto: si se lleva un porcentaje, agrégalo como beneficiario de un esquema en Repartos."
        actions={none ? undefined : <NewLoaderButton />}
      />
      {none ? (
        <EmptyState
          icon={<Users aria-hidden className="size-8" />}
          title="Todavía no hay cargadores"
          description="Agrega a quienes te traen ventas: al registrar cada cobro eliges de quién es, y aquí ves lo de cada uno para reportárselo."
          action={<NewLoaderButton />}
        />
      ) : (
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-3">
            {/* El período se lee de la URL con `useSearchParams()`: va dentro de <Suspense>. */}
            <Suspense fallback={null}>
              <UrlPeriod className="max-w-xl" />
            </Suspense>
            <p className="text-ink-soft">
              Del <DateText value={report.period.from} /> al <DateText value={report.period.to} />.
            </p>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            {report.loaders.map((loader) => (
              <LoaderCard key={loader.id} loader={loader} />
            ))}
            <UnassignedCard sales={report.unassigned} />
          </div>
        </div>
      )}
    </>
  );
}
