import { Camera, ImagePlus, Loader2, Sparkles } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Photo } from '@/domain/types';
import { compressImage, sampleImage } from '@/lib/images';
import { svc } from '@/services';
import { buttonClass } from './Button';
import { cn } from './cn';

const BASE = import.meta.env.BASE_URL;

/** URL temporal (object URL) de un archivo guardado en el navegador. */
export function useFileUrl(fileId?: string): string | undefined {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!fileId) {
      setUrl(undefined);
      return;
    }
    let revoked = false;
    let objectUrl: string | undefined;
    svc.files.getFile(fileId).then((f) => {
      if (revoked || !f) return;
      objectUrl = URL.createObjectURL(f.blob);
      setUrl(objectUrl);
    });
    return () => {
      revoked = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [fileId]);
  return url;
}

/** Ruta pública de una ilustración de ejemplo ('demo/miami-1.svg' → '/gestor-propiedades/demo/miami-1.svg'). */
export function assetUrl(src: string): string {
  return src ? `${BASE}${src.replace(/^\//, '')}` : '';
}

/** Foto de propiedad: ilustración de ejemplo (src) o foto subida (fileId). */
export function PropertyImage({ photo, src, alt, className }: { photo?: Pick<Photo, 'src' | 'fileId'>; src?: string; alt: string; className?: string }) {
  const fileUrl = useFileUrl(photo?.fileId);
  const url = fileUrl ?? assetUrl(photo?.src ?? src ?? '');
  if (!url) return <div className={cn('bg-surface-container', className)} role="img" aria-label={alt} />;
  return <img src={url} alt={alt} loading="lazy" decoding="async" className={cn('object-cover', className)} />;
}

export function FileImage({ fileId, alt, className }: { fileId: string; alt: string; className?: string }) {
  const url = useFileUrl(fileId);
  if (!url) return <div className={cn('animate-pulse bg-surface-container', className)} aria-hidden />;
  return <img src={url} alt={alt} className={cn('object-cover', className)} />;
}

/** Iniciales en círculo (no se guardan fotos de personas). */
export function Avatar({ name, size = 'md', className }: { name: string; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');
  const tones = ['bg-info-container text-on-info-container', 'bg-warning-container text-on-warning-container', 'bg-secondary-container text-on-secondary-container', 'bg-surface-high text-primary'];
  const tone = tones[[...name].reduce((s, c) => s + c.charCodeAt(0), 0) % tones.length];
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full font-bold',
        size === 'sm' && 'h-8 w-8 text-label-sm',
        size === 'md' && 'h-10 w-10 text-label-md',
        size === 'lg' && 'h-14 w-14 text-headline-md',
        tone,
        className,
      )}
    >
      {initials}
    </span>
  );
}

export interface PhotoInputProps {
  /** Recibe la foto ya comprimida (WebP ≤ 1600 px). */
  onPhoto: (blob: Blob) => Promise<void> | void;
  label?: ReactNode;
  /** Abre la cámara trasera directamente en el teléfono. */
  camera?: boolean;
  /** Muestra «Usar foto de ejemplo» (para probar en una computadora). */
  sample?: { phase: string; caption?: string };
  /** Texto del botón de foto de ejemplo (por defecto «Usar foto de ejemplo»). */
  sampleLabel?: string;
  size?: 'md' | 'lg';
  variant?: 'primary' | 'secondary' | 'tonal' | 'mint';
  disabled?: boolean;
  testId?: string;
}

/** Botón de cámara (o galería) con compresión en el navegador. La cámara va primero. */
export function PhotoInput({ onPhoto, label = 'Tomar foto', camera = true, sample, sampleLabel = 'Usar foto de ejemplo', size = 'lg', variant = 'primary', disabled, testId }: PhotoInputProps) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const handle = async (blob: Blob) => {
    setBusy(true);
    try {
      await onPhoto(blob);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        ref={ref}
        type="file"
        accept="image/*"
        capture={camera ? 'environment' : undefined}
        className="sr-only"
        data-testid={testId}
        tabIndex={-1}
        aria-hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) await handle(await compressImage(file));
        }}
      />
      <button type="button" disabled={disabled || busy} className={buttonClass(variant, size)} onClick={() => ref.current?.click()}>
        {busy ? <Loader2 size={20} className="animate-spin" aria-hidden /> : camera ? <Camera size={20} aria-hidden /> : <ImagePlus size={20} aria-hidden />}
        {label}
      </button>
      {sample && (
        <button
          type="button"
          disabled={disabled || busy}
          className={buttonClass('ghost', 'sm')}
          onClick={async () => handle(await sampleImage(sample.phase, sample.caption))}
        >
          <Sparkles size={16} aria-hidden />
          {sampleLabel}
        </button>
      )}
    </div>
  );
}
