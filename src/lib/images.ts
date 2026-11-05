/**
 * Fotos: se comprimen en el navegador a WebP de 1600 px como máximo (JPEG si el navegador
 * no sabe codificar WebP, como Safari). También genera «fotos de ejemplo» para la demo.
 */
import { tokenValue } from '@/ui/tokens';

export const MAX_PHOTO_SIDE = 1600;

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

export async function compressImage(file: Blob, maxSide = MAX_PHOTO_SIDE, quality = 0.82): Promise<Blob> {
  if (!file.type.startsWith('image/')) return file;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file;
  }
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) return file;
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const webp = await canvasToBlob(canvas, 'image/webp', quality);
  if (webp && webp.type === 'image/webp') return webp;
  return (await canvasToBlob(canvas, 'image/jpeg', quality)) ?? file;
}

const PHASE_TEXT: Record<string, string> = {
  before: 'Antes',
  after: 'Después',
  report: 'Reporte',
  resolved: 'Resuelto',
  damage: 'Daño',
};

/**
 * Foto de ejemplo dibujada en un canvas (para probar la demo en una computadora sin cámara).
 * Usa los colores de los tokens.
 */
export async function sampleImage(phase: keyof typeof PHASE_TEXT | string, caption = ''): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = 960;
  canvas.height = 720;
  const ctx = canvas.getContext('2d')!;
  const clean = phase === 'after' || phase === 'resolved';
  const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
  grad.addColorStop(0, tokenValue(clean ? 'secondary-container' : 'warning-container') || 'gray');
  grad.addColorStop(1, tokenValue('surface-high') || 'white');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // Piso y pared
  ctx.fillStyle = tokenValue('surface-container') || 'white';
  ctx.fillRect(0, 470, canvas.width, 250);
  // Mueble
  ctx.fillStyle = tokenValue('primary-container') || 'black';
  ctx.fillRect(170, 330, 620, 170);
  ctx.fillStyle = tokenValue('outline-variant') || 'gray';
  ctx.fillRect(200, 300, 560, 40);
  // Marca de daño o brillo
  ctx.beginPath();
  if (phase === 'before' || phase === 'report' || phase === 'damage') {
    ctx.strokeStyle = tokenValue('error') || 'red';
    ctx.lineWidth = 10;
    ctx.arc(600, 420, 70, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    ctx.fillStyle = tokenValue('on-image') || 'white';
    for (const [x, y] of [
      [300, 260],
      [520, 230],
      [700, 280],
    ]) {
      ctx.beginPath();
      ctx.arc(x, y, 14, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.fillStyle = tokenValue('primary') || 'black';
  ctx.font = '700 54px Manrope Variable, sans-serif';
  ctx.fillText(`Foto de ejemplo · ${PHASE_TEXT[phase] ?? phase}`, 40, 90);
  if (caption) {
    ctx.font = '500 34px Manrope Variable, sans-serif';
    ctx.fillText(caption.slice(0, 48), 40, 145);
  }
  return (await canvasToBlob(canvas, 'image/webp', 0.8)) ?? (await canvasToBlob(canvas, 'image/jpeg', 0.8))!;
}
