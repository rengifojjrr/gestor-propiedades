/**
 * Las iniciales que ocupan el lugar del logo de una empresa que no tiene: la primera letra (o dígito) de sus dos
 * primeras palabras, en mayúsculas. Lo que no es letra ni dígito (comillas, signos) no cuenta como palabra.
 */
export function initialsOf(name: string): string {
  const words = name.match(/[\p{L}\p{N}][\p{L}\p{N}\p{M}'’.-]*/gu) ?? [];
  const initials = words
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join("");
  return initials === "" ? "·" : initials;
}
