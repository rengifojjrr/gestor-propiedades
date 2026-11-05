# Permisos por rol

Se aplican en la capa de servicios con `can(sujeto, acción, recurso)` (`src/services/permissions.ts`), nunca solo
escondiendo botones. Las pruebas de `tests/unit/permissions.test.ts` intentan lo prohibido con cada rol y deben
fallar. En «Ver como…» (propietario) todo es solo lectura.

**Alcance por propiedades**: equipo → las asignadas (`propertyIds`, «todas» o una lista); limpieza → las de sus
tareas; técnico → las de sus órdenes; huésped → las de sus reservas; inquilino → las de sus contratos.

| Qué | Propietario | Administración | Atención al cliente | Limpieza | Mantenimiento | Huésped | Inquilino | Contabilidad |
|---|---|---|---|---|---|---|---|---|
| Panel del portafolio | ✅ | ✅ | Panel propio (sin dinero) | — | — | — | — | — |
| Propiedades (ver) | ✅ | ✅ asignadas | ✅ asignadas | Solo las de sus tareas | Solo las de sus órdenes | Solo la de su reserva | Solo la de su contrato | ✅ |
| Propiedades (crear, editar, estado) | ✅ | ✅ (crear: si tiene «todas») | — | — | — | — | — | — |
| Datos privados (compra, valor, hipoteca, seguro, HOA, impuestos) | ✅ | Solo si el propietario los comparte | — | — | — | — | — | Solo si se comparten |
| Destapar códigos de acceso (auditado) | ✅ | ✅ | — | — | — | Solo durante su estadía | — | — |
| Reservas (ver) | ✅ | ✅ | ✅ (sin montos en pantalla) | Solo nombre del huésped y horas, dentro de su tarea | — | Solo la suya | — | — |
| Reservas (crear, editar, salida, cancelar, bloquear, importar .ics) | ✅ | ✅ | Solo anotar | — | — | — | — | — |
| Contratos (ver) | ✅ | ✅ | — | — | — | — | Solo el suyo | ✅ lectura |
| Contratos (crear, renovar, registrar pagos) | ✅ | ✅ | — | — | — | — | — | — |
| Limpieza (ver) | ✅ | ✅ | ✅ | Solo sus tareas | — | — | — | — |
| Limpieza (crear, asignar, cancelar) | ✅ | ✅ | — | — | — | — | — | — |
| Limpieza (checklist, fotos, faltantes, daños, terminar) | ✅ | ✅ | — | Solo sus tareas | — | — | — | — |
| Mantenimiento (ver) | ✅ | ✅ | ✅ (sin costos) | — | Solo sus órdenes | — | — | — |
| Mantenimiento (crear, asignar, cambiar) | ✅ | ✅ | — | — | Solo trabajar sus órdenes: estado, presupuesto, materiales, fotos, costo real | — | — | — |
| Aprobar gastos grandes | ✅ | — | — | — | — | — | — | — |
| Incidencias (reportar) | ✅ | ✅ | ✅ | En sus propiedades | — | Con foto, en su propiedad | Con foto, en su propiedad | — |
| Incidencias (asignar / volverlas orden) | ✅ | ✅ | ✅ | — | — | — | — | — |
| Preventivo | ✅ | ✅ | — | — | — | — | — | — |
| Proveedores | ✅ | ✅ | Ver | — | — | — | — | — |
| Personas (huéspedes e inquilinos) | ✅ | ✅ | ✅ | — | — | — | — | — |
| Mensajes y plantillas | ✅ | ✅ | ✅ (y «Enviar a todos») | — | — | Su conversación | Su conversación | — |
| Finanzas (ver) | ✅ | ✅ | — | — | — | — | — | ✅ |
| Finanzas (registrar ingresos y gastos) | ✅ | ✅ (lo que pasa el umbral queda pendiente) | — | — | — | — | — | — |
| Exportar CSV y estado de cuenta | ✅ | ✅ | — | — | — | — | — | ✅ |
| Documentos | ✅ todos | ✅ menos «solo propietario» | Equipo, inquilino y huésped | — | — | Los de su casa marcados para huésped | Los de su contrato y su casa | Solo los financieros |
| Calendario general | ✅ | ✅ | ✅ | Sus tareas | — | — | — | ✅ |
| Avisos | Los suyos | Los suyos | Los suyos | Los suyos | Los suyos | — | — | Los suyos |
| Ajustes (empresa, moneda, umbral, compartir datos privados) | ✅ | Ver | — | — | — | — | — | — |
| Equipo (altas y cambios) | ✅ | ✅ (no crea administración ni propietario) | Ver | — | — | — | — | — |
| Auditoría | ✅ | ✅ | — | — | — | — | — | — |
| «Ver como…» | ✅ (solo mirar) | — | — | — | — | — | — | — |

Acciones técnicas (`Action`) por fila: `property.*`, `booking.*`, `lease.*`, `cleaning.read|write|work`,
`maintenance.read|write|work|readCost|approve`, `incident.*`, `vendor.*`, `person.*`, `thread.read`,
`message.send|broadcast`, `template.*`, `finance.read|write|export|approve`, `document.read|write`,
`calendar.read`, `notification.read`, `settings.read|write`, `team.read|write`, `audit.read`.
Toda acción que no termina en `read`, `readCost`, `readPrivate` o `export` es de escritura y queda prohibida en
«Ver como…».
