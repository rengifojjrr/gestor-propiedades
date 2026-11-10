/**
 * La puerta única del motor: todo lo de `src/lib/pasarelas/` se puede importar desde `@/lib/pasarelas`.
 * Los nombres no se repiten entre módulos (si se repitieran, TypeScript lo marca aquí como ambigüedad).
 */
export * from "./types";
export * from "./decimal";
export * from "./money";
export * from "./allocate";
export * from "./schemes";
export * from "./breakdown";
export * from "./guards";
export * from "./dates";
export * from "./holidays";
export * from "./versions";
export * from "./status";
export * from "./stats";
export * from "./csv";
