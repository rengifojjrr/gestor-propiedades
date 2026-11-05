# Decisiones

Decisiones técnicas tomadas para la demo, con su porqué. Lo que falta definir con el cliente está en
[PENDIENTES.md](PENDIENTES.md).

## Entorno y versiones

- **Se construyó en un contenedor en la nube, no en el Mac del plan original.** Diferencias que importan:
  - Node 22 (no 24). `npm 10` tiene un fallo interno (`Cannot read properties of null (reading 'edgesOut')`) con
    los peers de Vitest: las dependencias se instalaron con `npx npm@11`. En el Mac (npm 11) basta `npm ci`.
  - Playwright usa `channel: 'chrome'`. Aquí ese Chrome es *Chrome for Testing*; en el Mac es el Chrome instalado.
  - La red del contenedor bloquea Wikimedia, Unsplash, `github.io` y los mapas de OpenStreetMap:
    - **Fotos**: no se pudieron bajar. Se usan **ilustraciones SVG originales** (`public/demo/`, CC0), como
      permitía el plan.
    - **Link publicado**: no se pudo abrir desde aquí. Se verificó por la API de GitHub (el flujo «pages build
      and deployment» terminó bien) y se probó el mismo `dist/` con `vite preview` en la misma ruta base.
      `npm run test:live` repite la prueba contra el link real desde cualquier computadora.
    - **Mapas**: en las pruebas los mosaicos no cargan (los marcadores sí). En un teléfono normal cargan.
- **Versiones conocidas y estables** para entregar en una noche sin sorpresas: Vite 7, React 19, React Router 7
  (`createHashRouter`), TypeScript 5.9 (typescript-eslint aún no soporta TS ≥ 6.1), ESLint 9, Vitest 4,
  Tailwind 4, zod 4, Dexie 4, luxon 3, Leaflet 1.9, Recharts 3, lucide-react, vite-plugin-pwa 1.3. Ya existen
  Vite 8, React Router 8 y TypeScript 7: actualizar es una tarea aparte.

## Publicación

- GitHub Pages sirve la rama `gh-pages` (se activó sola al empujar la rama). Base `/gestor-propiedades/`,
  rutas con hash (`#/panel`) para que recargar nunca dé 404, y `public/.nojekyll`.
- Se publica con `npm run build && npm run deploy` (paquete `gh-pages`, opción `-t` para subir `.nojekyll`).
- La app lleva `<meta name="robots" content="noindex, nofollow">`.

## Arquitectura

- **Capas**: pantallas → `src/services` (reglas, permisos, validación con zod, auditoría) → `src/data`
  (interfaz `DataStore`) → implementación local con Dexie (`src/data/local`). Las pantallas nunca tocan Dexie.
- **Reactividad**: `useLive(consulta, deps)` vuelve a correr la consulta cuando cambia cualquier dato (la
  implementación avisa después de cada escritura). Con el volumen de la demo (~1.500 registros) es instantáneo;
  con servidor se cambia por consultas con caché e invalidación por tabla.
- **Reloj único** (`src/lib/clock.ts`): todo «hoy» pasa por ahí, en la **zona horaria de cada propiedad**
  (San Juan usa `America/Puerto_Rico`, Houston `America/Chicago`). Las pruebas fijan la fecha.
- **Semilla relativa a hoy** (`src/data/seed`): es determinista (misma fecha → mismos datos) y siempre trae una
  reserva que termina hoy. Si el navegador tiene datos de otro día, aparece «Restablecer»; el recorrido
  restablece solo.
- **Tokens** en un solo archivo (`src/styles/tokens.css`), con la paleta por defecto de Tailwind apagada
  (`--color-*: initial`). Gráficas, mapa, QR y canvas leen los colores de las variables CSS en tiempo de
  ejecución. Una prueba (`tests/unit/tokens.test.ts`) falla si aparece un color escrito a mano.
- El manifiesto de la PWA y `theme-color` leen sus colores de `tokens.css` al compilar (no se repiten).
- Íconos: lucide (equivalentes de los Material Symbols de Stitch). Letra: Manrope servida desde el sitio
  (`@fontsource-variable/manrope`), sin CDN.

## Permisos

- Se aplican en los servicios con `can(sujeto, acción, recurso)` (`src/services/permissions.ts`); las pantallas
  además esconden lo que el rol no puede hacer, pero la regla vive en el servicio. Tabla en
  [PERMISOS.md](PERMISOS.md); pruebas en `tests/unit/permissions.test.ts`.
- **En esta demo los permisos corren en el navegador**: alguien con herramientas de desarrollador podría leer
  IndexedDB. Es aceptable porque todo es de ejemplo y cada navegador tiene sus propios datos. **Con servidor se
  vuelven seguros de verdad** repitiendo las mismas reglas en la base (RLS por rol y por propiedad, funciones
  `security definer` para lo sensible) — ver [SUPABASE.md](SUPABASE.md).
- «Ver como…» (propietario): el actor lleva `readOnly`, y `can()` niega toda acción de escritura.
- Fotos: se piden por id después de que el servicio dueño (tarea, orden, incidencia) autorizó el registro.
  Con servidor: Storage privado con URLs firmadas por registro.

## Códigos de acceso (cerradura, caja de llaves, wifi)

- En la demo son inventados. Se guardan aparte (`accessCodes`) y **nunca viajan en mensajes ni plantillas**: la
  plantilla de entrada manda el link de la app.
- El **huésped** los ve solo durante su estadía: desde el día de entrada hasta el de salida, incluidos, en la zona
  horaria de la propiedad, y si la reserva no está cancelada ni terminada (`codesVisibleForStay`). Fuera de ese
  rango llegan tapados (ni siquiera el nombre de la red wifi).
- **En todos los demás lugares aparecen tapados.** Propietario y administración pueden destapar uno con «Mostrar»,
  y cada vez queda en la auditoría.
- **Cómo se guardarían cifrados con el servidor:**
  1. Tabla `access_codes` con `secret_ciphertext bytea` (no texto plano), cifrado con una llave guardada en
     **Supabase Vault** (o `pgsodium` con llave administrada); la llave nunca sale de la base.
  2. Sin `select` directo para nadie (RLS niega todo). La única forma de leer es la función
     `reveal_access_code(code_id)` (`security definer`) que: verifica el rol (propietario/administración de esa
     propiedad) **o** que quien pide es el huésped de una reserva activa con `today` (en la zona de la propiedad)
     entre la entrada y la salida; descifra; escribe en `audit_log`; y devuelve el valor.
  3. Rotación: al terminar cada estadía se puede generar un código nuevo (integración con la cerradura,
     «Próximamente») y el viejo queda inválido.

## Dinero

- **No se mueve dinero.** Rentas, pagos de reservas y gastos se **registran** (método y referencia). No hay
  pasarelas ni claves.
- Montos en unidades mayores con 2 decimales (`round2`); en la base irían como `numeric(12,2)`.
- Cada propiedad tiene su moneda (todas USD en la demo, el campo está listo). Cada movimiento guarda `amount` en la
  moneda de la propiedad y `amountBase` con la **tasa manual vigente en su fecha** (Ajustes → Monedas). Si falta la
  tasa, no se registra. Los reportes del portafolio suman solo `amountBase`; `sumSameCurrency` falla si se intentan
  sumar monedas distintas (pruebas en `tests/unit/finance.test.ts`).
- **Reservas**: ingreso = alojamiento + limpieza (+ impuesto si el canal no lo remite); gastos = comisión del canal
  y, si el canal no remite el impuesto, «Impuestos de hospedaje». Comisiones de ejemplo: Airbnb 3 %, Booking 15 %,
  Vrbo 5 %, directo 0 %. Airbnb y Vrbo remiten el impuesto; Booking y directo no. Se registra al terminar la
  estadía.
- **ADR, RevPAR y ocupación** (`occupancyStats`): noches disponibles = días del período − bloqueos; ADR = ingreso
  por alojamiento / noches vendidas; RevPAR = ingreso por alojamiento / noches disponibles. Ocupación «en libros»:
  incluye reservas confirmadas del mes. En las de por meses, ocupación = días con contrato.
- **ROI** = ganancia neta de los últimos 12 meses (anualizada si hay menos historia) / precio de compra. Solo lo ve
  quien ve los datos privados.
- **Gastos fijos de la semilla** repartidos en el mes (HOA el 10, hipoteca el 15, servicios el 20, seguro el 25,
  administración del portafolio el 28) para que la ganancia del mes en curso no arranque negativa el día 1.

## Reglas de operación

- **Estados de reserva**: confirmada → en curso (el día de entrada) → terminada (al «Registrar salida» o, si nadie
  la registra, sola al día siguiente) o cancelada. Así la reserva que «termina hoy» se ve todo el día.
- **Nunca se cruzan**: misma propiedad, rango `[entrada, salida)`; la salida de una puede ser la entrada de otra.
  Cuentan también los bloqueos y los contratos activos (propiedades mixtas).
- **Limpieza de salida**: se crea sola al terminar la reserva (una vez por reserva), asignada a la persona de
  limpieza de la propiedad, con la checklist de la propiedad, el nombre del huésped y la hora de la próxima entrada.
  Para cerrarla: checklist completa + al menos 1 foto de antes + 1 de después. El pago por tarea va a gastos.
- **Daños**: urgente o alto → orden de mantenimiento automática con esa prioridad, asignada al proveedor de la
  categoría (y a su técnico si tiene cuenta). Medio o bajo → incidencia que atención al cliente o administración
  asigna.
- **Aprobación de gastos** (umbral en Ajustes, 500 USD por defecto): un presupuesto por encima del umbral pide la
  aprobación del propietario; si el costo real supera el umbral sin aprobación previa, el gasto queda «pendiente de
  aprobación» y no cuenta hasta que el propietario lo aprueba. Lo aprobado cubre hasta un 10 % más.
- **Preventivo**: cada calendario crea su orden cuando llega la fecha (una vez por fecha) y avanza la siguiente.
  Corre al abrir la app y cada minuto.
- **Recargo por atraso**: porcentaje de la renta o monto fijo, después de los días de gracia. El libro marca cada
  mes como pagado, pagado con atraso, por pagar, atrasado o próximo. Renovación: aviso 60 días antes del fin.
- **Salud de la propiedad** (0–100): −25/−15/−8 por incidencia abierta urgente/alta/otra, −12 por orden atrasada,
  −10 por limpieza sin hacer, −8 por documento por vencer (30 días), −20 por documento vencido. ≥ 80 buena,
  ≥ 50 atención, < 50 crítica.

## Personas y documentos

- Ninguna persona, dirección, teléfono, correo ni monto es real (direcciones marcadas «de ejemplo», teléfonos
  555, correos `.test`).
- **Ningún documento de identidad**: la ficha solo dice «documento verificado: sí/no». Nunca se guarda la imagen.
- Los documentos de ejemplo no tienen archivo (se abre una hoja que lo dice). Los que se suben desde el teléfono
  se guardan en IndexedDB como Blob (máx. 15 MB).
- Fotos: se comprimen en el navegador a WebP de 1600 px como máximo (JPEG si el navegador no codifica WebP, como
  Safari).

## Mensajes y avisos

- Una sola bandeja por reserva o contrato. Nada sale por WhatsApp ni por correo: «Próximamente».
- Avisos (campana): se calculan del estado (urgencias, rentas atrasadas, documentos por vencer, limpiezas sin
  hacer, aprobaciones, renovaciones) más eventos guardados (reservas nuevas, daños, pagos, mensajes). Lo leído se
  marca por usuario.

## Accesibilidad y diseño

- Contraste AA: el verde sobre menta usa `#005236` (el `#00714D` de Stitch queda justo en 4.5:1); el ámbar `#C88000`
  (3.2:1 sobre blanco) solo se usa en bordes, barras e íconos, nunca como texto.
- Diálogos con `<dialog>` (foco atrapado y Escape), foco visible, «Ir al contenido», etiquetas en todos los campos.
- Modo oscuro derivado de los mismos tokens (clase `.dark`), con selector Sistema/Claro/Oscuro por dispositivo.

## Rendimiento

- La semilla (~2.000 registros) se genera y se escribe en IndexedDB **dentro de un Worker**: la primera visita no
  congela la pantalla (TBT de ~2 s a ~0,1 s). Si el navegador no tiene Worker, se hace en el hilo principal.
- `index.html` trae una pantalla de carga estática con el mismo encabezado de la entrada, que React reemplaza.
- Las pantallas se cargan perezosas (una por ruta); Leaflet, Recharts e ical.js solo cuando se usan.
- Se probó separar las librerías en paquetes propios (`manualChunks`): bajó Lighthouse móvil de 91 a 88 por la
  cantidad de descargas en paralelo, así que se dejó el reparto por defecto de Vite.
- El registro del service worker va diferido. Con la PWA instalada todo sale de la caché.

## Recorrido guiado

- 8 pasos (`src/features/tour`). Cada paso se puede hacer a mano en la pantalla o con «Hazlo por mí», que llama a
  los mismos servicios con la cuenta del paso (propietario, Rosa de limpieza, Tomás técnico): el recorrido también
  ejercita los permisos. Al empezar restablece los datos para que la historia siempre cuadre.
