# Avance

Una línea por etapa: qué quedó y cómo se prueba. Capturas en [capturas/](capturas/).

| Etapa | Qué quedó | Cómo se prueba | Capturas |
|---|---|---|---|
| E0 · Arranque | Vite + React 19 + TS estricto, Tailwind 4 con los tokens de Stitch en un solo archivo, Manrope, PWA (manifiesto, íconos, service worker), rutas con hash y base `/gestor-propiedades/`. Capas `data` (interfaz + Dexie) y `services` (permisos `can`, zod, auditoría). Semilla relativa a hoy, cargada en un Worker. Entrada con «Entrar como…», QR del link, instalar y datos de la demo. Marco por rol y «Cambiar de rol». | `npm run dev` → entrar con cualquier cuenta. | `E0-entrada-movil` |
| E1 · Panel y propiedades | Panel único (ocupadas, libres, en mantenimiento, ocupación, ganancia neta, ADR, RevPAR, rentas atrasadas, alertas, estado y salud de cada propiedad, mapa, entradas/salidas, tareas de hoy); panel de atención sin dinero; portafolio con filtros y mapa; ficha con operación, salud, finanzas, códigos tapados, datos privados del propietario con ROI, documentos, historial y fotos; alta y edición. | Propietario → Panel → una propiedad. Atención al cliente → Panel. | `E1-panel-movil`, `E1-panel-escritorio`, `E1-propiedades-movil`, `E1-ficha-movil` |
| E2 · Reservas, calendario y contratos | Lista, línea de tiempo y vista por mes con bloqueos; detalle con montos e historial; «Registrar salida» crea la limpieza; alta con aviso de cruces; importar `.ics` (con archivo de ejemplo); contratos con libro de pagos, recargo, renovación y documentos; calendario general. | Administración → Reservas (pestañas) → Importar .ics; Contratos → C-201 (atrasado) → Registrar pago. | `E2-reservas-escritorio`, `E2-linea-de-tiempo`, `E2-contrato-atrasado` |
| E3 · Limpieza y mantenimiento | Operación con urgencias, gastos por aprobar, carga, pendientes; app de limpieza (hoy, ruta, próximas salidas; checklist con fotos de antes y después obligatorias, faltantes, daños que se vuelven incidencia u orden urgente); app del técnico (presupuesto, materiales, fotos, costo real que va a gastos o a aprobación); preventivo que crea órdenes solas; proveedores; incidencias. **Primera publicación** del link. | Limpieza (Rosa) → una tarea → fotos de ejemplo → «Reportar daño» → terminar. Mantenimiento (Tomás) → la orden → resolver. | `E3-operacion-movil`, `E3-app-limpieza`, `E3-checklist-fotos`, `E3-app-tecnico` |
| E4 · Huéspedes y mensajes | Registro de huéspedes e inquilinos, fichas («no volver a alquilar», documento verificado sí/no), bandeja única con plantillas ES/EN y «Enviar a todos», indicadores; app del huésped (ES/EN, códigos solo durante la estadía) y del inquilino (contrato, pago atrasado, historial, documentos, reportar). | Atención (Diego) → Mensajes → Emily → plantilla. Huésped (Emily) → ES/EN. Inquilino (Javier). | `E4-huespedes-mensajes`, `E4-conversacion`, `E4-app-huesped`, `E4-app-inquilino` |
| E5 · Finanzas y documentos | Finanzas consolidadas en moneda base con tasas manuales, flujo de 6 meses, margen, registrar ingresos y gastos (umbral → aprobación), desempeño por propiedad con ocupación/ADR/RevPAR/ROI, CSV; estado de cuenta mensual imprimible; documentos con etiquetas, cumplimiento y vencimientos. | Propietario → Finanzas → Estado de cuenta → Imprimir. Contabilidad → Finanzas (solo lectura). | `E5-finanzas-escritorio`, `E5-estado-de-cuenta`, `E5-documentos-movil` |
| E6 · Avisos, calendario, ajustes | Campana de avisos para todos los roles; calendario general; ajustes (empresa y logo, monedas y tasas, umbral, compartir datos privados, checklists, categorías, equipo, auditoría de solo agregar, datos de la demo, apariencia). | Propietario → campana; Más → Ajustes. | `E6-avisos-movil`, `E6-ajustes-movil`, `E6-calendario-escritorio` |
| E7 · Pulido | Recorrido guiado de 8 pasos («Hazlo por mí» o a mano), «Cambiar de rol», restablecer/exportar/importar JSON, modo oscuro, pantalla de carga estática, semilla en Worker, guía de la demo. **Publicación final.** | Entrada → «Iniciar recorrido». `npm run check`, `npm run test:e2e`. | `E7-recorrido-paso1`, `E7-modo-oscuro` |

## Estado de las verificaciones (al publicar)
- `npm run lint`: sin errores. `npm run typecheck`: sin errores.
- `npm test` (Vitest): **35 pruebas en verde** en 9 archivos, entre ellas las de cada rol que intentan lo prohibido.
- `npm run test:e2e` (Playwright, Chrome del sistema, contra `vite preview` en `/gestor-propiedades/`): **4 en verde**:
  el recorrido de 8 pasos y «cada rol entra a su app», a **390×844** y a **1280×800**.
- **Lighthouse móvil** (simulado, navegador limpio, contra `vite preview`): rendimiento **90–91**, accesibilidad
  **100**, buenas prácticas **100**. Con los datos ya cargados (segunda visita): rendimiento 100.
- El link publicado no se pudo abrir desde el contenedor (la red bloquea `github.io`): el despliegue se verificó por
  la API de GitHub. `npm run test:live` hace la prueba en vivo desde cualquier computadora.

## Qué falta
Ver [PENDIENTES.md](PENDIENTES.md): datos reales, pasar a servidor (Supabase), sincronizar el calendario de Airbnb
y enviar mensajes por WhatsApp o correo.
