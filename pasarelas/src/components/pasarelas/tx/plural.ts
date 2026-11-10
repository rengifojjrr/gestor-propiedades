/** «1 cobro», «3 cobros». */
export function cobros(count: number): string {
  return count === 1 ? "1 cobro" : `${count} cobros`;
}

/**
 * Lo que se dice tras una acción en lote: cuántos cambiaron (`done`, con el participio en singular y en plural) y,
 * si alguno de los elegidos no admitía el cambio, cuántos.
 */
export function batchDone(done: number, chosen: number, participle: { one: string; many: string }): string {
  const head = `${cobros(done)} ${done === 1 ? participle.one : participle.many}.`;
  const skipped = chosen - done;
  if (skipped <= 0) return head;
  return `${head} ${skipped === 1 ? "1 no admitía el cambio." : `${skipped} no admitían el cambio.`}`;
}
