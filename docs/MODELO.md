# Modelo de datos

Esquemas zod y tipos en `src/domain/types.ts`; tablas Dexie en `src/data/local/dexieStore.ts`. Montos en unidades
mayores con 2 decimales; fechas de calendario `AAAA-MM-DD` en la zona horaria de la propiedad; marcas de tiempo ISO
en UTC.

## Personas y equipo
| Tabla | Campos principales |
|---|---|
| `users` | id, name, role (owner, admin, support, cleaner, technician, guest, tenant, accountant), title, email, phone, propertyIds ('all' o lista: hace de `user_properties`), personId (huésped/inquilino), vendorId (técnico), active |
| `people` | id, kind (guest/tenant), name, email, phone, language (es/en), country, notes, doNotRent, idVerified (solo sí/no: nunca la imagen), tags |

Los roles son fijos (`ROLES`); con servidor se vuelven una tabla `roles` si hace falta personalizarlos.

## Propiedades
| Tabla | Campos principales |
|---|---|
| `properties` | id, name, type, country, region, city, neighborhood, address, lat, lng, timezone, currency, photos[] (embebidas: `property_photos`), bedrooms, bathrooms, capacity, sizeM2, amenities[] (embebidas: `amenities`), rentalMode (nightly/monthly/mixed), statusOverride (none/maintenance/blocked), license {number, expiresOn}, houseManual/checkInInstructions/directions {es,en}, checkInTime, checkOutTime, nightlyRate, cleaningFee, cleaningPay, monthlyRent, taxRate, defaultCleanerId, vendorIds[], ownerPrivate {purchasePrice, purchaseDate, estimatedValue, mortgage, insurance, hoaMonthly, propertyTaxAnnual}, notes, archived |
| `accessCodes` | id, propertyId, kind (door, lockbox, wifi, gate, alarm), label, value (lo sensible; cifrado con servidor) |
| `checklists` | id, propertyId, rooms[{name, items[]}] |
| `vendors` | id, name, specialties[], contactName, phone, email, rating, notes, active |

El estado visible de la propiedad (ocupada, libre, en mantenimiento, bloqueada) se calcula: el manual manda; si no,
«ocupada» si hay estadía o contrato hoy.

## Alquiler
| Tabla | Campos principales |
|---|---|
| `bookings` | id, code, propertyId, guestId, channel (airbnb/booking/vrbo/direct: solo etiqueta), checkIn, checkOut, guests, nightlyRate, cleaningFee, commission, taxes, taxRemittedByChannel, netPayout, currency, status, statusHistory[] (el historial de estados), notes[], source (manual/ics/seed), externalUid, needsDetails |
| `blocks` | id, propertyId, start, end (exclusivo), reason (owner/maintenance/other), note |
| `leases` | id, code, propertyId, tenantId, start, end (inclusivo), rent, currency, dueDay, deposit, lateFee {kind percent/fixed, value, graceDays}, status (active/ended/terminated), notes |
| `leasePayments` | id, leaseId, period (AAAA-MM), amount, lateFee, paidOn, method, reference, recordedBy |

## Operación
| Tabla | Campos principales |
|---|---|
| `cleaningTasks` | id, propertyId, bookingId, type (checkout/deep/inspection), status, assigneeId, date, time, priority, fee, currency, items[{room, label, done}] (ítems de la checklist), photos[{fileId, phase before/after}], supplies[] (faltantes), incidentIds[], notes, guestName, nextCheckIn, startedAt, completedAt, expenseId |
| `maintenanceOrders` | id, code, propertyId, incidentId, title, description, category, priority (urgent/high/medium/low), status (open/scheduled/in_progress/resolved/cancelled), assigneeUserId, vendorId, scheduledDate, estimate, actualCost, currency, materials[] (costos), photos[{fileId, phase report/resolved}], approval {status, amount, decidedBy, decidedAt, note}, preventiveId, expenseId, resolutionNote, resolvedAt |
| `incidents` | id, propertyId, title, description, category, severity, source (cleaning/guest/tenant/team), kind (damage/missing/problem), reportedBy, reporterName, cleaningTaskId, bookingId, leaseId, photos[], status, maintenanceOrderId |
| `preventive` | id, propertyId, title, category, every {unit week/month, count}, nextDue, vendorId, assigneeUserId, estimate, active, lastCreatedFor |

## Mensajes
| Tabla | Campos principales |
|---|---|
| `threads` | id, kind (booking/lease/general), propertyId, bookingId, leaseId, personId, subject, lastMessageAt, lastMessagePreview, unreadTeam, unreadPerson |
| `messages` | id, threadId, at, author {kind team/person/system, userId, personId, name}, body, templateKey, broadcastId, attachments[] |
| `templates` | id, key, name, body {es, en} con variables `{{guest_name}}`…, builtIn |

## Dinero
| Tabla | Campos principales |
|---|---|
| `transactions` | id, propertyId (vacío = portafolio), type (income/expense), category, amount, currency, amountBase, fxRate, date, description, method, reference, status (posted/pending_approval/void), source {kind booking/lease_payment/cleaning/maintenance/manual/recurring, id}, createdBy |
| `fxRates` | id, currency, rate (moneda base por 1 unidad), date |
| `budgets` | id, month, propertyId (opcional), amount (gastos, moneda base) |

## Documentos
| Tabla | Campos principales |
|---|---|
| `documents` | id, name, category (contract, insurance, deed, license, invoice, inspection, other), propertyId, personId, leaseId, tags[], expiresOn, fileId, mime, size, visibility (owner/team/finance/tenant/guest), uploadedBy, sample |
| `files` | id, blob, name, mime, size (fotos y documentos, en IndexedDB) |

## Sistema
| Tabla | Campos principales |
|---|---|
| `notifications` | id, at, kind, title, body, link, propertyId, roles[], userIds[] (los eventos; los avisos calculados no se guardan) |
| `notificationReads` | id (usuario + aviso), userId, notificationId, at |
| `settings` | id 'app', companyName, logoFileId, baseCurrency, approvalThreshold, shareOwnerFinancials, guestLanguages, customExpenseCategories[], theme, seedDate, seededAt |
| `audit` | id, at, actorId, actorName, actorRole, action, entity, entityId, summary — **solo se agrega** (la interfaz no tiene editar ni borrar) |

## Cambios respecto del borrador
- `user_properties` es el campo `users.propertyIds`; `property_photos` y `amenities` van embebidas en la propiedad;
  los ítems y fotos de limpieza y las fotos y costos de mantenimiento van embebidos en su registro. En Postgres
  serían tablas hijas (ver [SUPABASE.md](SUPABASE.md)).
- Se agregaron `notificationReads` (lo leído por usuario) y `files` (los Blob).
