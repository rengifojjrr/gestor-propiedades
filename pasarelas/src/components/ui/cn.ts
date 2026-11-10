/** Une clases de CSS descartando lo que no es una clase: `cn("a", activo && "b", className)`. */
export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}
