# Pasarelas

Libro de cuentas **privado** para un dueño con varias empresas: registra cada cobro, calcula lo que se llevan la
pasarela, sus opciones y la plataforma, reparte lo neto entre beneficiarios, estima cuándo cae el dinero al banco y
lo resume. **No procesa pagos ni mueve dinero**, y no guarda tarjetas, cuentas completas ni contraseñas.

Es un proyecto **aparte** del gestor de propiedades que vive en la raíz de este repo: tiene su propio
`package.json`, su propia base (Supabase) y su propio despliegue. No comparten código.

> Estado: en construcción. Qué hay, cómo se usa y qué falta para producción: [`docs/PASARELAS.md`](docs/PASARELAS.md).

## Desarrollo

Requiere Node ≥ 20.19 y Docker (para el Supabase local).

```bash
npm ci                # instala lo del lockfile (con npm 10 o con npm 11)
npm run db:start      # levanta el Supabase local; escribe .env.local solo si falta o si le falta la clave
npm run dev           # http://localhost:3000
```

Para agregar dependencias con npm 10 usa `npx npm@11 install <paquete>`: con npm 10, `npm install` puede fallar al
resolver el árbol («edgesOut»); `npm ci` no. `npm run db:env` vuelve a escribir en `.env.local` la URL y las claves
del stack local y conserva lo demás que tenga.

```bash
npm run typecheck && npm run lint && npm test   # tipos, lint y pruebas del motor
npm run test:int                                # contra el Supabase local
npm run test:e2e -- --trace off                 # de punta a punta, en celular y escritorio
```

De punta a punta con tu propio puerto, de dos maneras:

```bash
# Modo producción: compila y arranca su propio servidor (falla si el puerto ya está ocupado)
E2E_PORT=31xx npm run test:e2e -- --trace off e2e/<archivo>

# Desarrollo: contra un `next dev` que ya tienes corriendo
npx next dev -p 31xx
E2E_BASE_URL=http://127.0.0.1:31xx npm run test:e2e -- --trace off e2e/<archivo>
```

El Supabase local es **uno solo y compartido** entre todas las copias de trabajo: si alguien más lo está usando, no
hagas `npm run db:reset` (borra la base) ni `npm run db:stop` (lo detiene para todos).

## Sesión y segundo factor

Se entra con correo y contraseña en `/login`; **no hay registro**. Si la cuenta tiene segundo factor (TOTP), la
entrada sigue en `/login/verificar` y hasta escribir el código no se ve ninguna pantalla ni ningún dato (lo exige
también la base, con RLS). En **Ajustes → Seguridad** se activa el segundo factor (QR o clave), se agregan o quitan
dispositivos, se cambia la contraseña y se cierra la sesión, aquí o en todos los dispositivos. Mientras la cuenta no
tenga segundo factor, todas las pantallas lo avisan.

No están en la app, y se resuelven desde el panel de Supabase: **crear la cuenta del dueño** (Authentication → Users
→ «Add user»), **restablecer una contraseña olvidada** y **quitar el segundo factor de un teléfono perdido** (no hay
códigos de respaldo: conviene activar un segundo dispositivo).

### Ajustes de Auth que la app da por hechos

En local los pone `supabase/config.toml` (cambiarlo exige reiniciar el stack: `npm run db:stop` y `npm run db:start`;
los datos se conservan). En el proyecto alojado hay que dejarlos igual, en el panel (Authentication) o con la API de
administración (`PATCH /v1/projects/{ref}/config/auth`; entre paréntesis, el nombre del campo cuando se conoce):

| Ajuste | Local (`supabase/config.toml`) | Proyecto alojado |
|---|---|---|
| Registro público **apagado** | `[auth] enable_signup = false` | Sign In / Providers → «Allow new users to sign up» apagado (`disable_signup: true`) |
| Cambiar la contraseña **exige la actual** | `[auth.email] require_current_password = true` | (`security_update_password_require_current_password: true`) |
| Contraseña de **10 caracteres** o más | `[auth] minimum_password_length = 10` | Longitud mínima de la contraseña: 10 |
| Segundo factor **TOTP activo** | `[auth.mfa.totp] enroll_enabled = true` y `verify_enabled = true` | Multi-Factor → TOTP activado (`mfa_totp_enroll_enabled` y `mfa_totp_verify_enabled`) |
| **URL del sitio** | `[auth] site_url` | URL Configuration → «Site URL»: la dirección pública de la app |

Si «exige la actual» queda apagado, Supabase **ignora** la contraseña actual que manda la app y cualquiera con una
sesión abierta puede cambiarla. Con segundo factor activo, Supabase solo deja cambiar la contraseña o quitar un
dispositivo a una sesión que entró con su código.

Convenciones del proyecto y trampas conocidas: [`AGENTS.md`](AGENTS.md).
