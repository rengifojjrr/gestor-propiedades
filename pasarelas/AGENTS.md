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
9. **Quién paga la comisión** (`fees_paid_by`). Lo que pagaron los compradores sale solo de `buyerFeesOf(breakdown)`,
   que se guarda en `pay_transactions.buyer_fees` junto a `fees_total`. Cuenta solo las líneas pasarela, opción y
   plataforma, y nunca el costo del reembolso ni el de la disputa, que son del negocio.
   - Lo facturado es `gross − buyerFees` y las comisiones del negocio, `fees − buyerFees`.
   - En las vistas, `gross` y `fees` conservan su significado de siempre.
   - No inventes otra regla en un componente: llama a esa función.
10. **Partes que no pagan comisión** (`pay_scheme_lines.fee_exempt`, congelada en `rules.scheme.lines[].feeExempt`).
    La cuenta vive solo en el motor: `allocation` y `sparedAmounts` de `breakdown.ts`. Las marcas las pone `rules.ts`
    (las del esquema, o las de ese cobro con `feeExemptIds`) y `feeExemptIdsOf` las lee.
    - Solo aplica con la comisión a cargo de nosotros y el reparto sobre el neto. Si no, la marca no cambia nada.
    - La parte exenta recibe su parte del bruto vigente (`allocate`); las demás se reparten neto − exentas en
      proporción a sus porcentajes (`allocateInProportion`). Las dos, por mayor resto (`allocate.ts`).
    - Si nadie queda pagando (`someonePaysFees` de `schemes.ts`), lanza `PayRuleError("nadie_paga_comision")`. La
      base no lo comprueba.
    - En `pay_allocations`, la fila exenta va con `base = 'bruto'` (`allocationsOf` de `write.ts`). No repitas la
      cuenta en un componente.
11. **La retención de la pasarela** (`pay_gateways.retention_pct`, `retention_days` y
    `pay_gateway_retention_recipients`). Se congela en `rules.gateway.retention`: la pone `rules.ts` con la
    configuración vigente, solo si retiene más de 0 %. La cuenta vive solo en el motor: `retentionOf`, `payoutOf` y
    `retentionReleaseOn` de `breakdown.ts`.
    - No es una comisión: no cambia el neto, las comisiones, `buyerFees` ni el reparto. Lo que llega al banco es
      neto − retenido (`payoutOf`; en las filas, `net − retention`). «Por caer» y «Depositado» en pantalla son
      `pendingPayout` y `depositedPayout`, no `*Net`.
    - Un cobro guardado usa la congelada, no la de la configuración. Editar la conserva (también la fecha y el
      monto); solo cambiar de pasarela y «Recalcular» traen la vigente (`reResolve`, `recalc`). Sin la clave, no
      retiene.
    - `retention_amount` se escribe en cada camino que escribe `fees_total`, vía `derived()` de `write.ts`: alta e
      importación, edición, reembolso, disputa, fallido, reabrir y recalcular. Un camino nuevo pasa por ahí.
    - Las partes (`retentionSharesOf`, a `pay_retention_shares` por `retention_shares`) van y vuelven con el reparto:
      se reescriben si y solo si cambia el desglose. Suman exactamente lo retenido (`allocate`, por mayor resto); la
      base lo exige al confirmar (`pay_retention_sum_mismatch`). `null` = no tocarlas; `[]` = borrarlas.
    - `pay_beneficiary_balances.balance` ya descuenta `retained`. No lo vuelvas a restar en una pantalla.

## Comandos (desde `pasarelas/`)

```bash
npm ci                 # instala lo del lockfile; funciona con npm 10 y con npm 11
npm run db:start       # Supabase local con Docker; escribe .env.local solo si falta o si le falta la clave
npm run db:env         # vuelve a escribir en .env.local la URL y las claves del stack (conserva lo demás)
npm run db:status      # estado del stack local
npm run seed           # usuario demo@example.com + libro de ejemplo en el stack local; imprime la contraseña
npm run dev            # http://localhost:3000
npm run typecheck      # next typegen && tsc --noEmit   (tsc a secas falla en un clon limpio)
npm run lint           # eslint (no existe `next lint`)
npm test               # Vitest: pruebas puras junto al código
npm run coverage       # exige 100 % en src/lib/pasarelas
npm run test:int       # Vitest contra el Supabase local (tests/integration)
npm run test:e2e       # Playwright (compila y arranca en el puerto 3100, o en E2E_PORT; trace ya va apagado)
npm run db:types       # regenera src/lib/supabase/database.types.ts
npm run db:reset       # BORRA la base local y vuelve a aplicar las migraciones
npm run db:stop        # detiene el stack local (para TODOS los que lo estén usando)
```

Para **agregar o cambiar dependencias** con npm 10 usa `npx npm@11 install <paquete>`: lo que puede fallar con
npm 10 («edgesOut») es `npm install` cuando tiene que resolver el árbol, no `npm ci`.

La semilla (`scripts/seed-pasarelas-demo.ts`, datos en `scripts/demo-data.ts`) solo siembra sobre un libro vacío;
`npm run seed -- --reset` borra antes todo lo de `demo@example.com`. Cada corrida le pone una contraseña nueva. Se
niega a correr fuera del stack local salvo con `SEED_ALLOW_REMOTE=1`, y ahí entra con `SEED_EMAIL` y
`SEED_PASSWORD` (nunca con la clave secreta) y no admite `--reset`.

El stack local es **uno solo y compartido**: si hay más gente o agentes trabajando, no hagas `db:reset` **ni
`db:stop`**; crea tus propios usuarios de prueba (cada usuario solo ve lo suyo). Para tu propio servidor usa otro
puerto. Punta a punta, de dos maneras:

- **Modo producción** (compila y arranca su propio servidor con `next build && next start`):
  `E2E_PORT=31xx npm run test:e2e -- e2e/<archivo>`. No reutiliza un servidor ajeno: si el puerto está ocupado,
  falla. **Una corrida por carpeta**: dos a la vez en la misma copia de trabajo compilan en el mismo `.next` y se
  rompen entre sí. Para correr en paralelo, cada una en su propio worktree.
- **Desarrollo** (contra un servidor que ya tienes corriendo): `npx next dev -p 31xx` y
  `E2E_BASE_URL=http://127.0.0.1:31xx npm run test:e2e -- e2e/<archivo>`.
  Dos `next dev` no arrancan en la misma carpeta.

Desde otro dispositivo de la red local (`http://<IP>:3000`) el navegador no da `crypto.randomUUID` (no es un
contexto seguro), y lo usan registrar un cobro, subir comprobantes o logos, agregar opciones al crear una pasarela,
agregar líneas a un esquema y registrar liquidaciones: arranca con `npx next dev --experimental-https -H <IP>`. A
propósito no se programó una alternativa a `crypto.randomUUID`: para probar desde el celular se usa https.

## Next 16.4: lo que NO es como lo recuerdas

La fuente de verdad es `node_modules/next/dist/docs/` y los tipos instalados, no la memoria.

- `middleware.ts` ya no: es **`src/proxy.ts`** con `export function proxy`. Corre en Node; no admite `runtime`.
- `params`, `searchParams`, `cookies()` y `headers()` son **solo asíncronos** (`await`).
- Tipos globales `PageProps<'/ruta'>` y `LayoutProps<'/ruta'>` (la URL sin grupos); los genera `next typegen`.
- `error.tsx` recibe `{ error: unknown; retry; reset }` y es `'use client'`.
- Tras mutar en una Server Action hay que llamar `revalidatePath('<ruta>')` (o `refresh()` si solo cambia la pantalla
  actual): si no, la pantalla queda vieja. `revalidateTag('x')` con un solo argumento no compila.
- Dentro de un mismo render, Next **memoiza los `fetch` GET iguales** (misma URL y cabeceras), y el cliente de
  Supabase lee con `fetch`. Si escribes y vuelves a leer lo mismo en el mismo render, la segunda lectura devuelve la
  respuesta de antes de escribir. Usa lo que devolvió la escritura (así lo hace `getPayConfig` con `seedHolidays`).
- Una Server Action es un **endpoint POST público**: verifica la sesión y valida con Zod dentro de cada una.
- **`cacheComponents` va apagado a propósito** (el arranque oficial lo enciende): todo es privado y por usuario, y cada
  página lee la sesión, así que es dinámica. No uses `force-cache`, `unstable_cache`, `'use cache'` ni variables de
  módulo con datos de usuario. En la tabla de `next build`, todo lo privado debe salir `ƒ (Dynamic)`.
- `redirect()` y `notFound()` **lanzan**: nunca dentro de `try`.
- Lint: `react-hooks` 7 trata como **error** un `setState` síncrono dentro de `useEffect`.
- Al terminar la acción de un `<form action>` (bien o con error), React 19 lo reinicia con `form.reset()`: cada
  control vuelve a su valor por defecto del DOM. Los no controlados se vacían (devuelve los valores en el estado). Un
  texto controlado sobrevive (React le mantiene el `defaultValue`), pero un `<select>`, una casilla o un interruptor
  controlados volverían a lo que trajo el HTML del servidor (o a la primera opción, sin marcar) aunque el estado diga
  otra cosa. `Select`, `Checkbox` y `Switch` del kit mantienen `defaultSelected` / `defaultChecked` iguales al valor
  controlado, así que el reinicio no cambia nada en pantalla: dentro de un `<form action>` usa esos, no los nativos.
  Y mientras la acción corre, `Input`, `Textarea`, `MoneyInput` y `PctInput` del kit son de solo lectura
  (`useFormStatus`). Así nadie escribe algo que el reinicio, al terminar, cambiaría por lo enviado.
- Comprobantes con URL firmada: `<img>` normal (o `<Image unoptimized>`), nunca `next/image` optimizado.
- Tailwind 4 entra por el cargador `@tailwindcss/turbopack` (ver `next.config.ts`); no hay `postcss.config`.
- Zod 4: `{ error: '…' }` y `z.flattenError(resultado.error).fieldErrors`.

## Supabase: trampas comprobadas

- En el servidor **no** uses `getSession()` ni `mfa.getAuthenticatorAssuranceLevel()` para autorizar (leen la cookie
  sin verificarla). Usa `getClaims()` (verifica la firma; trae `sub`, `email`, `aal`) y, para saber si hay factor,
  `mfa.listFactors()`.
- En `proxy.ts` no existe `response.cookies.setAll`: copia las cookies una a una.
- El rol `authenticated` no puede leer `auth.mfa_factors` ni `auth.sessions`: por eso `private.pay_mfa_ok()` es
  `security definer` y vive en `private`, un esquema que la Data API no expone (en `public` se podría llamar por
  `/rest/v1/rpc`).
- PostgREST devuelve `numeric` como número JSON: **lee el dinero con `::text`**
  (`select('id, gross_amount::text')`) y escríbelo como cadena. Usa las listas de columnas de `dto.ts`.
- **`Database` se importa de `@/lib/supabase/types`**, no de `database.types.ts` (el generado, que no se edita):
  es el mismo tipo, pero al escribir las columnas de dinero y de porcentaje son `string` y rechazan `number`.
- Borrar un usuario (panel o `auth.admin.deleteUser`) corre los disparadores de la cascada con el rol del servicio
  de Auth, que no tiene permisos sobre `pay_*` ni sobre `private`: un disparador que lea o escriba tablas va con
  `security definer` y `search_path` vacío. La cascada no borra los archivos de Storage.
- Las agregaciones de la API están apagadas: se suma con decimal.js o con las vistas `pay_*_totals`.
- Tope de 1000 filas por petición: para totales, pagina (`leanTx`).
- Storage: `delete from storage.objects` está bloqueado; se borra por API (`list` + `remove`) y **antes** de borrar la
  fila. `remove()` sobre rutas sin permiso devuelve `[]` sin error: comprueba cuántas borró. El tipo MIME se valida
  contra lo declarado, no contra el contenido: valida también en la app.
- CLI 3: todo es local por defecto; lo remoto se pide con `--remote` (o `--remote=<cadena>`; `--db-url` está
  obsoleto). Ningún guion ni prueba usa `--remote`: solo el paso a paso de producción del README, a mano.
- Comprobantes: **no se guarda el nombre original del archivo** (puede traer el nombre de un comprador). La columna
  no existe; el archivo se guarda como `<usuario>/<cobro>/<uuid>.<ext>` y en pantalla se nombra por tipo, fecha y
  tamaño (`receiptLabel` y `receiptSize` de `components/pasarelas/receipts/label.ts`). El tipo y el tamaño que se
  guardan son los que dice Storage (`storedFile` de `ops/receipts.ts`), no los que declara el navegador. No lo
  vuelvas a agregar, ni en la exportación.
- Los permisos (`grant`) van explícitos en la migración: no se depende de los que el proyecto dé por defecto.

## Sesión

- Cada página, cada Route Handler y cada Server Action pasa por `await requireSession()` (`@/lib/auth/session`):
  directo, o a través de `runAction`. Se libran solo `/login` (sus páginas y sus acciones), la raíz (que solo
  redirige) y la galería `/kit` (sin datos; su banco `/kit/acciones` sí lo llama). Sin sesión manda a
  `/login`; con segundo factor y sin el código (aal1), a `/login/verificar`. El proxy (`src/proxy.ts`) solo refresca
  la cookie, manda a `/login` a quien no tiene sesión y saca de `/login` a quien ya la tiene (a `siguiente`, o al
  Resumen); el layout solo pinta el aviso del segundo factor. Ninguno de los dos protege una pantalla ni una acción.
- `siguiente` (a dónde se vuelve tras entrar) viene de la URL: pásalo siempre por `safeNextPath`
  (`@/lib/auth/next-path`).
- `getClaims()` no nota una sesión cerrada desde otro dispositivo hasta que el token caduca (1 h); `mfa.listFactors()`
  sí, porque pregunta a Auth. **La base sí lo nota al instante**: `private.pay_mfa_ok()` exige además que la sesión
  del token (`session_id` del JWT) siga en `auth.sessions`, y Auth borra esa fila al cerrar la sesión (en ese
  dispositivo o en todos) y al cambiar la contraseña (todas menos la propia). Desde ese momento la RLS no le da ni
  una fila ni le deja escribir, también por la API directa y en el bucket `comprobantes`, aunque `requireSession()`
  todavía deje abrir la pantalla. No hace falta otra comprobación en la app (lo prueba `tests/integration/sesiones.test.ts`).
- Tras `mfa.unenroll()` el token sigue en aal2 hasta `refreshSession()`; renovado baja a aal1 si no queda ningún
  factor **o** si el que se quitó era el que usó esa sesión, aunque queden otros.
- Cambiar `supabase/config.toml` no tiene efecto hasta reiniciar el stack (`db:stop` y `db:start`). Sin
  `require_current_password`, Auth **ignora** la contraseña actual al cambiarla: por eso `changePassword` la comprueba
  en la app (entra con ella en un cliente aparte, sin cookies ni sesión guardada) antes de cambiar nada.
- Punta a punta: `newUser()`, `login()` y `loginWithTotp()` de `e2e/helpers.ts` (usuarios reales del stack local,
  entrando por la pantalla). Para preparar datos sin pasar por la pantalla, `e2e/server-data.ts`: `serverData()` da
  las `ops` y `queries` de cobros (`createTx`, `getSnapshots`, `trashTx`…) y `demoData()` la semilla
  (`seedDemo`), con el cliente del propio usuario de prueba (`signInAal1` de `tests/integration/helpers.ts`), así que
  valen las mismas restricciones que en la app. Cargan esos módulos con `require` y `server-only` vacío: no los
  importes directo desde un spec.

## Acciones desde el navegador

- Las Server Actions del módulo (`src/server/pasarelas/actions/`) se arman con `runAction(schema, input, fn, opts)`
  (`src/server/pasarelas/action.ts`): sesión, Zod, el cliente con la RLS, errores en español (`errors.ts`) y
  `revalidatePath`. Devuelve `ActionResult` (`{ ok: true, data }` o `{ ok: false, error, fieldErrors? }`); no lanza
  salvo las redirecciones de Next. Sin `opts.revalidate` revalida todo `/pasarelas`; una acción que solo lee pasa
  `{ revalidate: [] }`. Las de Ajustes → Seguridad (`src/app/(dashboard)/ajustes/actions.ts`) y las de `/login` van
  aparte, con sus propios tipos de resultado.
- **Ninguna llamada a una Server Action desde el navegador queda sin proteger.** Si la llamada no llega o la
  respuesta no vuelve (un corte de red), la promesa rechaza y, sin protección, el error sube a `error.tsx` (o a
  `global-error.tsx` en la entrada): se desmonta la pantalla y se pierde lo escrito. Hay tres formas:
  - `callAction(() => accion(…))` (`components/pasarelas/callAction.ts`) para las que devuelven el `ActionResult` del
    módulo: con un corte no lanza y devuelve un error con `unsure: true` («no se sabe si se guardó»).
  - `callActionOr(() => accion(…), () => loQueSeDice)` para las que traen su propio tipo de resultado. Lo que se
    dice depende de si repetir es seguro:
    - `RETRY_TEXT` en la entrada, el código y al empezar a activar un dispositivo.
    - `UNSURE_TEXT`, con «Ver cómo quedó», al confirmar o quitar un dispositivo y al cerrar sesión
      (`src/app/(auth)/login/SignOutForm.tsx`).
    - Un texto propio al cambiar la contraseña, que explica cómo saber si cambió.

    Por eso la entrada ya no funciona con JavaScript apagado. React repite el envío que se hizo antes de hidratar.
  - Un `try/catch` propio, con su propio texto: los formularios y diálogos de `companies/` (logo incluido,
    `useActionForm`), el importador, `registrar/RegisterForm.tsx`, `splits/SchemeEditor.tsx`,
    `splits/SettlementForm.tsx` y `receipts/upload.ts`.

  Las dos primeras dejan pasar las redirecciones de Next (`unstable_rethrow`). Un `try/catch` alrededor de una
  acción que redirige también tiene que dejarlas pasar, como `companies/CompanyCard.tsx` con `deleteCompany`.
- El error se pinta con `<ActionError failure={failureOf(result)} />` (`components/pasarelas/ActionError.tsx`); dentro
  de un diálogo, `<DialogActionError>`. Con `unsure` ofrece «Ver cómo quedó», que hace `router.refresh()`.
  `callAction` **no refresca solo**: con mala señal el refresco fallido recargaría la página entera. Al cerrar un
  diálogo con esa duda en pantalla, se refresca (`useRefreshOnClose`).
- Lo que no es idempotente (reembolso, liquidación, alta de un cobro) lleva un id creado en el navegador o la
  versión vista (`expectedUpdatedAt`): repetirlo tras la duda no duplica dinero ni pisa cambios de otra pestaña.

## Dónde va cada cosa

| Carpeta | Qué hay |
|---|---|
| `src/lib/pasarelas/` | **El motor**: funciones puras (sin red, sin reloj, sin base) y sus pruebas al lado. `types.ts` es el contrato |
| `src/lib/supabase/`, `src/lib/auth/` | Clientes de Supabase (navegador, servidor, proxy), tipos generados y la sesión verificada |
| `src/server/pasarelas/queries/` | Lecturas, solo servidor (`import 'server-only'`). Devuelven DTO, nunca filas crudas |
| `src/server/pasarelas/ops/` | Escrituras con el cliente inyectado: se prueban sin Next (`tests/integration`) |
| `src/server/pasarelas/actions/` | Server Actions delgadas: `runAction` (sesión + Zod + `ops` + `revalidatePath`) |
| `src/server/pasarelas/queries/paging.ts` | `readAll(page, what)`: leer por tramos de 1000 filas sin cortar en silencio |
| `src/components/ui/` | Kit propio de interfaz. `src/components/pasarelas/` son las piezas del dominio (con `callAction` y `ActionError`) |
| `src/app/(auth)/`, `src/app/(dashboard)/` | Entrada y pantallas: las del módulo bajo `/pasarelas`, más `/ajustes` y la galería `/kit` (solo en desarrollo) |
| `supabase/migrations/` | El esquema. `supabase/config.toml` es el stack local |
| `scripts/` | `stack.sh` (los `db:*`), la semilla (`seed-pasarelas-demo.ts` + `demo-data.ts`), `capturas.ts` e íconos |
| `tests/integration/`, `e2e/` | Pruebas contra el Supabase local y de punta a punta (390×844 y 1280×800, con axe) |

## Pruebas

- Motor: pruebas puras junto al código, con los casos exactos del spec (E1–E6, F1–F3) y los de la guía (E7–E10). Cobertura 100 %.
- En Vitest, `server-only` está simulado (`vitest.setup.ts`). `cookies()` y `headers()` no existen fuera de una
  petición: lo que las use se prueba de punta a punta.
- Integración: dos usuarios reales del stack local; cada prueba crea los suyos y no depende de datos de otra.
- Punta a punta: contra `next build && next start`. La salida de las pruebas debe quedar limpia, sin avisos.

## Kit de interfaz

- Las pantallas se arman con `@/components/ui` y `@/components/shell`. La galería `/kit` muestra cada componente con
  sus props: existe con `next dev`; en producción da 404 salvo que se compile **y** se arranque con `PASARELAS_KIT=1`
  (`PASARELAS_KIT=1 npm run build && PASARELAS_KIT=1 npx next start -p 3110`; sin ella `next build` deja el 404 fijo).
  No es un secreto y no va en Vercel. `npm run test:e2e` compila **todo** con `PASARELAS_KIT=1` (para
  `e2e/kit.spec.ts`): ninguna prueba comprueba el 404 de `/kit` en el build que se entrega.
- **Los colores por defecto de Tailwind están apagados**: `bg-white` o `text-gray-500` no hacen nada. Usa los tokens de
  `src/app/globals.css` (`bg-surface`, `text-ink-soft`, `border-rule`…), que ya traen su par para el modo oscuro.
- Dinero y porcentajes se pintan con `<Money value currency />` y `<Percent value />`, que llaman a `formatMoney` y
  `formatPct`; las fechas, con `<DateText value />` y `<DateTimeText value />`, que llaman a `formatDate` y
  `formatDateTime` (hora de Nueva York). No se formatea a mano en una pantalla. Los cuatro **lanzan** con un valor
  que no sea válido: si puede venir `null` (un depósito sin fecha), la pantalla decide qué pintar antes de llamarlos.
- `<Alert>` no interrumpe al lector de pantalla por defecto (`role="status"`). El error general de un formulario, que
  aparece como respuesta a lo que la persona acaba de hacer, se pinta con `<Alert tone="danger" announce>`
  (`role="alert"`). El error de un campo va en `error` de su `<Field>`, que lo enlaza al control.
- `<Field>` lleva **un solo control** como hijo directo; si ese control trae su propio `id`, la etiqueta apunta a él.
- axe se pasa con `expectNoSeriousAxe` de `e2e/axe.ts` (concilia los tipos de las dos versiones de `playwright-core`
  del lockfile). Si hace falta desde otro archivo de ayuda, se reexporta de ahí: no se duplica.
- Si la pantalla pudo enseñar un aviso pasajero, antes de axe va `await waitForStillToasts(page)` de `e2e/avisos.ts`.
  Un aviso a medio entrar o a medio irse es translúcido y axe lo mide como falta de contraste. No copies la espera
  en un spec: llama al ayudante.

## Commits

Pequeños, en español, que digan qué cambia y por qué. Nada de `.env*` (salvo `.env.example`), ni datos reales, ni
nombres o versiones de modelos de IA en mensajes, comentarios o documentos. Los pies de commit
`Co-Authored-By: Claude <noreply@anthropic.com>` y `Claude-Session: <enlace>` sí son válidos: lo prohibido es
nombrar el modelo o su versión.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
