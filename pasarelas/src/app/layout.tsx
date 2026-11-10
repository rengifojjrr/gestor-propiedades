import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { Toaster } from "@/components/ui";
import { THEME_COLORS } from "@/components/ui/tokens";
import "./globals.css";

// Archivo (variable: peso y ancho), servida desde el propio sitio. Licencia OFL en ./fonts/OFL-Archivo.txt.
const archivo = localFont({
  src: "./fonts/archivo-latin-wdth-normal.woff2",
  variable: "--font-archivo",
  weight: "100 900",
  display: "swap",
  declarations: [{ prop: "font-stretch", value: "62% 125%" }],
});

export const metadata: Metadata = {
  title: { default: "Pasarelas", template: "%s · Pasarelas" },
  description: "Libro privado de cobros, comisiones, depósitos y repartos.",
  robots: { index: false, follow: false },
  appleWebApp: { title: "Pasarelas", statusBarStyle: "default" },
  icons: {
    icon: [
      { url: "/icons/icon.svg", type: "image/svg+xml" },
      { url: "/icons/icon-192.png", type: "image/png", sizes: "192x192" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: THEME_COLORS.light.paper },
    { media: "(prefers-color-scheme: dark)", color: THEME_COLORS.dark.paper },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es" className={archivo.variable}>
      <body>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
