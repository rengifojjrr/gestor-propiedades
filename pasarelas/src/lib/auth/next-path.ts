/*
 * «A dónde se vuelve después de entrar». La ruta viaja en la URL (`/login?siguiente=/pasarelas/cobros`), así que
 * es entrada de cualquiera: solo se aceptan rutas de este sitio. Sin esto, un enlace a
 * `/login?siguiente=//evil.example` mandaría a otro sitio a quien acaba de escribir su contraseña.
 */

/** El nombre del parámetro en la URL. */
export const NEXT_PARAM = "siguiente";

/** A dónde se va cuando no hay ruta, o la que vino no vale: el Resumen. */
export const DEFAULT_NEXT_PATH = "/pasarelas";

const LOGIN_PATH = "/login";
const VERIFY_PATH = "/login/verificar";

/** Un origen que no existe, solo para resolver la ruta y comprobar que no sale de él. */
const PROBE_ORIGIN = "http://interno.invalid";

/** Barra invertida (los navegadores la leen como «/») y caracteres de control (los descartan al leer una URL). */
const UNSAFE_CHARS = /[\\\u0000-\u001f\u007f]/;

/**
 * Devuelve `value` si es una ruta interna (`/algo`, con su consulta y su ancla) y, si no, el Resumen.
 * Nunca devuelve `//host`, `http:…` ni nada que el navegador pueda leer como otro sitio; tampoco la propia
 * entrada (`/login…`), que sería un ir y venir.
 */
export function safeNextPath(value: unknown): string {
  if (typeof value !== "string") return DEFAULT_NEXT_PATH;
  if (!value.startsWith("/") || value.startsWith("//") || UNSAFE_CHARS.test(value)) return DEFAULT_NEXT_PATH;

  const url = new URL(value, PROBE_ORIGIN);
  if (url.origin !== PROBE_ORIGIN) return DEFAULT_NEXT_PATH;
  if (url.pathname === LOGIN_PATH || url.pathname.startsWith(`${LOGIN_PATH}/`)) return DEFAULT_NEXT_PATH;
  return `${url.pathname}${url.search}${url.hash}`;
}

function withNext(path: string, next: unknown): string {
  const safe = safeNextPath(next);
  return safe === DEFAULT_NEXT_PATH ? path : `${path}?${NEXT_PARAM}=${encodeURIComponent(safe)}`;
}

/** La entrada, recordando a dónde se vuelve después (si no es el Resumen, que es a donde se va de todos modos). */
export function loginPath(next?: unknown): string {
  return withNext(LOGIN_PATH, next);
}

/** La pantalla del código del segundo factor, recordando a dónde se vuelve después. */
export function verifyPath(next?: unknown): string {
  return withNext(VERIFY_PATH, next);
}
