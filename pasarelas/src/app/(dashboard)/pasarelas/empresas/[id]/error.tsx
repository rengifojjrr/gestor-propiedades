"use client"; // los límites de error son componentes de cliente

import { ScreenError } from "@/components/pasarelas/companies/ScreenError";

export default function Error({ error, retry }: { error: unknown; retry: () => void }) {
  return <ScreenError error={error} retry={retry} />;
}
