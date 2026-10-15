import type { Quilt } from '../quilt/build.ts';
import type { Sewing } from '../interaction/sewing.ts';
import { renderQuilt } from './quilt.ts';

/**
 * 고해상도 PNG. 화면에 보이는 그대로가 아니라, 사용자가 꿰맨 땀 그대로를 큰 캔버스에 다시 그린다.
 * iOS 사파리는 캔버스 면적이 약 16.7M 픽셀을 넘으면 빈 그림을 주므로 폭을 줄여 가며 시도한다.
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
