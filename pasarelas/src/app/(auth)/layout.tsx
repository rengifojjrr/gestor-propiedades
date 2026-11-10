/** El marco de la entrada: una columna angosta y centrada, sin navegación (todavía no hay sesión completa). */
export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-6 px-4 py-10">
      <p className="titulo text-xl text-brand">Pasarelas</p>
      {children}
    </main>
  );
}
