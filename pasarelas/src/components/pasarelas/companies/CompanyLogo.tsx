import { cn } from "@/components/ui";
import { initialsOf } from "./initials";

export type CompanyLogoProps = {
  name: string;
  /** La URL firmada (60 s) del logo, generada al pintar; `null` = sin logo: van las iniciales. */
  url: string | null;
  size?: "md" | "lg";
  className?: string;
};

/** El logo de una empresa o, si no tiene, sus iniciales sobre un sello verde. */
export function CompanyLogo({ name, url, size = "md", className }: CompanyLogoProps) {
  const box = cn(size === "lg" ? "size-16 text-xl" : "size-11 text-base", "shrink-0 rounded-control", className);
  if (url !== null) {
    const imageClass = cn(box, "border border-rule bg-surface object-contain");
    // Una URL firmada de Storage: `<img>` normal, nunca next/image optimizado.
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt={`Logo de ${name}`} className={imageClass} />;
  }
  return (
    <span
      aria-hidden
      className={cn(box, "inline-flex items-center justify-center bg-brand-soft font-semibold text-brand")}
    >
      {initialsOf(name)}
    </span>
  );
}
