# Pasarelas — guía para quien escriba código aquí (personas y agentes)

Libro **privado** de cobros, comisiones, depósitos y repartos. Proyecto autónomo dentro del repo
`gestor-propiedades`: todo lo de Pasarelas vive en esta carpeta y no comparte código con el gestor de la raíz.

Qué es y por qué: [`docs/PASARELAS.md`](docs/PASARELAS.md). Diseño: `docs/superpowers/specs/`. Plan: `docs/superpowers/plans/`.

## Reglas que no se negocian

1. **El dinero nunca pasa por `number`.** Montos y porcentajes son cadenas (`"90.30"`, `"2.9"`); la aritmética se hace
   solo con `D` de `src/lib/pasarelas/decimal.ts` (decimal.js, mitad hacia arriba); cada línea se redondea a centavos
   **antes** de sumar. Nunca se suman monedas distintas.
2. **La base manda.** Cada tabla `pay_*` tiene RLS (`user_id = auth.uid()`) y una política restrictiva de segundo
   factor (`private.pay_mfa_ok()`). Los cuadres (neto, reparto que suma su base, esquema ≤ 100 %) son restricciones y
   disparadores: no los rodees desde la app.
3. **Lo calculado se congela** en `pay_transactions.breakdown` con las reglas usadas adentro. Cambiar tarifas o
   esquemas no reescribe cobros viejos.
4. **Sin datos reales** en código, pruebas, semilla ni capturas: «Tienda Demo», «Escuela Demo», «Grupo A»,
   `@example.com`. El repo es público.
5. **Sin secretos.** La app solo lee `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
   `SUPABASE_SECRET_KEY` existe solo para pruebas y semilla contra el stack **local**.
6. Nunca se guardan números de tarjeta, CVV, cuentas completas, contraseñas ni datos de compradores.
7. Interfaz **en español**, **celular primero** (390 px), objetivos táctiles ≥ 44 px, contraste AA. Dinero con coma
   decimal (`$1.234,56`) usando `formatMoney`, no `Intl`. Fechas en `America/New_York`.
8. Migraciones **solo aditivas**, con nombre en español, y todo objeto de la base con prefijo `pay_`.

## Comandos (desde `pasarelas/`)

```bash
npm ci                 # con npm 10 puede fallar («edgesOut»): usa `npx npm@11 ci`
npm run db:start       # Supabase local con Docker; escribe .env.local
npm run dev            # http://localhost:3000
npm run typecheck      # next typegen && tsc --noEmit   (tsc a secas falla en un clon limpio)
npm run lint           # eslint (no existe `next lint`)
npm test               # Vitest: pruebas puras junto al código
npm run coverage       # exige 100 % en src/lib/pasarelas
npm run test:int       # Vitest contra el Supabase local (tests/integration)
npm run test:e2e       # Playwright (compila y arranca en el puerto 3100) — pásale `--trace off`
npm run db:types       # regenera src/lib/supabase/database.types.ts
npm run db:reset       # BORRA la base local y vuelve a aplicar las migraciones
```

El stack local es **uno solo y compartido**: si hay más gente o agentes trabajando, no hagas `db:reset`; crea tus
propios usuarios de prueba (cada usuario solo ve lo suyo). Para tu propio servidor usa otro puerto:
`npx next dev -p 3110` y `E2E_BASE_URL=http://127.0.0.1:3110 npm run test:e2e -- --trace off e2e/<archivo>`.
Dos `next dev` no arrancan en la misma carpeta.

## Next 16.4: lo que NO es como lo recuerdas

La fuente de verdad es `node_modules/next/dist/docs/` y los tipos instalados, no la memoria.

- `middleware.ts` ya no: es **`src/proxy.ts`** con `export function proxy`. Corre en Node; no admite `runtime`.
- `params`, `searchParams`, `cookies()` y `headers()` son **solo asíncronos** (`await`).
- Tipos globales `PageProps<'/ruta'>` y `LayoutProps<'/ruta'>` (la URL sin grupos); los genera `next typegen`.
- `error.tsx` recibe `{ error: unknown; retry; reset }` y es `'use client'`.
- Tras mutar en una Server Action hay que llamar `revalidatePath('<ruta>')` (o `refresh()` si solo cambia la pantalla
  actual): si no, la pantalla queda vieja. `revalidateTag('x')` con un solo argumento no compila.
- Una Server Action es un **endpoint POST público**: verifica la sesión y valida con Zod dentro de cada una.
- **`cacheComponents` va apagado a propósito** (el arranque oficial lo enciende): todo es privado y por usuario, y cada
  página lee la sesión, así que es dinámica. No uses `force-cache`, `unstable_cache`, `'use cache'` ni variables de
  módulo con datos de usuario. En la tabla de `next build`, todo lo privado debe salir `ƒ (Dynamic)`.
- `redirect()` y `notFound()` **lanzan**: nunca dentro de `try`.
- Lint: `react-hooks` 7 trata como **error** un `setState` síncrono dentro de `useEffect`.
- React 19 vacía los campos no controlados al terminar la acción de un `<form>`: devuelve los valores en el estado.
- Comprobantes con URL firmada: `<img>` normal (o `<Image unoptimized>`), nunca `next/image` optimizado.
- Tailwind 4 entra por el cargador `@tailwindcss/turbopack` (ver `next.config.ts`); no hay `postcss.config`.
- Zod 4: `{ error: '…' }` y `z.flattenError(resultado.error).fieldErrors`.

## Supabase: trampas comprobadas

- En el servidor **no** uses `getSession()` ni `mfa.getAuthenticatorAssuranceLevel()` para autorizar (leen la cookie
  sin verificarla). Usa `getClaims()` (verifica la firma; trae `sub`, `email`, `aal`) y, para saber si hay factor,
  `mfa.listFactors()`.
- En `proxy.ts` no existe `response.cookies.setAll`: copia las cookies una a una.
- El rol `authenticated` no puede leer `auth.mfa_factors`: por eso `private.pay_mfa_ok()` es `security definer`.
- PostgREST devuelve `numeric` como número JSON: **lee el dinero con `::text`**
  (`select('id, gross_amount::text')`) y escríbelo como cadena. Usa las listas de columnas de `dto.ts`.
- Las agregaciones de la API están apagadas: se suma con decimal.js o con las vistas `pay_*_totals`.
- Tope de 1000 filas por petición: para totales, pagina (`leanTx`).
- Storage: `delete from storage.objects` está bloqueado; se borra por API (`list` + `remove`) y **antes** de borrar la
  fila. `remove()` sobre rutas sin permiso devuelve `[]` sin error: comprueba cuántas borró. El tipo MIME se valida
  contra lo declarado, no contra el contenido: valida también en la app.
- CLI 3: todo es local por defecto; lo remoto se pide con `--remote`. Nada en este repo usa `--remote`.
- Los permisos (`grant`) van explícitos en la migración: no se depende de los que el proyecto dé por defecto.

## Dónde va cada cosa

| Carpeta | Qué hay |
|---|---|
| `src/lib/pasarelas/` | **El motor**: funciones puras (sin red, sin reloj, sin base) y sus pruebas al lado. `types.ts` es el contrato |
| `src/lib/supabase/`, `src/lib/auth/` | Clientes de Supabase (navegador, servidor, proxy), tipos generados y la sesión verificada |
| `src/server/pasarelas/queries/` | Lecturas, solo servidor (`import 'server-only'`). Devuelven DTO, nunca filas crudas |
| `src/server/pasarelas/ops/` | Escrituras con el cliente inyectado: se prueban sin Next (`tests/integration`) |
| `src/server/pasarelas/actions/` | Server Actions delgadas: sesión + Zod + `ops` + `revalidatePath` |
| `src/components/ui/` | Kit propio de interfaz. `src/components/pasarelas/` son las piezas del dominio |
| `src/app/(auth)/`, `src/app/(dashboard)/` | Entrada y pantallas; todas las del módulo bajo `/pasarelas` |
| `supabase/migrations/` | El esquema. `supabase/config.toml` es el stack local |
| `tests/integration/`, `e2e/` | Pruebas contra el Supabase local y de punta a punta (390×844 y 1280×800, con axe) |

## Pruebas

- Motor: pruebas puras junto al código, con los casos exactos del spec (E1–E6, F1–F3). Cobertura 100 %.
- En Vitest, `server-only` está simulado (`vitest.setup.ts`). `cookies()` y `headers()` no existen fuera de una
  petición: lo que las use se prueba de punta a punta.
- Integración: dos usuarios reales del stack local; cada prueba crea los suyos y no depende de datos de otra.
- Punta a punta: contra `next build && next start`. La salida de las pruebas debe quedar limpia, sin avisos.

## Commits

Pequeños, en español, que digan qué cambia y por qué. Nada de `.env*` (salvo `.env.example`), ni datos reales, ni
nombres de modelos de IA en mensajes, comentarios o documentos.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
