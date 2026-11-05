# Gestor de Propiedades

Gestor **interno** de propiedades para un propietario que alquila por noches (tipo Airbnb) y por meses: la
operación, los problemas y la contabilidad de todas sus propiedades desde un solo panel, con una app por rol
(propietario, administración, atención al cliente, limpieza, mantenimiento, huésped, inquilino y contabilidad).

**Demo publicada:** https://rengifojjrr.github.io/gestor-propiedades/ — PWA instalable, en español (ES/EN para
huéspedes e inquilinos), con **datos de ejemplo**. No es un marketplace ni una app pública.

> Es una demo sin servidor: los datos viven en cada navegador (IndexedDB). No se cobra ni se mueve dinero: todo se
> registra. Personas, direcciones, códigos y montos son inventados.

## Cómo se usa
- En la entrada: **«Entrar como…»** cualquier rol (sin contraseña), o **«Iniciar recorrido»** (8 pasos).
- Botón flotante **«Cambiar de rol»** siempre a mano. Guía de una página: [docs/GUIA-DEMO.md](docs/GUIA-DEMO.md).

## Desarrollo
Requiere Node ≥ 20.19 (probado con 22 y 24).

```bash
npm ci                # si npm falla con EACCES/EEXIST: npm ci --cache ./.npm-cache
npm run dev           # http://localhost:5173/gestor-propiedades/
npm run check         # lint + tipos + pruebas unitarias (Vitest)
npm run build         # tipos + compilación a dist/
npm run test:e2e      # Playwright con el Chrome del sistema contra `vite preview` (390×844 y 1280×800)
npm run test:live     # la misma comprobación contra el link publicado
npm run deploy        # publica dist/ en la rama gh-pages (GitHub Pages)
```

## Estructura
| Carpeta | Qué hay |
|---|---|
| `src/styles/tokens.css` | Los tokens de diseño (colores, letra, sombras, esquinas): la única fuente de colores |
| `src/domain` | Modelo (esquemas zod), reglas puras (cruces, recargos, monedas, ADR/RevPAR, códigos), textos |
| `src/data` | Interfaz `DataStore`, implementación local (Dexie), semilla, `useLive` |
| `src/services` | Reglas, permisos (`can`), validación y auditoría. Las pantallas solo usan esto |
| `src/ui`, `src/layout`, `src/app` | Kit de componentes (estilo Stitch), marco por rol, rutas, sesión |
| `src/features/*` | Las pantallas por área y las apps de cada rol; `tour` es el recorrido guiado |
| `tests/unit`, `tests/e2e` | Vitest (reglas, permisos por rol, tokens) y Playwright (recorrido de punta a punta) |
| `docs/` | [DECISIONES](docs/DECISIONES.md), [PERMISOS](docs/PERMISOS.md), [MODELO](docs/MODELO.md), [SUPABASE](docs/SUPABASE.md), [PENDIENTES](docs/PENDIENTES.md), [AVANCE](docs/AVANCE.md), [GUIA-DEMO](docs/GUIA-DEMO.md) |

## Estado
Qué quedó, cómo se prueba y qué falta: [docs/AVANCE.md](docs/AVANCE.md) y [docs/PENDIENTES.md](docs/PENDIENTES.md).
