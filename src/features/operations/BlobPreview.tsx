/** Vista previa de una foto que todavía no se guardó (para formularios con foto adjunta). */
import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn } from '@/ui';

export function BlobPreview({ blob, alt, onRemove, className }: { blob: Blob; alt: string; onRemove?: () => void; className?: string }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return (
    <div className={cn('relative w-40 overflow-hidden rounded-md bg-surface-container', className)}>
      {url && <img src={url} alt={alt} className="aspect-[4/3] w-full object-cover" />}
      {onRemove && (
        <button type="button" onClick={onRemove} aria-label="Quitar foto" title="Quitar foto" className="absolute top-1 right-1 flex h-9 w-9 items-center justify-center rounded-full bg-scrim text-on-image">
          <X size={18} aria-hidden />
        </button>
      )}
    </div>
  );
}
