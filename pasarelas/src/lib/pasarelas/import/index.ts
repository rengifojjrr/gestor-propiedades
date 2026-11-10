/**
 * El importador, la parte pura: reconocer un archivo (`detectFormat`), proponer su mapeo (`presetFor`), revisarlo
 * (`validateMapping`) y convertir sus filas (`mapRows`). El CSV lo lee el navegador: aquí solo llegan sus filas.
 */
export { detectFormat, type ImportFormat } from "./detect";
export { presetFor, referenceWarning, type ColumnMapping } from "./presets";
export { mapRows, parseImportAmount, validateMapping, type ImportRow, type ImportSkip } from "./mapping";
export {
  classifyRepeats,
  depositedOnImport,
  type ExistingRef,
  type ManualTx,
  type RepeatCheck,
} from "./review";
