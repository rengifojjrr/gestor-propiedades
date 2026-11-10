import { redirect } from "next/navigation";

/** La app empieza en el Resumen. */
export default function Inicio() {
  redirect("/pasarelas");
}
