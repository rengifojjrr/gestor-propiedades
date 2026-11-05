# Plan para pasar a servidor (Supabase) — sin construir

Hoy los datos viven en cada navegador (IndexedDB). Para que el equipo comparta datos y los permisos sean seguros de
verdad, el paso natural es Supabase (Postgres + Auth + Storage + RLS). Las pantallas no cambian: se escribe una
implementación nueva de `DataStore` (`src/data/store.ts`) y los servicios siguen igual.

## 1. Autenticación
- Supabase Auth con enlace mágico o código por correo/SMS. Tabla `profiles (id uuid = auth.uid(), role, name,
  person_id, vendor_id, active)`.
- Huéspedes e inquilinos entran con un enlace por reserva/contrato (token de un solo uso) que crea su sesión.

## 2. Tablas (Postgres)
Las mismas de [MODELO.md](MODELO.md), con las embebidas como tablas hijas:
- `properties`, `property_photos`, `amenities` (o `text[]`), `access_codes`, `checklists`, `checklist_items`,
  `vendors`, `user_properties (user_id, property_id)`.
- `bookings`, `booking_status_history`, `booking_notes`, `blocks`, `leases`, `lease_payments`.
- `cleaning_tasks`, `cleaning_task_items`, `cleaning_task_photos`, `maintenance_orders`, `maintenance_costs`,
  `maintenance_photos`, `incidents`, `preventive_schedules`.
- `threads`, `messages`, `templates`.
- `transactions`, `fx_rates`, `budgets`.
- `documents` (+ archivo en Storage), `notifications`, `notification_reads`, `settings`, `audit_log`.
- Montos `numeric(12,2)`, monedas `char(3)`, fechas de calendario `date` + `timezone` en la propiedad.
- Restricción para que las reservas no se crucen: `exclude using gist (property_id with =, daterange(check_in,
  check_out, '[)') with &&) where (status <> 'cancelled')` (extensión `btree_gist`).

## 3. RLS por rol y por propiedad
Funciones de ayuda (`security definer`, `stable`):
- `app_role()` → rol del usuario actual.
- `can_see_property(pid)` → propietario; o `user_properties` contiene `pid` (equipo); o tiene una tarea/orden en
  `pid` (limpieza/técnico); o es huésped de una reserva activa/próxima o inquilino de un contrato en `pid`.

Políticas (resumen; la tabla completa de reglas es [PERMISOS.md](PERMISOS.md)):
- `properties`: `select` si `can_see_property(id)`; `update` solo propietario y administración asignada. Columnas
  privadas en una tabla aparte `property_private` con `select` solo para el propietario (o si `settings.share_owner_financials`).
- `bookings`: equipo de la propiedad; huésped solo `guest_id = auth_person()`. Limpieza: nada (ve nombre y horas por la
  vista `cleaning_task_view`).
- `cleaning_tasks`: limpieza solo `assignee_id = auth.uid()`; equipo de la propiedad.
- `maintenance_orders`: técnico solo `assignee_user_id = auth.uid()`; costos en `maintenance_costs` con `select`
  para propietario, administración, contabilidad y el técnico asignado.
- `transactions`, `fx_rates`, `budgets`: propietario, administración (de sus propiedades) y contabilidad (`select`).
  `insert` de gastos por encima del umbral entra con `status = 'pending_approval'` (trigger); solo el propietario
  pasa a `posted` (función `approve_transaction`).
- `documents`: por `visibility` y propiedad; Storage con la misma política y URLs firmadas de corta vida.
- `audit_log`: `insert` desde triggers y funciones; **sin `update` ni `delete` para nadie** (append-only).
- «Ver como…»: solo en el cliente, con la sesión del propietario y lecturas filtradas como el otro rol (o una
  función `impersonate_read(role)` que devuelve vistas de solo lectura).

## 4. Códigos de acceso cifrados
- `access_codes(id, property_id, kind, label, secret_ciphertext bytea, key_id)` cifrado con una llave de
  **Supabase Vault** (o `pgsodium`). RLS niega todo `select`.
- `reveal_access_code(code_id)` (`security definer`): permite al propietario/administración de la propiedad, o al
  huésped con una reserva no cancelada cuyo rango (en la zona horaria de la propiedad) contiene hoy; descifra,
  escribe en `audit_log` y devuelve el valor. Nada más puede leerlo.
- Los mensajes y plantillas nunca incluyen códigos (solo el link de la app).

## 5. Automatismos
- `pg_cron` cada 15 min: avanzar reservas (en curso / terminadas + limpieza de salida), preventivo vencido, avisos.
- Edge Function para importar `.ics` (y más adelante sincronizar el enlace iCal de Airbnb/Vrbo cada hora).
- Edge Functions para enviar por WhatsApp/correo cuando se active («Próximamente»).

## 6. Migración
1. Crear el esquema y las políticas con migraciones (`supabase/migrations`).
2. Escribir `createSupabaseStore()` que implemente `DataStore` (repos sobre tablas; `subscribe` con Realtime).
3. Mover a funciones SQL lo que hoy valida el cliente y debe ser autoritativo: cruces de reservas, aprobación por
   umbral, revelar códigos, recargo por atraso y libro de pagos.
4. Importar el JSON de la demo (Ajustes → Exportar) como datos de prueba.
5. Cambiar `configureStore(createSupabaseStore())` en `src/data/index.ts`.
