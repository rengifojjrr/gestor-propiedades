/** Une clases condicionales: cn('a', cond && 'b'). */
export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}
