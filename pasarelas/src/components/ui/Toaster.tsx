"use client";

import type { CSSProperties } from "react";
import { Toaster as Sonner } from "sonner";

/** Los colores de los avisos salen de los tokens (claro y oscuro los resuelve la hoja de estilos). */
const TOKENS = {
  "--normal-bg": "var(--color-surface)",
  "--normal-text": "var(--color-ink)",
  "--normal-border": "var(--color-rule-strong)",
  "--border-radius": "var(--radius-control)",
  fontFamily: "var(--font-sans)",
} as CSSProperties;

/**
 * Donde aparecen los avisos pasajeros de `notify`. Va UNA vez, en el layout raíz. Salen arriba para no
 * tapar la barra inferior ni el botón de registrar.
 */
export function Toaster() {
  return (
    <Sonner
      position="top-center"
      theme="system"
      containerAriaLabel="Avisos"
      style={TOKENS}
      toastOptions={{ style: { fontSize: "1rem", boxShadow: "var(--shadow-raised)" } }}
    />
  );
}
