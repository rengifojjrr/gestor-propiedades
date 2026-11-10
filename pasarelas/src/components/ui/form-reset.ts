import { useCallback, useLayoutEffect, useRef, type Ref, type RefCallback } from "react";

/*
 * Al terminar la acción de un `<form action>`, React 19 reinicia el formulario con `form.reset()`. El reinicio
 * devuelve cada control a su valor «por defecto» del DOM: `defaultSelected` en las opciones de un select y
 * `defaultChecked` en una casilla. React no los toca cuando el control es controlado (`value`, `checked`), así que
 * se quedan en lo que trajo el HTML del servidor (o, si se montó en el navegador, en la primera opción y sin marcar):
 * la pantalla enseñaría otra cosa que el estado hasta el siguiente render.
 *
 * Estos ganchos mantienen ese valor por defecto igual al controlado, de modo que el reinicio no cambia nada en
 * pantalla. Corren en `useLayoutEffect`, después de la fase en la que React reinicia el formulario. Si el mismo
 * render que lo reinicia trae un valor nuevo, también queda bien: el reinicio deja el control como «no tocado», y un
 * control no tocado enseña su valor por defecto, que el gancho pone enseguida en el nuevo.
 * Sin `value` / `checked` (control no controlado) no hacen nada: el reinicio vacía ese campo como siempre.
 */

/** Engancha `node` al ref que el control ya traía por props (objeto o función) y devuelve cómo soltarlo. */
function attachRef<T>(ref: Ref<T> | undefined, node: T | null): () => void {
  if (typeof ref === "function") {
    const cleanup = ref(node);
    return typeof cleanup === "function" ? cleanup : () => ref(null);
  }
  if (!ref) return () => {};
  ref.current = node;
  return () => {
    ref.current = null;
  };
}

/** Deja como `defaultSelected` justo las opciones del valor elegido. */
function syncDefaultSelected(select: HTMLSelectElement, value: string | number | readonly string[]) {
  const wanted = typeof value === "object" ? value.map(String) : [String(value)];
  for (const option of select.options) option.defaultSelected = wanted.includes(option.value);
}

/** Deja `defaultChecked` igual a lo marcado. */
function syncDefaultChecked(input: HTMLInputElement, checked: boolean) {
  input.defaultChecked = checked;
}

/** Para un `<select>`: el reinicio del formulario lo deja en el valor controlado. Devuelve el `ref` que lleva. */
export function useSelectResetBaseline(
  value: string | number | readonly string[] | undefined,
  outerRef: Ref<HTMLSelectElement> | undefined,
): RefCallback<HTMLSelectElement> {
  const selectRef = useRef<HTMLSelectElement | null>(null);
  const ref = useCallback(
    (node: HTMLSelectElement | null) => {
      selectRef.current = node;
      const detach = attachRef(outerRef, node);
      return () => {
        selectRef.current = null;
        detach();
      };
    },
    [outerRef],
  );
  // Sin lista de dependencias: las `<option>` pueden cambiar sin que cambie el valor.
  useLayoutEffect(() => {
    if (selectRef.current && value !== undefined && value !== null) syncDefaultSelected(selectRef.current, value);
  });
  return ref;
}

/** Para una casilla o un interruptor: el reinicio lo deja en `checked`. Devuelve el `ref` que lleva. */
export function useCheckedResetBaseline(
  checked: boolean | undefined,
  outerRef: Ref<HTMLInputElement> | undefined,
): RefCallback<HTMLInputElement> {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const ref = useCallback(
    (node: HTMLInputElement | null) => {
      inputRef.current = node;
      const detach = attachRef(outerRef, node);
      return () => {
        inputRef.current = null;
        detach();
      };
    },
    [outerRef],
  );
  useLayoutEffect(() => {
    if (inputRef.current && checked !== undefined && checked !== null) syncDefaultChecked(inputRef.current, checked);
  }, [checked]);
  return ref;
}
