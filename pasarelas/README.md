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
npm ci                # con npm 10 puede fallar: npx npm@11 ci
npm run db:start      # levanta el Supabase local y escribe .env.local
npm run dev           # http://localhost:3000
```

```bash
npm run typecheck && npm run lint && npm test   # tipos, lint y pruebas del motor
npm run test:int                                # contra el Supabase local
npm run test:e2e -- --trace off                 # de punta a punta, en celular y escritorio
```

Convenciones del proyecto y trampas conocidas: [`AGENTS.md`](AGENTS.md).
