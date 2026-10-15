import type { Quilt } from '../quilt/build.ts';
import type { Sewing } from '../interaction/sewing.ts';
import { renderQuilt } from './quilt.ts';

/**
 * High-resolution PNG. Rather than copying the screen, it redraws the user's own stitches on a large canvas.
 * iOS Safari returns a blank image for canvases over ~16.7M pixels, so it retries at smaller widths.
 */
export async function exportPng(q: Quilt, sewing: Sewing, mode: 'wall' | 'light', widths = [3000, 2400, 1600]): Promise<Blob> {
  for (const w of widths) {
    const canvas = document.createElement('canvas');
    renderQuilt(canvas, q, w, {
      sewing,
      transforms: q.patchwork.pieces.map(() => ({ dx: 0, dy: 0, rot: 0, cx: 0, cy: 0 })),
      reveal: null,
      mode,
    });
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
    canvas.width = canvas.height = 0;
    if (blob && blob.size > 10_000) return blob;
  }
  throw new Error('This device could not create a large image.');
}

export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export const exportName = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `jogakbo-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}.png`;
};
