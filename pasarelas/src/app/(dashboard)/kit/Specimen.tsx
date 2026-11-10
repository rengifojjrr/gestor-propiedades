import type { ReactNode } from "react";

/** Una sección de la galería: es una región con nombre (su título). */
export function Section({ id, title, intro, children }: { id: string; title: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="mt-10 flex flex-col gap-6 border-t border-rule pt-6">
      <div className="flex flex-col gap-1">
        <h2 id={id} className="titulo text-xl leading-snug">
          {title}
        </h2>
        {intro ? <p className="max-w-prose text-ink-soft">{intro}</p> : null}
      </div>
      {children}
    </section>
  );
}

/** Un componente del kit: su nombre, sus props (firma y para qué sirve cada una) y un ejemplo vivo. */
export function Spec({ name, props, children }: { name: string; props?: readonly (readonly [string, string])[]; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h3 className="font-mono text-sm font-semibold">{name}</h3>
        {props ? (
          <ul className="flex flex-col gap-0.5 text-sm text-ink-soft">
            {props.map(([signature, purpose]) => (
              <li key={signature}>
                <code className="font-mono break-words text-ink">{signature}</code>: {purpose}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {children}
    </div>
  );
}
