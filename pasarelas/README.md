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

Convenciones del proyecto y trampas conocidas: [`AGENTS.md`](AGENTS.md).
