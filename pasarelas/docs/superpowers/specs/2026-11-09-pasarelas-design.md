# Pasarelas · Diseño (spec)

Fecha: 2026-11-09 · Estado: aprobado para construir «de corrido» (el dueño eligió no parar en el spec ni en el plan).

## 1. Qué se construye y qué decidió el dueño

Un libro de cuentas **privado** para un dueño con varias empresas: registra cada cobro, calcula solo lo que se
llevan la pasarela, sus opciones y la plataforma, reparte lo neto entre beneficiarios, estima cuándo cae el dinero
al banco y resume todo. **No** procesa pagos ni mueve dinero. **No** guarda números de tarjeta, CVV, números de
cuenta completos, claves ni contraseñas.

El encargo original (`PROMPT-PASARELAS-ONESHOT.md`) estaba escrito como un **módulo** de otra plataforma que ya
tenía login, segundo factor, papelera y kit de interfaz. El dueño decidió otra cosa, y eso cambia el alcance:

| Decisión del dueño (2026-11-09) | Consecuencia |
|---|---|
| Va en **este** repo (`gestor-propiedades`), en su carpeta, sin mezclarse con el gestor | Proyecto autónomo en `pasarelas/` con su propio `package.json`. El gestor de la raíz no se toca (salvo aislarlo, §12) |
| **App real con servidor**: Next 16 + Supabase | Hay que construir también lo que el prompt daba por hecho: login, segundo factor, menú, kit de interfaz y papelera |
| La base remota **se decide al final** (el plan gratis de Supabase tiene sus 2 proyectos activos) | Todo se construye y se prueba contra un **Supabase local** (Docker). No se crea ni se toca ningún proyecto remoto, ni Vercel |
| **De corrido** | Spec y plan quedan escritos en el repo; cada decisión tomada sin preguntar queda en `docs/PASARELAS.md` |

Lo que el prompt pedía y **no** se puede cumplir tal cual, y qué se hace en su lugar:

| El prompt pedía | Aquí |
|---|---|
| Copiar los patrones de `AGENTS.md`, `docs/ARCHITECTURE.md`, `papelera`, `tareas`… | No existen en este repo y no se pudo leer el otro. Patrones propios, documentados en `pasarelas/AGENTS.md` |
| Rama `pasarelas/v1` | La sesión solo puede empujar a `claude/admiring-ramanujan-p92z7s`. Se usa esa |
| Migración **aplicada** a la base remota (con copia antes) y **vista previa de Vercel** | Pendiente de que el dueño elija la base. Se deja la migración probada en local y el paso a paso exacto (copia + `psql`) |
| «Sin dependencias nuevas» | Es un proyecto nuevo: se usan exactamente las del prompt, más `sonner`, `lucide-react`, `server-only` y `tsx` |

## 2. Principios

1. **El dinero nunca pasa por `number`.** `decimal.js` en el motor; cadenas decimales (`"90.30"`) entre capas;
   `numeric` en Postgres.
2. **La base defiende los cuadres**, no solo el código: restricciones y disparadores impiden guardar un cobro cuyo
   neto no sea `bruto − comisiones` o cuyo reparto no sume exactamente su base.
3. **Lo calculado se congela** en el cobro, con las reglas usadas adentro. Cambiar tarifas o esquemas no reescribe
   nada viejo.
4. **Cada fila es de un usuario** (`user_id`) con RLS, y **segundo factor exigido en la base** si el usuario tiene
   uno. Las claves foráneas llevan `user_id`: una fila no puede apuntar a datos de otro usuario.
5. **Sin secretos en la app**: solo la clave publicable de Supabase y la sesión del usuario. Nada de `service_role`
   en tiempo de ejecución.
6. **Celular primero**, en español, fechas en `America/New_York`.
7. **Portátil**: rutas bajo `/pasarelas`, motor en `src/lib/pasarelas/`, tablas `pay_*`, y funciones, políticas y
   disparadores con prefijo `pay_`, para poder mudarlo a otra plataforma Next + Supabase sin chocar.

## 3. Arquitectura

```
gestor-propiedades/                  repo (público)
├─ src/ tests/ docs/ …               el gestor (Vite, GitHub Pages) — sin cambios de comportamiento
└─ pasarelas/                        ESTE proyecto, autónomo
   ├─ AGENTS.md  README.md  .env.example  package.json  next.config.ts …
   ├─ docs/PASARELAS.md              qué es cada pieza, fórmulas, decisiones, fase C, lo que queda
   ├─ supabase/config.toml           stack local (MFA TOTP encendido, registro apagado)
   ├─ supabase/migrations/           20261110120000_las_pasarelas_de_pago.sql (+ las que hagan falta)
   ├─ scripts/                       seed-pasarelas-demo.ts, utilidades del stack local
   ├─ tests/integration/             RLS, Storage y funciones contra el Supabase local
   ├─ e2e/                           Playwright (390×844 y 1280×800) + axe
   └─ src/
      ├─ proxy.ts                    refresca la sesión y protege rutas (en Next 16 reemplaza a middleware.ts)
      ├─ app/(auth)/…                login y verificación del segundo factor
      ├─ app/(dashboard)/pasarelas/… las pantallas (§8)
      ├─ app/(dashboard)/ajustes/…   seguridad (2FA, contraseña) y exportar todo
      ├─ components/ui/              kit propio (botón, campo, diálogo, tarjeta, tabla, vacío, esqueleto…)
      ├─ components/pasarelas/       piezas del dominio compartidas (desglose, reparto, estado, comprobantes…)
      ├─ lib/pasarelas/              EL MOTOR: funciones puras con decimal.js y sus tests al lado
      ├─ lib/supabase/               clientes (navegador, servidor, proxy) y tipos generados de la base
      ├─ lib/auth/                   sesión verificada por petición (DAL) y segundo factor
      └─ server/pasarelas/           lecturas (`queries/`, solo servidor) y escrituras (`actions/`, 'use server')
```

**Flujo de una escritura** (p. ej. registrar un cobro): formulario (cliente, vista previa con el motor) → Server
Action → valida con Zod → **vuelve a leer la configuración y recalcula en el servidor** (lo que manda es el
servidor, no la vista previa) → una función de Postgres guarda cobro + repartos + evento del historial **en una sola
transacción** → la base comprueba los cuadres al confirmar → se refresca la pantalla.

**Flujo de una lectura**: Server Component → `queries/*` → Supabase con la sesión del usuario (RLS) → mapeo a DTO
(los `numeric` pasan a cadena decimal en la frontera) → el motor agrega lo que haga falta → HTML.

**Comprobantes**: el navegador achica la imagen y la sube **directo** a Storage con la sesión del usuario (no pasa
por el servidor de Next: evita el límite de cuerpo de las funciones). Después una acción registra la fila.

## 4. Modelo de datos

Todas las tablas: `id uuid` (pk, `gen_random_uuid()`), `user_id uuid not null default auth.uid()` →
`auth.users(id) on delete cascade`, `created_at`, y `updated_at` (con disparador) donde la fila se edita.
Montos `numeric(14,2)`, porcentajes `numeric(7,4)` (0–100), monedas `char(3)` ISO en mayúsculas, `USD` por defecto.
Cada tabla tiene `unique (id, user_id)` y las claves foráneas son compuestas `(x_id, user_id)`.

| Tabla | Campos propios | Reglas |
|---|---|---|
| `pay_companies` | name, website, logo_path, currency, default_scheme_id, notes, active | nombre único por usuario (sin distinguir mayúsculas); `website` solo `http(s)://` |
| `pay_channels` | company_id, name, url, platform_fee_pct, platform_fee_fixed, active | `url` solo `http(s)://`; el canal es de **una** empresa |
| `pay_gateways` | name, payout_days (0–60), payout_day_type (`habiles`\|`corridos`), refunds_return_fee, dispute_fee, import_mapping (jsonb), notes, active | nombre único por usuario |
| `pay_gateway_fee_versions` | gateway_id, pct, fixed, effective_from (date), note | única por (pasarela, vigente desde). La primera vale «desde el inicio» (`2000-01-01`). **Solo se agregan** (o se borran si ningún cobro las usa) |
| `pay_gateway_extras` | gateway_id, name, pct, fixed, base (`bruto`\|`despues_de_comision`), default_on, payout_days_override, active, sort | |
| `pay_bank_accounts` | alias, institution, last4, currency, notes, active | `last4` exactamente 4 dígitos; alias e institución sin 7 o más dígitos seguidos |
| `pay_company_gateways` | company_id, gateway_id, dashboard_url, checkout_url, bank_account_id, payout_days_override, default_extra_ids (uuid[]), active | una por (empresa, pasarela); links solo `http(s)://` |
| `pay_beneficiaries` | name, kind (`persona`\|`empresa`\|`cartera`), account_alias, notes, active | nombre único por usuario (sin distinguir mayúsculas); `account_alias` sin 7 o más dígitos seguidos |
| `pay_schemes` | name, notes, active | nombre único por usuario (sin distinguir mayúsculas) |
| `pay_scheme_versions` | scheme_id, version, base (`neto`\|`bruto`), remainder_beneficiary_id («Resto»), effective_from | **solo se agregan**; única por (esquema, versión) y por (esquema, vigente desde) |
| `pay_scheme_lines` | scheme_version_id, beneficiary_id, pct (>0), sort | un beneficiario una sola vez por versión |
| `pay_transactions` | ver §4.1 | |
| `pay_allocations` | transaction_id, beneficiary_id, amount (puede ser negativo), base, pct, is_remainder | un beneficiario una vez por cobro |
| `pay_transaction_receipts` | transaction_id, path, mime, size_bytes | `path` empieza por `{user_id}/{transaction_id}/`; mime en la lista; ≤ 10 MB. Sin el nombre original del archivo (puede traer datos de otra persona) |
| `pay_transaction_events` | transaction_id, at, kind, summary, data (jsonb: antes/después) | **solo se agregan**: el historial del cobro |
| `pay_settlements` | beneficiary_id, paid_on, **currency**, amount (≠ 0), method, receipt_path, receipt_mime, receipt_size, note | positivo = pago al beneficiario; negativo = devolución del beneficiario |
| `pay_holidays` | day, name | único por (usuario, día); editable |

Añadidos respecto de la lista del prompt, y por qué:

- `pay_scheme_versions`: el prompt pide que el esquema «tenga versión». Además lleva **vigente desde**, igual que las
  tarifas: un cobro con fecha vieja que se registra tarde usa el reparto que regía ese día.
- `pay_transaction_events`: el prompt pide un historial por cobro y no listaba tabla.
- `pay_settlements.currency`: sin moneda, el saldo de un beneficiario sumaría monedas distintas.
- El mapeo del importador se recuerda en `pay_gateways.import_mapping`.

### 4.1 El cobro (`pay_transactions`)

| Campo | Qué es |
|---|---|
| occurred_at, occurred_on | instante del cobro y su fecha en `America/New_York` (la calcula el motor; con ella se filtra y se eligen versiones) |
| company_id, channel_id (opcional), gateway_id | el canal debe ser de esa empresa (clave foránea compuesta) |
| currency | por defecto la de la empresa |
| gross_original | lo cobrado (> 0) |
| refunded_amount | total reembolsado (0 … gross_original) |
| gross_amount | **bruto vigente** = gross_original − refunded_amount |
| fees_total, net_amount | comisiones totales y neto; `net_amount = gross_amount − fees_total` (restricción) |
| alloc_base, alloc_base_amount | base del reparto (`neto`\|`bruto`) y su monto; la suma de `pay_allocations` **debe** ser igual (disparador diferido) |
| breakdown (jsonb) | el desglose congelado **con las reglas usadas adentro** (§5.6) |
| fee_version_id, scheme_id, scheme_version_id | versiones usadas (el esquema es opcional: sin esquema no hay reparto) |
| reference, note | referencia de la pasarela (única por usuario y pasarela) y nota corta (≤ 280) |
| status | `registrado` → `en_transito` → `depositado`; o `fallido` |
| dispute_state, dispute_opened_on, dispute_closed_on | `abierta` \| `ganada` \| `perdida` |
| estimated_deposit_on, estimated_is_manual | fecha estimada; si se editó a mano, recalcular no la pisa |
| deposited_on | fecha real; existe si y solo si `status = 'depositado'` (restricción) |
| bank_account_id | cuenta destino (por defecto la de la cuenta de la pasarela de esa empresa) |
| receipts_count | lo mantiene un disparador; permite filtrar «sin comprobante» |
| deleted_at | en la **Papelera** si no es nulo |

**Estado visible.** El prompt lista seis estados en un solo campo. Aquí el ciclo del dinero (`status`) va separado
del reembolso y de la disputa, porque un reembolso parcial no borra que el resto está por caer. Lo que se **muestra**
y se filtra son los seis de siempre, derivados por el motor en este orden: `fallido` → `en disputa` (disputa
abierta) → `reembolsado` (reembolso total) → `depositado` → `en tránsito` → `registrado`; el reembolso parcial se ve
como una etiqueta adicional.

**«Por caer»** suma el neto de los cobros que **se ven** como `registrado` o `en tránsito` (un cobro recién
registrado también está por caer). Uno con la disputa abierta, o reembolsado por completo, no está por caer aunque
nunca se haya depositado: la pasarela retiene ese dinero o ya lo devolvió. El reembolso parcial sí sigue por caer,
con su neto ya rebajado. Es **una sola definición** (`isPending` del motor) para la tarjeta, el filtro de la lista,
los próximos depósitos y lo atrasado, y la misma en la vista `pay_bank_account_totals`. **«Depositado»** suma el
neto de los `depositado` (ciclo del dinero), tengan o no reembolso o disputa. Los `fallido` y los de la papelera no
cuentan en nada.

### 4.2 Lo que la base hace cumplir

- **RLS** en las 17 tablas: política permisiva `user_id = (select auth.uid())` y política **restrictiva**
  `(select private.pay_mfa_ok())` (aal2 si el usuario tiene un factor verificado). Rol `anon`: nada. Los permisos
  (`grant`) van explícitos. Las funciones internas (segundo factor, comprobaciones de los disparadores) viven en el
  esquema `private`, que la API no expone; en `public` solo quedan las tres funciones que la app llama.
- Tablas de **solo agregar** (sin política de `update`): versiones de tarifa, versiones y líneas de esquema, eventos.
- **Esquema válido** (disparador diferido): las líneas no pasan de 100 %; si suman menos de 100 % tiene que haber
  «Resto»; el «Resto» no puede ser además una línea.
- **Reparto cuadrado** (disparador diferido): `sum(pay_allocations.amount) = pay_transactions.alloc_base_amount`.
- **Cuadres del cobro** (restricciones): neto, bruto vigente, depositado ⇔ fecha real, fallido ⇒ todo en cero.
- **Escrituras de varias tablas en una transacción**, con funciones `security invoker` (RLS sigue aplicando):
  - `pay_save_transactions(items jsonb, skip_duplicates boolean)`: crea o actualiza de 1 a 500 cobros con sus
    repartos y su evento; con control optimista por `updated_at`; con `skip_duplicates` ignora referencias repetidas
    (importación).
  - `pay_save_scheme(payload jsonb)`: crea el esquema si hace falta y una versión nueva con sus líneas.
  - `pay_create_gateway(payload jsonb)`: pasarela + primera tarifa + opciones.
- **Vistas** (`security_invoker`) para totales de toda la historia: `pay_beneficiary_balances` (asignado, liquidado y
  saldo por beneficiario y moneda), `pay_company_totals`, `pay_bank_account_totals`. No cuentan la papelera.
- **Storage**: bucket privado `comprobantes` (10 MB; jpg, png, webp, pdf) creado en la migración; políticas en
  `storage.objects`: solo la carpeta `{auth.uid()}/…` y con la misma regla de segundo factor.

Los totales **por período** (Resumen, totales del filtro de Cobros) los calcula el motor en TypeScript sobre filas
mínimas traídas por páginas, con el mismo constructor de filtros que la lista: una sola definición de cada filtro.

## 5. El motor (`src/lib/pasarelas/`)

Funciones puras, sin acceso a red ni a reloj (la fecha de «hoy» entra como parámetro). Una instancia propia
`Decimal.clone({ precision: 40, rounding: ROUND_HALF_UP })`. Cada línea se redondea a centavos **antes** de sumar.

### 5.1 Reglas y estado

```ts
type Money = string;            // decimal canónico con 2 decimales: "90.30", "-3.20"
type Pct = string;              // porcentaje: "2.9", "33.3333"

type Rules = {                  // lo que se CONGELA dentro del desglose
  gateway: { id; name; feeVersionId; pct: Pct; fixed: Money; refundsReturnFee: boolean; disputeFee: Money;
             feeOverride?: Money };            // comisión real informada por un CSV (fase B)
  extras: { id; name; pct: Pct; fixed: Money; base: 'bruto' | 'despues_de_comision';
            payoutDaysOverride: number | null }[];      // solo las encendidas
  platform: { channelId; name; pct: Pct; fixed: Money } | null;
  scheme: { schemeId; versionId; base: 'neto' | 'bruto';
            lines: { beneficiaryId; name; pct: Pct }[];
            remainder: { beneficiaryId; name } | null } | null;
};
type State = { grossOriginal: Money; refunded: Money;
               dispute: null | 'abierta' | 'ganada' | 'perdida'; failed: boolean };

compute(rules, state, currency): Breakdown          // el cálculo
recompute(b, patch: Partial<State>): Breakdown      // mismas reglas, estado nuevo (reembolso, disputa, monto, fallido)
recalc(b, newRules): Breakdown                      // reglas nuevas, mismo estado («recalcular con la tarifa de hoy»)
diff(a, b): { campo; antes; despues }[]             // para enseñar el antes y el después
```

### 5.2 Fórmulas

Con `G0 = grossOriginal`, `R = refunded`, `G = G0 − R` (bruto vigente) y `r(x)` = redondeo a centavos, mitad hacia
arriba:

1. **Fallido**: sin líneas; bruto vigente, comisiones, neto y reparto en cero.
2. **Comisión original de la pasarela** `F0 = r(G0 × % + fijo)` (o `feeOverride` si viene de un CSV).
3. **Línea «pasarela»** `Fp`: si `G = 0` → 0; si no hay reembolso → `F0`; con reembolso → `r(G × % + fijo)`
   (con `feeOverride`: proporcional, `r(F0 × G / G0)`).
4. **Línea «costo del reembolso»**: solo si hay reembolso y la pasarela **no** devuelve la comisión:
   `F0 − Fp` (lo que la pasarela se queda de lo reembolsado). Así, lo retenido por la pasarela sigue siendo `F0`.
5. **Cada opción encendida**: base = `G` (`bruto`) o `max(0, G − Fp − costo del reembolso)`
   (`despues_de_comision`); monto = `r(base × % + fijo)`, o 0 si `G = 0`.
6. **Plataforma o canal**: `r(G × % + fijo)`, o 0 si `G = 0`.
7. **Costo de disputa**: `disputeFee` si la disputa está `abierta` o `perdida`; nada si se ganó.
   «Perdida» implica además reembolso total (`R = G0`).
8. **Comisiones totales** = suma de las líneas. **Neto** = `G − comisiones` (puede ser negativo).
9. **Reparto**: base = neto o bruto vigente según el esquema. Líneas del esquema más, si suman menos de 100 %, la
   línea «Resto» con lo que falta. **Mayor resto**: se trunca cada línea a centavos; los centavos que sobran van uno
   a uno a las de mayor resto; en empate gana la primera. Si la base es negativa se reparte su valor absoluto y se
   cambia el signo. La suma es **exactamente** la base.

Decisiones que el prompt dejaba abiertas (quedan en `docs/PASARELAS.md` como «para confirmar»):

- En un reembolso, la plataforma y las opciones **se recalculan** sobre el bruto vigente; solo la comisión base de la
  pasarela puede quedar retenida. Es lo único coherente con E4, que da 3,20 de costo y no 9,70.
- El costo de un reembolso o de una disputa **baja el neto** y por tanto se reparte como pérdida con los mismos
  porcentajes (esquema sobre el neto).
- Las cuotas fijas se entienden en la moneda del cobro.
- Al recalcular «con la tarifa de hoy» se puede elegir: la tarifa **vigente hoy** (por defecto) o la que
  **correspondía a la fecha del cobro** según la configuración actual.
- Al **editar** un cobro solo se vuelven a resolver las reglas de lo que cambió (pasarela, canal, opciones, esquema
  o fecha); lo demás conserva sus reglas congeladas.

### 5.3 Casos que deben salir exactos

| Caso | Entrada | Resultado |
|---|---|---|
| **E1** | 100,00 · Stripe 2,9 % + 0,30 · pago rápido 1,5 % sobre el bruto · plataforma 5 % · 50/30/20 sobre el neto | pasarela 3,20 + rápido 1,50 + plataforma 5,00 = **9,70** · neto **90,30** · A 45,15 · B 27,09 · C 18,06 |
| **E2** | 33,33 · Stripe 2,9 % + 0,30 · esquema 33,3333 / 33,3333 / 33,3334 | comisión 1,27 · neto 32,06 · **10,69 · 10,68 · 10,69** |
| **E3** | 100,00 · Stripe · pago rápido 1,5 % sobre el bruto menos la comisión | rápido = 96,80 × 1,5 % = 1,452 → **1,45** · neto **95,35** |
| **E4** | reembolso total de E1; la pasarela no devuelve la comisión | bruto 0 · costo del reembolso **3,20** · neto −3,20 · reparto **−1,60 · −0,96 · −0,64** · con 45,15 / 27,09 / 18,06 ya liquidados, saldos **−46,75 · −28,05 · −18,70** |
| **E5** (nuevo) | reembolso parcial de 40,00 sobre E1 | bruto 60,00 · pasarela 2,04 · costo del reembolso 1,16 · rápido 0,90 · plataforma 3,00 · comisiones 7,10 · neto **52,90** · reparto 26,45 · 15,87 · 10,58 |
| **E6** (nuevo) | disputa abierta sobre E1 con costo 15,00; luego ganada | abierta: comisiones 24,70 · neto 75,30 · reparto 37,65 · 22,59 · 15,06; ganada: vuelve a E1 |

Además: un esquema que no suma 100 % y no tiene «Resto» no se puede guardar; una tarifa con «vigente desde»
posterior no cambia el desglose de un cobro anterior; nunca se suman monedas distintas (`sumByCurrency`).

### 5.4 Cuándo cae el dinero

- Fecha de partida = fecha del cobro en `America/New_York`.
- Días: los de una opción encendida que los cambie (si hay varias, la menor) → los de la cuenta de la pasarela de esa
  empresa → los de la pasarela. Hábiles o corridos según la pasarela.
- **0 días → el mismo día**, aunque sea fin de semana o feriado.
- Hábiles: se avanza día por día y solo cuentan los que no son sábado, domingo ni feriado.
- Corridos: suma de calendario, sin correr al siguiente hábil.
- Aritmética de fechas de calendario: el cambio de horario no corre el día.

| Caso | Resultado |
|---|---|
| **F1** viernes 13/11/2026 + 2 hábiles | martes 17/11/2026 |
| **F2** miércoles 25/11/2026 + 2 hábiles (Acción de Gracias el 26) | lunes 30/11/2026 |
| **F3** jueves 24/12/2026 + 2 hábiles (Navidad el 25) | martes 29/12/2026 |
| Pago rápido (0 días) | el mismo día |
| Cobro a las 22:30 de Nueva York (ya es el día siguiente en UTC) | cuenta el día de Nueva York |
| Cruces de horario (8/3/2026 y 1/11/2026) | el día no se corre |

**Feriados.** Se guardan por usuario y son editables. El motor trae `usBankHolidays(año)`, que calcula los feriados
bancarios de EE. UU. de cualquier año, y con ella se siembran 2026 y 2027 la primera vez. Se usa el calendario
**bancario** (el que mueve los depósitos), no el de oficinas federales: cuando el feriado cae en sábado los bancos
abren el viernes anterior (4 de julio de 2026), y cuando cae en domingo cierran el lunes siguiente. El Resumen avisa
si falta sembrar el año en curso o el siguiente.

**Atrasado** = por caer (§4.1) y con la fecha estimada ya pasada.
**Tiempo real** por pasarela y por cuenta destino = promedio y mediana de días de calendario entre la fecha del
cobro y la del depósito real.

### 5.5 Otras piezas puras

`parseMoney` (acepta `1,234.56`, `1.234,56`, `100,5`), `formatMoney` (`$1.234,56`: coma decimal, sin depender de
`Intl` para que servidor y navegador den lo mismo), `validateScheme`, `pickVersion(versiones, fecha)`,
`resolveRules(config, selección, fecha)`, `resolvePayout`, `displayStatus`, `isOverdue`, `summarize(filas, hoy)`
(totales por moneda, por mes, por empresa, por pasarela, por cuenta, costo efectivo, próximos depósitos), `lagStats`,
`usBankHolidays`, `toCsv` (protegido contra inyección de fórmulas), `looksLikeCardNumber` (rechaza en textos libres
secuencias de 13–19 dígitos que pasan Luhn) y, en fase B, los lectores de CSV.

### 5.6 El desglose congelado (jsonb, versión 1)

```jsonc
{ "v": 1, "currency": "USD",
  "rules": { /* Rules completas: tarifa, opciones, plataforma, esquema con sus líneas */ },
  "state": { "grossOriginal": "100.00", "refunded": "0.00", "dispute": null, "failed": false },
  "gross": "100.00",
  "lines": [ { "kind": "pasarela", "name": "Stripe", "baseKind": "bruto", "baseAmount": "100.00",
               "pct": "2.9", "fixed": "0.30", "amount": "3.20" } /* opcion, plataforma, reembolso, disputa */ ],
  "feesTotal": "9.70", "net": "90.30",
  "alloc": { "baseKind": "neto", "baseAmount": "90.30",
             "lines": [ { "beneficiaryId": "…", "name": "Grupo A", "pct": "50", "amount": "45.15",
                          "isRemainder": false } ] } }
```

Como las reglas viajan adentro, un reembolso o una disputa años después se calculan con la tarifa de entonces sin
consultar nada.

## 6. Autenticación y seguridad

- **Entrada**: correo y contraseña (Supabase Auth). **Registro público apagado**: el usuario dueño se crea desde el
  panel de Supabase o con un script. Sesión en cookies con `@supabase/ssr`; `proxy.ts` la refresca y manda a
  `/login` si no hay sesión, o a `/login/verificar` si el usuario tiene factor y la sesión aún es aal1.
- **Segundo factor (TOTP)**: se activa en `Ajustes → Seguridad` (QR + código); se puede agregar un segundo
  dispositivo de respaldo y quitar factores. Si no hay factor, la app muestra un aviso permanente para activarlo.
  La exigencia real está en la base (política restrictiva), no en la interfaz.
- **Cada Server Action** verifica la sesión y valida la entrada con Zod; los errores de la base se traducen a
  mensajes en español.
- **Cabeceras**: CSP (solo el propio sitio y el host de Supabase), `frame-ancestors 'none'`, `nosniff`,
  `Referrer-Policy`, `Permissions-Policy`; `robots: noindex`.
- **Links** de panel, pago y web: solo `http(s)://` (validado en Zod y en la base); se abren con
  `rel="noopener noreferrer"`.
- **Comprobantes**: URL firmada de 60 s generada al abrir; nunca URL pública. Las imágenes se recodifican en el
  navegador (máx. 1600 px), lo que además les quita los metadatos (ubicación).
- **Sin datos de clientes**: el importador no trae correos ni nombres de compradores.
- **Sin datos reales en el repo**: empresas, personas y montos inventados en código, pruebas, semilla y capturas.

Fuera de alcance por ahora (queda anotado): recuperar la contraseña por correo y códigos de respaldo del segundo
factor (se resuelven desde el panel de Supabase).

## 7. Navegación

Celular: barra inferior con **Resumen · Cobros · ＋ · Repartos · Más**; el «＋» es el botón fijo «Registrar cobro»,
visible en todas las pantallas del módulo. Escritorio (≥ 768 px): barra lateral con todas las secciones.
«Más»: Empresas, Pasarelas, Cuentas destino, Importar, Feriados, Papelera, Ajustes.

## 8. Pantallas (todas bajo `/pasarelas`; filtros en la URL)

| Ruta | Pantalla |
|---|---|
| `/pasarelas` | **Resumen**: filtros (período, empresa, pasarela, canal, moneda); tarjetas (bruto, comisiones y su %, neto, cobros, ticket promedio, por caer, depositado); gráficos (bruto y neto por mes, ranking de empresas, reparto por pasarela, costo efectivo por pasarela, cuentas destino con % y días promedio); próximos depósitos de 14 días por fecha y cuenta, con atrasados arriba en ámbar y «marcar depositado» por grupo; repartos por beneficiario (asignado, liquidado, saldo); avisos |
| `/pasarelas/registrar` | **Registrar cobro**: un paso, en orden empresa → canal → pasarela (con sus opciones) → monto y moneda → fecha y hora → referencia → comprobante; vista previa en vivo (cada comisión, neto, reparto y fecha estimada); «Repetir el último». En «Más opciones»: esquema (por defecto el de la empresa), cuenta destino, fecha estimada a mano, estado inicial y nota |
| `/pasarelas/cobros` | **Cobros**: búsqueda, filtros, orden, totales del filtro por moneda, selección múltiple (depositado, en tránsito, recalcular, papelera), exportar CSV; tabla en escritorio, tarjetas en celular |
| `/pasarelas/cobros/[id]` | Detalle: desglose congelado, reparto, comprobantes, historial; editar (también la fecha estimada), depositado, reembolso, disputa, recalcular (antes y después), papelera |
| `/pasarelas/empresas`, `…/[id]` | **Empresa**: ficha (web, link del panel y de pago por pasarela, canales con su costo, esquema, cuentas), resumen propio (período y total, por mes y por pasarela), sus cobros |
| `/pasarelas/pasarelas`, `…/[id]` | **Pasarelas**: alta y edición, opciones con interruptor, historial de tarifas con «vigente desde», tiempo real de depósito |
| `/pasarelas/repartos` | **Repartos**: libro por beneficiario (asignado, liquidado, saldo, por moneda), esquemas (suma en vivo y aviso si no da 100 %), beneficiarios, «Registrar liquidación» con comprobante |
| `/pasarelas/cuentas` | **Cuentas destino**: alias, banco, últimos 4, lo que cae en cada una y cuánto tarda |
| `/pasarelas/importar` | **Importar CSV** (fase B): Stripe y PayPal, mapeo que se recuerda por pasarela, «Así lo entendí» (nuevos, repetidos, con error) antes de crear |
| `/pasarelas/feriados` | Feriados por año; «Cargar feriados bancarios de EE. UU. de …» |
| `/pasarelas/papelera` | Cobros borrados: restaurar o borrar del todo (también sus archivos) |
| `/ajustes` | Seguridad (segundo factor, contraseña, cerrar sesión) y «Exportar todo» (JSON) como copia propia |

Cada pantalla tiene sus estados de vacío, cargando (`loading.tsx`) y error (`error.tsx`), y avisa con `sonner`.

## 9. Fases B y C

- **B (se construye)**: importador con papaparse para Stripe (payments y balance transactions) y PayPal (actividad).
  Detecta el formato por encabezados, deja ajustar el mapeo, lo recuerda por pasarela, enseña «Así lo entendí» y
  no duplica: la referencia es única por pasarela en la base. Si el archivo trae la comisión real, se puede usar en
  lugar de la calculada (`feeOverride`).
- **C (solo diseño, en `docs/PASARELAS.md`)**: leer cobros, comisiones y depósitos con claves restringidas de solo
  lectura y webhooks; dónde guardar varios secretos (variables por empresa o Supabase Vault) para que el dueño
  decida; leer comprobantes con IA; vista de solo lectura para un socio.

## 10. Pruebas

| Capa | Qué | Con qué |
|---|---|---|
| Motor | E1–E6, F1–F3, esquemas, versiones, reembolsos parciales, disputas, monedas, redondeos, propiedades con datos generados (el reparto siempre suma la base; neto = bruto − comisiones; recalcular es idempotente). **Cobertura 100 %** de `src/lib/pasarelas` | Vitest, junto al código |
| Base | En **todas** las tablas `pay_*` y en Storage: otro usuario no ve ni escribe; `anon` nada; con factor y aal1 nada; con aal2 sí. Disparadores de cuadre, claves compuestas, funciones atómicas, referencia única | Vitest + supabase-js contra el Supabase local, con dos usuarios reales y TOTP |
| Punta a punta | Celular 390×844: entrar, registrar el cobro E1 con comprobante, ver 9,70 / 90,30 / 45,15 · 27,09 · 18,06 y la fecha estimada, marcar depositado, ver Resumen y saldo; tarifa «vigente desde mañana» no mueve lo viejo; depósito en lote; reembolso parcial cuadrado. **axe** sin violaciones serias ni críticas en cada pantalla | Playwright + axe |
| Calidad | `typecheck`, `lint`, `test`, `build` en verde; y el gestor de la raíz sigue en verde | npm |

## 11. Semilla demo

`scripts/seed-pasarelas-demo.ts`: usuario demo, 3 empresas inventadas (Tienda Demo, Escuela Demo, Estudio Demo),
Stripe / PayPal / Zelle con sus tarifas y opciones, cuentas destino, Grupos A/B/C, 2 esquemas y ~60 cobros en 3 meses
(deterministas), con depósitos, un reembolso parcial, una disputa y liquidaciones. Usa el mismo motor y las mismas
funciones que la app.

## 12. Convivencia con el gestor (raíz del repo)

El gestor no cambia de comportamiento. Para que su propia verificación no recorra la carpeta nueva se hacen solo
estos ajustes de aislamiento, y se comprueba antes y después que su `npm run check` y su `npm run build` dan lo mismo
(línea base: 35 pruebas en verde y la misma hoja de estilos):

- `eslint.config.js` de la raíz: agregar `pasarelas` a los ignorados.
- `src/styles/index.css` de la raíz: excluir `pasarelas/` del escaneo de clases de Tailwind, solo si la hoja de
  estilos del gestor cambia al existir la carpeta.
- `README.md` de la raíz: una línea que diga que `pasarelas/` es otro proyecto.

## 13. Entrega y lo que queda del lado del dueño

Se entrega: código en la rama de la sesión con commits pequeños, migración probada en local, pruebas en verde,
semilla, `docs/PASARELAS.md`, capturas de las pantallas en el celular y un resumen corto.

No se hace sin el dueño: crear o reactivar un proyecto de Supabase (su plan gratis está lleno), aplicar la migración
a una base remota, crear el proyecto de Vercel y publicar. Queda el paso a paso. Advertencia que va en el resumen:
un libro de dinero real en el plan gratis de Supabase se pausa a los 7 días sin uso y no tiene copias automáticas;
por eso existe «Exportar todo».
