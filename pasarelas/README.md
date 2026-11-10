# Pasarelas

Libro de cuentas **privado** para un dueño con varias empresas: registra cada cobro, calcula lo que se llevan la
pasarela, sus opciones y la plataforma, reparte lo neto entre beneficiarios, estima cuándo cae el dinero al banco y
lo resume. **No procesa pagos ni mueve dinero**, y no guarda tarjetas, cuentas completas ni contraseñas.

Es un proyecto **aparte** del gestor de propiedades de la raíz de este repo: su propio `package.json`, su propia
base (Supabase) y su propio despliegue. Qué es cada pieza, cómo calcula y qué queda: [`docs/PASARELAS.md`](docs/PASARELAS.md).

## Desarrollo local

Requiere Node ≥ 20.19 y Docker. Todo se corre desde esta carpeta (`pasarelas/`).

```bash
npm ci             # instala lo del lockfile (sirve con npm 10 y con npm 11)
npm run db:start   # Supabase local con Docker; escribe .env.local si falta o si no trae la clave publicable
npm run seed       # crea el usuario demo con datos de ejemplo e imprime su contraseña
npm run dev        # http://localhost:3000
```

1. `npm run db:start` levanta la base, Auth, la API y Storage. **El panel de Supabase no se levanta en local**: no
   hay dónde crear usuarios a mano, y la app no tiene registro.
2. `npm run seed` crea (o reutiliza) `demo@example.com`, le carga un libro de ejemplo (empresas, pasarelas, cobros
   en todos los estados, repartos y liquidaciones) y **al final imprime su contraseña**. La contraseña es nueva en
   cada corrida y no queda guardada en ningún sitio.
   - Solo siembra sobre un libro vacío. `npm run seed -- --reset` borra antes todo lo de ese usuario.
   - Solo corre contra el stack local. Contra otra base se niega, salvo con `SEED_ALLOW_REMOTE=1`; ahí entra con
     `SEED_EMAIL` y `SEED_PASSWORD` (un usuario que ya existe y sin segundo factor). `--reset` nunca se admite
     contra una base remota.
3. `npm run dev` y entra en http://localhost:3000 con ese correo y esa contraseña.

`npm run db:stop` detiene el stack (los datos se conservan). `npm run db:reset` **borra** la base local y vuelve a
aplicar la migración. Si alguien más usa el mismo stack, no hagas ninguno de los dos.

**Desde el celular, por la red local, hace falta https**: fuera de un contexto seguro el navegador no da
`crypto.randomUUID`, y sin él no funcionan registrar un cobro, subir comprobantes o logos, agregar opciones al crear
una pasarela, agregar líneas a un esquema ni registrar liquidaciones. Arranca con
`npx next dev --experimental-https -H <IP de tu computadora>` y entra en `https://<IP>:3000` (el certificado es
propio: el navegador avisa la primera vez). Los comprobantes van directo del navegador al Supabase local, que escucha
en `127.0.0.1` de tu computadora: desde el celular no llegan.

## Pruebas

| Comando | Qué hace | Qué necesita |
|---|---|---|
| `npm run typecheck` | Tipos (`next typegen` y `tsc`) | Nada más |
| `npm run lint` | ESLint | Nada más |
| `npm test` | Pruebas unitarias (Vitest), junto al código | Nada más: sin red ni base |
| `npm run coverage` | Las unitarias con cobertura: exige 100 % en el motor (`src/lib/pasarelas`) | Nada más |
| `npm run test:int` | Integración contra el Supabase local; cada prueba crea sus propios usuarios | El stack en marcha (`db:start`). Se niega a correr contra otra base |
| `npm run test:e2e` | De punta a punta con Playwright, en celular (390×844) y escritorio (1280×800), con axe | El stack en marcha, el Chromium de Playwright (`npx playwright install chromium` la primera vez) y el puerto 3100 libre |

`npm run test:e2e` compila (`next build`) y arranca su propio servidor en el puerto 3100, o en el de `E2E_PORT`. Si
el puerto está ocupado, falla. Para probar contra un servidor que ya tienes corriendo:
`E2E_BASE_URL=http://127.0.0.1:<puerto> npm run test:e2e`. Un solo archivo: `npm run test:e2e -- e2e/<archivo>`.

**Dos corridas de punta a punta no pueden compartir la misma carpeta a la vez**: las dos compilan en `.next` y se
pisan. Una corrida por copia de trabajo.

## Pasar a producción

Nada de esto está hecho todavía. Son pasos para el dueño, o para quien tenga acceso a sus cuentas. Van en orden.

### 1. Elegir el proyecto de Supabase

El plan gratis permite **2 proyectos activos**, **pausa un proyecto tras una semana sin actividad** y **no tiene
copias automáticas** (son de los planes de pago). Por eso la app trae «Exportar todo» (paso 7). Hay que crear un
proyecto nuevo, o pausar o borrar uno que ya no se use para dejar el hueco.

La migración agrega objetos `pay_`, el esquema `private`, el bucket privado `comprobantes` y sus políticas. Si el
proyecto ya tiene un esquema `private` o un bucket `comprobantes`, los reutiliza y les cambia permisos y políticas:
compruébalo antes (si ese bucket ya existe y es público, la migración se detiene). Si el proyecto ya tiene datos, haz
la copia del paso 2.

### 2. Copia previa de esa base

La cadena de conexión está en el panel del proyecto, en el botón **Connect**. La conexión directa usa IPv6; si tu
red no tiene IPv6, usa la del **Session pooler** (puerto 5432). La cadena lleva la contraseña de la base: no la
guardes en el repo ni en `.env.local`. Guarda las copias **fuera** de esta carpeta.

```bash
DB_URL='postgresql://…'          # la cadena del panel, con la contraseña de la base
mkdir -p ~/copias-pasarelas
```

Con la CLI de Supabase (necesita Docker y no depende de la versión de `pg_dump` que tengas):

```bash
npx supabase db dump --remote="$DB_URL" -f ~/copias-pasarelas/roles.sql --role-only
npx supabase db dump --remote="$DB_URL" -f ~/copias-pasarelas/esquema.sql
npx supabase db dump --remote="$DB_URL" -f ~/copias-pasarelas/datos.sql --use-copy --data-only \
  -x "storage.buckets_vectors" -x "storage.vector_indexes"
```

Sin `--data-only`, `db dump` copia solo el esquema: hacen falta las tres. (`--db-url` también funciona, pero esta
versión de la CLI lo marca como obsoleto.)

O con `pg_dump`, que tiene que ser de la **misma versión mayor que el servidor o más nueva**: uno más viejo se
niega («server version mismatch»). Antes de usarlo, mira la versión del servidor con `select version();` en el SQL
Editor del panel. (El stack local va en Postgres 17.)

```bash
pg_dump --version                                  # la misma versión mayor del servidor, o más
pg_dump "$DB_URL" -Fc -f ~/copias-pasarelas/antes-de-pasarelas.dump
```

### 3. Aplicar la migración

Desde esta carpeta, con `psql`, **en una sola transacción**: si algo falla, no queda nada a medias.

```bash
psql "$DB_URL" --single-transaction -v ON_ERROR_STOP=1 \
  -f supabase/migrations/20261110120000_las_pasarelas_de_pago.sql
```

Al final la propia migración comprueba que toda tabla `pay_` tiene RLS y la política del segundo factor, y que el
bucket tiene la suya; si no, falla y no se aplica nada. **No uses `supabase db push`.**

### 4. Registrar la versión, solo si después usarás la CLI con ese proyecto

Así la CLI sabe que la migración ya está aplicada y no intenta repetirla:

```bash
npx supabase migration repair 20261110120000 --status applied --remote="$DB_URL"
```

Sin `--remote`, la CLI trabaja contra el stack local.

### 5. Ajustes de Auth y usuario dueño

La app da por hechos estos ajustes. En local los pone `supabase/config.toml`; en el proyecto alojado se dejan igual
en la sección **Authentication** del panel (los menús cambian entre versiones del panel), o con la API de
administración (`PATCH /v1/projects/{ref}/config/auth`, con el campo entre paréntesis).

| Ajuste | Local (`supabase/config.toml`) | Proyecto alojado |
|---|---|---|
| Registro público **apagado** | `[auth] enable_signup = false` | «Allow new users to sign up» apagado (`disable_signup: true`) |
| Segundo factor **TOTP activo** | `[auth.mfa.totp] enroll_enabled` y `verify_enabled = true` | Viene activo en todo proyecto; compruébalo (`mfa_totp_enroll_enabled` y `mfa_totp_verify_enabled: true`) |
| Contraseña de **10 caracteres** o más | `[auth] minimum_password_length = 10` | Longitud mínima de la contraseña: 10, en los ajustes del proveedor Email (`password_min_length: 10`) |
| Cambiar la contraseña **exige la actual** | `[auth.email] require_current_password = true` | Por la API de administración (`security_update_password_require_current_password: true`); si el panel no lo ofrece, no pasa nada: la app comprueba la contraseña actual |
| **URL del sitio** y de redirección | `[auth] site_url` y `additional_redirect_urls` | Página **URL Configuration**: «Site URL» y «Redirect URLs» con la dirección pública de la app, paso 6 (`site_url`, `uri_allow_list`) |

La app no manda correos con enlaces; la URL del sitio es a donde llevaría cualquier correo de Auth.

**Usuario dueño**: Authentication → Users → **Add user** → **Create new user**, con correo y contraseña y
marcando que quede confirmado (**Auto Confirm User**). Si no aparece esa casilla, apaga «Confirm email» en el
proveedor Email antes de crearlo. No uses la invitación por correo: la app no tiene pantalla para abrir enlaces de correo.

### 6. Proyecto de Vercel

- Importa el repo y pon **Root Directory** = `pasarelas` (también en Settings → Build and Deployment). Vercel
  reconoce Next.js solo; no hace falta cambiar los comandos.
- Variables de entorno: **solo dos**.
  - `NEXT_PUBLIC_SUPABASE_URL`: la URL del proyecto (`https://<ref>.supabase.co`).
  - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: la clave **publicable** del proyecto (empieza por `sb_publishable_`).
- **Nunca** pongas la clave secreta (`SUPABASE_SECRET_KEY`: salta la RLS y lee todo), ni `PASARELAS_KIT` (abre la
  galería de componentes `/kit`), ni las `SEED_*`.
- Las dos variables se leen al compilar (la política de contenido nombra a Supabase): si cambian, vuelve a
  desplegar.
- La producción de Vercel sale de la rama de producción del proyecto: `main` por defecto, que en este repo es
  también la rama por defecto. Se ve y se cambia en Settings → Environments → Production → Branch Tracking.
  Mientras la rama de trabajo no se fusione con `main`, Vercel la publica solo como vista previa: pon las
  variables también en el entorno **Preview**.
- Vuelve al paso 5 y pon como URL del sitio el dominio de la rama (el que no cambia entre despliegues) o, tras
  fusionar, el de producción.

### 7. Primer ingreso

1. Entra con el usuario dueño en la dirección de Vercel.
2. **Ajustes → Seguridad**: activa el segundo factor (QR o clave). Mejor en dos dispositivos: no hay códigos de
   respaldo, ni recuperar la contraseña por correo. Si se pierden, se resuelve desde el proyecto de Supabase, fuera
   de la app.
3. **Ajustes → Exportar todo**: descarga la primera copia (un JSON con todo lo registrado; no lleva ningún archivo:
   ni los comprobantes, de cobros y de liquidaciones, ni los logos de las empresas; solo sus filas). Repítela cada
   tanto y guárdala fuera de Supabase.

No corras `npm run seed` contra producción: son datos de ejemplo.

## Estructura

| Carpeta | Qué hay |
|---|---|
| `src/lib/pasarelas/` | El motor: cálculos puros (dinero, fechas, reglas, resumen, importador) con sus pruebas |
| `src/server/pasarelas/` | Lecturas, escrituras y Server Actions; hablan con Supabase |
| `src/app/`, `src/components/` | Pantallas y componentes |
| `supabase/` | La migración y la configuración del stack local |
| `scripts/` | Stack local, semilla demo, capturas e íconos |
| `tests/integration/`, `e2e/` | Pruebas contra el Supabase local y de punta a punta |
| `docs/` | [`PASARELAS.md`](docs/PASARELAS.md), capturas, diseño y plan |

Convenciones, trampas conocidas y cómo trabajar en el código: [`AGENTS.md`](AGENTS.md).
