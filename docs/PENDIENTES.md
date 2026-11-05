# Pendientes

## Datos que faltan (hoy son de ejemplo)
- **Nombre y logo de la empresa** (provisional: «Gestor de Propiedades»; se cambian en Ajustes → Empresa).
- **Propiedades reales**: direcciones, fotos, licencias, impuestos de hospedaje de cada ciudad, tarifas, checklists.
- **Equipo real**: quién es administración, atención, limpieza (por ciudad) y técnicos; qué propiedades tiene cada uno.
- **Comisiones por canal** (de ejemplo: Airbnb 3 %, Booking 15 %, Vrbo 5 %) y qué canal remite el impuesto.
- **Umbral de aprobación de gastos** (de ejemplo: 500 USD) y el presupuesto mensual de gastos (24.000 USD).
- **Contratos reales**: día de pago, recargo por atraso y días de gracia.
- **Tasas de cambio** si alguna propiedad cobra en otra moneda (hoy todas en USD).
- Plantillas de mensajes con el tono de la empresa.

## Para decidir
- **Pasar a servidor (Supabase)** para que el equipo comparta datos y los permisos sean seguros de verdad
  (plan en [SUPABASE.md](SUPABASE.md)). Sin eso, cada teléfono tiene su propia copia de la demo.
- **Conectar el calendario de Airbnb/Vrbo** (enlace iCal con sincronización cada hora). Hoy: importar un `.ics` a mano.
- Enviar mensajes por **WhatsApp y correo** (hoy todo queda dentro de la app).
- Integración con cerraduras inteligentes para rotar códigos por estadía.
- ¿Contabilidad necesita exportar a QuickBooks/Xero además del CSV?

## Técnico
- Actualizar a Vite 8, React Router 8 y TypeScript 7 cuando el ecosistema (typescript-eslint) lo soporte.
- PDF del estado de cuenta generado en el servidor (hoy: versión imprimible → «Guardar como PDF»).
- Notificaciones push (requiere servidor).
- Interfaz del equipo en inglés (hoy solo huésped e inquilino tienen ES/EN).
- Copias de seguridad automáticas (hoy: Exportar/Importar JSON a mano).
- Lighthouse: ver el resultado en [AVANCE.md](AVANCE.md).
