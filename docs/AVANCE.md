# Avance

Una línea por etapa: qué quedó y cómo se prueba. Capturas en [capturas/](capturas/).

| Etapa | Qué quedó | Cómo se prueba |
|---|---|---|
| E0 · Arranque | Vite + React 19 + TS estricto, Tailwind 4 con los tokens de Stitch en un solo archivo, Manrope, PWA (manifiesto, íconos, service worker), rutas con hash y base `/gestor-propiedades/`. Capa `data` (interfaz + Dexie) y `services` (permisos `can`, zod, auditoría). Semilla relativa a hoy, cargada en un Worker. Entrada con «Entrar como…», QR del link, instalar y datos de la demo. Marco por rol y «Cambiar de rol». | `npm run dev` → entrar con cualquier cuenta. `npm test`. Captura `E0-entrada-movil.png`. |
