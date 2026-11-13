# Pasarelas — Plan de implementación

> **Para quien ejecute (agentes):** SUB-HABILIDAD REQUERIDA: `superpowers:subagent-driven-development`
> (recomendada) o `superpowers:executing-plans`, tarea por tarea. Los pasos usan casillas (`- [ ]`).

**Objetivo:** una app autónoma en `pasarelas/` que registra cobros, calcula comisiones, reparte lo neto, estima
depósitos y lo resume, con todo cuadrado al centavo y privado por usuario.

**Arquitectura:** Next 16 (App Router) + Supabase. El cálculo vive en un motor de funciones puras
(`src/lib/pasarelas/`); la base hace cumplir los cuadres y la privacidad (RLS + segundo factor); las pantallas son
Server Components que leen por `queries/` y escriben por Server Actions delgadas sobre `ops/`.

**Stack:** Next 16.4.6 · React 19.3 · TypeScript 5.9 · Tailwind 4.3 · Supabase (`supabase-js` 2.119, `@supabase/ssr`
0.12, CLI 3.1 con Docker) · decimal.js 10.6 · Luxon 3.7 · Zod 4.6 · Recharts 3.10 · papaparse 5.7 · sonner 2 ·
lucide-react · Vitest · Playwright 1.63 + axe.

**Spec:** `pasarelas/docs/superpowers/specs/2026-11-09-pasarelas-design.md` (léelo entero antes de tu tarea).

**Ejecución elegida:** por subagentes (un agente por tarea, revisión independiente y una revisión adversarial final).
El dueño pidió construir «de corrido», sin parar a aprobar este plan.

## Restricciones globales

- Todo el trabajo va **dentro de `pasarelas/`**. No se toca el gestor de la raíz salvo lo que dice la tarea 1.
- Lee `pasarelas/AGENTS.md` antes de escribir código: Next 16.4 **no** es el que conoces. La fuente de verdad son
  `node_modules/next/dist/docs/` y los tipos instalados, no la memoria.
- **El dinero nunca pasa por `number`**: `Money`/`Pct` son cadenas; aritmética solo con `D` de `decimal.ts`; cada
  línea se redondea a centavos con `ROUND_HALF_UP` antes de sumar. Nunca se suman monedas distintas.
- Montos `numeric(14,2)`, porcentajes `numeric(7,4)`, monedas `char(3)`; fechas en `America/New_York`.
- Interfaz **en español**, **celular primero** (390 px), objetivos táctiles ≥ 44 px, contraste AA, sin violaciones
  serias ni críticas de axe. Formato de dinero con coma decimal: `$1.234,56`.
- **Sin datos reales** en código, pruebas, semilla ni capturas: «Tienda Demo», «Escuela Demo», «Grupo A»,
  correos `@example.com`.
- **Sin secretos**: la app solo usa `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. La clave
  secreta local solo en pruebas y semilla, leída de variables de entorno.
- Todo objeto de la base lleva prefijo `pay_`. Migraciones **solo aditivas**, con nombre en español.
- No se guardan números de tarjeta, CVV, cuentas completas ni datos de compradores.
- Cada tarea se ejecuta **en su propio worktree** de git y confirma ahí su trabajo, con commits pequeños y mensajes
  en español (sin nombrar modelos de IA). El stack local de Supabase es **compartido**: no hagas `db:reset` (salvo la
  tarea 2), crea tus propios usuarios de prueba y usa tu propio puerto (`3100 + número de tarea`).
- Verificación de cada tarea, desde `pasarelas/`: `npm run typecheck`, `npm run lint`, `npm test`, y lo que la tarea
  indique (`npm run test:int`, `npm run test:e2e -- <archivo>`).
- **Pantallas (tareas 10 a 19):**
  - Server Components que llaman a `requireSession()` (de `@/lib/auth/session`) y leen por `queries/` con el
    cliente de `@/lib/supabase/server`; la configuración, con `getPayConfig()`. Filtros en `searchParams`;
    `loading.tsx` y `error.tsx` por ruta; vacíos con `EmptyState`; avisos pasajeros con `notify`.
  - Las mutaciones van por Server Actions hechas con `runAction` (sesión + Zod + `ops` + revalidar). Las `ops`
    reciben el cliente y tienen pruebas de integración. Cada dominio en sus propios archivos:
    `src/server/pasarelas/{ops,actions,queries}/<dominio>.ts`.
  - Formularios con `Field` (un solo control por campo) y errores por campo; el error general que aparece tras
    una acción va en `<Alert tone="danger" announce>`. React 19 vacía los campos no controlados al terminar la
    acción de un `<form>`: devuelve los valores en el estado o usa campos controlados.
  - Solo tokens del kit (los colores de Tailwind están apagados). Dinero, porcentajes y fechas con `Money`,
    `Percent`, `DateText` y `DateTimeText`, que **lanzan** con un valor nulo: la pantalla decide antes qué pintar.
  - Archivos compartidos — `nav.ts`, `e2e/helpers.ts`, `e2e/axe.ts`, `package.json`, el kit
    (`src/components/ui/**`), el motor (`src/lib/pasarelas/**`) y `src/server/pasarelas/{action,errors,zod,dto}.ts`
    — no se editan salvo que la tarea lo diga. Si falta algo, se añade lo mínimo **al final** del archivo y se
    declara en el informe, para poder juntar los cambios de varias tareas.
  - Cada tarea deja su `e2e/<nombre>.spec.ts`: entra con `newUser()` y `login()`, y en cada estado importante de
    la pantalla pasa `expectNoSeriousAxe` y `expectNoHorizontalOverflow`. Se corre contra el servidor propio
    mientras se itera y **una vez al final en modo producción**
    (`E2E_PORT=<puerto> npx playwright test --trace off e2e/<archivo>`).
  - Antes de informar, quien implementa **mira** su pantalla: capturas a 390×844 (claro y oscuro) y a 1280×800,
    guardadas fuera del repo, y revisadas: jerarquía, desborde, estados vacíos, textos cortados, lo que no se
    entiende sin explicación.

## Foco de revisión

Lo que el spec implica y es más probable que le falle a quien lo use; cada uno tiene su prueba en la tarea dueña:

1. **Doble envío o reintento al registrar** (red lenta en el celular): no puede crear dos cobros. → tarea 10.
2. **Monto pegado con formato ambiguo** (`1,234` · `1.234,5` · `$ 100` · `100,005`): se interpreta bien o se
   rechaza con mensaje; nunca se guarda otro número. → tarea 3.
3. **El comprobante falla después de guardar el cobro** (archivo de 11 MB, tipo no permitido, corte de red): el cobro
   queda guardado, se avisa y se puede reintentar; no quedan filas sin archivo. → tareas 10 y 16.
4. **Más de 1000 cobros en el período** (tope por petición de la API): los totales del filtro y el Resumen siguen
   siendo exactos. → tarea 9.
5. **Borrar o desactivar configuración que ya tiene cobros** (pasarela, canal, beneficiario, esquema): mensaje claro
   y el historial intacto. → tareas 2 y 11.

---

## Fase 0 · Cimientos

### Task 1: Arranque del proyecto

**Archivos:** crear `pasarelas/{package.json,tsconfig.json,next.config.ts,eslint.config.mjs,vitest.config.ts,
playwright.config.ts,.gitignore,.env.example,AGENTS.md,README.md}`, `supabase/config.toml`, `scripts/stack.sh`,
`src/app/{layout.tsx,globals.css,page.tsx}`, `src/lib/pasarelas/types.ts`. Modificar en la raíz:
`eslint.config.js` (ignorar `pasarelas`), `README.md` (una línea), y `src/styles/index.css` solo si hace falta.

**Produce:** scripts `dev`, `build`, `start`, `lint`, `typecheck`, `test`, `test:int`, `test:e2e`, `coverage`,
`db:start`, `db:stop`, `db:reset`, `db:types`, `db:env`, `seed`; alias `@/` → `src/`; todas las dependencias del
proyecto ya instaladas (las tareas siguientes no tocan `package.json`); `src/lib/pasarelas/types.ts` con **todos
los tipos del motor** (contrato cerrado: las tareas 3–6 no lo cambian sin avisar).

- [ ] Generar la base con `create-next-app@16.4.6` y adaptar (sin fuentes de Google en tiempo de compilación).
- [ ] `supabase/config.toml`: `enable_signup = false`, MFA TOTP `enroll_enabled = true` y `verify_enabled = true`,
      confirmación de correo apagada en local, `file_size_limit = "10MiB"`.
- [ ] `scripts/stack.sh start|stop|reset|status|env`: arranca Docker si está caído y el stack local; idempotente.
      `env` escribe `.env.local` (no versionado) con la URL y las claves del stack local en marcha.
- [ ] `AGENTS.md`: convenciones verificadas de Next 16.4, Supabase, pruebas y reglas del dinero.
- [ ] Verificar: `npm run lint && npm run typecheck && npm test && npm run build` en verde; `npm run db:start`
      responde en `http://127.0.0.1:54321`.
- [ ] Verificar el gestor: en la raíz, `npm run check && npm run build` dan lo mismo que la línea base (35 pruebas;
      la hoja de estilos principal pesa 72 651 bytes).

### Task 2: Base de datos

**Archivos:** crear `supabase/migrations/20261110120000_las_pasarelas_de_pago.sql`,
`src/lib/supabase/database.types.ts` (generado), `src/lib/supabase/types.ts`, `tests/integration/{helpers.ts,
rls.test.ts,cuadres.test.ts,funciones.test.ts,storage.test.ts,borrar-usuario.test.ts}`.

**`Database` se importa de `@/lib/supabase/types`**, nunca de `database.types.ts`: es el generado, pero al escribir
(Insert/Update) las columnas de dinero y de porcentaje son cadenas y no admiten `number`. Vale para todo
`SupabaseClient<Database>` de las tareas 8 en adelante.

**Produce:** las 17 tablas del spec §4; funciones `private.pay_mfa_ok()`, `pay_save_transactions(p_items jsonb,
p_skip_duplicates boolean) → jsonb [{id, inserted, skipped}]`, `pay_save_scheme(p jsonb) → {scheme_id, version_id,
version}`, `pay_create_gateway(p jsonb) → uuid`; vistas `pay_beneficiary_balances`, `pay_company_totals`,
`pay_gateway_totals`, `pay_bank_account_totals`; bucket `comprobantes`. Y en `tests/integration/helpers.ts`:
`adminClient()`, `createUser(): Promise<{ id, email, password, client }>`, `enrollTotp(client): Promise<{ secret,
factorId }>` (deja la sesión en aal2), `signInAal1(email, password)`, `totp(secret, timeMs?)`, `seedBasics(client):
Promise<Basics>` (empresa «Escuela Demo» con canal al 5 %, Stripe 2,9 % + 0,30 con «Pago rápido» 1,5 % sobre el
bruto y 0 días, cuenta destino, Grupos A/B/C y esquema 50/30/20 sobre el neto).

Mensajes de error de la base (los traduce la tarea 9): `pay_alloc_sum_mismatch`, `pay_scheme_over_100`,
`pay_scheme_under_100`, `pay_scheme_remainder_in_lines`, `pay_scheme_version_in_use`, `pay_tx_conflict` (40001),
`pay_tx_not_found` (P0002), `pay_scheme_not_found` (P0002: `pay_save_scheme` con un `scheme_id` que no existe o es
de otro usuario), `pay_bad_payload` (22023), `pay_no_session` (28000). El nombre repetido de una empresa o de una
pasarela da 23505 (`pay_companies_name_uq`, `pay_gateways_name_uq`); beneficiarios y esquemas admiten nombres
repetidos.

- [ ] **Pruebas primero** (`npm run test:int`, deben fallar sin la migración):
  - `rls.test.ts`, para **cada una** de las 17 tablas y las 4 vistas, generado desde una lista: el usuario B no ve
    filas de A (`select` → 0); B no puede insertar con `user_id` de A; B no puede actualizar ni borrar filas de A
    (0 afectadas); `anon` no ve ni escribe; A con factor verificado y sesión aal1 → 0 filas y escritura rechazada;
    A en aal2 → ve y escribe.
  - Tablas de solo agregar: `update` sobre `pay_gateway_fee_versions`, `pay_scheme_versions`, `pay_scheme_lines` y
    `pay_transaction_events` no afecta filas; `delete` sobre `pay_transaction_events` tampoco.
  - Claves compuestas: A no puede crear un canal en una empresa de B, ni un cobro con el canal de otra empresa suya.
  - `cuadres.test.ts`: reparto que no suma la base → rechazado; borrar una fila de `pay_allocations` → rechazado;
    `net_amount ≠ gross_amount − fees_total` → rechazado; `depositado` sin fecha → rechazado; esquema 50 + 30 sin
    «Resto» → rechazado; 60 + 50 → rechazado; «Resto» que además es línea → rechazado; 50 + 30 con «Resto» → pasa;
    `last4 = '12345'` → rechazado; alias con 7 dígitos seguidos → rechazado; `website = 'javascript:alert(1)'` →
    rechazado; referencia repetida en la misma pasarela → rechazada.
  - `funciones.test.ts`: `pay_save_transactions` crea cobro + 3 repartos + evento; si un elemento del lote falla, no
    queda nada de ninguno; `update` con `expected_updated_at` viejo → `pay_tx_conflict`; `p_skip_duplicates` salta la
    referencia repetida y devuelve `skipped: true`; 501 elementos → `pay_bad_payload`; `pay_save_scheme` crea la
    versión 1 y luego la 2, y reemplaza una versión sin cobros con la misma fecha; con cobros →
    `pay_scheme_version_in_use`; `pay_create_gateway` crea pasarela + tarifa «desde el inicio» + opciones.
  - `storage.test.ts`: A sube y lee en `{A}/…`; no puede subir en `{B}/…`; B no lista ni firma archivos de A; `anon`
    nada; con factor y aal1, nada; archivo de 11 MB y `text/plain` → rechazados por el bucket.
  - **Foco 5:** borrar una pasarela, un canal, un beneficiario o una versión de esquema **con cobros** → error de
    clave foránea (23503) y las filas siguen ahí.
  - `borrar-usuario.test.ts`: un usuario con filas en las 17 tablas se borra con `auth.admin.deleteUser` sin error y
    no queda ninguna fila suya (los disparadores de la cascada corren con el rol del servicio de Auth).
- [ ] Escribir la migración (spec §4; SQL comentado en español). `npm run db:reset` la aplica sin errores.
- [ ] `npm run db:types` genera `database.types.ts`; `npm run typecheck` en verde.
- [ ] `npm run test:int` en verde.

### Task 3: Motor I — dinero, reparto y desglose

**Archivos:** crear en `src/lib/pasarelas/`: `decimal.ts`, `money.ts`, `allocate.ts`, `schemes.ts`,
`breakdown.ts`, `guards.ts` y sus `*.test.ts` al lado.

**Consume:** `types.ts` (tarea 1). **Produce:**

```ts
// decimal.ts
export const D: typeof Decimal;                 // Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP })
export const ZERO: Money;                       // "0.00"
export function dec(x: string | Decimal): Decimal;        // RangeError si no es un decimal finito
export function r2(x: Decimal): Decimal;                  // a centavos, mitad hacia arriba
export function toMoney(x: Decimal): Money;               // nunca "-0.00"
export function isMoney(x: unknown): x is Money;          // /^-?\d+\.\d{2}$/
export function normPct(x: string | Decimal): Pct;        // "2.90" → "2.9", "50.0000" → "50"
// money.ts
export function parseMoney(input: string): Money | null;
export function parsePct(input: string): Pct | null;      // «2,9», «2.9 %»; fuera de 0–100 → null
export function formatAmount(m: Money): string;           // "1.234,56" · "-3,20"
export function formatMoney(m: Money, currency: Currency): string;   // "$1.234,56" · "-$3,20" · "€5,00" · "1.234,56 MXN"
export function formatPct(p: Pct): string;                // "2,9 %"
export function add(...xs: Money[]): Money;
export function sub(a: Money, b: Money): Money;
export function neg(a: Money): Money;
export function cmp(a: Money, b: Money): -1 | 0 | 1;
export function isZero(a: Money): boolean;
export function sumByCurrency<T>(rows: readonly T[], currencyOf: (r: T) => Currency,
                                 amountOf: (r: T) => Money): Record<Currency, Money>;
export function pctOf(part: Money, whole: Money, decimals?: number): Pct | null;   // whole = 0 → null
// allocate.ts
export function allocate(base: Money, pcts: readonly Pct[]): Money[];   // Σ pcts = 100 exacto; si no, RangeError
// schemes.ts
export type SchemeIssue = 'sin_lineas' | 'pct_invalido' | 'suma_mayor_100' | 'suma_menor_sin_resto'
                        | 'beneficiario_repetido' | 'resto_en_lineas';
export function schemeTotal(lines: readonly { pct: Pct }[]): Pct;
export function validateScheme(lines: readonly { beneficiaryId: string; pct: Pct }[],
                               remainderBeneficiaryId: string | null): SchemeIssue[];
export const SCHEME_ISSUE_TEXT: Record<SchemeIssue, string>;
// breakdown.ts
export function compute(rules: Rules, state: State, currency: Currency): Breakdown;
export function recompute(b: Breakdown, patch: Partial<State>): Breakdown;
export function recalc(b: Breakdown, rules: Rules): Breakdown;
export function diff(a: Breakdown, b: Breakdown): DiffRow[];      // solo lo que cambió
export function parseBreakdown(json: unknown): Breakdown;         // lanza si no es un desglose v1 válido
// guards.ts
export function looksLikeCardNumber(text: string): boolean;       // 13–19 dígitos (con espacios o guiones) y Luhn
export function hasLongDigitRun(text: string, min?: number): boolean;   // por defecto 7
export function isHttpUrl(text: string): boolean;
```

Reglas de `parseMoney`: admite espacios, `$`, `€` y signo; si hay coma y punto, el **último** es el decimal; un solo
separador seguido de exactamente 3 dígitos es de miles (`1,234` → `1234.00`); seguido de 1 o 2 dígitos es decimal;
más de 2 decimales, letras o vacío → `null`. «De miles» se lee en sentido estricto: los miles tienen que estar bien
agrupados (un primer grupo de 1 a 3 dígitos que no empieza por cero y luego grupos de 3); `0,500` y `1234,567` →
`null`, no `500.00` ni `1234567.00`, porque adivinar multiplicaría por mil lo que casi seguro era un decimal.

Qué marca `looksLikeCardNumber`: 13–19 dígitos que pasan Luhn escritos (1) en un tramo simple entero, con un espacio
o un guion como mucho entre dígito y dígito; (2) de corrido, lleven lo que lleven al lado; o (3) en grupos de 4 a 6
dígitos seguidos —separados por espacios, guiones, rayas o puntos—, con vecinos cortos (CVV, vencimiento) y, como
mucho, **un** vecino de 4 a 6 dígitos pegado. No prueba todas las ventanas de grupos contiguos: así dos teléfonos,
tres fechas o una lista de montos se marcaban del 20 % al 60 % de las veces. Queda un falso positivo de uno cada diez
en lo que solo Luhn distingue de una tarjeta (`2026-11-03 2026-11-28`, cuatro montos de 4 cifras seguidos): el error
de `zText` tiene que decir que el texto «parece un número de tarjeta» para que quien escribe pueda cambiarlo.

Fórmulas: spec §5.2, al pie de la letra. `compute` lanza `RangeError` si `grossOriginal ≤ 0` o si `refunded` no
está en `[0, grossOriginal]`.

- [ ] **Pruebas primero.** `breakdown.test.ts` usa un `rulesE1()` (Stripe `2.9` + `0.30`, sin devolver comisión,
      disputa `15.00`; «Pago rápido» `1.5` sobre `bruto`; plataforma `5`; esquema `neto` A `50`, B `30`, C `20`):

```ts
test('E1', () => {
  const b = compute(rulesE1(), { grossOriginal: '100.00', refunded: '0.00', dispute: null, failed: false }, 'USD');
  expect(b.lines.map((l) => [l.kind, l.amount])).toEqual([['pasarela', '3.20'], ['opcion', '1.50'], ['plataforma', '5.00']]);
  expect([b.feesTotal, b.net]).toEqual(['9.70', '90.30']);
  expect(b.alloc.lines.map((l) => l.amount)).toEqual(['45.15', '27.09', '18.06']);
});
test('E2', () => { /* 33.33, sin opciones ni plataforma, esquema 33.3333/33.3333/33.3334 */
  expect(b.feesTotal).toBe('1.27'); expect(b.net).toBe('32.06');
  expect(b.alloc.lines.map((l) => l.amount)).toEqual(['10.69', '10.68', '10.69']); });
test('E3', () => { /* pago rápido sobre despues_de_comision */
  expect(b.lines[1]).toMatchObject({ baseAmount: '96.80', amount: '1.45' }); expect(b.net).toBe('95.35'); });
test('E4', () => { const r = recompute(e1, { refunded: '100.00' });
  expect(r.gross).toBe('0.00');
  expect(r.lines.map((l) => [l.kind, l.amount])).toEqual([['pasarela', '0.00'], ['reembolso', '3.20'], ['opcion', '0.00'], ['plataforma', '0.00']]);
  expect(r.net).toBe('-3.20'); expect(r.alloc.lines.map((l) => l.amount)).toEqual(['-1.60', '-0.96', '-0.64']); });
test('E5', () => { const r = recompute(e1, { refunded: '40.00' });
  expect(r.lines.map((l) => l.amount)).toEqual(['2.04', '1.16', '0.90', '3.00']);
  expect([r.feesTotal, r.net]).toEqual(['7.10', '52.90']);
  expect(r.alloc.lines.map((l) => l.amount)).toEqual(['26.45', '15.87', '10.58']); });
test('E6', () => { const d = recompute(e1, { dispute: 'abierta' });
  expect([d.feesTotal, d.net]).toEqual(['24.70', '75.30']);
  expect(d.alloc.lines.map((l) => l.amount)).toEqual(['37.65', '22.59', '15.06']);
  expect(recompute(d, { dispute: 'ganada' }).net).toBe('90.30'); });
```

  Más pruebas con nombre: pasarela que **sí** devuelve la comisión (reembolso de 40 → pasarela `2.04`, sin línea de
  reembolso; total → `0.00`); `feeOverride` `4.70` (línea `informado`; reembolso de 40 sin devolución → `2.82` +
  `1.88`); esquema `bruto`; esquema con «Resto» (A `50`, B `30`, Resto C → C `20`, `isRemainder`); sin esquema
  (`alloc.baseKind = null`, sin líneas, base `0.00`); fallido (todo `0.00`); `recalc` con tarifa `3.2` + `0.30`
  cambia solo lo esperado y `diff` lo enumera; `recompute(b, {})` es idéntico a `b`; `parseBreakdown` rechaza
  `v: 2` y montos como número.
  `allocate.test.ts`: `('0.01', ['50','50'])` → `['0.01','0.00']`; `('-0.01', …)` → `['-0.01','0.00']`; empate lo
  gana la primera; Σ ≠ 100 → `RangeError`.
  **Propiedades** (2 000 casos con un generador determinista con semilla, sin dependencia nueva): la suma de
  `allocate` es exactamente la base; `net = gross − feesTotal`; `feesTotal` = suma de líneas; cada monto cumple
  `isMoney`; `recompute` es idempotente; el total retenido por una pasarela que no devuelve nunca baja al reembolsar.
  **Foco 2** (`money.test.ts`): `'1,234'`→`'1234.00'`, `'1.234,5'`→`'1234.50'`, `'$ 100'`→`'100.00'`,
  `'100,005'`→`'100005.00'`, `'1,234.56'`→`'1234.56'`, `'12.345'`→`'12345.00'`, `'0,5'`→`'0.50'`,
  `'1.2.3'`/`'abc'`/`''`/`'1,2345'`→`null`; `formatMoney('1234.56','USD')`→`'$1.234,56'`,
  `formatMoney('-3.20','USD')`→`'-$3,20'`, `formatMoney('5.00','MXN')`→`'5,00 MXN'`.
- [ ] Implementar hasta que todo pase. `npm run coverage` → **100 %** de líneas, ramas y funciones en estos
      archivos.

### Task 4: Motor II — fechas, feriados, versiones y estados

**Archivos:** crear en `src/lib/pasarelas/`: `dates.ts`, `holidays.ts`, `versions.ts`, `status.ts` y sus tests.

**Consume:** `types.ts`. **Produce:**

```ts
// dates.ts
export const ZONE = 'America/New_York';
export function isISODate(x: unknown): x is ISODate;
export function nyDate(instant: string | Date): ISODate;
export function todayNY(now: Date): ISODate;
export function addDays(d: ISODate, n: number): ISODate;
export function daysBetween(from: ISODate, to: ISODate): number;
export function isBusinessDay(d: ISODate, holidays: ReadonlySet<ISODate>): boolean;
export function estimateDepositDate(a: { occurredOn: ISODate; days: number; dayType: DayType;
                                         holidays: ReadonlySet<ISODate> }): ISODate;
export function localInputToInstant(local: string): string;   // "2026-11-13T10:30" (hora de NY) → ISO en UTC
export function instantToLocalInput(instant: string): string;
export type PeriodPreset = 'este_mes' | 'mes_anterior' | '30d' | '90d' | '365d' | 'este_anio' | 'personalizado';
export function periodRange(preset: PeriodPreset, today: ISODate,
                            custom?: { from?: ISODate | null; to?: ISODate | null }): { from: ISODate; to: ISODate };
export function monthKey(d: ISODate): string;                 // "2026-11"
export function monthLabel(key: string): string;              // "nov 2026"
export function formatDate(d: ISODate): string;               // "vie 13 nov 2026"
export function formatDateTime(instant: string): string;      // "vie 13 nov 2026, 10:30" (hora de NY)
// holidays.ts
export function usBankHolidays(year: number): { day: ISODate; name: string }[];
// versions.ts
export function pickVersion<T extends { effectiveFrom: ISODate }>(versions: readonly T[], on: ISODate): T | null;
// status.ts
export function displayStatus(t: Pick<LeanTx, 'status' | 'disputeState' | 'refunded' | 'grossOriginal'>): DisplayStatus;
export function isPartialRefund(t: Pick<LeanTx, 'status' | 'refunded' | 'grossOriginal'>): boolean;
export function isPending(t: Pick<LeanTx, 'status'>): boolean;                  // registrado | en_transito
export function isOverdue(t: Pick<LeanTx, 'status' | 'estimatedDepositOn' | 'gross'>, today: ISODate): boolean;
export const STATUS_LABEL: Record<DisplayStatus, string>;    // «Registrado», «En tránsito», «Depositado», …
export const LIFECYCLE_LABEL: Record<Lifecycle, string>;
```

Los nombres de días y meses en español salen de tablas propias (no de `Intl`): servidor y navegador deben dar el
mismo texto. `pickVersion`: la de `effectiveFrom` más reciente que sea ≤ `on`; si ninguna lo es, la más antigua; lista
vacía → `null`. `periodRange('30d', hoy)` = `[hoy − 29, hoy]`; `personalizado` sin fechas = `este_mes`; si
`from > to`, se intercambian.

- [ ] **Pruebas primero** (con `usBankHolidays(2026)` como feriados):

```ts
const H = new Set(usBankHolidays(2026).map((h) => h.day));
test('F1', () => expect(estimateDepositDate({ occurredOn: '2026-11-13', days: 2, dayType: 'habiles', holidays: H })).toBe('2026-11-17'));
test('F2', () => expect(estimateDepositDate({ occurredOn: '2026-11-25', days: 2, dayType: 'habiles', holidays: H })).toBe('2026-11-30'));
test('F3', () => expect(estimateDepositDate({ occurredOn: '2026-12-24', days: 2, dayType: 'habiles', holidays: H })).toBe('2026-12-29'));
test('pago rápido: 0 días es el mismo día aunque sea sábado', () =>
  expect(estimateDepositDate({ occurredOn: '2026-11-14', days: 0, dayType: 'habiles', holidays: H })).toBe('2026-11-14'));
test('corridos no saltan el fin de semana', () =>
  expect(estimateDepositDate({ occurredOn: '2026-11-13', days: 1, dayType: 'corridos', holidays: H })).toBe('2026-11-14'));
test('el día es el de Nueva York', () => {
  expect(nyDate('2026-11-14T03:30:00Z')).toBe('2026-11-13');
  expect(localInputToInstant('2026-11-13T22:30')).toBe('2026-11-14T03:30:00.000Z'); });
test('el cambio de horario no corre el día', () => {
  expect(addDays('2026-03-07', 1)).toBe('2026-03-08'); expect(addDays('2026-03-08', 1)).toBe('2026-03-09');
  expect(addDays('2026-10-31', 1)).toBe('2026-11-01'); expect(addDays('2026-11-01', 1)).toBe('2026-11-02');
  expect(daysBetween('2026-03-07', '2026-03-09')).toBe(2); });
```

  `holidays.test.ts`: `usBankHolidays(2026)` devuelve exactamente, en orden, `2026-01-01`, `2026-01-19`,
  `2026-02-16`, `2026-05-25`, `2026-06-19`, `2026-07-04`, `2026-09-07`, `2026-10-12`, `2026-11-11`, `2026-11-26`,
  `2026-12-25`; y `usBankHolidays(2027)`: `2027-01-01`, `2027-01-18`, `2027-02-15`, `2027-05-31`, `2027-06-19`,
  `2027-07-05`, `2027-09-06`, `2027-10-11`, `2027-11-11`, `2027-11-25`, `2027-12-25`. Regla del calendario
  **bancario**: si el feriado cae en sábado se deja en su fecha y el viernes anterior **no** es feriado (por eso
  no aparece `2026-07-03`); si cae en domingo se pasa al lunes siguiente con el nombre terminado en «(observado)»
  (por eso `2027-07-05` y no `2027-07-04`). Nombres en español: Año Nuevo, Día de Martin Luther King Jr., Día de
  los Presidentes, Día de los Caídos, Juneteenth, Día de la Independencia, Día del Trabajo, Día de Colón, Día de
  los Veteranos, Acción de Gracias, Navidad. `status.test.ts`: el orden de `displayStatus` del spec §4.1; `isOverdue` falso
  con bruto `0.00`, con `fallido`, con `depositado` y sin fecha estimada. `versions.test.ts`: tarifa «vigente desde
  mañana» no se elige para un cobro de hoy; para uno de mañana, sí.
- [ ] Implementar. Cobertura **100 %** de estos archivos.

### Task 5: Motor III — reglas y escrituras

**Archivos:** crear `src/lib/pasarelas/{rules.ts,write.ts}` y sus tests. **Consume:** tareas 3 y 4. **Produce:**

```ts
// rules.ts
export class PayRuleError extends Error { readonly code: 'empresa' | 'pasarela' | 'canal' | 'opcion' | 'esquema' | 'sin_tarifa' | 'sin_version' }
export function defaultExtraIds(cfg: PayConfig, companyId: string, gatewayId: string): string[];
export function resolveRules(cfg: PayConfig, sel: Selection, versionsOn?: ISODate): Rules;   // por defecto sel.occurredOn
export function reResolve(prev: Rules, cfg: PayConfig, sel: Selection,
  changed: { gateway: boolean; channel: boolean; extras: boolean; scheme: boolean; date: boolean }): Rules;
export function resolvePayout(cfg: PayConfig, sel: Pick<Selection, 'companyId' | 'gatewayId'>, extras: readonly ExtraRule[]):
  { days: number; dayType: DayType; source: 'opcion' | 'cuenta' | 'pasarela'; bankAccountId: string | null };
// write.ts
export class PayStateError extends Error { readonly code: string }
export type NewTxInput = Selection & { id: string; occurredAt: string; currency: Currency; grossOriginal: Money;
  reference: string | null; note: string | null; status?: 'registrado' | 'en_transito' | 'depositado';
  depositedOn?: ISODate | null; bankAccountId?: string | null; estimatedDepositOn?: ISODate | null };
export type EditTxInput = Partial<Pick<NewTxInput, 'companyId' | 'channelId' | 'gatewayId' | 'extraIds' | 'schemeId'
  | 'occurredAt' | 'currency' | 'grossOriginal' | 'reference' | 'note' | 'bankAccountId'>>;
export function planCreate(cfg: PayConfig, input: NewTxInput, kind?: 'creado' | 'importado'): TxWrite;
export function planEdit(cfg: PayConfig, tx: TxSnapshot, input: EditTxInput): TxWrite;
export function planRefund(tx: TxSnapshot, a: { amount: Money; on: ISODate; note?: string | null }): TxWrite;  // suma al total
export function planRefundTotal(tx: TxSnapshot, total: Money): TxWrite;                                        // corrige el total
export function planDispute(tx: TxSnapshot, a: { action: 'abrir' | 'ganar' | 'perder' | 'anular'; on: ISODate }): TxWrite;
export function planFail(tx: TxSnapshot): TxWrite;
export function planReopen(tx: TxSnapshot): TxWrite;
export function planTransit(tx: TxSnapshot): TxWrite;
export function planDeposit(tx: TxSnapshot, on: ISODate): TxWrite;
export function planRevertDeposit(tx: TxSnapshot): TxWrite;
export function planEstimated(cfg: PayConfig, tx: TxSnapshot, date: ISODate | null): TxWrite;   // null = volver a la automática
export function planRecalc(cfg: PayConfig, tx: TxSnapshot, mode: 'hoy' | 'fecha_del_cobro', today: ISODate):
  { write: TxWrite; changes: DiffRow[] };
export function planTrash(tx: TxSnapshot, nowIso: string): TxWrite;
export function planRestore(tx: TxSnapshot): TxWrite;
```

Reglas: `resolveRules` toma la tarifa y la versión de esquema con `pickVersion(…, versionsOn)`; las opciones en el
orden `sort`; el canal debe ser de la empresa; `schemeId = null` → sin esquema. `reResolve` conserva de `prev` todo
lo que no cambió (spec §5.2, última viñeta): `date` vuelve a elegir tarifa y versión de esquema; `gateway` cambia
tarifa y opciones; `channel` la plataforma; `scheme` el esquema. `resolvePayout`: menor `payoutDaysOverride` entre las
opciones → `payoutDaysOverride` de la cuenta de la pasarela de esa empresa → `payoutDays` de la pasarela; el tipo de
día es el de la pasarela. Transiciones (lo demás lanza `PayStateError`): depositar desde `registrado`/`en_transito`
(o cambiar la fecha si ya está); en tránsito solo desde `registrado`; revertir depósito → `en_transito`; fallar solo
sin depósito, sin reembolso y sin disputa; reabrir `fallido` → `registrado`; reembolsar nunca un `fallido` ni más
que el bruto original; disputa `abrir` desde nula o `ganada`, `ganar`/`perder`/`anular` solo desde `abierta`;
`perder` pone `refunded = grossOriginal`. Todo plan sobre un cobro existente lleva `expectedUpdatedAt = tx.updatedAt`,
`allocations` del desglose nuevo cuando cambian los números (y `null` cuando no) y un evento con
`data = { antes, despues }`. La fecha estimada se recalcula al crear y al cambiar fecha, pasarela u opciones, salvo
`estimatedIsManual`.

- [ ] **Pruebas primero** (`cfgDemo()` = lo mismo que `seedBasics` de la tarea 2, pero en memoria):
  `planCreate` de E1 el viernes `2026-11-13T15:30:00Z` → `fields` con `grossAmount '100.00'`, `feesTotal '9.70'`,
  `netAmount '90.30'`, `allocBaseAmount '90.30'`, `occurredOn '2026-11-13'`, `estimatedDepositOn '2026-11-13'`
  (pago rápido, 0 días) y, sin la opción, `'2026-11-17'`; `allocations` `45.15 / 27.09 / 18.06`; evento `creado`.
  **«Vigente desde mañana»:** con una segunda tarifa `3.5` + `0.30` vigente desde `2026-11-14`, `planCreate` del 13
  sigue dando `3.20`; del 14 da `3.80`; `planRecalc(…, 'hoy', '2026-11-20')` sobre el cobro del 13 pasa a `3.80` y
  `changes` lo lista; `planRecalc(…, 'fecha_del_cobro', …)` no cambia nada (`changes` vacío).
  `planEdit` que solo cambia el monto conserva `rules` idénticas; el que cambia de pasarela trae la tarifa nueva.
  `planRefund` 40 + otro de 60 = total; un tercero lanza. `planDispute` perder → `refundedAmount = grossOriginal` y
  línea `disputa`. `planDeposit` → `status 'depositado'`, `depositedOn`, `allocations: null`. Cada transición
  inválida de la lista lanza `PayStateError`.
- [ ] Implementar. Cobertura **100 %**.

### Task 6: Motor IV — resumen y CSV

**Archivos:** crear `src/lib/pasarelas/{stats.ts,csv.ts,index.ts}` y tests. **Consume:** tareas 3 y 4. **Produce:**

```ts
// stats.ts — todo excluye los `fallido`
export type Totals = { count: number; gross: Money; fees: Money; net: Money; avgTicket: Money; feePct: Pct | null;
  pendingNet: Money; pendingCount: number; depositedNet: Money; depositedCount: number };
export type CurrencySummary = { totals: Totals;
  byMonth: { month: string; gross: Money; fees: Money; net: Money; count: number }[];                       // asc
  byCompany: { companyId: string; gross: Money; fees: Money; net: Money; count: number }[];                 // bruto desc
  byGateway: { gatewayId: string; gross: Money; fees: Money; net: Money; count: number;
               sharePct: Pct | null; effectiveCostPct: Pct | null }[];                                      // bruto desc
  byAccount: { bankAccountId: string | null; net: Money; count: number; sharePct: Pct | null;
               avgDays: string | null; medianDays: string | null }[] };                                     // neto desc
export function summarize(rows: readonly LeanTx[], today: ISODate): Record<Currency, CurrencySummary>;
export function totalsOf(rows: readonly LeanTx[]): Record<Currency, Pick<Totals, 'count' | 'gross' | 'fees' | 'net'>>;
export function lagStats(rows: readonly LeanTx[], keyOf: (r: LeanTx) => string | null):
  Record<string, { count: number; avgDays: string; medianDays: string }>;      // solo depositados; 1 decimal
export type DepositGroup = { date: ISODate; bankAccountId: string | null; currency: Currency; net: Money;
  count: number; ids: string[]; overdue: boolean };
export function upcomingDeposits(rows: readonly LeanTx[], today: ISODate, days?: number): DepositGroup[];  // atrasados primero
// csv.ts
export type CsvFormat = { delimiter: ',' | ';'; decimal: '.' | ','; bom: boolean };
export const CSV_ES: CsvFormat;    // ; y coma decimal, con BOM
export const CSV_STD: CsvFormat;   // , y punto, sin BOM
export function toCsv(header: readonly string[], rows: readonly (readonly (string | null)[])[], fmt: CsvFormat,
                      moneyColumns?: readonly number[]): string;
// index.ts — reexporta todo el motor
```

`avgTicket = gross ÷ count`; `feePct` y `effectiveCostPct = fees ÷ gross × 100` con 2 decimales; `sharePct` sobre el
bruto (pasarelas) o el neto (cuentas) de esa moneda. `upcomingDeposits`: pendientes con fecha estimada `< today`
(`overdue`) o dentro de `[today, today + days − 1]` (14 por defecto), agrupados por fecha, cuenta y moneda. `toCsv`:
comillas dobles cuando hace falta; a toda celda de **texto** que empiece por `=`, `+`, `-`, `@`, tabulador o retorno
se le antepone `'`; las columnas de dinero no se tocan salvo el separador decimal.

- [ ] **Pruebas primero:** 6 filas a mano en USD y 2 en EUR → totales por moneda separados y nunca sumados; un
      `fallido` no cuenta en nada; `feePct` de bruto 0 → `null`; `byMonth` en orden; mediana de `[1, 2, 4]` = `2.0` y
      de `[1, 2]` = `1.5`; `upcomingDeposits` pone primero el atrasado y excluye depositados, fallidos y bruto `0.00`;
      `toCsv` con `'=1+1'`, `'-cmd'`, comillas, saltos de línea y montos negativos (`'-3.20'` → `-3,20` en `CSV_ES`,
      sin apóstrofo).
- [ ] Implementar. Cobertura **100 %** de `src/lib/pasarelas/**`.

### Task 7: Kit de interfaz y marco

**Archivos:** crear `src/app/globals.css` (tokens), `src/components/ui/*` con `index.ts`,
`src/components/shell/{AppShell.tsx,nav.ts,NavLink.tsx,RegisterFab.tsx}`, `src/app/(dashboard)/layout.tsx`,
`src/app/{manifest.ts,not-found.tsx,global-error.tsx}`, `public/icons/*`, `src/app/(dashboard)/kit/page.tsx`
(galería de componentes, solo en desarrollo), `e2e/kit.spec.ts`.

**Produce** (desde `@/components/ui`): `Button`, `ButtonLink`, `IconButton`, `SubmitButton`; `Field`, `Input`,
`Textarea`, `Select`, `Checkbox`, `Switch`, `MoneyInput`, `PctInput`; `Card`, `CardHeader`, `CardTitle`, `CardBody`;
`Badge` (`tone`: `neutral|info|success|warning|danger`); `Alert`; `Dialog`, `ConfirmDialog`; `EmptyState`;
`Skeleton`; `Table`, `THead`, `TBody`, `Tr`, `Th`, `Td`; `PageHeader`, `BackLink`, `TabsNav`; `Stat`; `Money`,
`Percent`, `DateText`, `DateTimeText`; `UrlSelect`, `UrlSearch`, `UrlPeriod`, `Pagination` (filtros que viven en la
URL); `Toaster` y `notify.success|error`; `cn`. Cada componente con sus props tipadas y documentadas en la galería.
Desde `@/components/shell`: `AppShell` (barra inferior en celular: Resumen · Cobros · ＋ · Repartos · Más; barra
lateral desde 768 px) y `NAV` (rutas del spec §8).

- [ ] Elegir la dirección visual con la habilidad `frontend-design:frontend-design` (propia de este proyecto, sobria,
      cifras tabulares) y fijar los tokens en `@theme`: colores con contraste AA en claro y oscuro, tipografía
      servida desde el propio sitio, radios, sombras, foco visible.
- [ ] `Money` usa `formatMoney`; los negativos van con signo y con un tono distinto, nunca solo color.
- [ ] `Dialog` sobre `<dialog>` nativo (`showModal`, Escape, foco atrapado, título enlazado).
- [ ] Todos los controles con etiqueta, `aria-invalid` y `aria-describedby` cuando hay error; objetivos ≥ 44 px.
- [ ] `e2e/kit.spec.ts`: la galería a 390×844 y 1280×800, en claro y oscuro, **sin violaciones serias ni críticas de
      axe** y sin desbordamiento horizontal.

### Task 8: Sesión y segundo factor

**Archivos:** crear `src/lib/supabase/{client.ts,server.ts,proxy.ts}`, `src/proxy.ts`, `src/lib/auth/session.ts`,
`src/app/(auth)/{layout.tsx,login/page.tsx,login/LoginForm.tsx,login/actions.ts,login/verificar/page.tsx,
login/verificar/VerifyForm.tsx}`, `src/app/(dashboard)/ajustes/{page.tsx,SecurityCard.tsx,actions.ts}`,
`src/components/shell/MfaBanner.tsx`, `next.config.ts` (cabeceras), `e2e/{helpers.ts,sesion.spec.ts}`.

**Consume:** tarea 7 y `tests/integration/helpers.ts` (tarea 2). **Produce:**

```ts
// `Database` siempre de '@/lib/supabase/types' (dinero como cadena al escribir), no de database.types.ts
// lib/supabase/client.ts            → export function createClient(): SupabaseClient<Database>        (navegador)
// lib/supabase/server.ts            → export async function createClient(): Promise<SupabaseClient<Database>>
// lib/auth/session.ts  (server-only)
export type Session = { userId: string; email: string; aal: 'aal1' | 'aal2'; hasFactor: boolean };
export const getSession: () => Promise<Session | null>;      // una vez por petición (cache de React)
export async function requireSession(): Promise<Session>;    // sin sesión → /login; con factor y aal1 → /login/verificar
// e2e/helpers.ts
export async function newUser(): Promise<TestUser>;                     // usuario nuevo con datos de seedBasics
export async function login(page: Page, u: TestUser): Promise<void>;
export async function expectNoSeriousAxe(page: Page): Promise<void>;
```

- [ ] `proxy.ts` refresca la sesión en cada petición y protege todo salvo `/login`, estáticos y el manifiesto.
      El parámetro `siguiente` solo acepta rutas internas (`/algo`, nunca `//host` ni `http:`).
- [ ] Entrar con correo y contraseña; mensaje genérico si falla; sin página de registro.
- [ ] `/login/verificar`: pide el código si hay factor verificado y la sesión es aal1.
- [ ] `Ajustes → Seguridad`: activar TOTP (QR + clave + verificar), listar y quitar factores, cambiar contraseña,
      cerrar sesión. Aviso permanente en el marco si no hay factor.
- [ ] Cabeceras de seguridad y CSP (spec §6); `robots: noindex`.
- [ ] `e2e/sesion.spec.ts` (390×844): sin sesión, `/pasarelas` manda a `/login`; credenciales malas → mensaje;
      entrar → `/pasarelas`; activar el segundo factor, cerrar sesión, entrar de nuevo → pide el código → entra;
      `?siguiente=//evil.example` no saca del sitio; axe limpio en `/login`, `/login/verificar` y `/ajustes`.

### Task 9: Capa de datos común y cobros en el servidor

Esta tarea es la parte de la capa de datos que **no depende de la sesión de Next**: todo recibe el cliente de
Supabase como parámetro y se prueba contra el stack local. Las Server Actions, la configuración por petición y la
subida de comprobantes desde el navegador son la tarea 25.

**Archivos:** crear en `src/server/pasarelas/`: `result.ts`, `errors.ts`, `zod.ts`, `dto.ts`, `tx-save.ts`,
`queries/{config.ts,transactions.ts}`, `ops/{transactions.ts,receipts.ts}`;
`tests/integration/{config.test.ts,cobros.test.ts,totales.test.ts}`; pruebas puras junto al código para `zod.ts`,
`errors.ts`, `dto.ts` y `parseTxFilters`. Enmienda al motor: `src/lib/pasarelas/write.ts` (ver «Reglas»).

**Consume:** tareas 2, 5 y 6. **Produce:**

```ts
// result.ts
export type ActionResult<T = void> = { ok: true; data: T } | { ok: false; error: string; fieldErrors?: Record<string, string[]> };
// zod.ts — esquemas compartidos por todas las acciones
export const zId: z.ZodType<string>;                   // uuid
export const zMoney: z.ZodType<Money>;                 // texto del usuario → parseMoney; inválido → «Monto no válido»
export const zPositiveMoney: z.ZodType<Money>;         // > 0
export const zPct: z.ZodType<Pct>;                     // texto → parsePct
export const zDate: z.ZodType<ISODate>;
export const zCurrency: z.ZodType<Currency>;           // 3 letras, a mayúsculas
export const zHttpUrl: z.ZodType<string | null>;       // vacío → null; solo http(s)
export function zText(max: number): z.ZodType<string>;            // recorta; rechaza looksLikeCardNumber
export function zOptionalText(max: number): z.ZodType<string | null>;
export function zAlias(max: number): z.ZodType<string>;           // además rechaza 7 o más dígitos seguidos
export const zReference: z.ZodType<string | null>;     // recorta; vacío → null; máx. 120; SIN la guarda de tarjeta
// errors.ts — puro: de un error (PostgREST, Storage, PayStateError, PayRuleError, ZodError) a un mensaje en español
export function errorMessage(e: unknown): string;
export class UserError extends Error {}                  // error esperado: su mensaje se le enseña tal cual a la persona
// dto.ts — fila de la base → tipos del motor; los numeric pasan a Money con toMoney(dec(String(n)))
export function toLeanTx(row): LeanTx;  export function toTxSnapshot(row): TxSnapshot;  /* y uno por tabla */
// queries/config.ts
export async function loadPayConfig(supabase: SupabaseClient<Database>): Promise<PayConfig>;   // incluye inactivos
export async function ensureHolidays(supabase): Promise<void>;   // siembra 2026 y 2027 si no hay ninguno
// tx-save.ts
export async function saveTx(supabase, writes: TxWrite[], opts?: { skipDuplicates?: boolean }):
  Promise<{ id: string; inserted: boolean; skipped: boolean }[]>;   // en lotes de 500
// queries/transactions.ts
export type TxFilters = { from?: ISODate; to?: ISODate; companyId?: string; channelId?: string; gatewayId?: string;
  bankAccountId?: string; currency?: Currency; status?: DisplayStatus | 'por_caer' | 'atrasado';
  receipt?: 'con' | 'sin'; estimatedOn?: ISODate; q?: string; trashed?: boolean };
export type TxSort = 'fecha_desc' | 'fecha_asc' | 'monto_desc' | 'monto_asc' | 'estimada_asc';
export function parseTxFilters(sp: Record<string, string | string[] | undefined>, today: ISODate): { filters: TxFilters; sort: TxSort; page: number };
export async function listTx(supabase, f: TxFilters, sort: TxSort, page: number, today: ISODate, pageSize?: number): Promise<{ rows: TxListItem[]; total: number }>;
export async function leanTx(supabase, f: TxFilters, today: ISODate): Promise<LeanTx[]>;   // TODAS las del filtro, por páginas de 1000
export async function getTx(supabase, id: string): Promise<TxDetail | null>;               // con reparto, comprobantes y eventos
export async function getSnapshots(supabase, ids: string[]): Promise<TxSnapshot[]>;
export async function lastTx(supabase): Promise<TxSnapshot | null>;
// ops/transactions.ts — lógica con el cliente inyectado (se prueba sin Next)
export async function createTx(supabase, input: NewTxInput): Promise<{ id: string; created: boolean }>;
export async function editTx(supabase, id: string, input: EditTxInput): Promise<void>;
export async function refundTx(supabase, id: string, a: { amount: Money; on: ISODate; note?: string | null }): Promise<void>;
export async function setRefundTotalTx(supabase, id: string, total: Money): Promise<void>;
export async function disputeTx(supabase, id: string, a: { action: 'abrir' | 'ganar' | 'perder' | 'anular'; on: ISODate }): Promise<void>;
export async function failTx(supabase, id: string): Promise<void>;
export async function reopenTx(supabase, id: string): Promise<void>;
export async function transitTx(supabase, ids: string[]): Promise<number>;
export async function depositTx(supabase, ids: string[], on: ISODate): Promise<number>;
export async function revertDepositTx(supabase, id: string): Promise<void>;
export async function setEstimatedTx(supabase, id: string, date: ISODate | null): Promise<void>;
export async function trashTx(supabase, ids: string[]): Promise<number>;
export async function restoreTx(supabase, ids: string[]): Promise<number>;
export async function purgeTx(supabase, userId: string, ids: string[]): Promise<number>;
export async function previewRecalcTx(supabase, ids: string[], mode: 'hoy' | 'fecha_del_cobro', today: ISODate):
  Promise<{ items: { id: string; label: string; changes: DiffRow[] }[]; unchanged: number }>;
export async function applyRecalcTx(supabase, ids: string[], mode: 'hoy' | 'fecha_del_cobro', today: ISODate): Promise<number>;
// ops/receipts.ts
export async function registerReceipt(supabase, userId: string, a: { transactionId: string; path: string; mime: string; sizeBytes: number; originalName: string | null }): Promise<string>;
export async function removeReceipt(supabase, id: string): Promise<void>;        // archivo y fila
export async function receiptSignedUrl(supabase, id: string): Promise<string>;   // 60 s
```

Reglas: un único constructor `applyTxFilters(query, filters, today)` lo usan `listTx` **y** `leanTx`. La búsqueda `q`
se limpia a letras, dígitos, espacio y `-_.@#/:` (máx. 80) y busca en referencia, nota, nombres de empresa, canal y
pasarela (resueltos a ids con la configuración) y, si es un monto, en el bruto original. `status` se traduce a
condiciones sobre `status`, `dispute_state` y `refunded_amount` en el orden de `displayStatus`. `createTx` es
**idempotente** por `id`: si ya existe ese `id`, devuelve `{ created: false }` sin tocar nada. `purgeTx` borra primero
los archivos de `{userId}/{txId}/` y luego la fila; si falla Storage, no borra la fila. `registerReceipt` comprueba
que el archivo existe en Storage y que la ruta empieza por `{userId}/{transactionId}/`.

Más reglas, que salen de las revisiones de las tareas 3, 5 y 23:
- **Leer dinero siempre con `::text`**: `dto.ts` exporta las listas de columnas de cada lectura (p. ej.
  `TX_COLUMNS`, `LEAN_TX_COLUMNS`) con los `numeric` de dinero y porcentaje convertidos a texto; los mapeadores
  devuelven montos canónicos (`toMoney`) y porcentajes normalizados (`normPct`), y nunca hacen aritmética con `number`.
- **Una operación que no cambia nada no escribe**: si el plan del motor deja `fields` vacío (depositar con la misma
  fecha, corregir un reembolso al mismo total), la `op` no llama a la base y no deja evento.
- **Recalcular**: se escribe si `fields` no queda vacío, aunque `changes` esté vacío (puede cambiar solo la fecha
  estimada); `previewRecalcTx` añade entonces una fila «Fecha estimada» con el antes y el después.
- `errorMessage` traduce: 23505 (`pay_companies_name_uq`, `pay_gateways_name_uq`, `pay_beneficiaries_name_uq`,
  `pay_schemes_name_uq`, la referencia repetida `pay_transactions_reference_uq`), 23503 (algo que todavía se usa),
  23514 con los mensajes `pay_*` de la tarea 2 y `pay_transactions_alloc_base_check`, 40001 `pay_tx_conflict`
  («Este cobro cambió mientras lo editabas: vuelve a abrirlo»), P0002, 42501 (sesión sin segundo factor: «Verifica
  tu segundo factor para seguir»), los códigos de `PayStateError` y `PayRuleError` con sus textos del motor, y
  cualquier otro error como «No se pudo guardar. Inténtalo de nuevo.» sin filtrar detalles internos.
- `zText` rechaza lo que `looksLikeCardNumber` marca, con un mensaje que dice por qué y cómo seguir («Parece un
  número de tarjeta. No lo guardes aquí: si son fechas o montos, sepáralos con texto»). **La referencia no lleva
  esa guarda** (`zReference`): los identificadores largos de una pasarela son normales.
- **Enmienda al motor** (`write.ts`, con sus pruebas y sin perder el 100 % de cobertura): en `planEdit`, cambiar de
  empresa también recalcula la fecha estimada automática, y cambiar de empresa o de pasarela sin `bankAccountId`
  explícito vuelve a poner la cuenta destino por defecto (`resolvePayout`).

- [ ] **Pruebas primero** (`npm run test:int`, con `createUser` + `seedBasics`):
  - `cobros.test.ts`: `createTx` de E1 deja en la base `fees_total 9.70`, `net_amount 90.30`, repartos
    `45.15/27.09/18.06` y un evento `creado`. **Foco 1:** llamar `createTx` dos veces con el mismo `id` → una sola
    fila y `created: false` la segunda. `refundTx` de 40 → `52.90` y repartos `26.45/15.87/10.58`; con liquidaciones
    previas de `45.15/27.09/18.06` y reembolso total, `pay_beneficiary_balances` da `-46.75/-28.05/-18.70`.
    `depositTx` en lote de 3 → los 3 `depositado`; `pay_gateway_totals.avg_days` cambia. Conflicto optimista → error
    con mensaje en español. `trashTx` saca el cobro de listas, totales y saldos; `restoreTx` lo devuelve; `purgeTx`
    borra también sus archivos (la carpeta queda vacía).
  - `totales.test.ts` — **Foco 4:** con 1 250 cobros de 1,00 creados por lotes, `leanTx` devuelve 1 250 y
    `totalsOf` da bruto `1250.00`; `listTx` página 1 devuelve 50 y `total = 1250`. Para 20 filtros generados,
    `totalsOf(leanTx(f))` coincide con sumar a mano las filas que `listTx` recorre página a página.
  - `config.test.ts`: `loadPayConfig` devuelve la forma exacta de `PayConfig` y los montos como cadenas con 2
    decimales; `ensureHolidays` siembra una sola vez.
- [ ] Implementar. `npm run test:int` en verde.

### Task 23: Ajustes tras las revisiones de las tareas 1 y 2

Lo que las revisiones independientes de las tareas 1 y 2 dejaron por arreglar, más dos decisiones del controlador.
Va antes de la tarea 8. Es la única tarea, además de la 2, que puede ejecutar `npm run db:reset`.

**Archivos:** modificar `supabase/migrations/20261110120000_las_pasarelas_de_pago.sql` (todavía no se ha aplicado a
ninguna base remota: se edita en su sitio), `src/lib/supabase/database.types.ts` (regenerado),
`src/lib/pasarelas/types.ts` (solo `EventKind`), `tests/integration/{helpers.ts,cuadres.test.ts,funciones.test.ts}`,
`scripts/stack.sh`, `playwright.config.ts`, `next.config.ts`, `AGENTS.md`, `README.md`, `.env.example`,
`docs/superpowers/specs/2026-11-09-pasarelas-design.md` (§4) y, en la raíz del repo, `eslint.config.js`.

**Produce:** `Basics.companyGatewayId`; `EventKind` con `'disputa_anulada'`; errores nuevos que traduce la tarea 9:
23505 de `pay_beneficiaries_name_uq` y `pay_schemes_name_uq`.

- [ ] **Base — pruebas primero** (`npm run test:int`; cada una debe fallar contra la migración actual):
  1. **Nombre único** por usuario, sin distinguir mayúsculas ni espacios de los extremos, también en
     `pay_beneficiaries` (`pay_beneficiaries_name_uq`) y `pay_schemes` (`pay_schemes_name_uq`): repetido → 23505; el
     mismo nombre en otro usuario → pasa. (Decisión del controlador: se restaura lo que el arreglo de la tarea 2
     quitó; la prueba que hoy afirma que se pueden repetir cambia de sentido.) Actualiza la tabla del spec §4.
  2. `pay_beneficiary_balances` **no cuenta los cobros `fallido`**: un fallido con repartos `5.00` y `-5.00`
     (suman cero) deja en `0.00` lo asignado de ambos beneficiarios.
  3. **El cobro ata su versión de esquema a su esquema**: clave foránea `(scheme_version_id, scheme_id, user_id)`
     hacia `pay_scheme_versions (id, scheme_id, user_id)`. Un cobro con `scheme_id` de un esquema y
     `scheme_version_id` de otro → 23503.
  4. **`receipts_count` no se escribe a mano**: un `update` directo que lo cambie deja el valor anterior, y una
     inserción directa lo deja en 0; subir y quitar un comprobante sigue sumando y restando 1.
  5. **La base del reparto queda atada al cobro** (`pay_transactions_alloc_base_check`): `alloc_base_amount` es el
     `net_amount` si `alloc_base = 'neto'`, el `gross_amount` si es `'bruto'` y `0` si no hay esquema; y sin esquema
     (`scheme_version_id` nulo) también son nulos `scheme_id` y `alloc_base`. Casos: `'neto'` con base ≠ neto →
     23514; `'bruto'` con base ≠ bruto → 23514; sin esquema con `alloc_base = 'neto'` → 23514; los válidos pasan,
     incluido un `fallido` con esquema (todo en cero).
  6. **La referencia se guarda siempre recortada**: una inserción directa con espacios en los extremos → 23514; la
     función `pay_save_transactions` sigue recortándola y aceptándola.
  7. En un duplicado saltado (`p_skip_duplicates`), `pay_save_transactions` devuelve el **`id` del cobro que ya
     existe**, con `inserted: false, skipped: true`.
  8. `pay_transaction_events.kind` admite `disputa_anulada`; un valor inventado sigue dando 23514. `EventKind` en
     `types.ts` lo incluye (después de `disputa_perdida`).
- [ ] Aplicar los ocho cambios en la migración (comentados en español), `npm run db:reset`, `npm run db:types`,
      y `npm run test:int` en verde. La comprobación final de la migración sigue pasando.
- [ ] `seedBasics` deja además la empresa con su esquema por defecto (`default_scheme_id`) y crea la cuenta de la
      pasarela de esa empresa en `pay_company_gateways` (Stripe en «Escuela Demo», con la cuenta destino, sin días
      propios y sin opciones propias); `Basics` gana `companyGatewayId`.
- [ ] **Raíz del repo, `eslint.config.js`:** `globalIgnores` incluye también `.claude` (los worktrees temporales de
      los agentes no son código del gestor). Compruébalo creando un archivo con un error de lint en
      `.claude/worktrees/prueba/pasarelas/.next/x.js`, corriendo `npx eslint .` en la raíz (0 errores) y borrándolo.
- [ ] **`next.config.ts`:** `allowedDevOrigins: ["127.0.0.1"]`. En desarrollo Next 16.4 bloquea los orígenes que
      no sean `localhost`; las pruebas entran por `http://127.0.0.1:<puerto>`. Compruébalo: con `next dev` en tu
      puerto, abre la página con Playwright por `127.0.0.1`, espera 5 s y confirma que el servidor no imprimió
      «Blocked cross-origin request» y que la consola del navegador no tiene errores del websocket.
- [ ] **`scripts/stack.sh`:** (a) con el stack caído, `env` termina con su mensaje «No pude leer…» y código 1 (hoy
      muere en silencio por `set -e`); (b) `env` conserva las demás variables que ya hubiera en `.env.local` (p. ej.
      `SEED_EMAIL`, `SEED_PASSWORD`) y solo reemplaza las tres que escribe; (c) `start` vuelve a escribir
      `.env.local` cuando falta o está vacía `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. **No detengas el stack
      compartido** para probar (a): simúlalo con una copia temporal del guion.
- [ ] **`playwright.config.ts`:** el `webServer` espera la raíz (`LOCAL_URL`), no `/login`, y
      `reuseExistingServer: false` (para reutilizar un servidor ya existe `E2E_BASE_URL`).
- [ ] **`AGENTS.md`, `README.md`, `.env.example`:** no hacer `db:reset` **ni `db:stop`** con el stack compartido;
      los pies de commit válidos son `Co-Authored-By: Claude <noreply@anthropic.com>` y `Claude-Session: <enlace>`
      (lo prohibido son nombres o versiones de modelos); receta de punta a punta en modo producción
      (`E2E_PORT=31xx npm run test:e2e -- --trace off e2e/<archivo>`) junto a la de desarrollo; `npm ci` **sí**
      funciona con npm 10 (lo que falla es `npm install` cuando tiene que resolver: para agregar dependencias,
      `npx npm@11 install`); `db:start` solo escribe `.env.local` si falta o si le falta la clave; `.env.example`
      remite a `npm run db:env`.
- [ ] Verificar: `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:int`, `npm run build`.

### Task 24: Pulido del kit de interfaz

Los hallazgos menores que dejó la revisión de la tarea 7 y que conviene cerrar antes de construir pantallas encima.

**Archivos:** modificar `src/components/ui/{Dialog.tsx,Field.tsx,Alert.tsx,Toggles.tsx}`,
`src/components/shell/AppShell.tsx`, `src/app/globals.css`, la galería (`src/app/(dashboard)/kit/*`) y
`e2e/kit.spec.ts`.

- [ ] **`Dialog`: `onClose` exactamente una vez por cierre que inicia la persona** (Escape, botón de cerrar, clic en
      el fondo, «Cancelar») y **nunca** por el cierre que el propio código hace después de confirmar.
      `ConfirmDialog` llama a `onConfirm` una sola vez y no dispara `onClose` tras confirmar. Prueba de punta a punta
      con un contador visible en la galería: cancelar → `onClose` 1 y `onConfirm` 0; confirmar → `onConfirm` 1 y
      `onClose` 0; Escape → `onClose` 1.
- [ ] **`Dialog`: el clic en el fondo solo cierra si empezó y terminó en el fondo.** Soltar fuera una selección de
      texto iniciada dentro, o usar la barra de desplazamiento del diálogo, no lo cierra. Prueba: arrastrar desde un
      campo de texto del diálogo hasta el fondo lo deja abierto; un clic limpio en el fondo lo cierra.
- [ ] **Sombras en oscuro:** `shadow-raised` y `shadow-overlay` usan sus variantes del modo oscuro.
- [ ] **`Field`:** si el control hijo trae su propio `id`, se respeta y la etiqueta apunta a él; si trae
      `aria-describedby`, se **combina** con la ayuda y el error en vez de reemplazarse.
- [ ] **`Checkbox` y `Switch`:** un `aria-labelledby` del llamador se conserva, combinado con el propio.
- [ ] **`Alert`:** por defecto un aviso fijo no lleva `role="alert"` (un lector de pantalla no debe interrumpir por
      un texto que ya estaba en la página); se pide con la prop `announce`. La galería enseña los dos.
- [ ] **`AppShell`:** sin desestructurar `NAV.main` como si fuera una tupla.
- [ ] Verificar: `npm run typecheck`, `npm run lint`, `npm test` y `e2e/kit.spec.ts` (los dos tamaños, claro y
      oscuro, axe sin violaciones serias ni críticas).

### Task 25: Acciones del servidor y comprobantes desde el navegador

Lo que une la capa de datos (tarea 9) con la sesión (tarea 8) y con el navegador. Va después de las dos.

**Archivos:** crear `src/server/pasarelas/action.ts`, `src/server/pasarelas/queries/session-config.ts`,
`src/server/pasarelas/actions/{transactions.ts,receipts.ts}`,
`src/components/pasarelas/receipts/{ReceiptPicker.tsx,upload.ts,downscale.ts,check.ts}` y `check.test.ts`;
`e2e/acciones.spec.ts` y una página de prueba `src/app/(dashboard)/kit/acciones/page.tsx` (solo con
`PASARELAS_KIT=1`); modificar `src/server/pasarelas/errors.ts` y `src/server/pasarelas/ops/receipts.ts` (y sus
pruebas) como dicen las «Reglas». `queries/config.ts` **no se toca**: tiene que seguir siendo importable fuera de
Next (lo usan la semilla y las pruebas de integración).

**Consume:** tareas 7, 8 y 9. **Produce:**

```ts
// action.ts (server-only)
export async function runAction<S extends z.ZodType, T>(schema: S, input: unknown,
  fn: (ctx: { supabase: SupabaseClient<Database>; session: Session }, data: z.output<S>) => Promise<T>,
  opts?: { revalidate?: string[] }): Promise<ActionResult<T>>;
// queries/session-config.ts (server-only; depende de la sesión de Next)
export const getPayConfig: () => Promise<PayConfig>;      // una vez por petición (cache de React), con la sesión
// actions/transactions.ts ('use server') — cada una recibe `input: unknown`, valida con Zod y usa runAction
//   createTransaction → ActionResult<{ id: string }>      editTransaction({ id, ...cambios })
//   refundTransaction({ id, amount, on, note? })          setRefundTotal({ id, total })
//   disputeTransaction({ id, action, on })                failTransaction({ id })   reopenTransaction({ id })
//   markInTransit({ ids })  markDeposited({ ids, on })    → ActionResult<{ count: number }>
//   revertDeposit({ id })   setEstimatedDate({ id, date | null })
//   previewRecalc({ ids, mode })  applyRecalc({ ids, mode })
//   trashTransactions({ ids })  restoreTransactions({ ids })  purgeTransactions({ ids })  → ActionResult<{ count: number }>
// actions/receipts.ts ('use server')
//   registerReceiptAction({ transactionId, path, mime, sizeBytes, originalName }) → ActionResult<{ id: string }>
//   removeReceiptAction({ id })      receiptUrlAction({ id }) → ActionResult<{ url: string }>
// components/pasarelas/receipts (cliente)
export async function downscaleImage(file: File, maxSide?: number): Promise<File>;   // 1600; los PDF no se tocan
export function checkReceiptFile(file: { name: string; type: string; size: number }): string | null;   // mensaje si no vale
export async function sniffReceipt(file: Blob): Promise<'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf' | null>;
export async function uploadToFolder(file: File, folderId: string):
  Promise<{ path: string; mime: string; sizeBytes: number; originalName: string }>;  // a {userId}/{folderId}/{uuid}.{ext}
export async function uploadReceipt(file: File, transactionId: string): Promise<ActionResult<{ id: string }>>;
export function ReceiptPicker(props: { onPick: (file: File | null) => void; error?: string | null }): JSX.Element;   // cámara o galería
```

Reglas: `runAction` llama a `requireSession()`, valida con Zod (errores por campo con `z.flattenError`), ejecuta,
revalida las rutas pedidas (por defecto `/pasarelas` con su árbol) y convierte cualquier error con `errorMessage`;
los `redirect` de Next no se tragan. Toda acción recibe `input: unknown`: nunca confía en tipos del cliente. El `id`
del cobro lo manda el cliente (idempotencia) y se valida como uuid. `checkReceiptFile` valida extensión, tipo
declarado y 10 MB; `sniffReceipt` mira los primeros bytes (el tipo declarado no basta: Storage no comprueba el
contenido) y `uploadToFolder` rechaza un archivo cuyo contenido no coincide con lo declarado. Las imágenes se
recodifican siempre en el navegador (máx. 1600 px; WebP y, si el navegador no lo codifica, JPEG), lo que además les
quita los metadatos; el nombre en Storage es `{uuid}.{ext}` y el original se guarda aparte.

Más reglas, que salen de la revisión de la tarea 9:
- `getPayConfig` exige la sesión, carga con `loadPayConfig` y, si el usuario todavía no tiene ningún feriado,
  llama a `ensureHolidays` y vuelve a cargar (sin una consulta extra en el caso normal).
- `errorMessage`: un `ZodError` **lanzado** es un fallo interno (un desglose guardado que no se deja leer, una
  respuesta de la base con otra forma) y da el mensaje genérico, sin enseñar el texto de Zod. La entrada de la
  persona nunca llega ahí: `runAction` la valida con `safeParse` y devuelve los errores por campo.
- `registerReceipt` guarda el tipo y el tamaño **que dice Storage** (los de su listado), no los que declara el
  navegador; si no coinciden con un tipo permitido o pasan de 10 MB, borra el archivo y rechaza.
- `registerReceipt` y `removeReceipt` dejan en el historial del cobro los eventos `comprobante_agregado` y
  `comprobante_quitado` (inserción directa en `pay_transaction_events`, que es de solo añadir).

- [ ] **Pruebas primero:** `check.test.ts` (tipos y tamaños permitidos y rechazados; cabeceras reales de JPEG, PNG,
      WebP y PDF; un `.txt` renombrado a `.pdf` → rechazado). `e2e/acciones.spec.ts` (390×844) sobre la página de
      prueba: un botón crea el cobro E1 con `createTransaction` y la página muestra `9,70`, `90,30` y `45,15`;
      pulsarlo dos veces seguidas con el mismo `id` deja un solo cobro; se adjunta un PNG generado en memoria y la
      página lo muestra por su URL firmada; un archivo de 11 MB y un `.txt` se rechazan antes de subir; otro usuario
      no puede abrir esa URL firmada pasado el minuto ni registrar un comprobante en un cobro ajeno; una acción
      llamada sin sesión no devuelve datos. En integración (`cobros.test.ts` o un archivo nuevo): el tipo y el
      tamaño guardados son los de Storage aunque se declaren otros, y agregar y quitar un comprobante dejan sus
      dos eventos en el historial.
- [ ] Implementar. `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:int` y el e2e en verde; en la
      tabla de `npm run build` la página de prueba sale `ƒ (Dynamic)`.

### Task 26: «Por caer» con una sola definición

Al integrar la tarea 9 quedaron tres definiciones distintas de «por caer»: la tarjeta (`isPending`: cualquier cobro
`registrado` o `en_transito`), la lista de próximos depósitos (además, bruto vigente > 0) y lo atrasado (ídem). Un
cobro con la disputa abierta entraba en el grupo «marcar depositado» aunque la pasarela retiene ese dinero, y uno
reembolsado por completo se quedaba «por caer» para siempre con su neto negativo. Queda **una** definición, la del
spec §4.1 ya corregido: está por caer lo que **se ve** como `registrado` o `en tránsito`.

**Archivos:** modificar `src/lib/pasarelas/status.ts`, `src/lib/pasarelas/stats.ts` y sus pruebas;
`src/server/pasarelas/queries/transactions.ts` y `queries/config.ts` y sus pruebas;
`supabase/migrations/20261110120000_las_pasarelas_de_pago.sql` (solo la vista `pay_bank_account_totals`);
`tests/integration/{totales.test.ts,funciones.test.ts}`.

**Produce:**

```ts
// status.ts
export function isPending(t: Pick<LeanTx, 'status' | 'disputeState' | 'refunded' | 'grossOriginal'>): boolean;
//   = displayStatus(t) es 'registrado' o 'en_transito'
export function isOverdue(t: Pick<LeanTx, 'status' | 'disputeState' | 'refunded' | 'grossOriginal' | 'estimatedDepositOn'>,
  today: ISODate): boolean;   // = isPending(t) y fecha estimada anterior a hoy
```

Reglas:
- `stats.ts`: `summarize` (tarjeta «por caer») y `upcomingDeposits` usan `isPending` y nada más: se quita la
  condición aparte del bruto vigente (ya va implícita). Sin ramas muertas: la cobertura sigue en 100 %.
- `queries/transactions.ts` (`applyStatus`): `por_caer` = `status` en (`registrado`, `en_transito`), disputa no
  abierta (la columna puede ser nula) y `gross_amount > 0`; `atrasado` = lo mismo y `estimated_deposit_on < today`.
  El comentario de la función debe decir lo que hace.
- **Paginación que no se corta en silencio**: en `leanTx`, `listTx` y `readAll` de `queries/config.ts`, si la
  respuesta llega sin `count` se lanza un error en vez de dar por leídas todas las filas (`count ?? 0` cortaba los
  totales en la primera página).
- Vista `pay_bank_account_totals`: `pending_count` y `pending_net` con el mismo filtro (`status in ('registrado',
  'en_transito') and gross_amount > 0 and dispute_state is distinct from 'abierta'`). La migración se edita en su
  sitio (todavía no se aplicó a ninguna base remota) y, **sin `db:reset`**, la vista se reemplaza en la base local
  con `create or replace view` (mismas columnas) para que las pruebas la vean.

- [ ] **Pruebas primero:**
  - `status.test.ts`: por caer con reembolso parcial → sí; con reembolso total → no; con disputa abierta → no; con
    disputa ganada → sí; con disputa perdida → no; depositado y fallido → no. Atrasado: los mismos casos con la
    fecha estimada pasada, hoy y futura, y sin fecha.
  - `stats.test.ts`: un grupo con un cobro por caer normal, uno con reembolso parcial, uno en disputa abierta y uno
    reembolsado del todo (los cuatro `registrado`): `pendingNet` y `pendingCount` cuentan solo los dos primeros, y
    `upcomingDeposits` trae esos mismos dos.
  - `queries/transactions.test.ts` y `totales.test.ts`: para filas generadas con todos los estados, el filtro
    `por_caer` devuelve exactamente las que cumplen `isPending`, y `atrasado` las que cumplen `isOverdue`; el total
    del filtro `por_caer` coincide con `pendingNet` de `summarize`. Una lectura sin `count` lanza.
  - `funciones.test.ts`: con un cobro por caer (90,30), otro en disputa abierta y otro reembolsado del todo en la
    misma cuenta, `pay_bank_account_totals` da `pending_count 1` y `pending_net 90.30`.
- [ ] Implementar. `npm run typecheck`, `npm run lint`, `npm run coverage` (100 %) y `npm run test:int` en verde.

---

## Fase 1 · Pantallas

Lo común a todas las pantallas está en «Restricciones globales».

### Task 10: Registrar cobro

**Archivos:** `src/app/(dashboard)/pasarelas/registrar/{page.tsx,loading.tsx}`,
`src/components/pasarelas/registrar/{RegisterForm.tsx,LivePreview.tsx,ExtrasToggles.tsx}`,
`src/components/pasarelas/{BreakdownCard.tsx,AllocationList.tsx}`, `e2e/registrar.spec.ts`.

**Consume:** `getPayConfig`, `lastTx`, `createTransaction`, `ReceiptPicker`, `checkReceiptFile`, `uploadReceipt`,
motor completo. **Produce:** `BreakdownCard({ breakdown })` y `AllocationList({ breakdown })` (los reusa el detalle).

- [ ] Formulario de un paso en el orden del spec §8; al elegir pasarela se encienden sus opciones por defecto
      (`defaultExtraIds`); moneda por defecto la de la empresa; fecha y hora «ahora» en Nueva York, con la nota
      «hora de Nueva York»; «Más opciones» plegado.
- [ ] Vista previa en vivo con el mismo motor: `resolveRules` → `compute` → `resolvePayout` →
      `estimateDepositDate`. Si falta configuración (`PayRuleError`), lo dice y enlaza a dónde arreglarlo.
- [ ] El `id` del cobro se genera **una vez** al montar el formulario (`crypto.randomUUID()`) y cambia solo después
      de un guardado correcto; el botón se desactiva mientras guarda.
- [ ] Comprobante: cámara o galería, imagen o PDF; se valida tipo y 10 MB **antes** de subir; se achica en el
      navegador; se sube directo a Storage y se registra. Si la subida falla, el cobro queda guardado y aparece
      «Reintentar comprobante».
- [ ] «Repetir el último» carga la selección del último cobro. Tras guardar: aviso con «Ver cobro» y formulario listo
      para el siguiente con la misma selección.
- [ ] `e2e/registrar.spec.ts`: **«Listo cuando» n.º 1** — Escuela Demo, Stripe con pago rápido, 100: la vista previa
      muestra `3,20`, `1,50`, `5,00`, comisiones `9,70`, neto `90,30`, `45,15` / `27,09` / `18,06` y la fecha
      estimada; se adjunta un PNG generado en memoria; al guardar, el detalle muestra lo mismo y el comprobante.
      **Foco 1:** doble toque en «Guardar» → un solo cobro en la lista. **Foco 3:** un archivo de 11 MB y un `.txt`
      se rechazan con mensaje antes de subir, y el cobro se puede guardar sin comprobante.

### Task 11: Pasarelas

**Archivos:** `src/app/(dashboard)/pasarelas/pasarelas/{page.tsx,nueva/page.tsx,[id]/page.tsx}` y sus
`loading.tsx`; `src/components/pasarelas/gateways/*`; `src/server/pasarelas/{ops,actions}/gateways.ts`;
`tests/integration/pasarelas.test.ts`; `e2e/pasarelas.spec.ts`.

**Produce (acciones):** `createGateway`, `updateGateway`, `setGatewayActive`, `deleteGateway`, `addFeeVersion`
(`{ gatewayId, pct, fixed, effectiveFrom, note? }`), `deleteFeeVersion`, `saveExtra`, `deleteExtra`.

- [ ] Lista con tarifa vigente, días al depósito y tiempo real (promedio y mediana de `pay_gateway_totals`).
      «+ Agregar pasarela»: nombre, % y fijo, días (hábiles o corridos), ¿devuelve la comisión?, costo por disputa.
- [ ] Detalle: opciones con interruptor de «encendida por defecto», %, fijo, base y días; historial de tarifas con
      «vigente desde» (por defecto mañana) y la vigente marcada.
- [ ] **Foco 5:** borrar una pasarela o una tarifa con cobros → «Tiene cobros: desactívala en su lugar».
- [ ] `e2e/pasarelas.spec.ts`: crear «PayPal Demo» 3,49 % + 0,49 con opción «Transferencia inmediata» 1,75 %;
      **«Listo cuando» n.º 3** — agregar a Stripe una tarifa 3,5 % «vigente desde mañana» y comprobar que un cobro
      ya registrado sigue mostrando 3,20 y que uno nuevo con fecha de mañana muestra 3,80.

### Task 12: Empresas

**Archivos:** `src/app/(dashboard)/pasarelas/empresas/{page.tsx,nueva/page.tsx,[id]/page.tsx}`;
`src/components/pasarelas/companies/*`; `src/server/pasarelas/{ops,actions,queries}/companies.ts`;
`tests/integration/empresas.test.ts`; `e2e/empresas.spec.ts`.

**Produce (acciones):** `saveCompany`, `setCompanyActive`, `deleteCompany`, `saveChannel`, `deleteChannel`,
`saveCompanyGateway` (`{ companyId, gatewayId, dashboardUrl, checkoutUrl, bankAccountId, payoutDaysOverride,
defaultExtraIds }`), `deleteCompanyGateway`.

- [ ] Ficha: web, por cada pasarela su «Abrir panel» y «Abrir link de pago» (enlaces `http(s)` con
      `rel="noopener noreferrer"`), canales con su costo, esquema por defecto, cuentas destino. Logo opcional
      (imagen a `{userId}/{companyId}/…` con `uploadToFolder`, vista con URL firmada); sin logo, las iniciales.
- [ ] Resumen propio: «Esta empresa ha facturado X» en el período y en total (`pay_company_totals`), por mes y por
      pasarela (`summarize` sobre `leanTx({ companyId })`), y enlace a sus cobros.
- [ ] Zod rechaza links que no sean `http(s)` y cualquier texto que parezca tarjeta (`looksLikeCardNumber`).
- [ ] `e2e/empresas.spec.ts`: crear «Tienda Demo» con un canal al 3 % + 0,25 y su cuenta de Stripe con links; los
      botones tienen el `href` correcto; `javascript:alert(1)` se rechaza con mensaje.

### Task 13: Cuentas destino y feriados

**Archivos:** `src/app/(dashboard)/pasarelas/{cuentas,feriados}/page.tsx`;
`src/components/pasarelas/{accounts,holidays}/*`; `src/server/pasarelas/{ops,actions}/{accounts,holidays}.ts`;
`e2e/cuentas-feriados.spec.ts`.

**Produce (acciones):** `saveBankAccount`, `setBankAccountActive`, `deleteBankAccount`, `addHoliday`,
`deleteHoliday`, `loadUsHolidays` (`{ year }`).

- [ ] Cuentas: alias, banco o billetera, últimos 4, moneda; lo depositado, lo que está por caer y cuánto tarda
      (`pay_bank_account_totals`). El campo de últimos 4 no admite más de 4 dígitos; el alias rechaza 7 o más
      dígitos seguidos con el mensaje «No guardes números de cuenta completos».
- [ ] Feriados por año; «Cargar feriados bancarios de EE. UU. de <año>» (idempotente).
- [ ] `e2e`: crear una cuenta; pegar `1234567890` en el alias da error; cargar 2028 agrega sus feriados una sola vez.

### Task 14: Repartos

**Archivos:** `src/app/(dashboard)/pasarelas/repartos/{page.tsx,esquemas/[id]/page.tsx,esquemas/nuevo/page.tsx,
beneficiarios/[id]/page.tsx}`; `src/components/pasarelas/splits/*`;
`src/server/pasarelas/{ops,actions,queries}/{splits,settlements}.ts`; `tests/integration/repartos.test.ts`;
`e2e/repartos.spec.ts`.

**Produce (acciones):** `saveBeneficiary`, `setBeneficiaryActive`, `deleteBeneficiary`, `saveScheme`
(`{ schemeId?, name, base, remainderBeneficiaryId, effectiveFrom, lines }` → `pay_save_scheme`), `setSchemeActive`,
`saveSettlement`, `deleteSettlement` (borra también su comprobante). **Consume:** `ReceiptPicker` y
`uploadToFolder(file, settlementId)`: el comprobante de una liquidación va a `{userId}/{settlementId}/…`.

- [ ] Libro: por beneficiario y moneda, asignado, liquidado y saldo (`pay_beneficiary_balances`); el saldo negativo
      se ve con signo y la palabra «a favor de la empresa».
- [ ] Ficha del beneficiario: movimientos (cada reparto con su cobro, cada liquidación) y «Registrar liquidación»
      (fecha, monto, moneda, medio, comprobante, nota; «pago» o «devolución»).
- [ ] Editor de esquema: líneas con beneficiario y %, **suma en vivo**, aviso si no da 100 %, selector de «Resto»,
      base, «vigente desde»; no deja guardar un esquema inválido y dice por qué (`SCHEME_ISSUE_TEXT`). Versiones
      anteriores visibles.
- [ ] `e2e/repartos.spec.ts`: armar el esquema 50/30/20; con 50/30 sin «Resto» el botón no guarda y explica; con
      «Resto» sí; registrar una liquidación de 45,15 al Grupo A con comprobante y ver el saldo bajar.

### Task 15: Cobros — lista

**Archivos:** `src/app/(dashboard)/pasarelas/cobros/{page.tsx,loading.tsx,exportar/route.ts}`;
`src/components/pasarelas/tx/{TxFilters.tsx,TxTable.tsx,TxCards.tsx,TxBulkBar.tsx,TxTotals.tsx,StatusBadge.tsx,
DepositDialog.tsx,RecalcDialog.tsx}`; `e2e/cobros.spec.ts`.

**Consume:** `parseTxFilters`, `listTx`, `leanTx`, `totalsOf`, acciones de la tarea 9. **Produce:** `StatusBadge`,
`DepositDialog`, `RecalcDialog` (los reusa el detalle y el Resumen).

- [ ] Búsqueda, filtros (período, empresa, canal, pasarela, cuenta, moneda, estado, con o sin comprobante), orden y
      paginación de 50, todo en la URL. Totales del filtro por moneda (nunca mezclados).
- [ ] Tabla desde 768 px; tarjetas en celular. Selección múltiple con barra de acciones: marcar en tránsito, marcar
      depositado (con fecha), recalcular (elige «tarifa vigente hoy» o «la de la fecha del cobro», y enseña el
      **antes y el después** antes de confirmar), a la papelera.
- [ ] Exportar CSV del filtro completo (no solo la página), en formato español o estándar, sin datos de compradores.
- [ ] `e2e/cobros.spec.ts`: **«Listo cuando» n.º 5** — con 3 cobros de Stripe, seleccionarlos, «Marcar depositado»
      con fecha y ver los tres depositados y el tiempo promedio de la pasarela actualizado; el filtro «Sin
      comprobante» los encuentra; el CSV descargado trae sus referencias y sus montos con coma.

### Task 16: Cobro — detalle, acciones y papelera

**Archivos:** `src/app/(dashboard)/pasarelas/cobros/[id]/{page.tsx,editar/page.tsx}`,
`src/app/(dashboard)/pasarelas/papelera/page.tsx`;
`src/components/pasarelas/tx/{TxDetail.tsx,TxActions.tsx,RefundDialog.tsx,DisputeDialog.tsx,EditForm.tsx,
EventsTimeline.tsx,ReceiptsCard.tsx}`; `e2e/cobro-detalle.spec.ts`.

- [ ] Detalle: `BreakdownCard`, `AllocationList`, fechas (cobro, estimada, real), cuenta destino, comprobantes
      (ver con URL firmada, agregar, quitar) e historial.
- [ ] Acciones según el estado: editar, cambiar la fecha estimada o volver a la automática, en tránsito, depositado,
      revertir depósito, reembolso (monto, fecha, nota; muestra el antes y el después), disputa (abrir, ganada,
      perdida, anular), marcar fallido o reabrir, recalcular, a la papelera. Las no permitidas no se muestran.
- [ ] Papelera: restaurar, borrar del todo (confirmación que dice que también se borran los comprobantes) y vaciar.
- [ ] Viene de la tarea 10: registrar E1 por la pantalla «Registrar cobro» con un comprobante, tocar «Ver cobro» en
      el aviso y ver en el detalle `9,70`, `90,30`, `45,15` / `27,09` / `18,06`, la fecha estimada y el comprobante.
- [ ] `e2e/cobro-detalle.spec.ts`: **«Listo cuando» n.º 6** — reembolso parcial de 40 sobre el cobro E1: bruto
      `60,00`, costo del reembolso `1,16`, neto `52,90`, reparto `26,45` / `15,87` / `10,58`, y el historial lo
      registra; abrir disputa suma `15,00` y ganarla lo revierte; mandar a la papelera lo saca de la lista y
      restaurarlo lo devuelve; borrarlo del todo elimina también el comprobante. **Foco 3:** quitar un comprobante
      borra archivo y fila.

### Task 17: Resumen

**Archivos:** `src/app/(dashboard)/pasarelas/{page.tsx,loading.tsx,error.tsx}`;
`src/components/pasarelas/summary/{SummaryFilters.tsx,StatCards.tsx,MonthChart.tsx,CompanyRanking.tsx,
GatewayShare.tsx,GatewayCost.tsx,AccountsChart.tsx,UpcomingDeposits.tsx,SplitsTable.tsx,Notices.tsx,ChartFrame.tsx,
BarsChart.tsx}` (`BarsChart.tsx` es el único módulo que importa Recharts: `ChartFrame`, de cliente, lo carga con
`next/dynamic` y `ssr: false`); `src/server/pasarelas/queries/summary.ts`; `src/server/pasarelas/queries/paging.ts`
(`readAll`, la lectura por tramos que comparten `config.ts` y `summary.ts`); `e2e/resumen.spec.ts`.

**Consume:** `leanTx`, `summarize`, `upcomingDeposits`, `pay_beneficiary_balances`, `DepositDialog`.

- [ ] Filtros: período (este mes, el anterior, 30, 90 y 365 días, el año y uno a elegir), empresa, pasarela, canal y
      moneda. Si hay más de una moneda, selector de moneda; nunca un total mezclado.
- [ ] Tarjetas, gráficos, próximos depósitos (14 días por fecha y cuenta; atrasados arriba en ámbar; «Marcar
      depositado» por grupo = «todo lo de esta fecha y esta cuenta»), repartos por beneficiario (asignado y
      liquidado en el período, saldo de toda la historia) y avisos (sin comprobante, atrasados, empresas sin esquema,
      disputas abiertas, año sin feriados) como en el spec §8.
- [ ] Gráficos con Recharts en componentes de cliente cargados perezosamente; colores desde los tokens; cada gráfico
      con título, resumen en texto y tabla alternativa accesible; sin desbordar a 390 px.
- [ ] `e2e/resumen.spec.ts`: **«Listo cuando» n.º 4** — con cobros de dos empresas y dos pasarelas: cuánto facturó
      cada empresa, comisiones por pasarela, qué cae en los próximos 14 días y en qué cuenta, y cuánto se le debe a
      cada grupo; marcar depositado un grupo desde aquí lo mueve de «por caer» a «depositado».

### Task 18: Ajustes — exportar todo y contraseña a prueba de configuración

**Archivos:** crear `src/server/pasarelas/queries/export.ts` (la lectura, con el cliente inyectado),
`tests/integration/exportar.test.ts`, `src/app/(dashboard)/ajustes/{ExportCard.tsx,exportar/route.ts}` y
`e2e/ajustes.spec.ts`; modificar `src/app/(dashboard)/ajustes/{page.tsx,actions.ts,SecurityCard.tsx}`,
`next.config.ts` y `e2e/sesion.spec.ts`.

**Produce:**

```ts
// queries/export.ts (server-only)
export type ExportFile = { format: 'pasarelas-export'; version: 1; exportedAt: string;
  tables: Record<string, Record<string, unknown>[]> };       // las 17 tablas pay_*, cada fila con todas sus columnas
export async function exportAll(supabase: SupabaseClient<Database>, nowIso: string): Promise<ExportFile>;
```

- [ ] «Exportar todo» descarga un JSON con **todas** las columnas de todas las filas `pay_*` del usuario (las 17
      tablas, sin archivos), con la fecha en el nombre. Los montos y porcentajes salen como texto, tal como están
      guardados (`"90.30"`), nunca como número. Lee por tramos: una tabla con más de 1000 filas sale entera. El
      archivo lleva la versión del formato y la fecha y hora de la exportación. Texto que explica que es la copia
      propia del dueño y que no incluye los comprobantes.
- [ ] `changePassword` comprueba la contraseña actual **en la app** antes de cambiarla (entrando con ella en un
      cliente aparte, sin cookies ni sesión persistente): no depende de que el proyecto de Supabase tenga encendido
      «exigir la contraseña actual». La prueba «cambiar la contraseña exige la actual» de `e2e/sesion.spec.ts`
      deja de ser condicional y de omitirse sola.
- [ ] La tarjeta de seguridad dice, junto a «Cerrar sesión en todos los dispositivos», que otro dispositivo puede
      tardar hasta una hora en quedar fuera.
- [ ] `Strict-Transport-Security` queda en `max-age=63072000`, sin `includeSubDomains` ni `preload`: la app no
      decide por todo el dominio del dueño.
- [ ] `tests/integration/exportar.test.ts`: `exportAll` trae las 17 tablas; en cada una, las claves de una fila
      exportada son exactamente las columnas que devuelve `select('*')` (si mañana se añade una columna y no se
      exporta, la prueba falla); los `numeric` salen como texto con sus decimales; con 1 005 feriados salen los
      1 005; otro usuario no ve nada de eso.
- [ ] `e2e/ajustes.spec.ts`: la descarga trae las 17 tablas y los cobros creados en la prueba, con el neto del
      cobro E1 como el texto `"90.30"`; sin sesión, la ruta de exportar no entrega datos.

### Task 27: Importador — la parte pura (fase B)

Lo que no depende de pantallas ni de la base: reconocer un archivo, proponer su mapeo y convertir sus filas. Va en
el motor (funciones puras, cobertura 100 %). El CSV se lee **en el navegador** (tarea 19) y al servidor solo viajan
las filas ya convertidas: los correos y nombres de compradores no salen del equipo de quien importa.

**Archivos:** crear `src/lib/pasarelas/import/{detect.ts,presets.ts,mapping.ts,index.ts}` con sus pruebas junto al
código y `tests/fixtures/{stripe-pagos.csv,stripe-saldo.csv,paypal-actividad.csv,otro.csv}` (datos inventados);
modificar `src/lib/pasarelas/index.ts` (reexportar) e `index.test.ts`.

**Consume:** `parseMoney`, `isMoney`, `looksLikeCardNumber` y `dates.ts` del motor. **Produce:**

```ts
export type ImportFormat = 'stripe_pagos' | 'stripe_saldo' | 'paypal_actividad' | 'otro';
export type ColumnMapping = {
  reference: string; date: string; time?: string | null; timezone?: string | null;
  gross: string; currency?: string | null; fee?: string | null; status?: string | null; type?: string | null;
  note?: string | null;                 // por defecto ninguna: una columna de descripción puede traer datos de terceros
  fixedZone: string;                    // zona IANA (o 'UTC') cuando el archivo no trae columna de zona
  decimal: '.' | ',';
  dateFormat: 'YYYY-MM-DD' | 'MM/DD/YYYY' | 'DD/MM/YYYY';   // la hora, si viene, es HH:mm o HH:mm:ss (pegada o en su columna)
  defaultCurrency: Currency;            // cuando no hay columna de moneda o viene vacía
};
export function detectFormat(headers: readonly string[]): ImportFormat;
export function presetFor(format: ImportFormat): ColumnMapping | null;        // 'otro' → null
export function validateMapping(headers: readonly string[], m: ColumnMapping): string[];   // problemas, en español
export type ImportRow = { line: number; reference: string; occurredAt: string; occurredOn: ISODate;
  grossOriginal: Money; currency: Currency; reportedFee: Money | null; note: string | null };
export type ImportSkip = { line: number; reason: string };
export function mapRows(rows: readonly Record<string, string>[], m: ColumnMapping, format: ImportFormat):
  { ok: ImportRow[]; skipped: ImportSkip[]; errors: ImportSkip[] };
```

Reglas:
- **Los encabezados reales no se inventan**: se toman de la documentación oficial vigente de cada pasarela (la
  exportación de pagos de Stripe, la de movimientos de saldo de Stripe y la descarga de actividad de PayPal) y el
  informe cita la fuente de cada uno. `detectFormat` compara sin distinguir mayúsculas, espacios alrededor ni la
  marca BOM, y exige las columnas que hacen falta para ese formato; si no reconoce el archivo, `otro`.
- `line` es la línea del archivo (la primera fila de datos es la 2).
- **Solo cobros**: se convierten las filas que son un cobro logrado. Lo demás se cuenta en `skipped` con su motivo
  en español: reembolsos, retiros y depósitos al banco, comisiones sueltas, ajustes, retenciones y conversiones de
  moneda, cobros fallidos o pendientes, y una referencia que ya salió antes en el mismo archivo. Una fila que no se
  puede leer (fecha, monto, moneda o zona inválidos, falta la referencia) va a `errors` con línea y motivo.
- Un cobro que el archivo marca con un reembolso se importa por su monto original y su nota dice cuánto trae
  reembolsado, para aplicarlo después en el detalle del cobro (el importador no registra reembolsos).
- **Montos** con el separador decimal del mapeo (`1,234.56` con punto; `1.234,56` con coma), sin pasar por
  `number`; el resultado es `Money` canónico. La comisión informada se guarda **en positivo** aunque el archivo la
  traiga negativa; vacía → `null`.
- **Fechas**: con columna de zona, se respeta la de cada fila (abreviaturas habituales de EE. UU. y nombres IANA;
  una zona que no se reconoce es un error de esa fila, no una suposición); sin ella, `fixedZone`. `occurredAt` sale
  como instante ISO en UTC y `occurredOn` es su fecha en `America/New_York`. Las horas que no existen o se repiten
  por el cambio de horario se resuelven sin depender de la zona de la máquina.
- **Nunca** se leen columnas de correo, nombre o dirección del comprador: los valores por defecto no las mapean, y
  `validateMapping` rechaza mapear `note` o `reference` a una columna cuyo nombre sea de correo, nombre o dirección.
  Una nota que parece número de tarjeta (`looksLikeCardNumber`) se descarta.
- [ ] **Pruebas primero**: los tres formatos con sus archivos de ejemplo (leídos con papaparse **en la prueba**),
      con filas de cada tipo que se omite; fechas en UTC, con columna de zona y con zona fija, incluidos un cobro a
      las 23:30 de Los Ángeles (cae al día siguiente en Nueva York) y los dos cambios de horario de 2026; montos
      `1,234.56` y `1.234,56`; comisión con signo negativo; referencia repetida en el archivo; columnas de
      comprador presentes en el archivo y ausentes del resultado; `otro` con un mapeo a mano. Cobertura 100 %.
- [ ] Implementar. `npm run typecheck`, `npm run lint` y `npm run coverage` en verde.

### Task 19: Importar CSV — pantalla y guardado (fase B)

**Archivos:** `src/app/(dashboard)/pasarelas/importar/{page.tsx,loading.tsx}`; `src/components/pasarelas/import/*`;
`src/server/pasarelas/{ops,actions}/import.ts`; `tests/integration/importar.test.ts`; `e2e/importar.spec.ts`.

**Consume:** tarea 27 (`detectFormat`, `presetFor`, `validateMapping`, `mapRows`), `planCreate`, `saveTx`,
`runAction`, `getPayConfig`. **Produce (acciones):** `importTransactions` (`{ companyId, gatewayId, channelId,
extraIds, useReportedFee, rows: ImportRow[] }` en lotes de 500 → `{ created, duplicates }`) y `saveImportMapping`
(`{ gatewayId, format, mapping }` → `pay_gateways.import_mapping`).

> **Forma de `pay_gateways.import_mapping`** (decidida al implementar): un sobre `{ format: ImportFormat, mapping:
> ColumnMapping }`, no el `ColumnMapping` suelto. El formato sirve para avisar cuando llega a la misma pasarela un
> archivo de otro formato (Stripe saldo y Stripe pagos dan referencias distintas al mismo cobro: «Ojo: puede duplicar
> cobros», con la casilla «Son otros cobros: importar igual»). `getImportMappings` (`queries/import.ts`) valida esa
> forma con Zod e **ignora sin avisar** lo que no la tenga: la semilla (tarea 20) o cualquier otra tarea que escriba
> el mapeo tiene que usar el sobre.

- [ ] El archivo se lee **en el navegador** con papaparse (no se sube): se detecta el formato por encabezados, se
      propone el mapeo y se puede ajustar; el mapeo se recuerda por pasarela. Se eligen empresa, pasarela, canal y
      opciones para todos los cobros del archivo. Un archivo de más de 5 000 filas se rechaza con mensaje.
- [ ] «Así lo entendí»: N nuevos, N omitidos (con su motivo) y N con error (línea y motivo), y una muestra de las
      primeras filas ya convertidas, antes de guardar. Opción «usar la comisión del archivo» (`feeOverride`).
- [ ] Guarda con `planCreate(…, 'importado')` y `saveTx(…, { skipDuplicates: true })`; al terminar dice cuántos se
      crearon y cuántos ya existían (por referencia en esa pasarela) y no se tocaron. El servidor vuelve a validar
      cada fila con Zod: nunca confía en lo que mandó el navegador.
- [ ] Pruebas: integración de `ops/import.ts` (crea, respeta `feeOverride`, **importar dos veces el mismo archivo
      no duplica nada**, una fila inválida no deja el lote a medias); `e2e/importar.spec.ts` con el archivo de
      ejemplo de Stripe: sube, revisa «Así lo entendí», guarda, los cobros aparecen con sus comisiones, y al
      repetir el archivo dice que ya existían.

### Task 28: Registrar cobro — arreglos tras la revisión

**Archivos:** modificar `src/components/pasarelas/registrar/RegisterForm.tsx`,
`src/app/(dashboard)/pasarelas/registrar/{page.tsx,error.tsx}` y `e2e/registrar.spec.ts`.

- [ ] **El `id` del cobro nace en el navegador al montar el formulario** (`useState(() => crypto.randomUUID())`; no
      se pinta en el HTML, así que no rompe la hidratación) y no llega del servidor. Hoy llega como prop de la página:
      al volver con «Atrás» a una página restaurada de la caché del navegador, el formulario remonta con un `id` ya
      usado, `createTransaction` (idempotente) no crea nada y la pantalla dice que guardó. Prueba: guardar un cobro,
      ir a otra pantalla, volver con «Atrás», guardar otro → hay dos cobros.
- [ ] Un fallo **después** de guardar el cobro (la subida del comprobante, el aviso) nunca dice «No se pudo guardar
      el cobro»: dice que el cobro quedó guardado y qué falló.
- [ ] Si el comprobante no se subió, el aviso de éxito lo dice (no un «Cobro guardado.» a secas) y remite al
      reintento. Si el fallo es por el contenido del archivo (no se puede leer, no es lo que dice ser), en lugar de
      «Reintentar comprobante» se ofrece «Elegir otro archivo» para ese cobro.
- [ ] Cada reintento pendiente dice que el comprobante también se puede agregar después desde el detalle del cobro
      (salir de la pantalla no pierde el cobro, solo ese reintento).
- [ ] `registrar/error.tsx` no dice «Tus datos están guardados.» (es un formulario de alta): dice qué hacer.
- [ ] `npm run typecheck`, `npm run lint`, `npm test` y `e2e/registrar.spec.ts` en verde en modo producción.

---

## Fase 2 · Cierre

### Task 20: Semilla demo

**Archivos:** `scripts/seed-pasarelas-demo.ts`, `scripts/demo-data.ts`.

- [ ] 3 empresas (Tienda Demo, Escuela Demo, Estudio Demo), Stripe / PayPal / Zelle con tarifas y opciones, 3 cuentas
      destino, Grupos A/B/C y un cuarto beneficiario, 2 esquemas, ~60 cobros en los 3 meses anteriores a hoy
      (generador con semilla fija), con depósitos, un reembolso parcial, una disputa, un fallido y liquidaciones.
- [ ] Usa `planCreate` y `saveTx`: lo sembrado pasa las mismas restricciones que lo real. Crea el usuario demo si hay
      clave secreta local; si no, entra con `SEED_EMAIL` / `SEED_PASSWORD`. `--reset` borra antes los datos de ese
      usuario; sin `--reset` se niega si ya hay datos.
- [ ] `npm run seed` deja el Resumen lleno; correrlo dos veces con `--reset` da los mismos totales.

### Task 21: «Listo cuando» de punta a punta y verificación completa

**Archivos:** crear `e2e/listo-cuando.spec.ts`; modificar `e2e/registrar.spec.ts` y cualquier otra prueba que
todavía deje pasar errores de consola por rutas «pendientes» (ya existen todas).

- [ ] `listo-cuando.spec.ts` recorre de corrido, a 390×844 y contra `next build && next start`, por las pantallas
      (sin atajos por la base salvo para preparar datos que no son el objeto de la prueba), los siete «Listo cuando»
      del encargo:
  1. Registrar E1 desde «Registrar cobro» (Escuela Demo, canal al 5 %, Stripe con pago rápido, 100): la vista previa
     muestra `9,70`, `90,30`, `45,15` / `27,09` / `18,06` y la fecha estimada; guardado, el detalle muestra lo mismo.
  2. La foto del comprobante se sube desde el celular y **solo la ve el dueño**: otro usuario no abre el detalle del
     cobro, no puede firmar la ruta del archivo en Storage con su sesión, y el enlace firmado del dueño caduca.
  3. Una tarifa de Stripe «vigente desde mañana» (3,5 %) no mueve el cobro viejo (sigue en `3,20`) y la vista previa
     de un cobro con fecha de mañana muestra `3,80`.
  4. El Resumen dice cuánto facturó cada empresa, las comisiones por pasarela, qué cae en los próximos 14 días y en
     qué cuenta, y cuánto se le debe a cada grupo.
  5. Marcar depositados varios cobros de una vez desde Cobros actualiza el tiempo promedio de la pasarela en su
     pantalla.
  6. Un reembolso parcial de 40 sobre E1 deja todo cuadrado al centavo (`60,00`, `1,16`, `52,90`, `26,45` / `15,87` /
     `10,58`).
  7. Nada público: sin sesión, cada ruta del módulo manda a la entrada; con segundo factor y sin el código, a
     `/login/verificar`, y la base no le devuelve filas a esa sesión.
- [ ] Ninguna prueba deja pasar errores de consola por rutas que «todavía no existen».
- [ ] Verificación completa desde `pasarelas/`: `npm run lint`, `npm run typecheck`, `npm run coverage` (100 % del
      motor), `npm run test:int`, `npm run build` (todo lo privado `ƒ (Dynamic)`) y `npm run test:e2e` entero en
      verde y con la salida limpia.

### Task 29: Accesibilidad en todas las pantallas y capturas

**Archivos:** crear `e2e/accesibilidad.spec.ts`, `scripts/capturas.ts` y `docs/capturas/*`.

- [ ] `accesibilidad.spec.ts`: cada ruta del spec §8 (también las de detalle, edición y alta, la entrada, el código y
      Ajustes), con un usuario sembrado con `seedDemo`, en claro y en oscuro y en los dos tamaños: sin violaciones
      serias ni críticas de axe, sin desbordamiento horizontal y con los objetivos táctiles de al menos 44 px.
- [ ] `scripts/capturas.ts`: capturas de cada pantalla en el celular (390×844, escala 2) con los datos de la semilla,
      en claro (y el Resumen también en oscuro), en `docs/capturas/` con nombres que digan qué pantalla son. Solo
      datos inventados. Livianas (WebP si hay con qué convertir sin dependencias nuevas; si no, PNG optimizado).
- [ ] Lo que las capturas o axe revelen (textos cortados, cifras que no caben, contraste) se arregla en la pantalla
      que corresponda, con su prueba.

### Ola de arreglos de la revisión final (tareas 30 a 36)

Una revisión adversarial de toda la rama (seis dimensiones, cada hallazgo grave verificado por otro agente que
intentó refutarlo) dejó 17 hallazgos confirmados y 26 menores. Están, con su escenario, su evidencia y el arreglo
verificado, en un JSON de trabajo que no se guarda en el repo: «#n» es el n-ésimo hallazgo confirmado y «mN» el
N-ésimo menor (contando desde 1); lo que se arregló de cada uno se dice en las tareas de abajo. Cada tarea
de esta ola es dueña de sus archivos: no toca los de las otras, que corren a la vez. Todas terminan con sus
pruebas (unitarias, de integración y de punta a punta en modo producción) en verde y la salida limpia.

### Task 30: Cobros — depósitos, concurrencia, reintentos y pantallas en el celular

**Dueña de:** `src/lib/pasarelas/{write,rules}.ts` (+ pruebas), `src/server/pasarelas/ops/transactions.ts`,
`actions/transactions.ts`, `ops/holidays.ts`, `actions/{holidays,gateways}.ts` (solo para lo del punto 7),
`src/components/pasarelas/tx/**` (salvo `ReceiptsCard.tsx`), `src/components/pasarelas/registrar/**`,
`src/components/pasarelas/BreakdownCard.tsx`, `src/components/pasarelas/summary/UpcomingDeposits.tsx`, un nuevo
`src/components/pasarelas/callAction.ts`, `src/app/(dashboard)/pasarelas/cobros/**`, `tests/integration/cobros.test.ts`
y `e2e/{registrar,cobros,cobro-detalle,listo-cuando}.spec.ts`.

1. **#1** — «Marcar depositado» en lote (Cobros y Resumen) solo deposita lo que está POR CAER (`isPending`): salta los
   ya depositados (no les pisa la fecha) y los que tienen la disputa abierta o el reembolso total; el aviso dice
   cuántos se saltaron y por qué. Cambiar la fecha de un depósito ya hecho queda solo en el detalle del cobro.
2. **#6 y #7 (reembolso)** — Las acciones de un solo cobro reciben el `updatedAt` que vio la persona
   (`expectedUpdatedAt`) y la base compara contra ese: una pestaña vieja no pisa cambios ni aplica una vista previa
   que ya no vale, y un reembolso reintentado tras un corte da conflicto en vez de sumarse dos veces.
3. **#5 y #12** — `createTransaction` devuelve `{ id, created }`; si el `id` ya existía con OTROS datos (monto,
   moneda, fecha, empresa, pasarela, canal, opciones, esquema, referencia), no escribe y lo dice. Registrar no
   enseña «Cobro guardado.» si no se creó nada, y el aviso tras un fallo de red no afirma que no se guardó («No
   sabemos si se guardó: revisa Cobros antes de cambiar nada; si lo envías igual, no se duplica»).
4. **#11** — Un ayudante `callAction` atrapa el fallo de red de una acción en los diálogos y barras de cobros: el
   error sale en el propio diálogo (sin desmontarlo ni ir a `error.tsx`), dice que hay que revisar antes de repetir
   y refresca la pantalla.
5. **#16 (Registrar)** — Si la empresa elegida tiene un esquema por defecto desactivado, Registrar lo avisa fuera de
   «Más opciones» («este cobro no se reparte») con enlace a la empresa.
6. **Celular** — En el detalle del cobro, lo primero son los datos y el desglose; las acciones van agrupadas (la
   principal a la vista y el resto en «Más acciones»). En la lista de Cobros, la lista aparece pronto: la exportación
   a CSV va en un menú o al final, y los totales del filtro, plegables con una línea de resumen.
7. **m25** — Al cambiar feriados o los días al depósito de una pasarela, se recalculan las fechas estimadas
   AUTOMÁTICAS de lo que está por caer (sin tocar comisiones ni las fechas puestas a mano), y se dice cuántas cambiaron.
8. Menores: **m1** (corregir el monto de un cobro importado descarta la comisión informada del archivo), **m2** (la
   línea prorrateada no dice «Informada por la pasarela»), **m7** (la fecha de depósito no puede ser anterior a la
   del cobro ni futura), **m10** (foco tras una acción en lote), **m13** (la tabla del antes y el después cabe a
   390 px), **m24** (una prueba de fecha estimada con días hábiles y feriado por la pantalla de Registrar).

### Task 31: Importar — estado, repetidos y esquema

**Dueña de:** `src/lib/pasarelas/import/**` (+ pruebas y `tests/fixtures/`), `src/server/pasarelas/{ops,actions,queries}/import.ts`,
`src/components/pasarelas/import/**`, `tests/integration/importar.test.ts` y `e2e/importar.spec.ts`.

1. **#2** — Opción «Estos cobros ya se depositaron»: los de fecha estimada hasta hoy entran como depositados en esa
   fecha (es una estimación y se dice). «Así lo entendí» dice cuántos quedarán por caer y cuántos atrasados con la
   opción apagada, y la sugiere si hay atrasados.
2. **#8** — Los repetidos que están en la papelera se cuentan aparte y se dice qué hacer.
3. **#15** — Stripe saldo usa `source_id` (`ch_…`/`py_…`) como referencia cuando viene (confírmalo en la fuente
   oficial y anótalo en `presets.ts`); antes de importar se buscan las referencias que ya existen en esa pasarela
   (papelera incluida) y se enseñan como repetidas; y las filas que coinciden con un cobro registrado a mano sin esa
   referencia (misma empresa, pasarela, moneda y bruto, ±1 día) se marcan como «posible repetido» y piden confirmar.
4. **#16 (Importar)** — El esquema por defecto solo se aplica si está activo; «Así lo entendí» dice qué esquema se
   aplicará.
5. Menores de la tarea 27: la marca BOM como `\uFEFF` (no un carácter invisible); «Pago por transferencia» no se
   omite como retiro en «otro»; BUYER_COLUMN reconoce nombres con guion bajo y no confunde «city» dentro de otras
   palabras.

### Task 32: Resumen en el celular y la moneda por defecto

**Dueña de:** `src/app/(dashboard)/pasarelas/page.tsx`, `src/components/pasarelas/summary/**` (salvo
`UpcomingDeposits.tsx`), `src/server/pasarelas/queries/summary.ts` (+ pruebas), `src/lib/pasarelas/stats.ts`
(+ pruebas) y `e2e/resumen.spec.ts`.

1. La moneda por defecto es la que tiene más cobros en el período (en empate, la de la mayoría de las empresas), no
   la de más bruto comparando monedas distintas como números.
2. En el celular, las cifras se ven sin desplazar: los filtros van plegados tras un botón «Filtros» que resume lo
   elegido; desde 768 px, como hoy.
3. **#16 (Resumen)** — El aviso de empresas sin esquema cuenta también las que tienen uno desactivado.
4. **m3** — La parte de cada cuenta destino no da más de 100 % ni porcentajes negativos cuando hay pérdidas.
5. Menores de la tarea 17: «Marcar depositado» de un grupo de más de 500 cobros va por lotes; una pasarela sin costo
   efectivo no se dibuja como 0 %; el vacío al pedir una moneda sin cobros dice qué pasa.

### Task 33: Comprobantes y liquidaciones

**Dueña de:** `src/components/pasarelas/receipts/**`, `src/components/pasarelas/tx/ReceiptsCard.tsx`,
`src/server/pasarelas/{ops,actions}/receipts.ts`, `src/components/pasarelas/splits/{SettlementForm,Movements}.tsx`,
`src/server/pasarelas/{ops,actions}/settlements.ts`, `src/components/pasarelas/companies/LogoEditor.tsx`,
`tests/integration/{comprobantes,repartos}.test.ts` y `e2e/repartos.spec.ts`.

1. **#7 (liquidación)** — Registrar una liquidación es idempotente: tras un corte conserva su `id`, el reintento no
   crea otra y el comprobante no se borra si no se sabe si la fila quedó.
2. **#9** — El «Tipo» de la liquidación que se ve es el que se guarda, también tras guardar o tras un error.
3. **m5** — Si una acción lanza después de que el servidor ya guardó, el navegador no borra el archivo (comprobante
   o logo): solo lo borra ante un rechazo seguro.
4. **m4** — No se guarda ni se muestra el nombre original del archivo (puede traer datos de otra persona): se
   identifica por tipo y fecha.
5. Menores: **m8** (quitar un comprobante dos veces no duplica el evento), **m14** («Ver» y «Quitar» dicen de qué
   comprobante son), **m18** (la URL firmada del PDF se pide al tocar el enlace), y de la tarea 14: el tipo y el
   tamaño del comprobante de una liquidación salen de Storage (`storedFile`), una prueba de la devolución (monto
   negativo), la etiqueta de borrar una devolución sin el signo menos.

### Task 34: Configuración — cuentas, empresas, esquemas y Ajustes

**Dueña de:** `src/components/pasarelas/{accounts,holidays}/**`, `src/components/pasarelas/companies/**` (salvo
`LogoEditor.tsx`), `src/components/pasarelas/gateways/**`, `src/components/pasarelas/splits/{SchemeStatusActions,SchemeEditor}.tsx`,
`src/server/pasarelas/{ops,actions}/companies.ts`, `src/app/(dashboard)/pasarelas/empresas/**`,
`src/app/(dashboard)/ajustes/{error,loading}.tsx`, `src/lib/supabase/proxy.ts`, y sus pruebas
(`e2e/{empresas,cuentas-feriados,pasarelas}.spec.ts`).

1. **#17** — Desactivar una cuenta destino que usan cuentas de pasarela avisa cuántas son y que los cobros nuevos la
   seguirán usando hasta cambiarla; la ficha de la empresa marca «Cuenta inactiva»; el texto de la pantalla dice
   la verdad.
2. **#16 (Configuración)** — La ficha de la empresa marca «(desactivado)» junto a un esquema por defecto inactivo, y
   desactivar un esquema nombra antes las empresas que lo tienen por defecto.
3. **#11 (formularios de configuración)** — Un fallo de red en los formularios de pasarela y de esquema sale en el
   propio formulario, sin perder lo escrito.
4. Menores: **m9** (un error no queda detrás de un diálogo abierto), **m12** (`/ajustes` con `error.tsx` y
   `loading.tsx`), **m16** (borrar una empresa desde su ficha no pinta un 404 antes de volver a la lista), **m19**
   (con sesión, `/login?siguiente=…` respeta `siguiente`), **m26** («Ver sus cobros» abre todo su historial).

### Task 35: Kit — formularios que no se desincronizan

**Dueña de:** `src/components/ui/{Inputs,Toggles}.tsx` (+ pruebas), `e2e/kit.spec.ts`, la línea de `AGENTS.md` sobre el
reinicio de los formularios de React 19.

1. **#10** — Al terminar la acción de un `<form>`, React 19 reinicia el formulario: un `Select`, `Checkbox` o `Switch`
   controlado vuelve a su valor inicial EN PANTALLA aunque el estado diga otro. Las primitivas mantienen
   `defaultSelected`/`defaultChecked` iguales al valor controlado, para que el reinicio no cambie nada. Prueba en la
   galería con un formulario de acción real; `AGENTS.md` dice cómo es.

### Task 36: Seguridad en la base y en Storage

**Dueña de:** `supabase/migrations/20261110120000_las_pasarelas_de_pago.sql`, `tests/integration/{rls,storage}.test.ts`,
un nuevo `tests/integration/sesiones.test.ts` y `src/app/(dashboard)/ajustes/SecurityCard.tsx` (solo textos).

1. **#3** — Políticas RESTRICTIVAS en `storage.objects` para el bucket `comprobantes` (la carpeta del usuario y el
   segundo factor), aparte para `authenticated` y para `anon`, más su comprobación al final de la migración y una
   prueba que cree una política permisiva amplia y vea que una sesión aal1 con factor sigue sin ver nada.
2. **#4** — Una sesión cerrada (cambio de contraseña, «cerrar sesión en todos», o cerrar sesión en ese dispositivo)
   deja de leer y escribir de inmediato: `private.pay_mfa_ok()` exige además que la sesión del token siga existiendo
   en `auth.sessions`. Comprueba en el stack local qué sesiones borra Auth en cada caso y pruébalo; si alguno no las
   borra, dilo. Los textos de Ajustes dicen lo que de verdad pasa.
3. **m23** — Una prueba de que el registro público está apagado.
4. Los cambios se aplican a la base local compartida SIN reiniciarla (`create or replace function`, `create policy`
   con `psql`), y el informe deja el SQL exacto.

### Remates tras revisar las tareas 30 y 33 (tareas 37 y 38)

Las tareas 30 y 33 se integraron sin pasar por su revisión; una revisión aparte (cada hallazgo grave verificado por
otro agente) quedó en un JSON de trabajo que no se guarda en el repo: los confirmados (R1 a R4), lo que quedó a
medias y los menores. Lo que se arregló de cada uno se dice en las tareas 37 y 38.

### Task 37: Remates de cobros, fechas estimadas y configuración

**Dueña de:** `src/lib/pasarelas/{write,rules}.ts` (+ pruebas), `src/server/pasarelas/ops/transactions.ts`,
`actions/{transactions,holidays,gateways,companies}.ts`, `src/components/pasarelas/callAction.ts`,
`src/components/pasarelas/tx/**` (salvo `ReceiptsCard.tsx`), `registrar/**`, `holidays/**`, `accounts/**`, `gateways/**`,
`splits/SchemeStatusActions.tsx`, `src/app/(dashboard)/pasarelas/cobros/**`, `tests/integration/{cobros.test.ts,helpers.ts}`
y `e2e/{cobros,cobro-detalle,registrar,cuentas-feriados,pasarelas,listo-cuando}.spec.ts`.

1. **R1** — Depositar (o cambiar la fecha del depósito) y recalcular DESDE EL DETALLE mandan la versión vista: una
   pestaña vieja da conflicto. Los lotes siguen con «solo por caer».
2. **R2** — `callAction` no refresca solo tras un fallo de red (con mala señal el refresco recarga la página y se
   pierde todo): el aviso ofrece «Ver cómo quedó», que refresca cuando la persona lo pide (y al cerrar el diálogo).
3. **R3** — Un reenvío del alta con el mismo `id` compara también el estado inicial, la fecha de depósito, la cuenta,
   la fecha estimada y la nota.
4. Lo que quedó a medias: **m7** (`planEdit` no deja la fecha del cobro después de su depósito), **m10** (si el lote
   vacía la lista, el foco va al encabezado o al vacío), **m25** (los avisos de feriados, de la pasarela y de la cuenta
   de la pasarela en la empresa dicen cuántas fechas estimadas cambiaron; si el recálculo falla, se dice; cambiar los
   días de la cuenta de una pasarela en una empresa también recalcula; el historial dice que lo cambió el sistema),
   y el menor de cambiar SOLO la moneda de un cobro con comisión informada (se descarta, como al cambiar el monto).
5. De la tarea 34: las acciones de configuración con `startTransition` sin protección (cuentas, feriados, estado de la
   pasarela, opciones, tarifas, estado del esquema) usan `callAction`; un solo texto para «no sabemos si se guardó».
6. `e1Item` de `tests/integration/helpers.ts` arma un desglose COMPLETO (hoy guarda uno a medias que `parseBreakdown`
   rechaza y deja errores en el registro del servidor durante las pruebas).

### Task 38: Remates de comprobantes y liquidaciones

**Dueña de:** `supabase/migrations/20261110120000_las_pasarelas_de_pago.sql` (solo la columna `original_name`),
`src/lib/supabase/database.types.ts`, `src/server/pasarelas/dto.ts` (solo lo de los comprobantes),
`src/server/pasarelas/queries/export.ts`, `src/server/pasarelas/{ops,actions}/{receipts,settlements}.ts`,
`src/components/pasarelas/receipts/**`, `src/components/pasarelas/tx/ReceiptsCard.tsx`,
`src/components/pasarelas/splits/{SettlementForm,SettlementActions,Movements}.tsx`,
`tests/integration/{repartos,comprobantes,exportar}.test.ts` y `e2e/{repartos,acciones}.spec.ts`.

1. **R4** — Un reintento de una liquidación con el mismo `id` y OTROS datos (beneficiario, fecha, moneda, monto, o
   tener o no comprobante) no se da por bueno: se dice que quedó la del primer intento.
2. **m4 completo** — La columna `original_name` desaparece de la migración (todavía no se aplicó a ninguna base
   remota) y de todo el código y las pruebas: no se lee, no se muestra, no se exporta. El SQL para la base local
   compartida (`alter table … drop column if exists original_name`) lo aplica quien integra.
3. **m18 en liquidaciones** — La URL firmada del comprobante de una liquidación se pide al tocar el enlace.
4. Menores: borrar una liquidación vacía su carpeta entera (no solo `receipt_path`: quedan los archivos de intentos
   dudosos); tras un corte en los comprobantes del cobro, «Ver cómo quedó» antes de volver a subir (no duplicar); la
   etiqueta del comprobante usa `formatDate` del motor; «Quitar» un comprobante y las acciones de la liquidación usan
   `callAction`.

### Remates tras revisar el cierre (tareas 39 y 40)

Una revisión independiente de los últimos cambios (cada hallazgo verificado por otro agente que intentó refutarlo)
encontró que el arreglo del corte de red del diálogo de cuentas destino faltaba en los beneficiarios. Un barrido de
todos los componentes que llaman a una Server Action dejó cuatro más sin protección, en la entrada y en Ajustes →
Seguridad. Ahí, además, el corte caía en `ajustes/error.tsx`, que dice «Tus datos están guardados», y eso es falso
si se cortó al cambiar la contraseña. Las dos tareas son dueñas de archivos distintos y corren a la vez.

### Task 39: Cortes de red en beneficiarios; importar el mismo archivo; la prueba del refresco de cuentas

**Dueña de:** `src/components/pasarelas/splits/{BeneficiaryFormDialog,BeneficiaryActions}.tsx`,
`src/components/pasarelas/import/ImportScreen.tsx` y, solo para agregar o ajustar sus pruebas,
`e2e/{repartos,importar,cuentas-feriados}.spec.ts`.

1. Crear o editar un beneficiario, y activarlo, desactivarlo o borrarlo desde su ficha, llaman con `callAction`. El
   fallo se pinta con `ActionError` o `DialogActionError`, como en `accounts/`: un corte no sube a `error.tsx`, no se
   pierde lo escrito y se ofrece «Ver cómo quedó». La redirección de borrar sigue su camino.
2. Importar: el control de archivo se vacía tras elegir, así que volver a elegir el mismo archivo (corregido y
   guardado con el mismo nombre) se vuelve a leer. Además queda desactivado hasta hidratar, como el del logo.
3. La prueba del corte en el diálogo de cuentas comprueba de verdad que la lista se vuelve a pintar al cerrarlo.
   La petición llega al servidor, se corta solo la respuesta, y la cuenta aparece tras «Cancelar».

### Task 40: Cortes de red en la entrada y en Ajustes → Seguridad

**Dueña de:** `src/app/(auth)/login/{LoginForm.tsx,verificar/VerifyForm.tsx,verificar/page.tsx}`, un componente
nuevo de cerrar sesión si hace falta, `src/app/(dashboard)/ajustes/SecurityCard.tsx`, lo mínimo al final de
`src/components/pasarelas/callAction.ts` si hace falta un ayudante genérico (declarado en el informe) y, solo para
agregar pruebas, `e2e/{sesion,ajustes}.spec.ts`.

1. Entrar y escribir el código del segundo factor: con un corte, la pantalla no cae en `global-error.tsx`. El
   correo sigue escrito y se dice que se perdió la conexión y que se vuelva a intentar (repetir es seguro). Las
   redirecciones al salir bien siguen funcionando.
2. Ajustes → Seguridad: agregar un dispositivo, confirmar su código, quitarlo y cambiar la contraseña. Un corte se
   dice en la tarjeta, sin caer en `ajustes/error.tsx`. Si no se sabe si el cambio quedó, se dice y se dice cómo
   averiguarlo.
3. Cerrar sesión (en la pantalla del código y en Ajustes): un corte se dice ahí mismo, con «Ver cómo quedó».

### Task 41: Editar un esquema de reparto y agregar un beneficiario desde el editor

Pedido del dueño, ya usando la app publicada: corregir un esquema después de crearlo (puso «Sobre el bruto» y era
«Sobre el neto») y agregar un beneficiario sin salir del editor. Sin migración: `pay_save_scheme` ya reemplaza una
versión con la misma fecha si ningún cobro la usa.

**Dueña de:** `splits/{SchemeEditor,BeneficiaryFormDialog}.tsx`, `repartos/page.tsx` (tarjeta «Esquemas»),
`repartos/esquemas/[id]/page.tsx`, la ruta nueva `repartos/esquemas/[id]/editar/`, lo mínimo de
`server/pasarelas/{queries,ops,actions}/splits.ts`, `tests/integration/repartos.test.ts` y `e2e/repartos.spec.ts`.

1. «Editar» (en la ficha y en la lista) corrige la última versión si ningún cobro la usa: nombre, base, líneas y resto,
   con la misma fecha y «Guardar cambios». Si la usa alguno, dice cuántos, deja cambiar solo el nombre y lleva a
   «Versión nueva».
2. «Nuevo beneficiario» dentro del editor: lo crea y lo deja en una línea nueva.

### Task 42: Pagos internacionales: un recargo propio de la pasarela

Pedido del dueño: una pasarela cobra distinto a los pagos internacionales, y al registrar un cobro quiere elegir si fue
nacional o internacional. Stripe y PayPal lo cobran como un RECARGO sobre la tarifa nacional (Stripe: +1,5 % por
tarjeta internacional), así que se modela como una opción de la pasarela de tipo `internacional`. El motor ya la sabe
aplicar.

**Dueña de:** una migración nueva y aditiva (columna `kind` en `pay_gateway_extras`, una internacional activa por
pasarela, `pay_create_gateway` que la guarda), lo de opciones de pasarela en el servidor, `gateways/**`, las pantallas
de pasarelas, `RegisterForm`, `EditForm`, `TxDetail`, `import/SettingsCard` y sus pruebas.

1. Al crear la pasarela y en su ficha: el bloque «Pagos internacionales» (recargo en % y fijo), con la cuenta completa
   a la vista.
2. Al registrar y al editar un cobro: «¿Nacional o internacional?», que aplica o no el recargo, con la vista previa al
   momento. El detalle dice el origen.

### Task 43: Cuánto tarda en caer el dinero: ventanas «de 3 a 5 días»

Pedido del dueño: saber cuándo esperar cada cobro, nacional o internacional y con la opción rápida. Los días por
pasarela, por opción y por empresa, la fecha estimada y el tiempo real medido ya existían. Lo nuevo son ventanas («de
3 a 5 días hábiles»), también por opción, para lo internacional y en la cuenta de la empresa.

**Dueña de:** una migración aditiva (máximos opcionales junto a cada «días», `estimated_deposit_from` en el cobro y
`pay_save_transactions` que la guarda), el motor de fechas y lo que depende de la fecha estimada, y las pantallas de
pasarelas, empresas, registrar, detalle, editar, cobros, Resumen e importar.

1. La fecha estimada pasa a ser una ventana. `estimated_deposit_on` es la más tardía: «por caer», «atrasado» y los
   próximos depósitos siguen con una sola fecha.
2. En las pantallas: «Llega entre el lun 16 y el mié 18 nov».

### Task 44: ¿Quién paga la comisión? «Nosotros» o «el comprador»

Pedido del dueño, con las decisiones tomadas con él:
- se escribe lo que pagó el comprador y la comisión se calcula con la tarifa real (1040 con Stripe: 30,46, neto
  1009,54);
- si la pagó el comprador, se reparte sobre lo que queda, y su comisión sale aparte en los totales, no como costo del
  negocio.

**Dueña de:** una migración aditiva (`fees_paid_by` en el cobro, `pay_save_transactions`, las vistas de totales), el
motor, los totales y las pantallas Registrar, Editar, detalle, Cobros, Resumen, empresas, pasarelas e Importar.

### Task 45: «Quién paga la comisión», corregido

Correcciones de la tarea 44, antes de llevarla a producción:
- en un cobro del comprador, el costo de un reembolso o de una disputa lo paga el negocio, no el comprador;
- las vistas de totales conservan el significado de sus columnas y suman solo `buyer_fees`;
- el % de las comisiones se mide sobre lo facturado;
- la tabla por mes cuadra.

### Task 46: Cambiar el estado de un cobro desde la lista

Cada cobro de la lista lleva un menú con solo los cambios que el motor permite: en tránsito, depositado (con fecha),
revertir, fallido (con confirmación) y reabrir. Usa las acciones del servidor que ya existen.

### Task 47: PDF de los cobros elegidos

Elegir cobros en la lista (o todos los del día) y descargar un PDF. Por cada cobro: el monto, el desglose y el
reparto; al final, los totales. Sirve para enviarlo cada día. Va después de las tareas 48 a 50, para que el PDF las
muestre.

### Task 48: Partes que no pagan comisión

Una marca «No paga comisión» en cada línea del esquema, que se puede cambiar en cada cobro. Con «Nosotros» y base
neto:
- la parte exenta sale del bruto, o sea de lo facturado;
- las demás se reparten lo que queda del neto, en proporción.

Migración 5.

### Task 49: Retención de la pasarela para ciertas personas

Una pasarela (por ejemplo OTF) retiene un % del bruto durante N días. Al soltarlo, le cae a ciertas personas, como
los dueños de la cuenta.
- La retención cuenta como un pago que esas personas ya recibieron de su parte del reparto.
- A tu banco llega el neto menos la retención.

Migración 6.

### Task 50: Marcar lo que ya se le pagó a cada parte

Cada parte del reparto de un cobro se marca como pagada. Detrás, una liquidación enlazada al cobro, para que el saldo
siga siendo la única verdad. También:
- pagar varios cobros de una vez;
- el indicador «Reparto pagado» y el filtro «Reparto pendiente».

La retención (tarea 49) cuenta como pagado. Migración 7.

### Task 22: Documentación, revisión y entrega

**Archivos:** `docs/PASARELAS.md`, `README.md`, raíz `README.md`.

- [ ] `docs/PASARELAS.md`: cada pieza; fórmulas con E1–E6 y F1–F3; cómo se congelan los desgloses; decisiones
      tomadas y «para confirmar»; fase C (claves restringidas de solo lectura, webhooks, dónde guardar secretos, leer
      comprobantes con IA, vista del socio); lo que queda.
- [ ] `README.md`: cómo correrlo en local y el paso a paso para producción: copia previa (`pg_dump`), aplicar la
      migración **con `psql`**, apagar el registro, crear el usuario dueño, proyecto de Vercel con directorio raíz
      `pasarelas/` y sus dos variables. Advertencia del plan gratis de Supabase (pausa a los 7 días, sin copias).
- [ ] Revisión adversarial de toda la rama (dinero, seguridad y RLS, accesibilidad, celular) y arreglos.
- [ ] Verificación final de `pasarelas/` y del gestor de la raíz; `npm audit` sin vulnerabilidades altas.
- [ ] Resumen corto para el dueño: qué hay y cómo se usa, capturas, y qué falta para producción.
